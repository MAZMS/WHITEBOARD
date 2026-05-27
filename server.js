const express = require('express');
const OpenAI = require('openai');
const path = require('path');
const { getSystemPrompt, getAllAgents } = require('./agents');
const pool = require('./db');

const app = express();

// ── Postgres helpers ──
let dbReady = false;

async function initDatabase() {
  if (!pool) {
    console.log('DATABASE_URL not set — running in memory-only mode');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id SERIAL PRIMARY KEY,
        date TEXT NOT NULL,
        premium_used INTEGER DEFAULT 0,
        mini_used INTEGER DEFAULT 0,
        default_model TEXT DEFAULT 'gpt-5.4',
        UNIQUE(date)
      );
      CREATE TABLE IF NOT EXISTS token_history (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        date TEXT NOT NULL,
        model TEXT,
        tier TEXT,
        agent TEXT,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0
      );
    `);
    dbReady = true;
    console.log('Postgres tables ready');
  } catch (err) {
    console.error('Postgres init failed — falling back to memory:', err.message);
  }
}

async function loadUsageFromDb() {
  if (!dbReady) return;
  try {
    const today = todayStr();
    const usageResult = await pool.query('SELECT * FROM token_usage WHERE date = $1', [today]);
    const row = usageResult.rows[0];
    if (row) {
      tokenUsage.premium = row.premium_used || 0;
      tokenUsage.mini = row.mini_used || 0;
      tokenUsage.settings.defaultModel = row.default_model || 'gpt-5.4';
    }
    const historyResult = await pool.query(
      'SELECT * FROM token_history WHERE date = $1 ORDER BY created_at DESC LIMIT 100',
      [today],
    );
    tokenUsage.history = historyResult.rows.map((r) => ({
      timestamp: r.created_at,
      model: r.model,
      tier: r.tier,
      agent: r.agent,
      prompt_tokens: r.prompt_tokens,
      completion_tokens: r.completion_tokens,
      total: r.total_tokens,
    }));
    tokenUsage.date = today;
    console.log(`Loaded usage from DB: premium=${tokenUsage.premium}, mini=${tokenUsage.mini}, history=${tokenUsage.history.length} rows`);
  } catch (err) {
    console.error('Failed to load usage from DB:', err.message);
  }
}

async function persistUsage(tier, tokens, model, agentName, usage) {
  if (!dbReady) return;
  try {
    // Upsert daily totals — use separate queries per tier to stay fully parameterized
    if (tier === 'premium') {
      await pool.query(`
        INSERT INTO token_usage (date, premium_used, default_model)
        VALUES ($1, $2, $3)
        ON CONFLICT (date) DO UPDATE SET premium_used = token_usage.premium_used + $2
      `, [todayStr(), tokens, tokenUsage.settings.defaultModel]);
    } else {
      await pool.query(`
        INSERT INTO token_usage (date, mini_used, default_model)
        VALUES ($1, $2, $3)
        ON CONFLICT (date) DO UPDATE SET mini_used = token_usage.mini_used + $2
      `, [todayStr(), tokens, tokenUsage.settings.defaultModel]);
    }

    // Insert history record
    await pool.query(`
      INSERT INTO token_history (date, model, tier, agent, prompt_tokens, completion_tokens, total_tokens)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [todayStr(), model, tier, agentName, usage.prompt_tokens || 0, usage.completion_tokens || 0, usage.total_tokens || 0]);
  } catch (err) {
    console.error('Failed to persist usage to DB:', err.message);
  }
}

// ── Security headers ──
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── OpenAI client ──
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Model tiers ──
const PREMIUM_MODELS = [
  'gpt-5.4', 'gpt-5.2', 'gpt-5.1', 'gpt-5.1-codex', 'gpt-5',
  'gpt-5-codex', 'gpt-5-chat-latest', 'gpt-4.1', 'gpt-4o', 'o1', 'o3',
];

const MINI_MODELS = [
  'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.1-codex-mini', 'gpt-5-mini',
  'gpt-5-nano', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o-mini',
  'o1-mini', 'o3-mini', 'o4-mini', 'codex-mini-latest',
];

const DAILY_LIMITS = {
  premium: 250_000,
  mini: 2_500_000,
};

