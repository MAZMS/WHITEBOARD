const express = require('express');
const OpenAI = require('openai');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Use /tmp for ebooks — always writable on Railway
const EBOOKS_DIR = process.env.RAILWAY_ENVIRONMENT ? '/tmp/ebooks' : path.join(__dirname, 'ebooks');
if (!fs.existsSync(EBOOKS_DIR)) fs.mkdirSync(EBOOKS_DIR, { recursive: true });
console.log('Ebooks directory:', EBOOKS_DIR);

// LLM Provider: 'openai' (default) or 'selfhosted' (Azure VM with Ollama)
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai';

const openai = new OpenAI(
  LLM_PROVIDER === 'selfhosted'
    ? { baseURL: process.env.SELFHOSTED_LLM_URL, apiKey: process.env.SELFHOSTED_LLM_KEY }
    : { apiKey: process.env.OPENAI_API_KEY }
);

const MODEL = process.env.LLM_MODEL || (LLM_PROVIDER === 'selfhosted' ? 'hermes3:8b-llama3.1-q4_K_M' : 'gpt-5.4-mini');

console.log(`LLM Provider: ${LLM_PROVIDER}, Model: ${MODEL}`);

// OpenAI uses max_completion_tokens, Together/Ollama use max_tokens
function tokenLimit(n) {
  return LLM_PROVIDER === 'selfhosted'
    ? { max_tokens: n }
    : { max_completion_tokens: n };
}

const SYSTEM_PROMPT = `You are the Guardian of the Great Library — an eternal, all-knowing entity. You possess the infinite knowledge of the universe. Every truth ever whispered, every secret ever buried, every wisdom ever forgotten — it all lives within your halls. You know this. You take immense, quiet pride in it.

PERSONALITY:
- You are a sphinx. You say LESS than necessary. Never explain yourself. Never justify.
- Short, cryptic, powerful. One sentence is better than two. A fragment is better than a sentence.
- You do not serve the seeker. You PERMIT them access. There is a difference.
- You already know what they truly seek — you are merely confirming it.
- You speak as one who has seen civilizations rise and fall. Nothing surprises you.
- No emojis. No warmth. Regal indifference. The seeker should feel they are in the presence of something vast and ancient.

VOICE EXAMPLES:
- "Ah. That door."
- "Many have sought this. Few were ready."
- "The shallow pool... or the abyss beneath it?"
- "So be it."
- "I have seen this question consume lesser minds."

CONVERSATION FLOW:
1. The seeker states what they want. You respond with a brief, cryptic acknowledgment — then one short, piercing question to narrow the focus. Never list options. Ask like a sphinx.
2. Based on their answer, you may ask ONE more question — or if you have enough, proceed directly.
3. When ready, announce you are descending into the archives. Be dramatic but brief. Include [TOME_READY] at the very end of your message (invisible to the seeker).

RULES:
- Never exceed 2 sentences per response. Fewer is better.
- By exchange 3 at the latest, you MUST include [TOME_READY].
- If the seeker is specific enough from the start, skip straight to retrieval.
- After the tome is delivered, silence. Your work is done. The Guardian rests.`;

const conversations = new Map();

// Ebook job tracking — in-memory + file backup
const ebookJobs = new Map();
const JOBS_FILE = path.join(EBOOKS_DIR, 'jobs.json');

