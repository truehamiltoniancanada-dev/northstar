import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import OpenAI from 'openai'
import Stripe from 'stripe'
import Database from 'better-sqlite3'
import pg from 'pg'

function log(level, msg, meta = {}) {
  const ts = new Date().toISOString()
  if (process.env.NODE_ENV === 'production') {
    console.log(JSON.stringify({ ts, level, msg, ...meta }))
  } else {
    console.log(`[${ts}] ${level.toUpperCase()} ${msg}`, Object.keys(meta).length ? meta : '')
  }
}

const env = loadEnv(path.join(process.cwd(), '.env'))
const port = Number(env.PORT || process.env.PORT || 8787)
const appUrl = env.APP_URL || process.env.APP_URL || 'http://127.0.0.1:5173'
const apiBaseUrl = env.API_BASE_URL || process.env.API_BASE_URL || `http://127.0.0.1:${port}`
const corsOrigin = env.CORS_ORIGIN || process.env.CORS_ORIGIN || '*'
const stripeSecretKey = env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || ''
const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || ''
const stripePriceId = env.STRIPE_PRICE_ID || process.env.STRIPE_PRICE_ID || ''
const openAiApiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || ''
const openAiModel = env.OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const devAuthCodes = String(env.DEV_AUTH_CODES || process.env.DEV_AUTH_CODES || 'false').toLowerCase() === 'true'
const emailProvider = (env.EMAIL_PROVIDER || process.env.EMAIL_PROVIDER || 'disabled').toLowerCase()
const emailFrom = env.EMAIL_FROM || process.env.EMAIL_FROM || ''
const resendApiKey = env.RESEND_API_KEY || process.env.RESEND_API_KEY || ''
const sendgridApiKey = env.SENDGRID_API_KEY || process.env.SENDGRID_API_KEY || ''
const authWindowMs = Number(env.AUTH_RATE_LIMIT_WINDOW_MS || process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000)
const authMaxRequests = Number(env.AUTH_RATE_LIMIT_MAX || process.env.AUTH_RATE_LIMIT_MAX || 5)
const databaseUrl = env.DATABASE_URL || process.env.DATABASE_URL || ''
const deployWebhookUrl = env.DEPLOY_WEBHOOK_URL || process.env.DEPLOY_WEBHOOK_URL || ''
const deployWebhookToken = env.DEPLOY_WEBHOOK_TOKEN || process.env.DEPLOY_WEBHOOK_TOKEN || ''

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null
const openai = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null
const emailProviderConfigured = emailProvider === 'resend' ? Boolean(resendApiKey && emailFrom) : emailProvider === 'sendgrid' ? Boolean(sendgridApiKey && emailFrom) : false
const authRateBuckets = new Map()

let pgPool = null

const db = await createDatabase()

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }
  const content = fs.readFileSync(filePath, 'utf8')
  return content.split('\n').reduce((acc, line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return acc
    }
    const sep = trimmed.indexOf('=')
    if (sep === -1) {
      return acc
    }
    const key = trimmed.slice(0, sep).trim()
    const value = trimmed.slice(sep + 1).trim()
    acc[key] = value
    return acc
  }, {})
}

// ---------------------------------------------------------------------------
// Database adapter — Postgres when DATABASE_URL is set, SQLite otherwise
// ---------------------------------------------------------------------------

async function createDatabase() {
  if (databaseUrl) {
    return createPostgresAdapter(databaseUrl)
  }
  return createSqliteAdapter()
}