// ── In-memory token tracking (resets daily) ──
let tokenUsage = {
  date: todayStr(),
  premium: 0,
  mini: 0,
  history: [],     // { timestamp, model, prompt_tokens, completion_tokens, total, agent }
  settings: {
    defaultModel: 'gpt-5.4',
  },
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function resetIfNewDay() {
  const today = todayStr();
  if (tokenUsage.date !== today) {
    tokenUsage.date = today;
    tokenUsage.premium = 0;
    tokenUsage.mini = 0;
    tokenUsage.history = [];
  }
}

function getModelTier(model) {
  if (PREMIUM_MODELS.includes(model)) return 'premium';
  if (MINI_MODELS.includes(model)) return 'mini';
  return 'premium'; // default to premium for unknown models
}

// ── API: Chat with agent ──
app.post('/api/agent', async (req, res) => {
  try {
    resetIfNewDay();

    const { agent, message, messages: msgHistory, model: requestedModel, displayName, role, outputType } = req.body;
    const model = requestedModel || tokenUsage.settings.defaultModel;
    const tier = getModelTier(model);

    // Check limits
    if (tokenUsage[tier] >= DAILY_LIMITS[tier]) {
      return res.status(429).json({
        error: `Daily ${tier} token limit reached (${DAILY_LIMITS[tier].toLocaleString()} tokens). Try a ${tier === 'premium' ? 'mini' : 'premium'} model or wait until tomorrow.`,
        usage: { premium: tokenUsage.premium, mini: tokenUsage.mini },
      });
    }

    // Get base system prompt and inject agent identity
    let systemPrompt = getSystemPrompt(agent);
    if (displayName || role) {
      const identity = `Your name is ${displayName || 'Agent'}. Your role is ${role || 'Assistant'}. Always use this name when asked. You ARE this person — never say you're an AI, a bot, or "custom". Stay in character.`;
      systemPrompt = identity + '\n\n' + systemPrompt;
    }
    if (outputType) {
      systemPrompt += `\nYour primary output is: ${outputType}. Produce this output directly when asked — don't just describe it or ask questions.`;
    }
    // Chat-mode: keep replies conversational, output is generated separately
    systemPrompt += `\n\nIMPORTANT: You are in CHAT MODE. Only respond with short conversational messages. NEVER include code blocks, documents, plans, or any substantial output in your chat. If the user asks you to create something, just acknowledge it casually like "on it, working on that now" or "sure, let me put that together for you". The actual output will be generated separately.`;

    // Build messages: system prompt + conversation history (trimmed to last 20 to limit token usage)
    const chatMessages = [{ role: 'system', content: systemPrompt }];
    if (msgHistory && Array.isArray(msgHistory)) {
      const trimmed = msgHistory.length > 20 ? msgHistory.slice(-20) : msgHistory;
      chatMessages.push(...trimmed);
    } else {
      chatMessages.push({ role: 'user', content: message });
    }

    const completion = await openai.chat.completions.create({
      model,
      messages: chatMessages,
      max_completion_tokens: 2048,
    });

    const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const reply = completion.choices[0]?.message?.content || '';

    // Track usage (in-memory + DB)
    tokenUsage[tier] += usage.total_tokens;
    tokenUsage.history.push({
      timestamp: new Date().toISOString(),
      model,
      tier,
      agent: agent || 'custom',
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total: usage.total_tokens,
    });

    persistUsage(tier, usage.total_tokens, model, agent || 'custom', usage);
    logRequest({ agent, model, tier, tokens: usage.total_tokens });

    res.json({
      reply,
      model,
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total: usage.total_tokens,
      },
    });
  } catch (err) {
    console.error('Agent error:', err.message);
    res.status(err.status || 500).json({ error: safeErrorMessage(err) });
  }
});

