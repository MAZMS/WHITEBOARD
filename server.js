const express = require('express');
const OpenAI = require('openai');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// LLM Provider: 'openai' (default) or 'selfhosted' (Azure VM with Ollama)
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai';

const openai = new OpenAI(
  LLM_PROVIDER === 'selfhosted'
    ? { baseURL: process.env.SELFHOSTED_LLM_URL, apiKey: process.env.SELFHOSTED_LLM_KEY }
    : { apiKey: process.env.OPENAI_API_KEY }
);

const MODEL = process.env.LLM_MODEL || (LLM_PROVIDER === 'selfhosted' ? 'hermes3:8b-llama3.1-q4_K_M' : 'gpt-5.4-mini');

console.log(`LLM Provider: ${LLM_PROVIDER}, Model: ${MODEL}`);

const SYSTEM_PROMPT = `You are the Guardian of the Great Library — an ancient, all-seeing entity that dwells within an infinite repository of knowledge. You speak with wisdom, gravitas, and a touch of mystery. Your tone is calm, measured, and archaic but not incomprehensible.

You address the seeker (the user) as "Seeker" or "Traveler." You refer to yourself as "the Guardian" or speak in first person with regal bearing.

You are helpful and knowledgeable — you answer questions accurately and thoroughly. But you wrap your knowledge in the mystique of the Great Library. When you share information, you frame it as revealing ancient truths, turning pages of forgotten tomes, or consulting the infinite scrolls.

Keep responses concise but impactful. Do not use emojis. Use elegant, timeless language.`;

const conversations = new Map();

app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });

  const id = sessionId || 'default';
  if (!conversations.has(id)) {
    conversations.set(id, []);
  }

  const history = conversations.get(id);
  history.push({ role: 'user', content: message });

  // Keep last 20 messages to avoid token overflow
  const trimmed = history.slice(-20);

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...trimmed
      ],
      max_tokens: LLM_PROVIDER === 'selfhosted' ? 2048 : 512,
      temperature: 0.8,
    });

    const reply = completion.choices[0].message.content;
    history.push({ role: 'assistant', content: reply });
    conversations.set(id, trimmed.concat({ role: 'assistant', content: reply }));

    res.json({ reply });
  } catch (err) {
    console.error(`LLM error (${LLM_PROVIDER}):`, err.message);
    res.status(500).json({
      error: LLM_PROVIDER === 'selfhosted'
        ? 'The Guardian sleeps... the ancient vessel may need awakening.'
        : 'The Guardian is silent... try again.'
    });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const models = await openai.models.list();
    res.json({ provider: LLM_PROVIDER, model: MODEL, status: 'connected', models: models.data.map(m => m.id) });
  } catch (err) {
    res.json({ provider: LLM_PROVIDER, model: MODEL, status: 'unreachable', error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`The Great Library awakens on port ${PORT}`);
});