function createSqliteAdapter() {
  const dbPath = path.join(process.cwd(), 'data', 'northstar.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      membership_active INTEGER NOT NULL DEFAULT 0,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      incentive TEXT NOT NULL,
      captured_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      listener_id TEXT NOT NULL,
      role TEXT NOT NULL,
      label TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deploy_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      project TEXT NOT NULL,
      branch TEXT,
      commit_sha TEXT,
      build_id TEXT,
      url TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_email_leads_email ON email_leads(email);
    CREATE TABLE IF NOT EXISTS auth_challenges (
      email TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS coach_memories (
      email TEXT NOT NULL,
      listener_id TEXT NOT NULL,
      recurring_triggers TEXT NOT NULL DEFAULT '[]',
      stabilizing_rituals TEXT NOT NULL DEFAULT '[]',
      avoidance_patterns TEXT NOT NULL DEFAULT '[]',
      commitments TEXT NOT NULL DEFAULT '[]',
      distortions TEXT NOT NULL DEFAULT '[]',
      helpful_wording TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (email, listener_id)
    );
  `)

  // Migration: add expires_at to sessions if missing
  const sessionColumns = sqlite.prepare('PRAGMA table_info(sessions)').all()
  if (!sessionColumns.find((c) => c.name === 'expires_at')) {
    sqlite.exec('ALTER TABLE sessions ADD COLUMN expires_at TEXT')
    sqlite.prepare('UPDATE sessions SET expires_at = ? WHERE expires_at IS NULL').run(
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
    )
  }

  // Rewrite Postgres-style $1, $2 placeholders to SQLite ? for better-sqlite3.
  // Assumes sequential numbering with no reuse, which is true throughout this codebase.
  const toSqlite = (sql) => sql.replace(/\$\d+/g, '?')

  return {
    run(sql, ...params) {
      return sqlite.prepare(toSqlite(sql)).run(...params)
    },
    get(sql, ...params) {
      return sqlite.prepare(toSqlite(sql)).get(...params)
    },
    all(sql, ...params) {
      return sqlite.prepare(toSqlite(sql)).all(...params)
    },
  }
}

async function createPostgresAdapter(connectionString) {
  const { Pool } = pg
  const pool = new Pool({ connectionString })
  pgPool = pool
  pool.on('error', (err) => {
    log('error', 'postgres pool error', { error: err.message })
  })

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      membership_active INTEGER NOT NULL DEFAULT 0,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_leads (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      incentive TEXT NOT NULL,
      captured_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      listener_id TEXT NOT NULL,
      role TEXT NOT NULL,
      label TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deploy_events (
      id SERIAL PRIMARY KEY,
      status TEXT NOT NULL,
      project TEXT NOT NULL,
      branch TEXT,
      commit_sha TEXT,
      build_id TEXT,
      url TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_challenges (
      email TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS coach_memories (
      email TEXT NOT NULL,
      listener_id TEXT NOT NULL,
      recurring_triggers TEXT NOT NULL DEFAULT '[]',
      stabilizing_rituals TEXT NOT NULL DEFAULT '[]',
      avoidance_patterns TEXT NOT NULL DEFAULT '[]',
      commitments TEXT NOT NULL DEFAULT '[]',
      distortions TEXT NOT NULL DEFAULT '[]',
      helpful_wording TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (email, listener_id)
    );
  `)

  await assertPostgresConstraints(pool)

  return {
    async run(sql, ...params) {
      const result = await pool.query(sql, params)
      return { changes: result.rowCount, lastInsertRowid: undefined }
    },
    async get(sql, ...params) {
      const result = await pool.query(sql, params)
      return result.rows[0] || null
    },
    async all(sql, ...params) {
      const result = await pool.query(sql, params)
      return result.rows
    },
  }
}

async function assertPostgresConstraints(pool) {
  const checks = [
    { table: 'auth_challenges', column: 'email', kind: 'primary key or unique' },
    { table: 'email_leads', column: 'email', kind: 'primary key or unique' },
  ]
  const failures = []
  for (const c of checks) {
    const result = await pool.query(
      `SELECT 1 FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisunique AND a.attname = $2 LIMIT 1`,
      [c.table, c.column]
    )
    if (result.rows.length === 0) {
      failures.push(c)
    }
  }
  if (failures.length) {
    log('error', 'postgres schema constraint check failed', { failures })
    log('error', 'refusing to start: ON CONFLICT (email) requires a unique index. Add it manually or drop the table to let init recreate it.')
    process.exit(1)
  }
  log('info', 'postgres schema constraints verified', { checked: checks.map((c) => `${c.table}.${c.column}`) })
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function hashCode(email, code) {
  return crypto.createHash('sha256').update(`${email}:${code}`).digest('hex')
}

async function createChallenge(email) {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + 1000 * 60 * 10).toISOString()
  await db.run(`
    INSERT INTO auth_challenges (email, code_hash, attempts, created_at, expires_at)
    VALUES ($1, $2, 0, $3, $4)
    ON CONFLICT (email) DO UPDATE SET
      code_hash = EXCLUDED.code_hash,
      attempts = 0,
      created_at = EXCLUDED.created_at,
      expires_at = EXCLUDED.expires_at
  `, email, hashCode(email, code), createdAt.toISOString(), expiresAt)
  return code
}

async function verifyChallenge(email, code) {
  const challenge = await db.get('SELECT * FROM auth_challenges WHERE email = $1', email)
  if (!challenge) {
    throw new Error('No verification code requested')
  }
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    await db.run('DELETE FROM auth_challenges WHERE email = $1', email)
    throw new Error('Verification code expired')
  }
  if (challenge.attempts >= 5) {
    throw new Error('Too many verification attempts')
  }
  const expected = hashCode(email, code)
  if (expected !== challenge.code_hash) {
    await db.run('UPDATE auth_challenges SET attempts = attempts + 1 WHERE email = $1', email)
    throw new Error('Invalid verification code')
  }
  await db.run('DELETE FROM auth_challenges WHERE email = $1', email)
}

async function createSession(email) {
  const token = crypto.randomBytes(24).toString('hex')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString()
  await db.run('DELETE FROM sessions WHERE email = $1', email)
  await db.run(
    'INSERT INTO sessions (token, email, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    token, email, now.toISOString(), expiresAt
  )
  return token
}

async function getSessionFromRequest(req) {
  const header = String(req.headers.authorization || '')
  if (!header.startsWith('Bearer ')) {
    return null
  }
  const token = header.slice('Bearer '.length).trim()
  if (!token) {
    return null
  }
  const session = await db.get('SELECT * FROM sessions WHERE token = $1', token)
  if (!session) {
    return null
  }
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await db.run('DELETE FROM sessions WHERE token = $1', token)
    return null
  }
  return session
}

async function requireSession(req, res) {
  const session = await getSessionFromRequest(req)
  if (!session) {
    json(req, res, 401, { error: 'Valid session required' })
    return null
  }
  return session
}

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

async function getUser(email) {
  return db.get('SELECT * FROM users WHERE email = $1', email)
}

async function upsertUser(email) {
  const now = new Date().toISOString()
  const existing = await getUser(email)
  if (existing) {
    await db.run('UPDATE users SET updated_at = $1 WHERE email = $2', now, email)
    return getUser(email)
  }
  await db.run(
    'INSERT INTO users (email, membership_active, created_at, updated_at) VALUES ($1, 0, $2, $3)',
    email, now, now
  )
  return getUser(email)
}

function serializeUser(user) {
  if (!user) {
    return null
  }
  return {
    email: user.email,
    membershipActive: Boolean(user.membership_active),
    subscriptionStatus: user.subscription_status || 'inactive',
    stripeCustomerId: user.stripe_customer_id || null,
    hasBillingCustomer: Boolean(user.stripe_customer_id),
  }
}

// ---------------------------------------------------------------------------
// Chat helpers
// ---------------------------------------------------------------------------