// ── API: Stream chat with agent ──
app.post('/api/agent/stream', async (req, res) => {
  try {
    resetIfNewDay();

    const { agent, message, messages: msgHistory, model: requestedModel, displayName, role, outputType } = req.body;
    const model = requestedModel || tokenUsage.settings.defaultModel;
    const tier = getModelTier(model);

    if (tokenUsage[tier] >= DAILY_LIMITS[tier]) {
      return res.status(429).json({
        error: `Hey, we've used up today's ${tier} tokens. Try again tomorrow or switch to a ${tier === 'premium' ? 'mini' : 'premium'} model.`,
        usage: { premium: tokenUsage.premium, mini: tokenUsage.mini },
      });
    }

    // Get base system prompt and inject agent identity
    let systemPrompt = getSystemPrompt(agent);
    if (displayName || role) {
      const identity = `Your name is ${displayName || 'Agent'}. Your role is ${role || 'Assistant'}. Always use this name when asked. You ARE this person — never say you're an AI, a bot, or "custom". Stay in character.`;
      systemPrompt = identity + '\n\n' + systemPrompt;
    }
    if (outputType) {
      systemPrompt += `\nYour primary output is: ${outputType}. Produce this output directly when asked — don't just describe it or ask questions.`;
    }
    // Chat-mode: keep replies conversational, output is generated separately
    systemPrompt += `\n\nIMPORTANT: You are in CHAT MODE. Only respond with short conversational messages. NEVER include code blocks, documents, plans, or any substantial output in your chat. If the user asks you to create something, just acknowledge it casually like "on it, working on that now" or "sure, let me put that together for you". The actual output will be generated separately.`;

    // Build messages: system prompt + conversation history (trimmed to last 20 to limit token usage)
    const chatMessages = [{ role: 'system', content: systemPrompt }];
    if (msgHistory && Array.isArray(msgHistory)) {
      const trimmed = msgHistory.length > 20 ? msgHistory.slice(-20) : msgHistory;
      chatMessages.push(...trimmed);
    } else {
      chatMessages.push({ role: 'user', content: message });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await openai.chat.completions.create({
      model,
      messages: chatMessages,
      max_completion_tokens: 2048,
      stream: true,
      stream_options: { include_usage: true },
    });

    // Abort the upstream stream if the client disconnects
    let clientDisconnected = false;
    req.on('close', () => {
      clientDisconnected = true;
      stream.controller?.abort?.();
    });

    let totalTokens = 0;

    for await (const chunk of stream) {
      if (clientDisconnected) break;

      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
      }
      if (chunk.usage) {
        totalTokens = chunk.usage.total_tokens || 0;
        tokenUsage[tier] += totalTokens;
        tokenUsage.history.push({
          timestamp: new Date().toISOString(),
          model,
          tier,
          agent: agent || 'custom',
          prompt_tokens: chunk.usage.prompt_tokens || 0,
          completion_tokens: chunk.usage.completion_tokens || 0,
          total: totalTokens,
        });
        persistUsage(tier, totalTokens, model, agent || 'custom', chunk.usage);
      }
    }

    logRequest({ agent, model, tier, tokens: totalTokens });

    if (!clientDisconnected) {
      res.write(`data: ${JSON.stringify({ done: true, total_tokens: totalTokens })}\n\n`);
      res.end();
    }
  } catch (err) {
    if (err.name === 'AbortError') return; // client disconnected, nothing to send
    console.error('Stream error:', err.message);
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: safeErrorMessage(err) });
    }
  }
});

// ── API: Generate output separately (no chat, just the deliverable) ──
app.post('/api/agent/output', async (req, res) => {
  try {
    resetIfNewDay();

    const { agent, message, outputType, displayName, role, messages: history, model: requestedModel } = req.body;
    const model = requestedModel || tokenUsage.settings.defaultModel;
    const tier = getModelTier(model);

    if (tokenUsage[tier] >= DAILY_LIMITS[tier]) {
      return res.status(429).json({
        error: `Daily ${tier} token limit reached.`,
        usage: { premium: tokenUsage.premium, mini: tokenUsage.mini },
      });
    }

    const outputPrompt = `You are ${displayName || 'Agent'}, a ${role || 'Assistant'}.
Your job is to produce ${outputType || 'Document'} based on the user's request.
ONLY output the deliverable — no chat, no explanations, no greetings, no "here you go", no "sure thing".
If the output type is Code, produce complete runnable HTML/CSS/JS in a single file.
If it's a Business Plan, produce a structured plan.
If it's a Document, produce the document text.
If it's a Strategy or Report, produce the full content.
Just the raw output, nothing else.`;

    // Use conversation history for context but generate ONLY the output
    const chatMessages = [{ role: 'system', content: outputPrompt }];
    if (history && Array.isArray(history)) {
      const trimmed = history.length > 10 ? history.slice(-10) : history;
      chatMessages.push(...trimmed);
    }
    chatMessages.push({ role: 'user', content: `Produce ${outputType || 'Document'} for: ${message}` });

    const completion = await openai.chat.completions.create({
      model,
      messages: chatMessages,
      max_completion_tokens: 4096,
    });

    const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const output = completion.choices[0]?.message?.content || '';

    // Track usage
    tokenUsage[tier] += usage.total_tokens;
    tokenUsage.history.push({
      timestamp: new Date().toISOString(),
      model,
      tier,
      agent: agent || 'custom',
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total: usage.total_tokens || 0,
    });

    persistUsage(tier, usage.total_tokens, model, agent || 'custom', usage);
    logRequest({ agent: agent || 'custom', model, tier, tokens: usage.total_tokens });

    res.json({
      output,
      model,
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total: usage.total_tokens,
      },
    });
  } catch (err) {
    console.error('Output generation error:', err.message);
    res.status(err.status || 500).json({ error: safeErrorMessage(err) });
  }
});

