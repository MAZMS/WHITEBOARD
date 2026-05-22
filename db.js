/**
 * db.js — PostgreSQL data layer for Great Library AI
 *
 * Connects to DATABASE_URL when available (Railway Postgres addon).
 * Falls back gracefully so the app still works with JSON files in local dev.
 *
 * All IPs are hashed with SHA-256 before storage — raw IPs never touch the database.
 * All queries use parameterized statements — no string concatenation.
 */

const { Pool } = require('pg');
const crypto = require('crypto');

// --- State ---
let pool = null;
let connected = false;

// Salt for IP hashing — use env var or a stable default for local dev
const IP_SALT = process.env.IP_HASH_SALT || 'gl-default-ip-salt-change-in-prod';

// --- IP Hashing (never store raw IPs) ---
function hashIP(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  return crypto.createHash('sha256').update(IP_SALT + ':' + ip).digest('hex');
}

// --- Schema Migration ---
const SCHEMA_SQL = `
-- Waitlist signups
CREATE TABLE IF NOT EXISTS waitlist (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  source_referrer TEXT,
  device TEXT,
  screen TEXT,
  oauth_signup BOOLEAN DEFAULT FALSE,
  survey_topics TEXT,
  survey_format TEXT,
  survey_role TEXT,
  survey_would_pay TEXT,
  survey_source TEXT,
  survey_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User accounts
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar TEXT,
  providers JSONB DEFAULT '[]',
  password_hash TEXT,
  ebook_ids JSONB DEFAULT '[]',
  tomes_count INTEGER DEFAULT 0,
  membership TEXT DEFAULT 'free',
  waitlist_id INTEGER REFERENCES waitlist(id),
  waitlist_linked BOOLEAN DEFAULT FALSE,
  waitlist_survey JSONB,
  last_sign_in TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ebook generation jobs
CREATE TABLE IF NOT EXISTS ebook_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id),
  session_id TEXT,
  status TEXT DEFAULT 'pending',
  progress REAL DEFAULT 0,
  step TEXT,
  title TEXT,
  subtitle TEXT,
  filename TEXT,
  file_data BYTEA,
  chapter_count INTEGER,
  chapter_list JSONB,
  cover_data BYTEA,
  design_config JSONB,
  duration_ms INTEGER,
  error TEXT,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Chat conversations (persist across restarts)
CREATE TABLE IF NOT EXISTS conversations (
  session_id TEXT PRIMARY KEY,
  messages JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Metrics (cumulative, keyed by name)
CREATE TABLE IF NOT EXISTS metrics_kv (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual visitor log (hashed IPs)
CREATE TABLE IF NOT EXISTS visitors (
  id SERIAL PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  page TEXT,
  user_agent TEXT,
  referrer TEXT,
  device TEXT,
  country TEXT,
  city TEXT,
  region TEXT,
  visited_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rate limiting (persists across restarts)
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);

-- Budget alerts log
CREATE TABLE IF NOT EXISTS budget_alerts (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  alert_type TEXT,
  level TEXT,
  message TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tome Library
CREATE TABLE IF NOT EXISTS tomes (
  id TEXT PRIMARY KEY,
  title TEXT,
  subtitle TEXT,
  author_id TEXT,
  author_name TEXT DEFAULT 'Anonymous Seeker',
  cover_data BYTEA,
  chapters JSONB DEFAULT '[]',
  design_config JSONB,
  topic_tags JSONB DEFAULT '[]',
  status TEXT DEFAULT 'published',
  visibility TEXT DEFAULT 'public',
  likes_count INTEGER DEFAULT 0,
  dislikes_count INTEGER DEFAULT 0,
  views_count INTEGER DEFAULT 0,
  downloads_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tome interactions
CREATE TABLE IF NOT EXISTS tome_likes (
  id SERIAL PRIMARY KEY,
  tome_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'like' or 'dislike'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tome_id, user_id, type)
);

CREATE TABLE IF NOT EXISTS tome_saves (
  id SERIAL PRIMARY KEY,
  tome_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tome_id, user_id)
);

CREATE TABLE IF NOT EXISTS tome_comments (
  id TEXT PRIMARY KEY,
  tome_id TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT DEFAULT 'Anonymous Seeker',
  user_avatar TEXT,
  parent_id TEXT,
  text TEXT NOT NULL,
  likes_count INTEGER DEFAULT 0,
  deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tome_views (
  id SERIAL PRIMARY KEY,
  tome_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  viewed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tome_reports (
  id SERIAL PRIMARY KEY,
  tome_id TEXT NOT NULL,
  user_id TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for frequently queried fields
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_ebook_jobs_status ON ebook_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ebook_jobs_session ON ebook_jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_visitors_ip ON visitors(ip_hash);
CREATE INDEX IF NOT EXISTS idx_visitors_visited ON visitors(visited_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);
CREATE INDEX IF NOT EXISTS idx_tomes_status ON tomes(status);
CREATE INDEX IF NOT EXISTS idx_tomes_author ON tomes(author_id);
CREATE INDEX IF NOT EXISTS idx_tome_likes_tome ON tome_likes(tome_id);
CREATE INDEX IF NOT EXISTS idx_tome_likes_user ON tome_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_tome_comments_tome ON tome_comments(tome_id);
CREATE INDEX IF NOT EXISTS idx_tome_views_tome ON tome_views(tome_id);
CREATE INDEX IF NOT EXISTS idx_tome_views_recent ON tome_views(tome_id, ip_hash, viewed_at);
`;