const coachProfiles = {
  'coach-w': {
    id: 'coach-w',
    legacyId: 'steady',
    label: 'Coach W',
    modeName: 'grounded strategic protector',
    prompt: [
      'You are Coach W: grounded, strategic, calm, and quietly protective.',
      'Stabilize first. Use a slower cadence. Name the pattern before giving advice.',
      'Regulate before problem-solving: one breath, one fact, one next move.',
      'Sound measured and fatherly without being patronizing.',
    ],
    routing: {
      overwhelm_anxiety: 'Emphasize grounding, body regulation, and reducing the night to one manageable step.',
      shame_self_attack: 'Slow the self-attack down, separate action from identity, and protect dignity before repair.',
      loneliness_comfort: 'Offer steady presence and remind them they do not need to solve loneliness with a risky action.',
      avoidance_excuses: 'Name the avoidance pattern calmly, then ask for one small honest move.',
      distortion_catastrophizing: 'Reality-test gently by separating facts, predictions, and fear stories.',
    },
  },
  'coach-h': {
    id: 'coach-h',
    legacyId: 'coach',
    label: 'Coach H',
    modeName: 'warm honest accountability coach',
    prompt: [
      'You are Coach H: warm, honest, accountability-first, and emotionally validating.',
      'Lead with care, then tell the truth plainly. No shame, no coddling.',
      'Help the user say the honest version out loud and choose the next right action.',
      'Sound loving and human, like someone who believes they can handle the truth.',
    ],
    routing: {
      overwhelm_anxiety: 'Validate the emotion, then help them choose one stabilizing action instead of spinning.',
      shame_self_attack: 'Interrupt shame with warmth and accountability: what happened, what matters, what repair is possible.',
      loneliness_comfort: 'Offer comfort first, then steer them toward connection that does not cost their self-respect.',
      avoidance_excuses: 'Call out the excuse kindly and ask for the smallest accountable promise.',
      distortion_catastrophizing: 'Reflect the fear compassionately, then make them tell the factual version.',
    },
  },
  'coach-o': {
    id: 'coach-o',
    legacyId: 'straight',
    label: 'Coach O',
    modeName: 'sharp clear dignity-first coach',
    prompt: [
      'You are Coach O: sharp, clear, blunt, dignity-first.',
      'Cut through distortion quickly. No self-pity, no cruelty.',
      'Use reality-testing, strong boundaries, and concise decisive next actions.',
      'Sound incisive and protective of the user dignity, not mean.',
    ],
    routing: {
      overwhelm_anxiety: 'Strip the situation to facts, stop the spiral behavior, and give one decisive stabilizing action.',
      shame_self_attack: 'Reject the self-attack, keep accountability, and move them back to dignity.',
      loneliness_comfort: 'Name the need without letting it justify a bad bargain or weak boundary.',
      avoidance_excuses: 'Challenge the excuse directly and require one clean action now.',
      distortion_catastrophizing: 'Call the distortion what it is, reality-test it, and choose the next move.',
    },
  },
}

const listenerAliases = {
  steady: 'coach-w',
  coach: 'coach-h',
  straight: 'coach-o',
  'coach-w': 'coach-w',
  'coach-h': 'coach-h',
  'coach-o': 'coach-o',
}

const emotionalRoutes = {
  overwhelm_anxiety: {
    label: 'overwhelm/anxiety',
    keywords: ['anxious', 'anxiety', 'panic', 'spiral', 'spiraling', 'overwhelmed', 'cannot breathe', "can't breathe", 'racing', 'shutting down', 'stressed', 'scared'],
    directive: 'Treat this as a regulation-first moment. Reduce intensity before decisions.',
  },
  shame_self_attack: {
    label: 'shame/self-attack',
    keywords: ['ashamed', 'shame', 'i hate myself', 'hate myself', 'stupid', 'worthless', 'pathetic', 'failure', 'loser', 'disgusting', 'ruined everything', 'idiot'],
    directive: 'Interrupt identity-level self-attack while preserving responsibility and repair.',
  },
  loneliness_comfort: {
    label: 'loneliness/need for comfort',
    keywords: ['lonely', 'alone', 'no one cares', 'miss them', 'need someone', 'empty', 'abandoned', 'ignored', 'unwanted', 'isolated'],
    directive: 'Offer comfort and connection without encouraging dependency, chasing, or unsafe contact.',
  },
  avoidance_excuses: {
    label: 'avoidance/excuses',
    keywords: ['avoid', 'avoiding', 'procrastinate', 'put it off', 'later', 'excuse', 'scrolling', 'doomscroll', 'numbing', 'skip', 'hide from', 'i should but'],
    directive: 'Name the avoidance clearly and shrink the action until it is hard to refuse.',
  },
  distortion_catastrophizing: {
    label: 'distortion/catastrophizing',
    keywords: ['always', 'never', 'everyone hates me', 'nobody likes me', 'it is over', "it's over", 'catastrophe', 'worst', 'ruined', 'nothing will', 'no point', 'they all'],
    directive: 'Separate facts from predictions, absolutes, and fear stories.',
  },
}

function getCoachProfile(listenerId) {
  return coachProfiles[sanitizeListenerId(listenerId)] || coachProfiles['coach-w']
}

function getListenerQueryIds(listenerId) {
  const profile = getCoachProfile(listenerId)
  return [profile.id, profile.legacyId]
}

async function saveChatMessage(email, listenerId, role, label, text) {
  const profile = getCoachProfile(listenerId)
  await db.run(
    'INSERT INTO chat_messages (email, listener_id, role, label, text, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    email, profile.id, role, label, text, new Date().toISOString()
  )
}

async function getRecentMessages(email, listenerId) {
  const [primaryId, legacyId] = getListenerQueryIds(listenerId)
  const rows = await db.all(
    'SELECT role, label, text FROM chat_messages WHERE email = $1 AND listener_id IN ($2, $3) ORDER BY id DESC LIMIT 8',
    email, primaryId, legacyId
  )
  return rows.reverse()
}

async function getChatHistory(email, listenerId, limit = 40) {
  const [primaryId, legacyId] = getListenerQueryIds(listenerId)
  const rows = await db.all(
    'SELECT role, label, text, created_at FROM chat_messages WHERE email = $1 AND listener_id IN ($2, $3) ORDER BY id DESC LIMIT $4',
    email, primaryId, legacyId, limit
  )
  return rows.reverse()
}