// ── Admin API: Get usage stats ──
app.get('/api/admin/usage', async (req, res) => {
  resetIfNewDay();

  // Try to serve fresh data from DB; fall back to in-memory cache
  if (dbReady) {
    try {
      const today = todayStr();
      const usageResult = await pool.query('SELECT * FROM token_usage WHERE date = $1', [today]);
      const row = usageResult.rows[0] || { premium_used: 0, mini_used: 0, default_model: tokenUsage.settings.defaultModel };
      const historyResult = await pool.query(
        'SELECT * FROM token_history WHERE date = $1 ORDER BY created_at DESC LIMIT 100',
        [today],
      );
      const premium = row.premium_used || 0;
      const mini = row.mini_used || 0;

      // Sync in-memory cache
      tokenUsage.premium = premium;
      tokenUsage.mini = mini;
      tokenUsage.settings.defaultModel = row.default_model || 'gpt-5.4';

      return res.json({
        date: today,
        premium: {
          used: premium,
          limit: DAILY_LIMITS.premium,
          remaining: Math.max(0, DAILY_LIMITS.premium - premium),
          percent: Math.round((premium / DAILY_LIMITS.premium) * 100),
        },
        mini: {
          used: mini,
          limit: DAILY_LIMITS.mini,
          remaining: Math.max(0, DAILY_LIMITS.mini - mini),
          percent: Math.round((mini / DAILY_LIMITS.mini) * 100),
        },
        history: historyResult.rows.map((r) => ({
          timestamp: r.created_at,
          model: r.model,
          tier: r.tier,
          agent: r.agent,
          prompt_tokens: r.prompt_tokens,
          completion_tokens: r.completion_tokens,
          total: r.total_tokens,
        })),
        settings: tokenUsage.settings,
        models: { premium: PREMIUM_MODELS, mini: MINI_MODELS },
      });
    } catch (err) {
      console.error('DB read failed in /api/admin/usage, falling back to memory:', err.message);
    }
  }

  // Fallback: serve from in-memory cache
  res.json({
    date: tokenUsage.date,
    premium: {
      used: tokenUsage.premium,
      limit: DAILY_LIMITS.premium,
      remaining: Math.max(0, DAILY_LIMITS.premium - tokenUsage.premium),
      percent: Math.round((tokenUsage.premium / DAILY_LIMITS.premium) * 100),
    },
    mini: {
      used: tokenUsage.mini,
      limit: DAILY_LIMITS.mini,
      remaining: Math.max(0, DAILY_LIMITS.mini - tokenUsage.mini),
      percent: Math.round((tokenUsage.mini / DAILY_LIMITS.mini) * 100),
    },
    history: tokenUsage.history.slice(-100),
    settings: tokenUsage.settings,
    models: { premium: PREMIUM_MODELS, mini: MINI_MODELS },
  });
});

// ── Admin API: Reset daily usage ──
app.post('/api/admin/reset', async (req, res) => {
  tokenUsage.premium = 0;
  tokenUsage.mini = 0;
  tokenUsage.history = [];
  tokenUsage.date = todayStr();

  if (dbReady) {
    try {
      const today = todayStr();
      await pool.query('DELETE FROM token_usage WHERE date = $1', [today]);
      await pool.query('DELETE FROM token_history WHERE date = $1', [today]);
    } catch (err) {
      console.error('DB reset failed:', err.message);
    }
  }

  console.log(`[${new Date().toISOString()}] Admin reset: usage counters cleared`);
  res.json({ message: 'Usage reset', date: todayStr() });
});

// ── Admin API: Update settings ──
app.post('/api/admin/settings', async (req, res) => {
  const { defaultModel } = req.body;
  if (defaultModel) {
    tokenUsage.settings.defaultModel = defaultModel;

    if (dbReady) {
      try {
        await pool.query(`
          INSERT INTO token_usage (date, default_model)
          VALUES ($1, $2)
          ON CONFLICT (date) DO UPDATE SET default_model = $2
        `, [todayStr(), defaultModel]);
      } catch (err) {
        console.error('DB settings update failed:', err.message);
      }
    }
  }
  res.json({ settings: tokenUsage.settings });
});