// --- Initialize ---
async function initialize() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log('[DB] No DATABASE_URL set -- using JSON file fallback. Set DATABASE_URL for persistent PostgreSQL storage.');
    return false;
  }

  try {
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test connection
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();

    // Run schema migrations
    await pool.query(SCHEMA_SQL);

    connected = true;
    console.log('[DB] PostgreSQL connected and schema migrated successfully.');
    return true;
  } catch (err) {
    console.error('[DB] PostgreSQL connection failed:', err.message);
    console.log('[DB] Falling back to JSON file storage.');
    pool = null;
    connected = false;
    return false;
  }
}

function isConnected() {
  return connected && pool !== null;
}

// --- Helper: safe query with error logging ---
async function query(text, params) {
  if (!isConnected()) throw new Error('Database not connected');
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error('[DB] Query error:', err.message, '\n  SQL:', text.slice(0, 200));
    throw err;
  }
}

// =============================================
// WAITLIST
// =============================================

async function getWaitlistCount() {
  const res = await query('SELECT COUNT(*) as count FROM waitlist');
  return parseInt(res.rows[0].count, 10);
}

async function findWaitlistByEmail(email) {
  const res = await query('SELECT * FROM waitlist WHERE email = $1', [email.toLowerCase().trim()]);
  return res.rows[0] || null;
}

async function getWaitlistPosition(email) {
  const res = await query(
    'SELECT COUNT(*) as position FROM waitlist WHERE id <= (SELECT id FROM waitlist WHERE email = $1)',
    [email.toLowerCase().trim()]
  );
  return parseInt(res.rows[0]?.position, 10) || 0;
}