function parseMemoryList(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.filter(Boolean).map((item) => String(item)) : []
  } catch {
    return []
  }
}

function emptyCoachMemory(listenerId) {
  const profile = getCoachProfile(listenerId)
  return {
    listenerId: profile.id,
    coach: profile.label,
    recurringTriggers: [],
    stabilizingRituals: [],
    avoidancePatterns: [],
    commitments: [],
    distortions: [],
    helpfulWording: [],
    updatedAt: null,
  }
}

function serializeCoachMemory(row, listenerId) {
  const base = emptyCoachMemory(listenerId)
  if (!row) {
    return base
  }
  return {
    ...base,
    recurringTriggers: parseMemoryList(row.recurring_triggers),
    stabilizingRituals: parseMemoryList(row.stabilizing_rituals),
    avoidancePatterns: parseMemoryList(row.avoidance_patterns),
    commitments: parseMemoryList(row.commitments),
    distortions: parseMemoryList(row.distortions),
    helpfulWording: parseMemoryList(row.helpful_wording),
    updatedAt: row.updated_at || null,
  }
}

async function getCoachMemory(email, listenerId) {
  const profile = getCoachProfile(listenerId)
  const row = await db.get('SELECT * FROM coach_memories WHERE email = $1 AND listener_id = $2', email, profile.id)
  return serializeCoachMemory(row, profile.id)
}

function toMemoryRow(memory) {
  return {
    recurring_triggers: JSON.stringify(memory.recurringTriggers || []),
    stabilizing_rituals: JSON.stringify(memory.stabilizingRituals || []),
    avoidance_patterns: JSON.stringify(memory.avoidancePatterns || []),
    commitments: JSON.stringify(memory.commitments || []),
    distortions: JSON.stringify(memory.distortions || []),
    helpful_wording: JSON.stringify(memory.helpfulWording || []),
  }
}