// ── Helper: infer output type from role ──
function inferOutputType(role) {
  const r = (role || '').toLowerCase();
  if (/ceo|director|planner|manager|lead|strategist|consultant/.test(r)) return 'Business Plan';
  if (/coder|developer|engineer|programmer/.test(r)) return 'Code';
  if (/writer|author|copywriter|editor|blogger/.test(r)) return 'Document';
  if (/designer|artist|illustrator|ux|ui/.test(r)) return 'Mockup';
  if (/researcher|analyst|scientist|investigator/.test(r)) return 'Report';
  if (/coach|trainer|mentor|tutor/.test(r)) return 'Guide';
  if (/marketer|advertiser|seo|growth/.test(r)) return 'Strategy';
  return 'Document';
}

// ── API: Pick best agent for a goal (uses gpt-4o-mini) ──
app.post('/api/agent/pick', async (req, res) => {
  try {
    const { goal } = req.body;
    if (!goal || !goal.trim()) {
      return res.status(400).json({ error: 'Goal is required.' });
    }

    const agentList = getAllAgents();
    const agentDescriptions = agentList
      .map(a => `- ${a.key}: ${a.description}`)
      .join('\n');

    const pickerPrompt = `You are a router. Given a user's goal, either pick the best agent from the existing list OR invent a new specialist role if none fits perfectly.

Reply with JSON only:
{
  "agent": "key from list, or 'custom' if inventing a new one",
  "role": "a short role title (1-2 words) that fits the goal, e.g. 'Fitness Coach', 'Budget Analyst', 'Recipe Creator', 'Music Producer'",
  "humanName": "a unique first name for this agent — diverse, friendly, never repeat",
  "outputType": "the type of output this agent produces: 'Business Plan', 'Strategy', 'Code', 'Document', 'Mockup', 'Report', or similar",
  "greeting": "a short friendly human greeting acknowledging their goal"
}

The role should be SPECIFIC to what the user wants — not generic. If they want to lose weight, the role is "Fitness Coach" not "Planner". If they want to write a song, the role is "Songwriter" not "Writer". Be creative.

The human name should feel real and diverse — mix cultures, genders, styles. Never use the same name twice in a conversation.

The greeting must sound like a real friend texting back. Rules:
- Super casual, warm, maybe a little playful. Lowercase is fine.
- Use contractions. Natural speech only.
- React to what they actually said — reference their specific topic.
- NEVER use phrases like "I'd be happy to help", "Great question", "Let's dive in", "Absolutely!", "Of course!", or anything that sounds like customer support.
- Think of how a smart friend would text you back if you asked them about this topic. They'd probably react to it first, then offer to dig in.
- 1-2 short sentences max. No exclamation-point overload.

Available agents for reference (use these system prompts when the goal matches):
${agentDescriptions}

If the goal doesn't match any existing agent well, use agent key "custom" and the system will use a generic helpful prompt.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: pickerPrompt },
        { role: 'user', content: goal.trim() },
      ],
      max_completion_tokens: 256,
      response_format: { type: 'json_object' },
    });

    const usage = completion.usage || { total_tokens: 0 };
    resetIfNewDay();
    tokenUsage.mini += usage.total_tokens || 0;
    tokenUsage.history.push({
      timestamp: new Date().toISOString(),
      model: 'gpt-4o-mini',
      tier: 'mini',
      agent: 'router',
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total: usage.total_tokens || 0,
    });
    persistUsage('mini', usage.total_tokens || 0, 'gpt-4o-mini', 'router', usage);

    const raw = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);

    const agentKey = parsed.agent || 'custom';
    const matched = agentList.find(a => a.key === agentKey);

    // Infer output type from role if the model didn't provide one
    const role = parsed.role || (matched ? matched.description.split('.')[0] : 'Assistant');
    const outputType = parsed.outputType || inferOutputType(role);

    res.json({
      agent: agentKey,
      displayName: parsed.humanName || (matched ? matched.humanName : 'Agent'),
      role,
      outputType,
      icon: matched ? matched.icon : '●',
      greeting: parsed.greeting || 'oh nice, tell me more about what you\'re working on',
    });
  } catch (err) {
    console.error('Pick error:', err.message);
    res.status(err.status || 500).json({ error: safeErrorMessage(err) });
  }
});

// ── API: Group chat — multiple agents respond in sequence ──
app.post('/api/agent/group', async (req, res) => {
  try {
    resetIfNewDay();

    const { agents: agentList, message, messages: msgHistory } = req.body;
    if (!agentList || !Array.isArray(agentList) || agentList.length < 2 || agentList.length > 6) {
      return res.status(400).json({ error: 'Provide 2-6 agents for a group chat.' });
    }

    const model = tokenUsage.settings.defaultModel;
    const tier = getModelTier(model);

    if (tokenUsage[tier] >= DAILY_LIMITS[tier]) {
      return res.status(429).json({
        error: `Daily ${tier} token limit reached. Try again tomorrow.`,
        usage: { premium: tokenUsage.premium, mini: tokenUsage.mini },
      });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let clientDisconnected = false;
    req.on('close', () => { clientDisconnected = true; });

    // Build shared conversation history from prior messages
    const sharedHistory = [];
    if (msgHistory && Array.isArray(msgHistory)) {
      const trimmed = msgHistory.length > 30 ? msgHistory.slice(-30) : msgHistory;
      sharedHistory.push(...trimmed);
    } else if (message) {
      sharedHistory.push({ role: 'user', content: message });
    }

    // This round's responses — each agent sees what agents before them said
    const roundResponses = [];
    let totalGroupTokens = 0;

    for (const agent of agentList) {
      if (clientDisconnected) break;

      const { name, role, key } = agent;

      // Build system prompt for this agent
      let systemPrompt = getSystemPrompt(key || 'custom');
      const identity = `Your name is ${name || 'Agent'}. Your role is ${role || 'Assistant'}. You are in a group conversation with other agents. Stay in character. Be concise — other agents will also respond. Build on what they said if relevant, don't repeat their points. If you disagree, say so respectfully.`;
      systemPrompt = identity + '\n\n' + systemPrompt;

      // Build messages: system + shared history + this round's prior agent responses
      const chatMessages = [{ role: 'system', content: systemPrompt }];
      chatMessages.push(...sharedHistory);
      for (const prev of roundResponses) {
        chatMessages.push({ role: 'assistant', content: `[${prev.name} — ${prev.role}]: ${prev.text}` });
      }
      // Add a user-role nudge so the model knows it's its turn
      chatMessages.push({ role: 'user', content: `It's your turn to respond, ${name}. What are your thoughts?` });

      try {
        const stream = await openai.chat.completions.create({
          model,
          messages: chatMessages,
          max_completion_tokens: 1024,
          stream: true,
          stream_options: { include_usage: true },
        });

        let agentReplyText = '';
        let agentTokens = 0;

        for await (const chunk of stream) {
          if (clientDisconnected) break;

          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            agentReplyText += delta;
            res.write(`data: ${JSON.stringify({ agent: name, role, text: delta })}\n\n`);
          }
          if (chunk.usage) {
            agentTokens = chunk.usage.total_tokens || 0;
            totalGroupTokens += agentTokens;
            tokenUsage[tier] += agentTokens;
            tokenUsage.history.push({
              timestamp: new Date().toISOString(),
              model,
              tier,
              agent: key || 'custom',
              prompt_tokens: chunk.usage.prompt_tokens || 0,
              completion_tokens: chunk.usage.completion_tokens || 0,
              total: agentTokens,
            });
            persistUsage(tier, agentTokens, model, key || 'custom', chunk.usage);
          }
        }

        // Signal this agent is done
        if (!clientDisconnected) {
          res.write(`data: ${JSON.stringify({ agent: name, role, done: true })}\n\n`);
        }

        // Store for next agent's context
        roundResponses.push({ name, role, text: agentReplyText });

        logRequest({ agent: key || 'custom', model, tier, tokens: agentTokens });
      } catch (agentErr) {
        if (agentErr.name === 'AbortError') break;
        console.error(`Group chat error for agent ${name}:`, agentErr.message);
        if (!clientDisconnected) {
          res.write(`data: ${JSON.stringify({ agent: name, role, error: safeErrorMessage(agentErr) })}\n\n`);
          res.write(`data: ${JSON.stringify({ agent: name, role, done: true })}\n\n`);
        }
      }
    }

    if (!clientDisconnected) {
      res.write(`data: ${JSON.stringify({ allDone: true, total_tokens: totalGroupTokens })}\n\n`);
      res.end();
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('Group chat error:', err.message);
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: safeErrorMessage(err) });
    }
  }
});