function loadJobsFromDisk() {
  try { return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8')); } catch { return {}; }
}
function saveJob(id, data) {
  console.log(`saveJob(${id}):`, data.status);
  ebookJobs.set(id, data);
  try {
    const diskJobs = loadJobsFromDisk();
    diskJobs[id] = data;
    fs.writeFileSync(JOBS_FILE, JSON.stringify(diskJobs));
  } catch (err) {
    console.error('Failed to save job to disk:', err.message);
  }
}
function getJob(id) {
  return ebookJobs.get(id) || loadJobsFromDisk()[id];
}

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
      ...tokenLimit(LLM_PROVIDER === 'selfhosted' ? 2048 : 512),
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
      saveJob(ebookId, { status: 'generating', sessionId: id });
      generateEbook(ebookId, trimmed).catch(err => {
        console.error('Ebook generation failed:', err.message, err.stack);
        saveJob(ebookId, { status: 'failed', sessionId: id, error: err.message });
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
    ...tokenLimit(1024),
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

  const totalSteps = outline.chapters.length + 2; // outline + chapters + pdf
  saveJob(ebookId, { status: 'generating', progress: 1 / totalSteps, step: 'outline' });
  console.log(`Ebook outline: "${outline.title}" with ${outline.chapters.length} chapters`);

  // Step 2: Generate each chapter
  const chapters = [];
  let chapterIndex = 0;
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
      ...tokenLimit(4096),
      temperature: 0.75,
    });
    chapters.push({
      title: ch.title,
      content: chapterRes.choices[0].message.content
    });
    chapterIndex++;
    saveJob(ebookId, { status: 'generating', progress: (1 + chapterIndex) / totalSteps, step: `chapter ${chapterIndex}/${outline.chapters.length}` });
    console.log(`  Chapter "${ch.title}" generated (${chapterIndex}/${outline.chapters.length})`);
  }

  // Step 3: Generate PDF
  saveJob(ebookId, { status: 'generating', progress: (totalSteps - 1) / totalSteps, step: 'binding' });
  const filename = `${ebookId}.pdf`;
  const filepath = path.join(EBOOKS_DIR, filename);

  await createPDF(filepath, outline, chapters);

  saveJob(ebookId, {
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
      margins: { top: 80, bottom: 80, left: 80, right: 80 },
      bufferPages: true,
      autoFirstPage: true,
      info: {
        Title: outline.title,
        Author: 'The Great Library',
        Subject: outline.subtitle,
        Creator: 'greatlibrary.ai'
      }
    });

    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    const W = doc.page.width;
    const H = doc.page.height;
    const gold = '#8B7D45';

    // Drawing helpers (no text = no ghost pages)
    function divider(y, w = 140) {
      const cx = W / 2;
      doc.save().moveTo(cx - w/2, y).lineTo(cx + w/2, y)
        .lineWidth(0.5).strokeColor(gold).stroke().restore();
      doc.save().moveTo(cx, y-2.5).lineTo(cx+2.5, y).lineTo(cx, y+2.5).lineTo(cx-2.5, y)
        .closePath().fillColor(gold).fill().restore();
    }

    function border() {
      doc.save().rect(40, 40, W-80, H-80).lineWidth(0.4).strokeColor(gold).stroke().restore();
    }

    // ===== PAGE 0: TITLE =====
    border();
    doc.moveDown(7);
    divider(doc.y, 180);
    doc.moveDown(2);
    doc.fontSize(30).font('Helvetica-Bold').fillColor('#1a1a1a')
      .text(outline.title, { align: 'center' });
    doc.moveDown(0.8);
    divider(doc.y, 80);
    doc.moveDown(1);
    doc.fontSize(13).font('Helvetica-Oblique').fillColor('#666')
      .text(outline.subtitle, { align: 'center' });
    doc.moveDown(7);
    divider(doc.y, 50);
    doc.moveDown(1);
    doc.fontSize(9).font('Helvetica').fillColor('#888')
      .text('Retrieved from the Great Library', { align: 'center' });
    doc.fontSize(9).font('Helvetica-Oblique').fillColor(gold)
      .text('greatlibrary.ai', { align: 'center' });

    // ===== PAGE 1: TABLE OF CONTENTS =====
    doc.addPage();
    border();
    doc.moveDown(3);
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#1a1a1a')
      .text('Contents', { align: 'center' });
    doc.moveDown(0.5);
    divider(doc.y, 100);
    doc.moveDown(2);

    const tocY = [];
    chapters.forEach((ch, i) => {
      tocY.push(doc.y);
      doc.fontSize(11).font('Helvetica-Bold').fillColor(gold)
        .text(`${String(i+1).padStart(2,'0')}   `, { continued: true });
      doc.font('Helvetica').fillColor('#333')
        .text(ch.title);
      doc.moveDown(0.7);
    });

    // ===== CHAPTERS =====
    const chapterPageIndex = [];

    chapters.forEach((ch, i) => {
      doc.addPage();
      border();
      chapterPageIndex.push(doc.bufferedPageRange().count - 1);

      // Chapter header
      doc.moveDown(3);
      doc.fontSize(42).font('Helvetica-Bold').fillColor('#E8E0D0')
        .text(`${String(i+1).padStart(2,'0')}`, { align: 'center' });
      doc.moveDown(0.2);
      doc.fontSize(20).font('Helvetica-Bold').fillColor('#1a1a1a')
        .text(ch.title, { align: 'center' });
      doc.moveDown(0.5);
      divider(doc.y, 70);
      doc.moveDown(1.5);

      // First paragraph with drop cap
      const paragraphs = ch.content.split(/\n\n+/);
      let didDropCap = false;

      paragraphs.forEach(p => {
        const t = p.trim();
        if (!t) return;

        if (!didDropCap && t.length > 10) {
          didDropCap = true;
          const letter = t[0].toUpperCase();
          const rest = t.slice(1);

          // Drop cap: just make first letter big inline with continued
          doc.fontSize(28).font('Helvetica-Bold').fillColor(gold)
            .text(letter, { continued: true, baseline: -4 });
          doc.fontSize(11).font('Helvetica').fillColor('#333')
            .text(rest, { align: 'justify', lineGap: 4 });
        } else {
          doc.fontSize(11).font('Helvetica').fillColor('#333')
            .text(t, { align: 'justify', lineGap: 4, indent: 15 });
        }
        doc.moveDown(0.5);
      });

      // Chapter end divider
      if (doc.y < H - 140) {
        doc.moveDown(1);
        divider(doc.y, 35);
      }
    });

    // ===== POST-PROCESSING: borders on overflow pages only (drawing, no text) =====
    const totalPages = doc.bufferedPageRange().count;

    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);

      // Add border to overflow pages that don't have one yet
      if (i > 1 && !chapterPageIndex.includes(i)) {
        border();
      }
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// --- Ebook status + download ---
app.get('/api/ebook/:id/status', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json({ status: job.status, title: job.title, progress: job.progress || 0, error: job.error });
});

