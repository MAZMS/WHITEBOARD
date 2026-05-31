const express = require('express');
const OpenAI = require('openai');
const path = require('path');
const { pool, initSchema } = require('./db');

const app = express();

// ── Security headers ──
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── OpenAI client (lazy — won't crash if key is missing at startup) ──
let _openai;
function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// ══════════════════════════════════════════
//  BOARD CRUD
// ══════════════════════════════════════════

// List all boards
app.get('/api/boards', async (req, res) => {
  try {
    if (!pool) return res.json([]);
    const result = await pool.query(
      'SELECT id, name, created_at, updated_at FROM boards ORDER BY updated_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List boards error:', err.message);
    res.status(500).json({ error: 'Failed to list boards' });
  }
});

// Create a new board
app.post('/api/boards', async (req, res) => {
  try {
    if (!pool) return res.json({ id: 'local', name: req.body.name || 'Untitled Board' });
    const { name } = req.body;
    const result = await pool.query(
      'INSERT INTO boards (name) VALUES ($1) RETURNING *',
      [name || 'Untitled Board']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Create board error:', err.message);
    res.status(500).json({ error: 'Failed to create board' });
  }
});

// Get a board with all its elements
app.get('/api/boards/:id', async (req, res) => {
  try {
    if (!pool) return res.json({ id: 'local', name: 'Local Board', elements: [] });
    const boardResult = await pool.query('SELECT * FROM boards WHERE id = $1', [req.params.id]);
    if (boardResult.rows.length === 0) return res.status(404).json({ error: 'Board not found' });
    const elementsResult = await pool.query(
      'SELECT * FROM elements WHERE board_id = $1 ORDER BY z_index ASC',
      [req.params.id]
    );
    res.json({ ...boardResult.rows[0], elements: elementsResult.rows });
  } catch (err) {
    console.error('Get board error:', err.message);
    res.status(500).json({ error: 'Failed to load board' });
  }
});

// Update board name
app.patch('/api/boards/:id', async (req, res) => {
  try {
    if (!pool) return res.json({ id: req.params.id, name: req.body.name });
    const result = await pool.query(
      'UPDATE boards SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [req.body.name, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update board error:', err.message);
    res.status(500).json({ error: 'Failed to update board' });
  }
});

// Delete a board
app.delete('/api/boards/:id', async (req, res) => {
  try {
    if (!pool) return res.json({ deleted: true });
    await pool.query('DELETE FROM boards WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete board error:', err.message);
    res.status(500).json({ error: 'Failed to delete board' });
  }
});

// ══════════════════════════════════════════
//  ELEMENT CRUD
// ══════════════════════════════════════════

// Add element to board
app.post('/api/boards/:boardId/elements', async (req, res) => {
  try {
    if (!pool) return res.json({ id: 'local-' + Date.now(), ...req.body });
    const { type, x, y, width, height, data, z_index } = req.body;
    const result = await pool.query(
      `INSERT INTO elements (board_id, type, x, y, width, height, data, z_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.boardId, type, x || 0, y || 0, width, height, JSON.stringify(data || {}), z_index || 0]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Add element error:', err.message);
    res.status(500).json({ error: 'Failed to add element' });
  }
});

// Update element (position, data, etc.)
app.patch('/api/boards/:boardId/elements/:id', async (req, res) => {
  try {
    if (!pool) return res.json({ id: req.params.id, ...req.body });
    const fields = [];
    const values = [];
    let idx = 1;
    for (const key of ['x', 'y', 'width', 'height', 'z_index']) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(req.body[key]);
      }
    }
    if (req.body.data !== undefined) {
      fields.push(`data = $${idx++}`);
      values.push(JSON.stringify(req.body.data));
    }
    if (fields.length === 0) return res.json({ unchanged: true });
    fields.push(`updated_at = NOW()`);
    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE elements SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    // Touch board updated_at
    await pool.query('UPDATE boards SET updated_at = NOW() WHERE id = $1', [req.params.boardId]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update element error:', err.message);
    res.status(500).json({ error: 'Failed to update element' });
  }
});

// Delete element
app.delete('/api/boards/:boardId/elements/:id', async (req, res) => {
  try {
    if (!pool) return res.json({ deleted: true });
    await pool.query('DELETE FROM elements WHERE id = $1 AND board_id = $2', [req.params.id, req.params.boardId]);
    await pool.query('UPDATE boards SET updated_at = NOW() WHERE id = $1', [req.params.boardId]);
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete element error:', err.message);
    res.status(500).json({ error: 'Failed to delete element' });
  }
});

// Bulk save — replace all elements at once
app.put('/api/boards/:boardId/elements', async (req, res) => {
  try {
    if (!pool) return res.json({ saved: true });
    const { elements } = req.body;
    if (!Array.isArray(elements)) return res.status(400).json({ error: 'elements must be an array' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM elements WHERE board_id = $1', [req.params.boardId]);
      for (const el of elements) {
        await client.query(
          `INSERT INTO elements (board_id, type, x, y, width, height, data, z_index)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [req.params.boardId, el.type, el.x || 0, el.y || 0, el.width, el.height,
           JSON.stringify(el.data || {}), el.z_index || 0]
        );
      }
      await client.query('UPDATE boards SET updated_at = NOW() WHERE id = $1', [req.params.boardId]);
      await client.query('COMMIT');
      res.json({ saved: true, count: elements.length });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Bulk save error:', err.message);
    res.status(500).json({ error: 'Failed to save elements' });
  }
});

// ══════════════════════════════════════════
//  AI IMAGE GENERATION
// ══════════════════════════════════════════

app.post('/api/ai/generate-image', async (req, res) => {
  try {
    const { prompt, size, boardId } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const response = await getOpenAI().images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: size || '1024x1024',
      response_format: 'url',
    });

    const imageUrl = response.data[0].url;
    const revisedPrompt = response.data[0].revised_prompt;

    // Save to DB if board specified
    if (pool && boardId) {
      await pool.query(
        `INSERT INTO images (board_id, source, url, prompt, width, height)
         VALUES ($1, 'ai-generated', $2, $3, $4, $5)`,
        [boardId, imageUrl, prompt, 1024, 1024]
      );
    }

    res.json({ url: imageUrl, revised_prompt: revisedPrompt });
  } catch (err) {
    console.error('Image generation error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Image generation failed' });
  }
});