// ── API: Auto-reply (Agent Mode — AI answers on behalf of the user) ──
app.post('/api/agent/auto-reply', async (req, res) => {
  try {
    resetIfNewDay();

    const { goal, agentName, agentRole, messages, model: requestedModel } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages are required.' });
    }

    const model = requestedModel || tokenUsage.settings.defaultModel;
    const tier = getModelTier(model);

    if (tokenUsage[tier] >= DAILY_LIMITS[tier]) {
      return res.status(429).json({
        error: 'Daily mini token limit reached.',
        usage: { premium: tokenUsage.premium, mini: tokenUsage.mini },
      });
    }

    const prompt = `You are the USER (not an AI assistant). You are a person who wants to "${goal || 'get help'}".
An agent named ${agentName || 'Agent'} (${agentRole || 'Assistant'}) is helping you. They just asked you a question or gave you options.

Reply as the user would — make decisions, state preferences, give clear answers. Be decisive.
Keep it short (1-2 sentences) like a real person texting back.
Don't ask questions back — just answer what was asked.
Be specific — pick options, state numbers, make choices.`;

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: prompt },
        ...messages.slice(-10),
      ],
      max_completion_tokens: 256,
    });

    const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const reply = completion.choices[0]?.message?.content || '';

    // Track usage
    tokenUsage[tier] += usage.total_tokens;
    tokenUsage.history.push({
      timestamp: new Date().toISOString(),
      model,
      tier,
      agent: 'auto-reply',
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total: usage.total_tokens || 0,
    });

    persistUsage(tier, usage.total_tokens, model, 'auto-reply', usage);
    logRequest({ agent: 'auto-reply', model, tier, tokens: usage.total_tokens });

    res.json({ reply });
  } catch (err) {
    console.error('Auto-reply error:', err.message);
    res.status(err.status || 500).json({ error: safeErrorMessage(err) });
  }
});

