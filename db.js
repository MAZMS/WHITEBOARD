const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    })
  : null;

async function initSchema() {
  if (!pool) {
    console.log('DATABASE_URL not set — running without persistence');
    return false;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS boards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL DEFAULT 'Untitled Board',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS elements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        x DOUBLE PRECISION NOT NULL DEFAULT 0,
        y DOUBLE PRECISION NOT NULL DEFAULT 0,
        width DOUBLE PRECISION,
        height DOUBLE PRECISION,
        data JSONB NOT NULL DEFAULT '{}',
        z_index INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS images (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        board_id UUID REFERENCES boards(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        url TEXT NOT NULL,
        prompt TEXT,
        width INTEGER,
        height INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_elements_board ON elements(board_id);
      CREATE INDEX IF NOT EXISTS idx_images_board ON images(board_id);
    `);
    console.log('Postgres schema ready');
    return true;
  } catch (err) {
    console.error('Schema init failed:', err.message);
    return false;
  }
}

module.exports = { pool, initSchema };