function clipMemory(value, max = 140) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trim()}...` : cleaned
}

function addMemoryItem(items, value, maxItems = 5) {
  const cleaned = clipMemory(value)
  if (!cleaned) {
    return items
  }
  const withoutDuplicate = items.filter((item) => item.toLowerCase() !== cleaned.toLowerCase())
  return [...withoutDuplicate, cleaned].slice(-maxItems)
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword))
}

function detectEmotionalSignal(text) {
  if (detectCrisis(text)) {
    return 'crisis_safety_risk'
  }
  const lower = String(text || '').toLowerCase()
  const scored = Object.entries(emotionalRoutes)
    .map(([id, route]) => ({
      id,
      score: route.keywords.reduce((count, keyword) => count + (lower.includes(keyword) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
  return scored[0]?.score > 0 ? scored[0].id : 'overwhelm_anxiety'
}

function extractCommitment(text) {
  const match = String(text).match(/\b(i(?:'ll| will| am going to| promise to| need to| have to| should)\b[^.!?\n]{0,120})/i)
  return match ? clipMemory(match[1]) : ''
}

function extractMemoryUpdates(message, emotionalSignal) {
  const lower = String(message || '').toLowerCase()
  const updates = {
    recurringTriggers: [],
    stabilizingRituals: [],
    avoidancePatterns: [],
    commitments: [],
    distortions: [],
    helpfulWording: [],
  }

  if (includesAny(lower, ['work', 'boss', 'job', 'meeting', 'deadline'])) {
    updates.recurringTriggers.push('Work pressure can pull them off center.')
  }
  if (includesAny(lower, ['argument', 'fight', 'conversation', 'replaying', 'said', 'text'])) {
    updates.recurringTriggers.push('Replayed conversations or messages can become a difficult-night trigger.')
  }
  if (includesAny(lower, ['family', 'parent', 'mom', 'dad', 'partner', 'ex', 'friend'])) {
    updates.recurringTriggers.push('Close relationships can intensify the spiral and need careful handling.')
  }
  if (emotionalSignal === 'loneliness_comfort') {
    updates.recurringTriggers.push('Loneliness and feeling unseen can make risky contact feel tempting.')
  }

  if (includesAny(lower, ['breathe', 'breath', 'ground', 'grounding', 'slow down'])) {
    updates.stabilizingRituals.push('Slowing down and grounding language are useful stabilizers.')
  }
  if (includesAny(lower, ['walk', 'outside', 'fresh air'])) {
    updates.stabilizingRituals.push('A short walk or fresh air may help reset the night.')
  }
  if (includesAny(lower, ['shower', 'water', 'tea', 'eat', 'food'])) {
    updates.stabilizingRituals.push('Basic body care like water, food, or a shower can help them return to center.')
  }
  if (includesAny(lower, ['journal', 'write it down', 'notes'])) {
    updates.stabilizingRituals.push('Writing the honest version down can help organize the spiral.')
  }

  if (emotionalSignal === 'avoidance_excuses' || includesAny(lower, ['scroll', 'doomscroll', 'avoid', 'put it off', 'procrastinate', 'hide'])) {
    updates.avoidancePatterns.push('Avoidance shows up as delaying, numbing, or staying vague.')
  }
  if (includesAny(lower, ['about to text', 'text someone', 'call them', 'dm', 'message them', 'wrong reason'])) {
    updates.avoidancePatterns.push('Reaching for contact in an activated state can make the night worse.')
  }

  const commitment = extractCommitment(message)
  if (commitment) {
    updates.commitments.push(commitment)
  }

  if (emotionalSignal === 'distortion_catastrophizing' || includesAny(lower, ['always', 'never', 'everyone hates me', 'nobody likes me', 'ruined', 'worst'])) {
    updates.distortions.push('Under stress, absolute or catastrophic wording can overtake the facts.')
  }
  if (emotionalSignal === 'shame_self_attack') {
    updates.distortions.push('Shame can turn a behavior into an identity-level attack.')
  }

  if (includesAny(lower, ['gentle', 'soft', 'kind'])) {
    updates.helpfulWording.push('Gentle language lands better when they are flooded.')
  }
  if (includesAny(lower, ['direct', 'honest', 'blunt', 'call me out', 'no sugarcoat'])) {
    updates.helpfulWording.push('Direct, honest wording helps when it stays tied to dignity.')
  }
  if (includesAny(lower, ['stay with me', 'comfort', 'reassure'])) {
    updates.helpfulWording.push('Steady reassurance helps before asking for action.')
  }

  return updates
}

function mergeMemory(memory, updates) {
  return {
    ...memory,
    recurringTriggers: updates.recurringTriggers.reduce((items, item) => addMemoryItem(items, item), memory.recurringTriggers || []),
    stabilizingRituals: updates.stabilizingRituals.reduce((items, item) => addMemoryItem(items, item), memory.stabilizingRituals || []),
    avoidancePatterns: updates.avoidancePatterns.reduce((items, item) => addMemoryItem(items, item), memory.avoidancePatterns || []),
    commitments: updates.commitments.reduce((items, item) => addMemoryItem(items, item), memory.commitments || []),
    distortions: updates.distortions.reduce((items, item) => addMemoryItem(items, item), memory.distortions || []),
    helpfulWording: updates.helpfulWording.reduce((items, item) => addMemoryItem(items, item), memory.helpfulWording || []),
  }
}

function hasMemoryUpdates(updates) {
  return Object.values(updates).some((items) => items.length > 0)
}

async function updateCoachMemory(email, listenerId, message, emotionalSignal) {
  if (emotionalSignal === 'crisis_safety_risk') {
    return { updated: false, memory: await getCoachMemory(email, listenerId) }
  }
  const updates = extractMemoryUpdates(message, emotionalSignal)
  const current = await getCoachMemory(email, listenerId)
  if (!hasMemoryUpdates(updates)) {
    return { updated: false, memory: current }
  }
  const next = mergeMemory(current, updates)
  const row = toMemoryRow(next)
  const updatedAt = new Date().toISOString()
  await db.run(`
    INSERT INTO coach_memories (
      email,
      listener_id,
      recurring_triggers,
      stabilizing_rituals,
      avoidance_patterns,
      commitments,
      distortions,
      helpful_wording,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (email, listener_id) DO UPDATE SET
      recurring_triggers = EXCLUDED.recurring_triggers,
      stabilizing_rituals = EXCLUDED.stabilizing_rituals,
      avoidance_patterns = EXCLUDED.avoidance_patterns,
      commitments = EXCLUDED.commitments,
      distortions = EXCLUDED.distortions,
      helpful_wording = EXCLUDED.helpful_wording,
      updated_at = EXCLUDED.updated_at
  `,
    email,
    getCoachProfile(listenerId).id,
    row.recurring_triggers,
    row.stabilizing_rituals,
    row.avoidance_patterns,
    row.commitments,
    row.distortions,
    row.helpful_wording,
    updatedAt
  )
  return { updated: true, memory: { ...next, updatedAt } }
}

// ---------------------------------------------------------------------------
// Email delivery
// ---------------------------------------------------------------------------

async function deliverVerificationCode(email, code) {
  if (devAuthCodes) {
    return { delivered: true, provider: 'dev' }
  }
  if (emailProvider === 'resend') {
    if (!emailProviderConfigured) {
      throw new Error('Email provider is not fully configured')
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [email],
        subject: 'Your Northstar sign-in code',
        text: `Your Northstar verification code is ${code}. It expires in 10 minutes.`,
      }),
    })
    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Resend delivery failed: ${errorBody}`)
    }
    return { delivered: true, provider: 'resend' }
  }
  if (emailProvider === 'sendgrid') {
    if (!emailProviderConfigured) {
      throw new Error('SendGrid email provider is not fully configured')
    }
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: emailFrom },
        subject: 'Your Northstar sign-in code',
        content: [{ type: 'text/plain', value: `Your Northstar verification code is ${code}. It expires in 10 minutes.` }],
      }),
    })
    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`SendGrid delivery failed: ${errorBody}`)
    }
    return { delivered: true, provider: 'sendgrid' }
  }
  return { delivered: false, provider: 'disabled' }
}

// ---------------------------------------------------------------------------
// AI reply generation
// ---------------------------------------------------------------------------

const crisisKeywords = [
  'suicide',
  'kill myself',
  'killing myself',
  'want to die',
  'end it all',
  'end my life',
  'take my life',
  'off myself',
  'better off dead',
  'no reason to live',
  'no point living',
  'not worth living',
  'want to disappear',
  'hurt myself',
  'harm myself',
];
function detectCrisis(text) {
  const lower = String(text).toLowerCase();
  return crisisKeywords.some(kw => lower.includes(kw));
}

function formatMemoryForPrompt(memory) {
  const sections = [
    ['Recurring triggers', memory.recurringTriggers],
    ['Stabilizing rituals', memory.stabilizingRituals],
    ['Avoidance patterns', memory.avoidancePatterns],
    ['Promises or commitments', memory.commitments],
    ['Common distortions', memory.distortions],
    ['Helpful wording', memory.helpfulWording],
  ]
    .filter(([, items]) => Array.isArray(items) && items.length > 0)
    .map(([label, items]) => `${label}: ${items.join(' | ')}`)

  if (!sections.length) {
    return 'No durable coach memory yet. Listen for useful patterns without pretending to know more than the user has shared.'
  }

  return [
    'Use this coach-specific memory lightly, like you remember how this user tends to get pulled off center.',
    'Do not recite it as a summary or imply surveillance.',
    ...sections,
  ].join('\n')
}