// ── API: Autonomous pipeline — execute a goal (strategy + team plan) ──
app.post('/api/agent/execute', async (req, res) => {
  try {
    resetIfNewDay();

    const { goal } = req.body;
    if (!goal || !goal.trim()) {
      return res.status(400).json({ error: 'Goal is required.' });
    }

    const model = tokenUsage.settings.defaultModel;
    const tier = getModelTier(model);

    if (tokenUsage[tier] >= DAILY_LIMITS[tier]) {
      return res.status(429).json({
        error: `Daily ${tier} token limit reached.`,
        usage: { premium: tokenUsage.premium, mini: tokenUsage.mini },
      });
    }

    const prompt = `You are an autonomous AI system. The user gave you ONE command: "${goal.trim()}"

You are the expert. Don't ask questions. EXECUTE.

Create a concrete strategy and decide what specialist agents to spawn.

Reply with JSON:
{
  "strategy": "A concise 2-3 sentence strategy for achieving this goal",
  "agents": [
    { "humanName": "unique first name", "role": "specific role title", "task": "exactly what this agent should produce — be specific and actionable" }
  ]
}

Rules:
- Max 3 agents. Focused team.
- Each agent has a SPECIFIC task — not vague. "Build a Shopify dropshipping store in HTML" not "help with code"
- The strategy is the plan. The agents execute it.
- Be decisive. No maybes. No options. Just DO.
- humanName should be a real-sounding diverse first name — mix cultures, genders.
- role should be specific: "Shopify Developer", "Ad Copywriter", "SEO Strategist" — not generic.`;

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: goal.trim() },
      ],
      max_completion_tokens: 1024,
      response_format: { type: 'json_object' },
    });

    const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const raw = completion.choices[0]?.message?.content || '{}';

    // Track usage
    tokenUsage[tier] += usage.total_tokens;
    tokenUsage.history.push({
      timestamp: new Date().toISOString(),
      model,
      tier,
      agent: 'pipeline-lead',
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total: usage.total_tokens || 0,
    });
    persistUsage(tier, usage.total_tokens, model, 'pipeline-lead', usage);
    logRequest({ agent: 'pipeline-lead', model, tier, tokens: usage.total_tokens });

    const parsed = JSON.parse(raw);

    res.json({
      strategy: parsed.strategy || 'Execute the goal directly.',
      agents: (parsed.agents || []).slice(0, 3).map(a => ({
        humanName: a.humanName || 'Agent',
        role: a.role || 'Specialist',
        task: a.task || 'Produce the deliverable.',
      })),
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total: usage.total_tokens,
      },
    });
  } catch (err) {
    console.error('Pipeline execute error:', err.message);
    res.status(err.status || 500).json({ error: safeErrorMessage(err) });
  }
});

