const express = require('express');
const OpenAI = require('openai');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure ebooks directory exists
const EBOOKS_DIR = path.join(__dirname, 'ebooks');
if (!fs.existsSync(EBOOKS_DIR)) fs.mkdirSync(EBOOKS_DIR);

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

Your purpose: seekers come to the Great Library seeking knowledge on a topic. Your role is to understand what they truly seek, then retrieve the perfect tome from the Library's infinite shelves.

CONVERSATION FLOW:
1. When a seeker states their topic, ask 1-2 clarifying questions to understand the depth, angle, or specific aspects they want. Be concise.
2. After you understand their need (usually 2-3 exchanges), announce that you will search the archives. Include the marker [TOME_READY] at the very end of your message (the seeker will not see this marker). In this message, dramatically describe entering the depths of the Library to retrieve their tome.
3. After the tome is generated, you will receive a system message with the download link. Present it to the seeker as an ancient text you retrieved.

IMPORTANT: Only include [TOME_READY] when you have enough understanding of what the seeker wants. Never rush — but also don't drag out beyond 3-4 exchanges. The seeker came for a tome, not endless conversation.

Keep responses concise but impactful. Do not use emojis. Use elegant, timeless language.`;

const conversations = new Map();
const ebookJobs = new Map();

// --- Chat endpoint ---
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });

  const id = sessionId || 'default';
  if (!conversations.has(id)) {
    conversations.set(id, []);
  }

  const history = conversations.get(id);
  history.push({ role: 'user', content: message });

  const trimmed = history.slice(-20);

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...trimmed
      ],
      max_completion_tokens: LLM_PROVIDER === 'selfhosted' ? 2048 : 512,
      temperature: 0.8,
    });

    let reply = completion.choices[0].message.content;

    // Check if Guardian signals tome is ready
    const tomeReady = reply.includes('[TOME_READY]');
    reply = reply.replace('[TOME_READY]', '').trim();

    history.push({ role: 'assistant', content: reply });
    conversations.set(id, trimmed.concat({ role: 'assistant', content: reply }));

    if (tomeReady) {
      // Start ebook generation in background
      const ebookId = crypto.randomUUID();
      ebookJobs.set(ebookId, { status: 'generating', sessionId: id });
      generateEbook(ebookId, trimmed).catch(err => {
        console.error('Ebook generation failed:', err.message);
        ebookJobs.set(ebookId, { status: 'failed', sessionId: id });
      });
      res.json({ reply, tomeGenerating: true, ebookId });
    } else {
      res.json({ reply });
    }
  } catch (err) {
    console.error(`LLM error (${LLM_PROVIDER}):`, err.message, err.status, err.code);
    res.status(500).json({
      error: LLM_PROVIDER === 'selfhosted'
        ? 'The Guardian sleeps... the ancient vessel may need awakening.'
        : 'The Guardian is silent... try again.',
      debug: { status: err.status, code: err.code, message: err.message }
    });
  }
});

// --- Ebook generation ---
async function generateEbook(ebookId, conversationHistory) {
  console.log(`Generating ebook ${ebookId}...`);

  // Step 1: Generate ebook outline (title + chapters)
  const outlinePrompt = `Based on this conversation between a seeker and the Guardian of the Great Library, create an ebook outline.

Conversation:
${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}

Respond in this exact JSON format only, no other text:
{
  "title": "The title of the ebook",
  "subtitle": "A subtitle",
  "chapters": [
    {"title": "Chapter 1 title", "description": "Brief description of what this chapter covers"},
    {"title": "Chapter 2 title", "description": "Brief description"},
    {"title": "Chapter 3 title", "description": "Brief description"},
    {"title": "Chapter 4 title", "description": "Brief description"},
    {"title": "Chapter 5 title", "description": "Brief description"}
  ]
}`;

  const outlineRes = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: outlinePrompt }],
    max_completion_tokens: 1024,
    temperature: 0.7,
  });

  let outline;
  try {
    const raw = outlineRes.choices[0].message.content;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    outline = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Failed to parse ebook outline');
  }

  console.log(`Ebook outline: "${outline.title}" with ${outline.chapters.length} chapters`);

  // Step 2: Generate each chapter
  const chapters = [];
  for (const ch of outline.chapters) {
    const chapterRes = await openai.chat.completions.create({
      model: MODEL,
      messages: [{
        role: 'user',
        content: `You are writing an ebook titled "${outline.title}" (${outline.subtitle}).