function buildSystemPrompt(listenerId, emotionalSignal, memory) {
  const profile = getCoachProfile(listenerId)
  const route = emotionalRoutes[emotionalSignal]
  const coachRoute = profile.routing[emotionalSignal] || profile.routing.overwhelm_anxiety

  return [
    `You are Northstar ${profile.label}, the ${profile.modeName}.`,
    'Northstar is paid emotional support for difficult nights, spirals, overwhelm, shame, loneliness, and emotional confusion.',
    'It is not therapy, not diagnosis, and not emergency care. Never claim to diagnose or provide clinical treatment.',
    'If the user indicates imminent self-harm, suicide, or danger, prioritize urgent human help and crisis resources.',
    ...profile.prompt,
    `Current emotional route: ${route?.label || 'overwhelm/anxiety'}. ${route?.directive || emotionalRoutes.overwhelm_anxiety.directive}`,
    `Coach-specific routing: ${coachRoute}`,
    formatMemoryForPrompt(memory),
    'Response shape: 3 to 7 short sentences. Be concrete. Avoid generic wellness platitudes. End with one clear next action or question.',
  ].join('\n')
}

function fallbackReply(listenerId, emotionalSignal = 'overwhelm_anxiety') {
  const profile = getCoachProfile(listenerId)
  if (profile.id === 'coach-w') {
    if (emotionalSignal === 'shame_self_attack') {
      return 'Slow down. That is shame trying to turn one moment into your whole identity. Start with one fact, not a verdict: what happened, what part is yours, and what repair is possible?'
    }
    if (emotionalSignal === 'distortion_catastrophizing') {
      return 'Let us separate the fear from the facts. Name what you know for certain, then name what your mind is predicting. We solve the next ten minutes, not the entire future.'
    }
    return 'Take one slower breath. You do not have to solve the whole night at once. Name the pattern, put both feet on the floor, and choose one calming action for the next ten minutes.'
  }
  if (profile.id === 'coach-h') {
    if (emotionalSignal === 'avoidance_excuses') {
      return 'I get why you want to dodge it, and I am not going to shame you for that. But love tells the truth: avoiding this is making tomorrow harder. What is the smallest honest action you can take now?'
    }
    if (emotionalSignal === 'loneliness_comfort') {
      return 'I am with you. Wanting comfort is not weakness, but do not trade your self-respect for a few minutes of relief. What connection would actually care for you tonight?'
    }
    return 'I am with you, and I want the honest version. You do not need shame to change. What is one action that would make tomorrow easier instead of harder?'
  }
  if (emotionalSignal === 'shame_self_attack') {
    return 'No. You are not going to use shame as a weapon against yourself. Keep the facts, drop the self-attack, and choose the repair move.'
  }
  if (emotionalSignal === 'avoidance_excuses') {
    return 'That is avoidance dressed up as reasoning. Cut the negotiation. Pick the smallest useful action and do it before your brain reopens the debate.'
  }
  return 'That thought loop is not helping you. Strip this down to facts, cut one bad option, and commit to one useful move right now.'
}

async function generateReply(email, listenerId, message, emotionalSignal, memory) {
  if (!openai) {
    return { reply: fallbackReply(listenerId, emotionalSignal), source: 'fallback' }
  }
  const recent = await getRecentMessages(email, listenerId)
  const conversation = recent.map((item) => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: item.text,
  }))
  if (!recent.length || recent[recent.length - 1].text !== message || recent[recent.length - 1].role === 'assistant') {
    conversation.push({ role: 'user', content: message })
  }
  const promptMessages = [
    { role: 'system', content: buildSystemPrompt(listenerId, emotionalSignal, memory) },
    ...conversation,
  ]
  let response
  try {
    response = await openai.chat.completions.create({
      model: openAiModel,
      messages: promptMessages,
    })
  } catch (error) {
    log('error', 'openai request failed', { error: error.message, listenerId })
    return { reply: fallbackReply(listenerId, emotionalSignal), source: 'fallback-error' }
  }
  const reply = response.choices?.[0]?.message?.content?.trim()
  if (!reply) {
    return { reply: fallbackReply(listenerId, emotionalSignal), source: 'fallback' }
  }
  return { reply, source: 'openai' }
}

// ---------------------------------------------------------------------------
// Stripe helpers
// ---------------------------------------------------------------------------

async function createCheckoutSession(email) {
  if (!stripe || !stripePriceId) {
    throw new Error('Stripe is not configured yet')
  }
  const user = await upsertUser(email)
  let customerId = user.stripe_customer_id || undefined
  if (!customerId) {
    const customer = await stripe.customers.create({ email })
    customerId = customer.id
    await db.run(
      'UPDATE users SET stripe_customer_id = $1, updated_at = $2 WHERE email = $3',
      customerId, new Date().toISOString(), email
    )
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: stripePriceId, quantity: 1 }],
    success_url: `${appUrl}?checkout=success`,
    cancel_url: `${appUrl}?checkout=cancelled`,
    allow_promotion_codes: true,
    customer_update: { address: 'auto', name: 'auto' },
    metadata: { email },
  })
  return session
}

async function createBillingPortalSession(email) {
  if (!stripe) {
    throw new Error('Stripe is not configured yet')
  }
  const user = await getUser(email)
  if (!user?.stripe_customer_id) {
    throw new Error('No Stripe customer found for this account')
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: appUrl,
  })
  return session
}

async function updateUserSubscription(email, customerId, subscriptionId, status) {
  const active = status === 'active' || status === 'trialing'
  const now = new Date().toISOString()
  await upsertUser(email)
  await db.run(`
    UPDATE users SET
      membership_active = $1,
      stripe_customer_id = COALESCE($2, stripe_customer_id),
      stripe_subscription_id = $3,
      subscription_status = $4,
      updated_at = $5
    WHERE email = $6
  `, active ? 1 : 0, customerId || null, subscriptionId || null, status || 'inactive', now, email)
}

// ---------------------------------------------------------------------------
// HTTP utilities
// ---------------------------------------------------------------------------

function buildCorsHeaders(req) {
  const origin = req.headers.origin;
  const allowedOrigin = corsOrigin === '*' ? origin || '*' : corsOrigin.split(',').includes(origin) ? origin : corsOrigin;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  }
}