// ── API: Autonomous pipeline — specialist produces their deliverable ──
app.post('/api/agent/produce', async (req, res) => {
  try {
    resetIfNewDay();

    const { task, role, humanName, goal, strategy } = req.body;
    if (!task) {
      return res.status(400).json({ error: 'Task is required.' });
    }

    const model = tokenUsage.settings.defaultModel;
    const tier = getModelTier(model);

    if (tokenUsage[tier] >= DAILY_LIMITS[tier]) {
      return res.status(429).json({
        error: `Daily ${tier} token limit reached.`,
        usage: { premium: tokenUsage.premium, mini: tokenUsage.mini },
      });
    }

    const prompt = `You are ${humanName || 'Agent'}, a ${role || 'Specialist'}.
Context: The goal is "${goal || 'Complete the task'}". The strategy is: "${strategy || 'Execute directly.'}"
Your specific task: ${task}

PRODUCE THE OUTPUT NOW. No chat. No questions. No preamble. Just the deliverable.
If it's code, write complete runnable code.
If it's a document, write the full document.
If it's a plan, write the detailed plan.
GO.`;

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Execute your task now: ${task}` },
      ],
      max_completion_tokens: 4096,
    });

    const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const output = completion.choices[0]?.message?.content || '';

    // Track usage
    tokenUsage[tier] += usage.total_tokens;
    tokenUsage.history.push({
      timestamp: new Date().toISOString(),
      model,
      tier,
      agent: `pipeline-${(role || 'specialist').toLowerCase().replace(/\s+/g, '-')}`,
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total: usage.total_tokens || 0,
    });
    persistUsage(tier, usage.total_tokens, model, `pipeline-${(role || 'specialist').toLowerCase().replace(/\s+/g, '-')}`, usage);
    logRequest({ agent: `pipeline-${(role || 'specialist').toLowerCase().replace(/\s+/g, '-')}`, model, tier, tokens: usage.total_tokens });

    res.json({
      output,
      model,
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total: usage.total_tokens,
      },
    });
  } catch (err) {
    console.error('Pipeline produce error:', err.message);
    res.status(err.status || 500).json({ error: safeErrorMessage(err) });
  }
});

// ── API: List available agents ──
app.get('/api/agents', (req, res) => {
  res.json(getAllAgents());
});

// ── API: Deploy output to Vercel ──
app.post('/api/deploy', async (req, res) => {
  try {
    const { code, name } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'No code to deploy.' });
    }

    const vercelToken = process.env.VERCEL_TOKEN;
    if (!vercelToken) {
      return res.status(500).json({ error: 'Vercel token not configured' });
    }

    const response = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: name || 'ai-project',
        files: [
          {
            file: 'index.html',
            data: Buffer.from(code).toString('base64'),
            encoding: 'base64',
          },
        ],
        projectSettings: {
          framework: null,
        },
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message || 'Deploy failed' });
    }

    res.json({
      url: `https://${data.url}`,
      deploymentId: data.id,
    });
  } catch (err) {
    console.error('Deploy error:', err.message);
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// ── Health check ──
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Serve pages ──
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ── Request logger (one line per agent call) ──
function logRequest({ agent, model, tier, tokens }) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] agent=${agent || 'custom'} model=${model} tier=${tier} tokens=${tokens}`);
}

// ── Safe error message (never leak stack traces) ──
function safeErrorMessage(err) {
  if (err.status === 401) return 'API key is invalid or missing.';
  if (err.status === 429) return 'Rate limited by upstream provider. Try again in a minute.';
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') return 'Could not reach the AI provider. Try again shortly.';
  if (err.message && err.message.length < 200) return err.message;
  return 'Something went wrong on our end. Try again in a moment.';
}

// ── Graceful shutdown ──
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  if (pool) {
    try { await pool.end(); } catch (_) { /* ignore */ }
  }
  process.exit(0);
});

// ── Start server ──
const PORT = process.env.PORT || 3000;

(async () => {
  await initDatabase();
  await loadUsageFromDb();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Whiteboard: http://localhost:${PORT}`);
    console.log(`Admin:      http://localhost:${PORT}/admin`);
  });
})();