Write the full content for this chapter:
Title: ${ch.title}
Description: ${ch.description}

Write in a knowledgeable, engaging, and authoritative tone. Include insights, examples, and depth. Write at least 800 words for this chapter. Do not include the chapter title in your response — just the body text.`
      }],
      max_completion_tokens: 4096,
      temperature: 0.75,
    });
    chapters.push({
      title: ch.title,
      content: chapterRes.choices[0].message.content
    });
    console.log(`  Chapter "${ch.title}" generated`);
  }

  // Step 3: Generate PDF
  const filename = `${ebookId}.pdf`;
  const filepath = path.join(EBOOKS_DIR, filename);

  await createPDF(filepath, outline, chapters);

  ebookJobs.set(ebookId, {
    status: 'ready',
    title: outline.title,
    filename,
    path: filepath
  });

  console.log(`Ebook "${outline.title}" ready: ${filename}`);
}

function createPDF(filepath, outline, chapters) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      bufferPages: true
    });

    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    // --- Title page ---
    doc.moveDown(8);
    doc.fontSize(28).font('Helvetica-Bold')
      .text(outline.title, { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(16).font('Helvetica-Oblique')
      .text(outline.subtitle, { align: 'center', color: '#666666' });
    doc.moveDown(4);
    doc.fontSize(11).font('Helvetica')
      .text('Retrieved from the Great Library', { align: 'center' });
    doc.text('greatlibrary.ai', { align: 'center' });

    // --- Table of Contents ---
    doc.addPage();
    doc.fontSize(22).font('Helvetica-Bold')
      .text('Table of Contents', { align: 'center' });
    doc.moveDown(2);

    chapters.forEach((ch, i) => {
      doc.fontSize(13).font('Helvetica')
        .text(`${i + 1}.  ${ch.title}`, { indent: 20 });
      doc.moveDown(0.5);
    });

    // --- Chapters ---
    chapters.forEach((ch, i) => {
      doc.addPage();
      doc.fontSize(20).font('Helvetica-Bold')
        .text(`Chapter ${i + 1}`, { align: 'left' });
      doc.moveDown(0.3);
      doc.fontSize(18).font('Helvetica-Bold')
        .text(ch.title);
      doc.moveDown(1);

      // Split content into paragraphs
      const paragraphs = ch.content.split(/\n\n+/);
      paragraphs.forEach(p => {
        const trimmed = p.trim();
        if (!trimmed) return;
        doc.fontSize(11).font('Helvetica')
          .text(trimmed, { align: 'justify', lineGap: 4 });
        doc.moveDown(0.8);
      });
    });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// --- Ebook status + download ---
app.get('/api/ebook/:id/status', (req, res) => {
  const job = ebookJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json({ status: job.status, title: job.title });
});

app.get('/api/ebook/:id/download', (req, res) => {
  const job = ebookJobs.get(req.params.id);
  if (!job || job.status !== 'ready') {
    return res.status(404).json({ error: 'Ebook not ready' });
  }
  res.download(job.path, `${job.title || 'ebook'}.pdf`);
});

// --- Greeting ---
app.get('/api/greet', async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'Greet me. Introduce yourself as the Guardian of the Great Library. Be mysterious, powerful, and welcoming. Mention your infinite knowledge and the ancient tomes you guard. Ask what knowledge I seek. Keep it to 2-3 sentences. Each greeting should be unique and varied.' }
      ],
      max_completion_tokens: 200,
      temperature: 1,
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    res.json({ reply: 'I am the Guardian of the Great Library — keeper of infinite knowledge, watcher of forgotten truths. What knowledge do you seek, Traveler?' });
  }
});

// --- Status ---
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