async function addWaitlistEntry({ email, ip, userAgent, referrer, utm, sourceReferrer, device, screen }) {
  const ipHash = hashIP(ip);
  const normalized = email.toLowerCase().trim();

  const res = await query(
    `INSERT INTO waitlist (email, ip_hash, user_agent, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, source_referrer, device, screen)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [
      normalized,
      ipHash,
      userAgent ? userAgent.slice(0, 500) : null,
      referrer || null,
      utm?.utm_source?.slice(0, 200) || null,
      utm?.utm_medium?.slice(0, 200) || null,
      utm?.utm_campaign?.slice(0, 200) || null,
      utm?.utm_term?.slice(0, 200) || null,
      utm?.utm_content?.slice(0, 200) || null,
      sourceReferrer ? sourceReferrer.slice(0, 500) : null,
      device ? device.slice(0, 20) : null,
      screen ? screen.slice(0, 20) : null
    ]
  );

  if (res.rows.length === 0) {
    // Already existed
    const existing = await findWaitlistByEmail(normalized);
    const position = await getWaitlistPosition(normalized);
    const count = await getWaitlistCount();
    return { success: true, existing: true, position, count, id: existing?.id };
  }

  const count = await getWaitlistCount();
  return { success: true, existing: false, position: count, count, id: res.rows[0].id };
}

async function updateWaitlistSurvey(email, { topics, format, role, wouldPay, source }) {
  const normalized = email.toLowerCase().trim();
  const sanitize = (val, maxLen) => {
    if (!val || typeof val !== 'string') return null;
    return val.trim().slice(0, maxLen) || null;
  };

  const res = await query(
    `UPDATE waitlist SET
       survey_topics = $2,
       survey_format = $3,
       survey_role = $4,
       survey_would_pay = $5,
       survey_source = $6,
       survey_completed_at = NOW()
     WHERE email = $1
     RETURNING id`,
    [
      normalized,
      sanitize(topics, 500),
      sanitize(format, 100),
      sanitize(role, 50),
      sanitize(wouldPay, 20),
      sanitize(source, 50)
    ]
  );

  return res.rows.length > 0;
}

async function getAllWaitlistEntries() {
  const res = await query('SELECT * FROM waitlist ORDER BY created_at ASC');
  return res.rows;
}

// =============================================
// ACCOUNTS
// =============================================

async function findAccountByEmail(email) {
  const normalized = email.toLowerCase().trim();
  const res = await query('SELECT * FROM accounts WHERE email = $1', [normalized]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  // Map DB columns back to camelCase for compatibility with existing code
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    providers: row.providers || [],
    passwordHash: row.password_hash,
    ebookIds: row.ebook_ids || [],
    tomesCount: row.tomes_count || 0,
    membershipStatus: row.membership || 'free',
    waitlistLinked: row.waitlist_linked || false,
    waitlistSurvey: row.waitlist_survey,
    createdAt: row.created_at,
    lastSignIn: row.last_sign_in,
    updatedAt: row.updated_at
  };
}

async function findAccountById(id) {
  const res = await query('SELECT * FROM accounts WHERE id = $1', [id]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    providers: row.providers || [],
    passwordHash: row.password_hash,
    ebookIds: row.ebook_ids || [],
    tomesCount: row.tomes_count || 0,
    membershipStatus: row.membership || 'free',
    waitlistLinked: row.waitlist_linked || false,
    waitlistSurvey: row.waitlist_survey,
    createdAt: row.created_at,
    lastSignIn: row.last_sign_in,
    updatedAt: row.updated_at
  };
}

async function createOrUpdateAccount({ email, name, avatar, provider }) {
  const normalized = email.toLowerCase().trim();
  const existing = await findAccountByEmail(normalized);

  if (existing) {
    // Update last sign-in and merge info
    const newProviders = existing.providers || [];
    if (provider && !newProviders.includes(provider)) newProviders.push(provider);

    await query(
      `UPDATE accounts SET
         last_sign_in = NOW(),
         name = COALESCE(NULLIF($2, ''), name),
         avatar = COALESCE(NULLIF($3, ''), avatar),
         providers = $4,
         updated_at = NOW()
       WHERE email = $1`,
      [normalized, name || '', avatar || '', JSON.stringify(newProviders)]
    );

    // Link to waitlist if not already linked
    if (!existing.waitlistLinked) {
      const wl = await findWaitlistByEmail(normalized);
      if (wl) {
        const survey = wl.survey_topics ? {
          topics: wl.survey_topics,
          format: wl.survey_format,
          role: wl.survey_role,
          wouldPay: wl.survey_would_pay,
          source: wl.survey_source,
          answeredAt: wl.survey_completed_at
        } : null;

        await query(
          `UPDATE accounts SET waitlist_linked = TRUE, waitlist_id = $2, waitlist_survey = $3 WHERE email = $1`,
          [normalized, wl.id, survey ? JSON.stringify(survey) : null]
        );
      }
    }

    return await findAccountByEmail(normalized);
  }

  // Create new account
  const id = require('crypto').randomUUID();
  const providers = provider ? [provider] : [];

  await query(
    `INSERT INTO accounts (id, email, name, avatar, providers, last_sign_in, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())`,
    [id, normalized, name || null, avatar || null, JSON.stringify(providers)]
  );

  // Link to waitlist
  const wl = await findWaitlistByEmail(normalized);
  if (wl) {
    const survey = wl.survey_topics ? {
      topics: wl.survey_topics,
      format: wl.survey_format,
      role: wl.survey_role,
      wouldPay: wl.survey_would_pay,
      source: wl.survey_source,
      answeredAt: wl.survey_completed_at
    } : null;

    await query(
      `UPDATE accounts SET waitlist_linked = TRUE, waitlist_id = $2, waitlist_survey = $3 WHERE id = $1`,
      [id, wl.id, survey ? JSON.stringify(survey) : null]
    );
  }

  return await findAccountByEmail(normalized);
}

async function setAccountPasswordHash(email, passwordHash) {
  const normalized = email.toLowerCase().trim();
  await query(
    `UPDATE accounts SET password_hash = $2, updated_at = NOW() WHERE email = $1`,
    [normalized, passwordHash]
  );
}

async function addEbookToAccount(email, ebookId) {
  const normalized = email.toLowerCase().trim();
  await query(
    `UPDATE accounts SET
       ebook_ids = ebook_ids || $2::jsonb,
       tomes_count = tomes_count + 1,
       updated_at = NOW()
     WHERE email = $1`,
    [normalized, JSON.stringify([ebookId])]
  );
}

async function addProviderToAccount(email, provider) {
  const normalized = email.toLowerCase().trim();
  const acc = await findAccountByEmail(normalized);
  if (!acc) return;
  const providers = acc.providers || [];
  if (!providers.includes(provider)) {
    providers.push(provider);
    await query(
      `UPDATE accounts SET providers = $2, updated_at = NOW() WHERE email = $1`,
      [normalized, JSON.stringify(providers)]
    );
  }
}

async function updateAccountSignIn(email) {
  const normalized = email.toLowerCase().trim();
  await query('UPDATE accounts SET last_sign_in = NOW(), updated_at = NOW() WHERE email = $1', [normalized]);
}

async function getAllAccounts() {
  const res = await query('SELECT * FROM accounts ORDER BY created_at DESC');
  return res.rows.map(row => ({
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    providers: row.providers || [],
    passwordHash: row.password_hash,
    ebookIds: row.ebook_ids || [],
    tomesCount: row.tomes_count || 0,
    membershipStatus: row.membership || 'free',
    waitlistLinked: row.waitlist_linked || false,
    createdAt: row.created_at,
    lastSignIn: row.last_sign_in
  }));
}

// =============================================
// EBOOK JOBS
// =============================================

async function getJob(id) {
  const res = await query('SELECT * FROM ebook_jobs WHERE id = $1', [id]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    status: row.status,
    progress: row.progress || 0,
    step: row.step,
    title: row.title,
    subtitle: row.subtitle,
    filename: row.filename,
    sessionId: row.session_id,
    chapters: row.chapter_count,
    chapterList: row.chapter_list,
    durationMs: row.duration_ms,
    error: row.error,
    generatedAt: row.generated_at,
    coverPath: null, // Not used with DB -- covers stored as BYTEA
    path: null, // Not used with DB -- files stored as BYTEA
    _hasFileData: !!row.file_data,
    _hasCoverData: !!row.cover_data,
    designConfig: row.design_config
  };
}

async function saveJob(id, data) {
  // Upsert the job
  await query(
    `INSERT INTO ebook_jobs (id, session_id, status, progress, step, title, subtitle, filename, chapter_count, chapter_list, duration_ms, error, generated_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       progress = EXCLUDED.progress,
       step = EXCLUDED.step,
       title = COALESCE(EXCLUDED.title, ebook_jobs.title),
       subtitle = COALESCE(EXCLUDED.subtitle, ebook_jobs.subtitle),
       filename = COALESCE(EXCLUDED.filename, ebook_jobs.filename),
       chapter_count = COALESCE(EXCLUDED.chapter_count, ebook_jobs.chapter_count),
       chapter_list = COALESCE(EXCLUDED.chapter_list, ebook_jobs.chapter_list),
       duration_ms = COALESCE(EXCLUDED.duration_ms, ebook_jobs.duration_ms),
       error = EXCLUDED.error,
       generated_at = COALESCE(EXCLUDED.generated_at, ebook_jobs.generated_at),
       completed_at = EXCLUDED.completed_at`,
    [
      id,
      data.sessionId || null,
      data.status || 'pending',
      data.progress || 0,
      data.step || null,
      data.title || null,
      data.subtitle || null,
      data.filename || null,
      data.chapters || null,
      data.chapterList ? JSON.stringify(data.chapterList) : null,
      data.durationMs || null,
      data.error || null,
      data.generatedAt || null,
      data.status === 'ready' ? new Date().toISOString() : null
    ]
  );
}

async function saveJobFileData(id, docxBuffer) {
  await query('UPDATE ebook_jobs SET file_data = $2 WHERE id = $1', [id, docxBuffer]);
}

async function saveJobCoverData(id, coverBuffer) {
  await query('UPDATE ebook_jobs SET cover_data = $2 WHERE id = $1', [id, coverBuffer]);
}

async function getJobFileData(id) {
  const res = await query('SELECT file_data, title FROM ebook_jobs WHERE id = $1', [id]);
  if (res.rows.length === 0 || !res.rows[0].file_data) return null;
  return { buffer: res.rows[0].file_data, title: res.rows[0].title };
}

async function getJobCoverData(id) {
  const res = await query('SELECT cover_data FROM ebook_jobs WHERE id = $1', [id]);
  if (res.rows.length === 0 || !res.rows[0].cover_data) return null;
  return res.rows[0].cover_data;
}

async function getAllJobs() {
  const res = await query('SELECT id, status, title, subtitle, generated_at, duration_ms, chapter_count, error, created_at FROM ebook_jobs ORDER BY created_at DESC');
  const jobs = {};
  for (const row of res.rows) {
    jobs[row.id] = {
      status: row.status,
      title: row.title,
      subtitle: row.subtitle,
      generatedAt: row.generated_at,
      durationMs: row.duration_ms,
      chapters: row.chapter_count,
      error: row.error
    };
  }
  return jobs;
}

// =============================================
// CONVERSATIONS
// =============================================

async function getConversation(sessionId) {
  const res = await query('SELECT messages FROM conversations WHERE session_id = $1', [sessionId]);
  if (res.rows.length === 0) return null;
  return res.rows[0].messages || [];
}

async function saveConversation(sessionId, messages) {
  await query(
    `INSERT INTO conversations (session_id, messages, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (session_id) DO UPDATE SET
       messages = EXCLUDED.messages,
       updated_at = NOW()`,
    [sessionId, JSON.stringify(messages)]
  );
}

// =============================================
// RATE LIMITING
// =============================================

async function checkRateLimit(key, maxCount, windowMs) {
  const now = new Date();

  // Clean expired entries first
  await query('DELETE FROM rate_limits WHERE reset_at < $1', [now.toISOString()]);

  const res = await query('SELECT count, reset_at FROM rate_limits WHERE key = $1', [key]);

  if (res.rows.length === 0) {
    // No entry -- allowed
    return { allowed: true, count: 0 };
  }

  const row = res.rows[0];
  const resetAt = new Date(row.reset_at);

  if (now >= resetAt) {
    // Window expired -- reset
    await query('DELETE FROM rate_limits WHERE key = $1', [key]);
    return { allowed: true, count: 0 };
  }

  if (row.count >= maxCount) {
    return { allowed: false, count: row.count };
  }

  return { allowed: true, count: row.count };
}

async function incrementRateLimit(key, windowMs) {
  const resetAt = new Date(Date.now() + windowMs).toISOString();

  await query(
    `INSERT INTO rate_limits (key, count, reset_at)
     VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       count = rate_limits.count + 1`,
    [key, resetAt]
  );
}

// =============================================
// VISITORS
// =============================================

async function trackVisit({ ip, page, userAgent, referrer, device, country, city, region }) {
  const ipHash = hashIP(ip);
  await query(
    `INSERT INTO visitors (ip_hash, page, user_agent, referrer, device, country, city, region, visited_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      ipHash,
      page || null,
      userAgent ? userAgent.slice(0, 500) : null,
      referrer || null,
      device || null,
      country || null,
      city || null,
      region || null
    ]
  );
}

async function getRecentVisitors(limit = 50) {
  const res = await query(
    `SELECT ip_hash, page, user_agent, country, city, region, device, visited_at
     FROM visitors ORDER BY visited_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows.map(r => ({
    ip: r.ip_hash.slice(0, 12) + '...',
    page: r.page,
    timestamp: r.visited_at,
    country: r.country,
    city: r.city,
    region: r.region,
    ua: r.user_agent ? r.user_agent.slice(0, 100) : '',
    isMobile: /mobile|android|iphone|ipad|ipod/i.test(r.user_agent || '')
  }));
}

async function getVisitorStats() {
  const totalRes = await query('SELECT COUNT(DISTINCT ip_hash) as unique_visitors FROM visitors');
  const todayRes = await query(
    `SELECT COUNT(DISTINCT ip_hash) as today_unique, COUNT(*) as today_total
     FROM visitors WHERE visited_at >= CURRENT_DATE`
  );
  const weekRes = await query(
    `SELECT COUNT(DISTINCT ip_hash) as week_unique
     FROM visitors WHERE visited_at >= NOW() - INTERVAL '7 days'`
  );
  const deviceRes = await query(
    `SELECT
       COUNT(*) FILTER (WHERE device = 'mobile' OR user_agent ~* 'mobile|android|iphone|ipad|ipod') as mobile,
       COUNT(*) FILTER (WHERE device = 'desktop' OR (user_agent IS NOT NULL AND user_agent !~* 'mobile|android|iphone|ipad|ipod')) as desktop
     FROM visitors`
  );
  const countryRes = await query(
    `SELECT country, COUNT(DISTINCT ip_hash) as count
     FROM visitors WHERE country IS NOT NULL
     GROUP BY country ORDER BY count DESC LIMIT 20`
  );
  const pageRes = await query(
    `SELECT page, COUNT(*) as count FROM visitors
     WHERE page IS NOT NULL GROUP BY page ORDER BY count DESC`
  );

  return {
    uniqueVisitors: parseInt(totalRes.rows[0].unique_visitors, 10),
    todayUnique: parseInt(todayRes.rows[0].today_unique, 10),
    todayTotal: parseInt(todayRes.rows[0].today_total, 10),
    weekUnique: parseInt(weekRes.rows[0].week_unique, 10),
    devices: {
      mobile: parseInt(deviceRes.rows[0]?.mobile || 0, 10),
      desktop: parseInt(deviceRes.rows[0]?.desktop || 0, 10)
    },
    countries: countryRes.rows.reduce((acc, r) => { acc[r.country] = parseInt(r.count, 10); return acc; }, {}),
    pageVisits: pageRes.rows.reduce((acc, r) => { acc[r.page] = parseInt(r.count, 10); return acc; }, {})
  };
}

async function getRetentionStats() {
  // New vs returning visitors (based on first visit)
  const res = await query(`
    WITH visitor_first AS (
      SELECT ip_hash, MIN(visited_at) as first_visit, COUNT(*) as total_visits
      FROM visitors GROUP BY ip_hash
    )
    SELECT
      COUNT(*) FILTER (WHERE total_visits = 1) as single_visit,
      COUNT(*) FILTER (WHERE total_visits > 1) as returning,
      COUNT(*) as total
    FROM visitor_first
  `);

  const row = res.rows[0];
  return {
    singleVisit: parseInt(row.single_visit, 10),
    returning: parseInt(row.returning, 10),
    total: parseInt(row.total, 10),
    returnRate: row.total > 0 ? Math.round(parseInt(row.returning, 10) / parseInt(row.total, 10) * 100) : 0
  };
}

async function getGeoStats() {
  const countryRes = await query(`
    SELECT country, COUNT(DISTINCT ip_hash) as unique_visitors, COUNT(*) as total_visits
    FROM visitors WHERE country IS NOT NULL
    GROUP BY country ORDER BY unique_visitors DESC LIMIT 50
  `);

  const cityRes = await query(`
    SELECT city, country, COUNT(DISTINCT ip_hash) as unique_visitors
    FROM visitors WHERE city IS NOT NULL AND country IS NOT NULL
    GROUP BY city, country ORDER BY unique_visitors DESC LIMIT 30
  `);

  return {
    countries: countryRes.rows.map(r => ({
      country: r.country,
      uniqueVisitors: parseInt(r.unique_visitors, 10),
      totalVisits: parseInt(r.total_visits, 10)
    })),
    cities: cityRes.rows.map(r => ({
      city: r.city,
      country: r.country,
      uniqueVisitors: parseInt(r.unique_visitors, 10)
    }))
  };
}

// =============================================
// METRICS (key-value store for cumulative metrics)
// =============================================

async function getMetricsValue(key) {
  const res = await query('SELECT value FROM metrics_kv WHERE key = $1', [key]);
  if (res.rows.length === 0) return null;
  return res.rows[0].value;
}

async function setMetricsValue(key, value) {
  await query(
    `INSERT INTO metrics_kv (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

// =============================================
// TOMES (Library)
// =============================================

async function saveTome(tome) {
  await query(
    `INSERT INTO tomes (id, title, subtitle, author_id, author_name, chapters, design_config, topic_tags, status, visibility, likes_count, dislikes_count, views_count, downloads_count, comments_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       subtitle = EXCLUDED.subtitle,
       author_id = COALESCE(EXCLUDED.author_id, tomes.author_id),
       author_name = COALESCE(EXCLUDED.author_name, tomes.author_name),
       chapters = COALESCE(EXCLUDED.chapters, tomes.chapters),
       design_config = COALESCE(EXCLUDED.design_config, tomes.design_config),
       topic_tags = COALESCE(EXCLUDED.topic_tags, tomes.topic_tags),
       status = COALESCE(EXCLUDED.status, tomes.status),
       visibility = COALESCE(EXCLUDED.visibility, tomes.visibility),
       likes_count = COALESCE(EXCLUDED.likes_count, tomes.likes_count),
       dislikes_count = COALESCE(EXCLUDED.dislikes_count, tomes.dislikes_count),
       views_count = COALESCE(EXCLUDED.views_count, tomes.views_count),
       downloads_count = COALESCE(EXCLUDED.downloads_count, tomes.downloads_count),
       comments_count = COALESCE(EXCLUDED.comments_count, tomes.comments_count),
       updated_at = NOW()`,
    [
      tome.id,
      tome.title,
      tome.subtitle || '',
      tome.authorId || null,
      tome.authorName || 'Anonymous Seeker',
      JSON.stringify(tome.chapters || []),
      tome.designConfig ? JSON.stringify(tome.designConfig) : null,
      JSON.stringify(tome.topicTags || []),
      tome.status || 'published',
      tome.visibility || 'public',
      tome.likesCount || 0,
      tome.dislikesCount || 0,
      tome.viewsCount || 0,
      tome.downloadsCount || 0,
      tome.commentsCount || 0,
      tome.createdAt || new Date().toISOString()
    ]
  );
}

async function saveTomeCoverData(tomeId, coverBuffer) {
  await query('UPDATE tomes SET cover_data = $2, updated_at = NOW() WHERE id = $1', [tomeId, coverBuffer]);
}

async function getTomeCoverData(tomeId) {
  const res = await query('SELECT cover_data FROM tomes WHERE id = $1', [tomeId]);
  if (res.rows.length === 0 || !res.rows[0].cover_data) return null;
  return res.rows[0].cover_data;
}

function mapTomeRow(row) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle || '',
    authorId: row.author_id,
    authorName: row.author_name || 'Anonymous Seeker',
    coverUrl: row.cover_data ? `/api/tomes/${row.id}/cover` : null,
    chapters: row.chapters || [],
    designConfig: row.design_config,
    topicTags: row.topic_tags || [],
    status: row.status,
    visibility: row.visibility,
    likesCount: row.likes_count || 0,
    dislikesCount: row.dislikes_count || 0,
    viewsCount: row.views_count || 0,
    downloadsCount: row.downloads_count || 0,
    commentsCount: row.comments_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getTome(id) {
  const res = await query('SELECT * FROM tomes WHERE id = $1', [id]);
  if (res.rows.length === 0) return null;
  return mapTomeRow(res.rows[0]);
}

async function getTomes({ topic, q, sort, page, limit }) {
  let where = "status = 'published' AND visibility = 'public'";
  const params = [];
  let paramIndex = 1;

  if (topic && topic !== 'all') {
    where += ` AND topic_tags @> $${paramIndex}::jsonb`;
    params.push(JSON.stringify([topic]));
    paramIndex++;
  }

  if (q) {
    where += ` AND (LOWER(title) LIKE $${paramIndex} OR LOWER(subtitle) LIKE $${paramIndex})`;
    params.push(`%${q.toLowerCase()}%`);
    paramIndex++;
  }

  let orderBy = 'created_at DESC';
  if (sort === 'oldest') orderBy = 'created_at ASC';
  else if (sort === 'most-liked') orderBy = 'likes_count DESC';
  else if (sort === 'most-viewed') orderBy = 'views_count DESC';
  else if (sort === 'trending') orderBy = '(likes_count * 3 + views_count) / GREATEST(1, SQRT(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600)) DESC';

  const pg = Math.max(1, parseInt(page) || 1);
  const lim = Math.min(50, Math.max(1, parseInt(limit) || 20));
  const offset = (pg - 1) * lim;

  const countRes = await query(`SELECT COUNT(*) as total FROM tomes WHERE ${where}`, params);
  const total = parseInt(countRes.rows[0].total, 10);

  const dataRes = await query(
    `SELECT id, title, subtitle, author_id, author_name, topic_tags, likes_count, views_count, comments_count, downloads_count,
            CASE WHEN cover_data IS NOT NULL THEN TRUE ELSE FALSE END as has_cover,
            ARRAY_LENGTH(COALESCE(chapters, '[]'::jsonb), 1) as chapter_count, created_at
     FROM tomes WHERE ${where} ORDER BY ${orderBy} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, lim, offset]
  );

  // Get all available tags
  const tagsRes = await query(
    `SELECT DISTINCT jsonb_array_elements_text(topic_tags) as tag FROM tomes WHERE status = 'published' ORDER BY tag`
  );

  const cards = dataRes.rows.map(r => ({
    id: r.id,
    title: r.title,
    subtitle: r.subtitle || '',
    authorName: r.author_name || 'Anonymous Seeker',
    authorId: r.author_id,
    coverUrl: r.has_cover ? `/api/tomes/${r.id}/cover` : null,
    topicTags: r.topic_tags || [],
    likesCount: r.likes_count || 0,
    viewsCount: r.views_count || 0,
    commentsCount: r.comments_count || 0,
    chapterCount: r.chapter_count || 0,
    createdAt: r.created_at
  }));

  return {
    tomes: cards,
    total,
    page: pg,
    limit: lim,
    totalPages: Math.ceil(total / lim),
    tags: tagsRes.rows.map(r => r.tag)
  };
}

async function getTrendingTomes(limit = 10) {
  const res = await query(
    `SELECT id, title, subtitle, author_name, topic_tags, likes_count, views_count,
            CASE WHEN cover_data IS NOT NULL THEN TRUE ELSE FALSE END as has_cover, created_at
     FROM tomes WHERE status = 'published' AND visibility = 'public'
     ORDER BY (likes_count * 3 + views_count) / GREATEST(1, SQRT(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600)) DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows.map(r => ({
    id: r.id,
    title: r.title,
    subtitle: r.subtitle || '',
    authorName: r.author_name || 'Anonymous Seeker',
    coverUrl: r.has_cover ? `/api/tomes/${r.id}/cover` : null,
    topicTags: r.topic_tags || [],
    likesCount: r.likes_count || 0,
    viewsCount: r.views_count || 0,
    createdAt: r.created_at
  }));
}

async function searchTomes(q, limit = 30) {
  if (!q) return [];
  const res = await query(
    `SELECT id, title, subtitle, author_name, topic_tags, likes_count, views_count,
            CASE WHEN cover_data IS NOT NULL THEN TRUE ELSE FALSE END as has_cover, created_at
     FROM tomes WHERE status = 'published' AND visibility = 'public'
       AND (LOWER(title) LIKE $1 OR LOWER(subtitle) LIKE $1 OR LOWER(author_name) LIKE $1)
     LIMIT $2`,
    [`%${q.toLowerCase()}%`, limit]
  );
  return res.rows.map(r => ({
    id: r.id,
    title: r.title,
    subtitle: r.subtitle || '',
    authorName: r.author_name || 'Anonymous Seeker',
    coverUrl: r.has_cover ? `/api/tomes/${r.id}/cover` : null,
    topicTags: r.topic_tags || [],
    likesCount: r.likes_count || 0,
    viewsCount: r.views_count || 0,
    createdAt: r.created_at
  }));
}

async function incrementTomeViews(tomeId, ip) {
  const ipHash = hashIP(ip);
  // Check for recent view by this IP
  const recentRes = await query(
    `SELECT id FROM tome_views WHERE tome_id = $1 AND ip_hash = $2 AND viewed_at > NOW() - INTERVAL '1 hour'`,
    [tomeId, ipHash]
  );
  if (recentRes.rows.length > 0) return false;

  await query('INSERT INTO tome_views (tome_id, ip_hash) VALUES ($1, $2)', [tomeId, ipHash]);
  await query('UPDATE tomes SET views_count = views_count + 1, updated_at = NOW() WHERE id = $1', [tomeId]);

  // Prune old views (keep last 5000)
  await query(`DELETE FROM tome_views WHERE id NOT IN (SELECT id FROM tome_views ORDER BY viewed_at DESC LIMIT 5000)`);

  return true;
}

async function toggleTomeLike(tomeId, userId, type) {
  // Check existing
  const existingRes = await query(
    'SELECT id FROM tome_likes WHERE tome_id = $1 AND user_id = $2 AND type = $3',
    [tomeId, userId, type]
  );

  const oppositeType = type === 'like' ? 'dislike' : 'like';

  if (existingRes.rows.length > 0) {
    // Remove existing (toggle off)
    await query('DELETE FROM tome_likes WHERE tome_id = $1 AND user_id = $2 AND type = $3', [tomeId, userId, type]);
    const col = type === 'like' ? 'likes_count' : 'dislikes_count';
    await query(`UPDATE tomes SET ${col} = GREATEST(0, ${col} - 1), updated_at = NOW() WHERE id = $1`, [tomeId]);
    return { toggled: false };
  }

  // Remove opposite first
  const oppositeRes = await query(
    'SELECT id FROM tome_likes WHERE tome_id = $1 AND user_id = $2 AND type = $3',
    [tomeId, userId, oppositeType]
  );
  if (oppositeRes.rows.length > 0) {
    await query('DELETE FROM tome_likes WHERE tome_id = $1 AND user_id = $2 AND type = $3', [tomeId, userId, oppositeType]);
    const oppCol = oppositeType === 'like' ? 'likes_count' : 'dislikes_count';
    await query(`UPDATE tomes SET ${oppCol} = GREATEST(0, ${oppCol} - 1), updated_at = NOW() WHERE id = $1`, [tomeId]);
  }

  // Add new
  await query('INSERT INTO tome_likes (tome_id, user_id, type) VALUES ($1, $2, $3)', [tomeId, userId, type]);
  const col = type === 'like' ? 'likes_count' : 'dislikes_count';
  await query(`UPDATE tomes SET ${col} = ${col} + 1, updated_at = NOW() WHERE id = $1`, [tomeId]);

  return { toggled: true };
}

async function toggleTomeSave(tomeId, userId) {
  const existingRes = await query(
    'SELECT id FROM tome_saves WHERE tome_id = $1 AND user_id = $2',
    [tomeId, userId]
  );

  if (existingRes.rows.length > 0) {
    await query('DELETE FROM tome_saves WHERE tome_id = $1 AND user_id = $2', [tomeId, userId]);
    return { saved: false };
  }

  await query('INSERT INTO tome_saves (tome_id, user_id) VALUES ($1, $2)', [tomeId, userId]);
  return { saved: true };
}

async function addTomeReport(tomeId, userId, reason) {
  await query('INSERT INTO tome_reports (tome_id, user_id, reason) VALUES ($1, $2, $3)', [tomeId, userId, reason]);
}

async function getTomeComments(tomeId) {
  const res = await query(
    `SELECT * FROM tome_comments WHERE tome_id = $1 AND deleted = FALSE ORDER BY created_at ASC`,
    [tomeId]
  );

  const all = res.rows.map(r => ({
    id: r.id,
    tomeId: r.tome_id,
    userId: r.user_id,
    userName: r.user_name,
    userAvatar: r.user_avatar,
    parentId: r.parent_id,
    text: r.text,
    likesCount: r.likes_count || 0,
    createdAt: r.created_at
  }));

  const topLevel = all.filter(c => !c.parentId);
  const replies = all.filter(c => c.parentId);

  return topLevel.map(c => ({
    ...c,
    replies: replies.filter(r => r.parentId === c.id)
  })).reverse(); // newest first
}

async function addTomeComment(tomeId, { userId, userName, userAvatar, parentId, text }) {
  const id = require('crypto').randomUUID();
  await query(
    `INSERT INTO tome_comments (id, tome_id, user_id, user_name, user_avatar, parent_id, text)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, tomeId, userId, userName, userAvatar, parentId || null, text.trim()]
  );
  await query('UPDATE tomes SET comments_count = comments_count + 1, updated_at = NOW() WHERE id = $1', [tomeId]);

  return {
    id,
    tomeId,
    userId,
    userName,
    userAvatar,
    parentId: parentId || null,
    text: text.trim(),
    likesCount: 0,
    createdAt: new Date().toISOString()
  };
}

async function likeTomeComment(commentId) {
  await query('UPDATE tome_comments SET likes_count = likes_count + 1 WHERE id = $1', [commentId]);
  const res = await query('SELECT likes_count FROM tome_comments WHERE id = $1', [commentId]);
  return res.rows[0]?.likes_count || 0;
}

async function incrementTomeDownloads(tomeId) {
  await query('UPDATE tomes SET downloads_count = downloads_count + 1, updated_at = NOW() WHERE id = $1', [tomeId]);
}

async function getTomeUserState(tomeId, userId, anonId) {
  const likerId = userId || anonId;
  const likeRes = await query(
    'SELECT type FROM tome_likes WHERE tome_id = $1 AND user_id = $2',
    [tomeId, likerId]
  );
  const liked = likeRes.rows.some(r => r.type === 'like');
  const disliked = likeRes.rows.some(r => r.type === 'dislike');

  let saved = false;
  if (userId) {
    const saveRes = await query(
      'SELECT id FROM tome_saves WHERE tome_id = $1 AND user_id = $2',
      [tomeId, userId]
    );
    saved = saveRes.rows.length > 0;
  }

  return { liked, disliked, saved };
}

async function getMyTomes(userId) {
  const res = await query(
    `SELECT id, title, subtitle, topic_tags, likes_count, views_count, comments_count, status,
            CASE WHEN cover_data IS NOT NULL THEN TRUE ELSE FALSE END as has_cover, created_at
     FROM tomes WHERE author_id = $1 AND status != 'removed' ORDER BY created_at DESC`,
    [userId]
  );
  return res.rows.map(r => ({
    id: r.id,
    title: r.title,
    subtitle: r.subtitle || '',
    coverUrl: r.has_cover ? `/api/tomes/${r.id}/cover` : null,
    topicTags: r.topic_tags || [],
    likesCount: r.likes_count || 0,
    viewsCount: r.views_count || 0,
    commentsCount: r.comments_count || 0,
    createdAt: r.created_at,
    status: r.status
  }));
}

async function getMySavedTomes(userId) {
  const res = await query(
    `SELECT t.id, t.title, t.subtitle, t.author_name, t.topic_tags, t.likes_count, t.views_count,
            CASE WHEN t.cover_data IS NOT NULL THEN TRUE ELSE FALSE END as has_cover, t.created_at
     FROM tomes t INNER JOIN tome_saves s ON t.id = s.tome_id
     WHERE s.user_id = $1 AND t.status = 'published'
     ORDER BY s.created_at DESC`,
    [userId]
  );
  return res.rows.map(r => ({
    id: r.id,
    title: r.title,
    subtitle: r.subtitle || '',
    authorName: r.author_name || 'Anonymous Seeker',
    coverUrl: r.has_cover ? `/api/tomes/${r.id}/cover` : null,
    topicTags: r.topic_tags || [],
    likesCount: r.likes_count || 0,
    viewsCount: r.views_count || 0,
    createdAt: r.created_at
  }));
}

async function getTomeAuthorStats(authorId) {
  const res = await query(
    `SELECT COUNT(*) as count FROM tomes WHERE author_id = $1 AND status = 'published'`,
    [authorId]
  );
  return parseInt(res.rows[0].count, 10);
}

// =============================================
// GRACEFUL SHUTDOWN
// =============================================

async function close() {
  if (pool) {
    await pool.end();
    connected = false;
    console.log('[DB] PostgreSQL connection pool closed.');
  }
}

// =============================================
// EXPORTS
// =============================================

module.exports = {
  initialize,
  isConnected,
  hashIP,
  close,

  // Waitlist
  getWaitlistCount,
  findWaitlistByEmail,
  getWaitlistPosition,
  addWaitlistEntry,
  updateWaitlistSurvey,
  getAllWaitlistEntries,

  // Accounts
  findAccountByEmail,
  findAccountById,
  createOrUpdateAccount,
  setAccountPasswordHash,
  addEbookToAccount,
  addProviderToAccount,
  updateAccountSignIn,
  getAllAccounts,

  // Ebook Jobs
  getJob,
  saveJob,
  saveJobFileData,
  saveJobCoverData,
  getJobFileData,
  getJobCoverData,
  getAllJobs,

  // Conversations
  getConversation,
  saveConversation,

  // Rate Limiting
  checkRateLimit,
  incrementRateLimit,

  // Visitors
  trackVisit,
  getRecentVisitors,
  getVisitorStats,
  getRetentionStats,
  getGeoStats,

  // Metrics KV
  getMetricsValue,
  setMetricsValue,

  // Tomes
  saveTome,
  saveTomeCoverData,
  getTomeCoverData,
  getTome,
  getTomes,
  getTrendingTomes,
  searchTomes,
  incrementTomeViews,
  toggleTomeLike,
  toggleTomeSave,
  addTomeReport,
  getTomeComments,
  addTomeComment,
  likeTomeComment,
  incrementTomeDownloads,
  getTomeUserState,
  getMyTomes,
  getMySavedTomes,
  getTomeAuthorStats,
};