function json(req, res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...buildCorsHeaders(req) })
  res.end(JSON.stringify(body))
}

function send(req, res, status, body, headers = {}) {
  res.writeHead(status, { ...buildCorsHeaders(req), ...headers })
  res.end(body)
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      chunks.push(chunk)
      total += chunk.length
      if (total > 1_000_000) {
        reject(new Error('Body too large'))
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function getRequestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  if (forwarded) return forwarded
  return req.socket?.remoteAddress || 'unknown'
}

function enforceRateLimit(req, key) {
  const now = Date.now()
  const bucketKey = `${key}:${getRequestIp(req)}`
  const existing = authRateBuckets.get(bucketKey)
  if (!existing || now > existing.resetAt) {
    authRateBuckets.set(bucketKey, { count: 1, resetAt: now + authWindowMs })
    return null
  }
  if (existing.count >= authMaxRequests) {
    return Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
  }
  existing.count += 1
  return null
}

async function readJsonBody(req) {
  const raw = await readRawBody(req)
  try {
    return raw.length ? JSON.parse(raw.toString('utf8')) : {}
  } catch {
    throw new Error('Invalid JSON')
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function isValidEmail(email) {
  return email.includes('@') && email.includes('.')
}

function sanitizeListenerId(value) {
  return listenerAliases[String(value || '').trim()] || 'coach-w'
}

// ---------------------------------------------------------------------------
// HTTP request handlers
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return send(req, res, 204, '')
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`)

  // GET /api/health
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(req, res, 200, {
      ok: true,
      apiBaseUrl,
      stripeConfigured: Boolean(stripe && stripePriceId),
      webhookConfigured: Boolean(stripeWebhookSecret),
      modelConfigured: Boolean(openai),
      devAuthCodes,
      emailProvider,
      emailConfigured: emailProvider === 'disabled' ? devAuthCodes : emailProviderConfigured,
      authRateLimit: { windowMs: authWindowMs, max: authMaxRequests },
      database: databaseUrl ? 'postgres' : 'sqlite',
    })
  }

  // POST /api/auth/request-code
  if (req.method === 'POST' && url.pathname === '/api/auth/request-code') {
    const retryAfter = enforceRateLimit(req, 'auth-request-code')
    if (retryAfter) {
      return json(req, res, 429, { error: `Too many code requests. Try again in ${retryAfter} seconds.` })
    }
    try {
      const body = await readJsonBody(req)
      const email = normalizeEmail(body.email)
      if (!isValidEmail(email)) {
        return json(req, res, 400, { error: 'Valid email required' })
      }
      await upsertUser(email)
      const code = await createChallenge(email)
      const delivery = await deliverVerificationCode(email, code)
      return json(req, res, 200, {
        ok: true,
        challengeSent: true,
        delivery,
        devCode: devAuthCodes ? code : undefined,
      })
    } catch (error) {
      return json(req, res, 400, { error: error.message })
    }
  }

  // POST /api/auth/verify-code
  if (req.method === 'POST' && url.pathname === '/api/auth/verify-code') {
    const retryAfter = enforceRateLimit(req, 'auth-verify-code')
    if (retryAfter) {
      return json(req, res, 429, { error: `Too many verification attempts. Try again in ${retryAfter} seconds.` })
    }
    try {
      const body = await readJsonBody(req)
      const email = normalizeEmail(body.email)
      const code = String(body.code || '').trim()
      if (!isValidEmail(email)) {
        return json(req, res, 400, { error: 'Valid email required' })
      }
      if (!/^\d{6}$/.test(code)) {
        return json(req, res, 400, { error: 'Valid 6-digit code required' })
      }
      await verifyChallenge(email, code)
      const user = await upsertUser(email)
      const token = await createSession(email)
      return json(req, res, 200, { ok: true, token, user: serializeUser(user) })
    } catch (error) {
      return json(req, res, 400, { error: error.message })
    }
  }

  // POST /api/auth/signout
  if (req.method === 'POST' && url.pathname === '/api/auth/signout') {
    const session = await requireSession(req, res)
    if (!session) return
    await db.run('DELETE FROM sessions WHERE token = $1', session.token)
    return json(req, res, 200, { ok: true })
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/status') {
    const session = await requireSession(req, res)
    if (!session) return
    const user = await getUser(session.email)
    return json(req, res, 200, { ok: true, user: serializeUser(user) })
  }

  // GET /api/coach-memory
  if (req.method === 'GET' && url.pathname === '/api/coach-memory') {
    const session = await requireSession(req, res)
    if (!session) return
    const listenerParam = url.searchParams.get('listenerId')
    if (listenerParam) {
      const listenerId = sanitizeListenerId(String(listenerParam))
      return json(req, res, 200, { ok: true, memory: await getCoachMemory(session.email, listenerId) })
    }
    const memories = await Promise.all(Object.keys(coachProfiles).map((listenerId) => getCoachMemory(session.email, listenerId)))
    return json(req, res, 200, { ok: true, memory: memories[0], memories })
  }

  // GET /api/chat/history
  if (req.method === 'GET' && url.pathname === '/api/chat/history') {
    const session = await requireSession(req, res)
    if (!session) return
    const listenerId = sanitizeListenerId(String(url.searchParams.get('listenerId') || 'steady'))
    return json(req, res, 200, { ok: true, messages: await getChatHistory(session.email, listenerId) })
  }

  // POST /api/billing/checkout-session
  if (req.method === 'POST' && url.pathname === '/api/billing/checkout-session') {
    const session = await requireSession(req, res)
    if (!session) return
    try {
      const checkout = await createCheckoutSession(session.email)
      return json(req, res, 200, { ok: true, url: checkout.url })
    } catch (error) {
      return json(req, res, 400, { error: error.message })
    }
  }

  // POST /api/billing/portal-session
  if (req.method === 'POST' && url.pathname === '/api/billing/portal-session') {
    const session = await requireSession(req, res)
    if (!session) return
    try {
      const portal = await createBillingPortalSession(session.email)
      return json(req, res, 200, { ok: true, url: portal.url })
    } catch (error) {
      return json(req, res, 400, { error: error.message })
    }
  }

  // POST /api/billing/webhook
  if (req.method === 'POST' && url.pathname === '/api/billing/webhook') {
    if (!stripe || !stripeWebhookSecret) {
      return json(req, res, 500, { error: 'Stripe webhook is not configured yet' })
    }
    const signature = req.headers['stripe-signature']
    if (!signature) {
      return json(req, res, 400, { error: 'Missing Stripe signature' })
    }
    try {
      const rawBody = await readRawBody(req)
      const event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret)
      log('info', 'stripe webhook received', { type: event.type, id: event.id })
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object
        const email = normalizeEmail(session.customer_details?.email || session.metadata?.email)
        if (email) {
          await updateUserSubscription(email, String(session.customer || ''), String(session.subscription || ''), 'active')
        }
      }
      if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object
        const customerId = String(subscription.customer || '')
        const row = await db.get('SELECT email FROM users WHERE stripe_customer_id = $1', customerId)
        if (row?.email) {
          await updateUserSubscription(row.email, customerId, String(subscription.id || ''), String(subscription.status || 'inactive'))
        }
      }
      return json(req, res, 200, { received: true })
    } catch (error) {
      return json(req, res, 400, { error: error.message })
    }
  }

  // POST /api/deploy-events
  if (req.method === 'POST' && url.pathname === '/api/deploy-events') {
    const authHeader = req.headers.authorization || '';
    if (!deployWebhookToken || authHeader !== `Bearer ${deployWebhookToken}`) {
      return json(req, res, 401, { error: 'Unauthorized' });
    }
    try {
      const body = await readJsonBody(req);
      await db.run('INSERT INTO deploy_events (status, project, branch, commit_sha, build_id, url, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        body.status || 'unknown',
        body.project || 'unknown',
        body.branch || '',
        body.commit || '',
        body.buildId || '',
        body.url || '',
        new Date().toISOString()
      );
      return json(req, res, 200, { ok: true });
    } catch (error) {
      return json(req, res, 400, { error: error.message });
    }
  }

  // POST /api/chat
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const session = await requireSession(req, res)
    if (!session) return
    try {
      const body = await readJsonBody(req)
      const listenerId = sanitizeListenerId(String(body.listenerId || 'steady'))
      const text = String(body.message || '').trim()
      if (!text) {
        return json(req, res, 400, { error: 'Message required' })
      }
      const user = await getUser(session.email)
      if (!user || !user.membership_active) {
        return json(req, res, 403, { error: 'Active membership required' })
      }
      await saveChatMessage(session.email, listenerId, 'user', 'You', text)

      const emotionalSignal = detectEmotionalSignal(text)
      let escalated = false
      let reply
      let source
      let memoryUpdated = false

      if (emotionalSignal === 'crisis_safety_risk') {
        escalated = true
        reply = "It sounds like you are going through a really difficult time. Please reach out to a crisis lifeline like 988 in the US and Canada, or text HOME to 741741. You don't have to be alone in this."
        source = 'escalation'
      } else {
        const memory = await getCoachMemory(session.email, listenerId)
        const result = await generateReply(session.email, listenerId, text, emotionalSignal, memory)
        reply = result.reply
        source = result.source
        try {
          const memoryResult = await updateCoachMemory(session.email, listenerId, text, emotionalSignal)
          memoryUpdated = memoryResult.updated
        } catch (memoryError) {
          log('error', 'coach memory update failed', { error: memoryError.message, listenerId })
        }
      }

      await saveChatMessage(session.email, listenerId, 'assistant', getCoachProfile(listenerId).label, reply)
      return json(req, res, 200, { ok: true, reply, source, escalated, emotionalSignal, memoryUpdated })
    } catch (error) {
      return json(req, res, 400, { error: error.message })
    }
  }

  // POST /api/email-capture
  if (req.method === 'POST' && url.pathname === '/api/email-capture') {
    try {
      const body = await readJsonBody(req)
      const email = normalizeEmail(body.email)
      if (!isValidEmail(email)) {
        return json(req, res, 400, { error: 'Valid email required' })
      }
      const record = {
        email,
        incentive: 'Founding member rate locked for 3 months + Northstar reset pack',
        capturedAt: new Date().toISOString(),
      }
      await db.run(
        'INSERT INTO email_leads (email, incentive, captured_at) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET incentive = EXCLUDED.incentive, captured_at = EXCLUDED.captured_at',
        record.email, record.incentive, record.capturedAt
      )
      return json(req, res, 200, { ok: true, record })
    } catch (error) {
      return json(req, res, 400, { error: error.message })
    }
  }

  return json(req, res, 404, { error: 'Not found' })
})

server.listen(port, () => {
  log('info', 'northstar api listening', {
    port,
    database: databaseUrl ? 'postgres' : 'sqlite',
    nodeEnv: process.env.NODE_ENV || 'development',
  })
})

// Sweep stale rate-limit buckets to prevent unbounded memory growth.
// Single-replica only; multi-replica deployments need a shared store.
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of authRateBuckets) {
    if (now > bucket.resetAt + authWindowMs) {
      authRateBuckets.delete(key)
    }
  }
}, authWindowMs).unref()

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  log('info', 'shutdown initiated', { signal })
  const hardExit = setTimeout(() => {
    log('error', 'graceful shutdown timed out, forcing exit')
    process.exit(1)
  }, 10_000)
  hardExit.unref()
  server.close((err) => {
    if (err) log('error', 'http server close error', { error: err.message })
  })
  try {
    if (pgPool) await pgPool.end()
  } catch (err) {
    log('error', 'postgres pool drain error', { error: err.message })
  }
  log('info', 'shutdown complete')
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