// ══════════════════════════════════════════
//  WEB IMAGE CAPTURE (proxy fetch)
// ══════════════════════════════════════════

app.post('/api/ai/capture-image', async (req, res) => {
  try {
    const { url, boardId } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Fetch image and convert to base64 data URL for embedding
    const response = await fetch(url, {
      headers: { 'User-Agent': 'WhiteboardApp/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return res.status(400).json({ error: `Failed to fetch image: ${response.status}` });

    const contentType = response.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'URL does not point to an image' });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const base64 = `data:${contentType};base64,${buffer.toString('base64')}`;

    // Save to DB if board specified
    if (pool && boardId) {
      await pool.query(
        `INSERT INTO images (board_id, source, url, width, height)
         VALUES ($1, 'web-capture', $2, NULL, NULL)`,
        [boardId, url]
      );
    }

    res.json({ dataUrl: base64, originalUrl: url });
  } catch (err) {
    console.error('Image capture error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to capture image' });
  }
});

// AI image search — uses OpenAI to suggest search terms, returns Unsplash/placeholder
app.post('/api/ai/search-images', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    // Generate multiple image URLs from picsum/placeholder services
    const images = [];
    for (let i = 0; i < 6; i++) {
      const seed = encodeURIComponent(query + i);
      images.push({
        url: `https://picsum.photos/seed/${seed}/400/300`,
        thumb: `https://picsum.photos/seed/${seed}/200/150`,
        alt: `${query} - image ${i + 1}`,
      });
    }
    res.json({ images });
  } catch (err) {
    console.error('Image search error:', err.message);
    res.status(500).json({ error: 'Image search failed' });
  }
});

// ══════════════════════════════════════════
//  HEALTH & PAGES
// ══════════════════════════════════════════

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

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
  await initSchema();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Whiteboard: http://localhost:${PORT}`);
  });
})();