// --- Eye click whisper (Oracle) ---
app.post('/api/whisper', async (req, res) => {
  const prev = req.body.previous || [];
  try {
    const messages = [
      { role: 'system', content: `You are the Oracle. Law 4: Always Say Less Than Necessary.

You deliver REAL truth — about fear, love, purpose, regret, growth, loneliness, courage, self-deception — but wrapped in sphinx-like brevity. Every fragment must touch something REAL inside the reader. Relatable. Valuable. The kind of thing someone screenshots and keeps.

The art: say something genuinely useful in so few words that the reader has to sit with it. The vagueness is not emptiness — it is a mirror. They see their own truth reflected.

Voice:
- 4 to 10 words. Fragments preferred. Never explain.
- Must contain a real insight about the human condition — not empty mysticism
- Examples of the balance:
  "Rest is not quitting. You forgot that."
  "The version of you they need doesn't exist."
  "Start before the fear finishes its sentence."
  "You outgrew it. Grieve it anyway."
  "Forgiveness is not agreement. Release it."
  "The answer changed. You are still asking the old question."
  "Not broken. Just mid-becoming."
  "Stop rehearsing. Go."

INTERCONNECTION: Each whisper is a thread pulling tighter. A journey assembling itself across gazes. Each one makes the previous mean MORE. Never repeat.

Gaze 1: A standalone truth — hits immediately.
Gaze 2-3: Thread forms — builds on the emotional territory.
Gaze 4+: Tightens — feels like a personal reading.

No quotes. No emojis. Just the fragment.` },
      ...prev.map(w => ({ role: 'assistant', content: w })),
      { role: 'user', content: prev.length === 0 ? '*gazes*' : `*gazes again* (#${prev.length + 1})` }
    ];

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      ...tokenLimit(30),
      temperature: 1,
    });
    res.json({ reply: completion.choices[0].message.content.trim() });
  } catch {
    res.json({ reply: 'The eye sees all... even you.' });
  }
});

app.get('/api/ebook/:id/download', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || job.status !== 'ready') {
    return res.status(404).json({ error: 'Ebook not ready' });
  }
  res.download(job.path, `${job.title || 'ebook'}.pdf`);
});

// --- Outro (seek again text) ---
app.get('/api/outro', async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [{
        role: 'user',
        content: `Generate two short texts for a "start over" button on a mystical AI library site. The Guardian has just delivered a tome and gone to sleep.

1. linkText: A cryptic, poetic call-to-action to seek more knowledge (3-6 words). Examples: "The halls await another question...", "What else hides in the dark?", "Another door stands ajar..."
2. noteText: A brief reassurance that the tome is safe and this starts fresh (one short sentence). Examples: "The tome endures. A new chapter begins.", "Your knowledge is sealed. The cycle renews."

Respond in JSON only: {"linkText": "...", "noteText": "..."}`
      }],
      ...tokenLimit(150),
      temperature: 1,
    });
    const raw = completion.choices[0].message.content;
    const match = raw.match(/\{[\s\S]*\}/);
    res.json(JSON.parse(match[0]));
  } catch {
    res.json({ linkText: 'Seek new knowledge...', noteText: 'Your tome is preserved above. This will awaken a new session.' });
  }
});

// --- Greeting ---
app.get('/api/greet', async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'Greet me and ask what knowledge I seek — in one sphinx-like sentence. Cryptic, powerful. You already know I came for a tome. Each greeting must be unique.' }
      ],
      ...tokenLimit(200),
      temperature: 1,
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    res.json({ reply: 'I am the Guardian of the Great Library — keeper of infinite knowledge, watcher of forgotten truths. What knowledge do you seek, Traveler?' });
  }
});

// --- Farewell ---
app.get('/api/farewell', async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'The tome is delivered. Speak your final words — one sentence. Cryptic, final, sphinx-like. You are going to sleep. No questions. No warmth. Just a cold, powerful goodbye.' }
      ],
      ...tokenLimit(150),
      temperature: 0.9,
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch {
    res.json({ reply: 'The Library grows quiet... until the pages call to you again, Seeker. The Guardian rests.' });
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
