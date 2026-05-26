const express = require('express');
const OpenAI = require('openai');
const path = require('path');
const { getSystemPrompt, getAllAgents } = require('./agents');

const app = express();
app.use(express.json());
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

// ── Agent system prompts (loaded from agents/index.js) ──

// ── API: Chat with agent ──
app.post('/api/agent', async (req, res) => {
  try {
    resetIfNewDay();

    const { agent, message, messages: msgHistory, model: requestedModel } = req.body;
    const model = requestedModel || tokenUsage.settings.defaultModel;
    const tier = getModelTier(model);

    // Check limits
    if (tokenUsage[tier] >= DAILY_LIMITS[tier]) {
      return res.status(429).json({
        error: `Daily ${tier} token limit reached (${DAILY_LIMITS[tier].toLocaleString()} tokens). Try a ${tier === 'premium' ? 'mini' : 'premium'} model or wait until tomorrow.`,
        usage: { premium: tokenUsage.premium, mini: tokenUsage.mini },
      });
    }

    const systemPrompt = getSystemPrompt(agent);

    // Build messages: system prompt + full conversation history (or single message for backward compat)
    const chatMessages = [{ role: 'system', content: systemPrompt }];
    if (msgHistory && Array.isArray(msgHistory)) {
      chatMessages.push(...msgHistory);
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

    // Track usage
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
    res.status(500).json({ error: err.message });
  }
});

// ── API: Stream chat with agent ──
app.post('/api/agent/stream', async (req, res) => {
  try {
    resetIfNewDay();

    const { agent, message, messages: msgHistory, model: requestedModel } = req.body;
    const model = requestedModel || tokenUsage.settings.defaultModel;
    const tier = getModelTier(model);

    if (tokenUsage[tier] >= DAILY_LIMITS[tier]) {
      return res.status(429).json({
        error: `Daily ${tier} limit reached.`,
      });
    }

    const systemPrompt = getSystemPrompt(agent);

    // Build messages: system prompt + full conversation history (or single message for backward compat)
    const chatMessages = [{ role: 'system', content: systemPrompt }];
    if (msgHistory && Array.isArray(msgHistory)) {
      chatMessages.push(...msgHistory);
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

    let totalTokens = 0;

    for await (const chunk of stream) {
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
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, total_tokens: totalTokens })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Stream error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin API: Get usage stats ──
app.get('/api/admin/usage', (req, res) => {
  resetIfNewDay();
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

// ── Admin API: Update settings ──
app.post('/api/admin/settings', (req, res) => {
  const { defaultModel } = req.body;
  if (defaultModel) {
    tokenUsage.settings.defaultModel = defaultModel;
  }
  res.json({ settings: tokenUsage.settings });
});

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

    const pickerPrompt = `You are a router. Given a user's goal, pick the best agent from this list:
${agentDescriptions}

Reply with JSON only: { "agent": "key", "greeting": "a short casual greeting" }.
The greeting must sound like someone texting a friend — super casual, warm, maybe a little playful. Use lowercase, contractions, natural speech. NO formal language, NO "I'd be happy to help", NO customer service vibes. Think of how a smart friend would reply to your text. Keep it to 1-2 short sentences max.`;

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

    const raw = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);

    const agentKey = parsed.agent || 'thinker';
    const matched = agentList.find(a => a.key === agentKey);

    res.json({
      agent: agentKey,
      displayName: agentKey.charAt(0).toUpperCase() + agentKey.slice(1),
      icon: matched ? matched.icon : '●',
      greeting: parsed.greeting || 'Hey, let me help you with that. What details can you share?',
    });
  } catch (err) {
    console.error('Pick error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── API: List available agents ──
app.get('/api/agents', (req, res) => {
  res.json(getAllAgents());
});

// ── Health check ──
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Serve pages ──
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Whiteboard: http://localhost:${PORT}`);
  console.log(`Admin:      http://localhost:${PORT}/admin`);
});
