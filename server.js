import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import OpenAI from 'openai'
import Stripe from 'stripe'
import Database from 'better-sqlite3'
import pg from 'pg'

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

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null
const openai = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null
const emailProviderConfigured = emailProvider === 'resend' ? Boolean(resendApiKey && emailFrom) : emailProvider === 'sendgrid' ? Boolean(sendgridApiKey && emailFrom) : false
const authRateBuckets = new Map()

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
    CREATE TABLE IF NOT EXISTS auth_challenges (
      email TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
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

  return {
    run(sql, ...params) {
      return sqlite.prepare(sql).run(...params)
    },
    get(sql, ...params) {
      return sqlite.prepare(sql).get(...params)
    },
    all(sql, ...params) {
      return sqlite.prepare(sql).all(...params)
    },
  }
}

function createPostgresAdapter(connectionString) {
  const { Pool } = pg
  const pool = new Pool({ connectionString })

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

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function hashCode(email, code) {
  return crypto.createHash('sha256').update(`${email}:${code}`).digest('hex')
}

function createChallenge(email) {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + 1000 * 60 * 10).toISOString()
  db.run(`
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

function verifyChallenge(email, code) {
  const challenge = db.get('SELECT * FROM auth_challenges WHERE email = $1', email)
  if (!challenge) {
    throw new Error('No verification code requested')
  }
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    db.run('DELETE FROM auth_challenges WHERE email = $1', email)
    throw new Error('Verification code expired')
  }
  if (challenge.attempts >= 5) {
    throw new Error('Too many verification attempts')
  }
  const expected = hashCode(email, code)
  if (expected !== challenge.code_hash) {
    db.run('UPDATE auth_challenges SET attempts = attempts + 1 WHERE email = $1', email)
    throw new Error('Invalid verification code')
  }
  db.run('DELETE FROM auth_challenges WHERE email = $1', email)
}

function createSession(email) {
  const token = crypto.randomBytes(24).toString('hex')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString()
  db.run('DELETE FROM sessions WHERE email = $1', email)
  db.run(
    'INSERT INTO sessions (token, email, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    token, email, now.toISOString(), expiresAt
  )
  return token
}

function getSessionFromRequest(req) {
  const header = String(req.headers.authorization || '')
  if (!header.startsWith('Bearer ')) {
    return null
  }
  const token = header.slice('Bearer '.length).trim()
  if (!token) {
    return null
  }
  const session = db.get('SELECT * FROM sessions WHERE token = $1', token)
  if (!session) {
    return null
  }
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.run('DELETE FROM sessions WHERE token = $1', token)
    return null
  }
  return session
}

function requireSession(req, res) {
  const session = getSessionFromRequest(req)
  if (!session) {
    json(res, 401, { error: 'Valid session required' })
    return null
  }
  return session
}

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

function getUser(email) {
  return db.get('SELECT * FROM users WHERE email = $1', email)
}

function upsertUser(email) {
  const now = new Date().toISOString()
  const existing = getUser(email)
  if (existing) {
    db.run('UPDATE users SET updated_at = $1 WHERE email = $2', now, email)
    return getUser(email)
  }
  db.run(
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

function saveChatMessage(email, listenerId, role, label, text) {
  db.run(
    'INSERT INTO chat_messages (email, listener_id, role, label, text, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    email, listenerId, role, label, text, new Date().toISOString()
  )
}

function getRecentMessages(email, listenerId) {
  return db.all(
    'SELECT role, label, text FROM chat_messages WHERE email = $1 AND listener_id = $2 ORDER BY id DESC LIMIT 8',
    email, listenerId
  ).reverse()
}

function getChatHistory(email, listenerId, limit = 40) {
  return db.all(
    'SELECT role, label, text, created_at FROM chat_messages WHERE email = $1 AND listener_id = $2 ORDER BY id DESC LIMIT $3',
    email, listenerId, limit
  ).reverse()
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

function buildSystemPrompt(listenerId) {
  if (listenerId === 'steady') {
    return 'You are Northstar in Steady Presence mode. Respond calmly, warmly, and clearly. Do not roleplay a therapist. Be emotionally supportive, grounded, brief, and practical. Never claim to provide emergency care or diagnosis.'
  }
  if (listenerId === 'coach') {
    return 'You are Northstar in Caring Coach mode. Respond warmly but directly. Be encouraging, honest, and accountable without being cruel. Do not roleplay a therapist. Never claim to provide emergency care or diagnosis.'
  }
  return 'You are Northstar in Straight Shooter mode. Respond bluntly and clearly, but not abusively. Prioritize clarity, realism, and useful next actions. Do not roleplay a therapist. Never claim to provide emergency care or diagnosis.'
}

function fallbackReply(listenerId) {
  if (listenerId === 'steady') {
    return 'Let us slow this down. Start with one true sentence about what is happening, then choose one calming action you can do in the next ten minutes.'
  }
  if (listenerId === 'coach') {
    return 'I am with you, but I want the honest version. What is one action that would make tomorrow easier instead of harder?'
  }
  return 'That thought loop is not helping you. Strip this down to facts, cut one bad option, and commit to one useful move right now.'
}

async function generateReply(email, listenerId, message) {
  if (!openai) {
    return { reply: fallbackReply(listenerId), source: 'fallback' }
  }
  const recent = getRecentMessages(email, listenerId)
  const promptMessages = [
    { role: 'system', content: buildSystemPrompt(listenerId) },
    ...recent.map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: item.text,
    })),
    { role: 'user', content: message },
  ]
  const response = await openai.responses.create({
    model: openAiModel,
    input: promptMessages,
  })
  const reply = response.output_text?.trim()
  if (!reply) {
    return { reply: fallbackReply(listenerId), source: 'fallback' }
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
  const user = upsertUser(email)
  let customerId = user.stripe_customer_id || undefined
  if (!customerId) {
    const customer = await stripe.customers.create({ email })
    customerId = customer.id
    db.run(
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
  const user = getUser(email)
  if (!user?.stripe_customer_id) {
    throw new Error('No Stripe customer found for this account')
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: appUrl,
  })
  return session
}

function updateUserSubscription(email, customerId, subscriptionId, status) {
  const active = status === 'active' || status === 'trialing'
  const now = new Date().toISOString()
  upsertUser(email)
  db.run(`
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

function buildCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...buildCorsHeaders() })
  res.end(JSON.stringify(body))
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...buildCorsHeaders(), ...headers })
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
  return ['steady', 'coach', 'straight'].includes(value) ? value : 'steady'
}

// ---------------------------------------------------------------------------
// HTTP request handlers
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return send(res, 204, '')
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`)

  // GET /api/health
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, {
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
      return json(res, 429, { error: `Too many code requests. Try again in ${retryAfter} seconds.` })
    }
    try {
      const body = await readJsonBody(req)
      const email = normalizeEmail(body.email)
      if (!isValidEmail(email)) {
        return json(res, 400, { error: 'Valid email required' })
      }
      upsertUser(email)
      const code = createChallenge(email)
      const delivery = await deliverVerificationCode(email, code)
      return json(res, 200, {
        ok: true,
        challengeSent: true,
        delivery,
        devCode: devAuthCodes ? code : undefined,
      })
    } catch (error) {
      return json(res, 400, { error: error.message })
    }
  }

  // POST /api/auth/verify-code
  if (req.method === 'POST' && url.pathname === '/api/auth/verify-code') {
    const retryAfter = enforceRateLimit(req, 'auth-verify-code')
    if (retryAfter) {
      return json(res, 429, { error: `Too many verification attempts. Try again in ${retryAfter} seconds.` })
    }
    try {
      const body = await readJsonBody(req)
      const email = normalizeEmail(body.email)
      const code = String(body.code || '').trim()
      if (!isValidEmail(email)) {
        return json(res, 400, { error: 'Valid email required' })
      }
      if (!/^\d{6}$/.test(code)) {
        return json(res, 400, { error: 'Valid 6-digit code required' })
      }
      verifyChallenge(email, code)
      const user = upsertUser(email)
      const token = createSession(email)
      return json(res, 200, { ok: true, token, user: serializeUser(user) })
    } catch (error) {
      return json(res, 400, { error: error.message })
    }
  }

  // POST /api/auth/signout
  if (req.method === 'POST' && url.pathname === '/api/auth/signout') {
    const session = requireSession(req, res)
    if (!session) return
    db.run('DELETE FROM sessions WHERE token = $1', session.token)
    return json(res, 200, { ok: true })
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/status') {
    const session = requireSession(req, res)
    if (!session) return
    const user = getUser(session.email)
    return json(res, 200, { ok: true, user: serializeUser(user) })
  }

  // GET /api/chat/history
  if (req.method === 'GET' && url.pathname === '/api/chat/history') {
    const session = requireSession(req, res)
    if (!session) return
    const listenerId = sanitizeListenerId(String(url.searchParams.get('listenerId') || 'steady'))
    return json(res, 200, { ok: true, messages: getChatHistory(session.email, listenerId) })
  }

  // POST /api/billing/checkout-session
  if (req.method === 'POST' && url.pathname === '/api/billing/checkout-session') {
    const session = requireSession(req, res)
    if (!session) return
    try {
      const checkout = await createCheckoutSession(session.email)
      return json(res, 200, { ok: true, url: checkout.url })
    } catch (error) {
      return json(res, 400, { error: error.message })
    }
  }

  // POST /api/billing/portal-session
  if (req.method === 'POST' && url.pathname === '/api/billing/portal-session') {
    const session = requireSession(req, res)
    if (!session) return
    try {
      const portal = await createBillingPortalSession(session.email)
      return json(res, 200, { ok: true, url: portal.url })
    } catch (error) {
      return json(res, 400, { error: error.message })
    }
  }

  // POST /api/billing/webhook
  if (req.method === 'POST' && url.pathname === '/api/billing/webhook') {
    if (!stripe || !stripeWebhookSecret) {
      return json(res, 500, { error: 'Stripe webhook is not configured yet' })
    }
    const signature = req.headers['stripe-signature']
    if (!signature) {
      return json(res, 400, { error: 'Missing Stripe signature' })
    }
    try {
      const rawBody = await readRawBody(req)
      const event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret)
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object
        const email = normalizeEmail(session.customer_details?.email || session.metadata?.email)
        if (email) {
          updateUserSubscription(email, String(session.customer || ''), String(session.subscription || ''), 'active')
        }
      }
      if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object
        const customerId = String(subscription.customer || '')
        const row = db.get('SELECT email FROM users WHERE stripe_customer_id = $1', customerId)
        if (row?.email) {
          updateUserSubscription(row.email, customerId, String(subscription.id || ''), String(subscription.status || 'inactive'))
        }
      }
      return json(res, 200, { received: true })
    } catch (error) {
      return json(res, 400, { error: error.message })
    }
  }

  // POST /api/chat
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const session = requireSession(req, res)
    if (!session) return
    try {
      const body = await readJsonBody(req)
      const listenerId = sanitizeListenerId(String(body.listenerId || 'steady'))
      const text = String(body.message || '').trim()
      if (!text) {
        return json(res, 400, { error: 'Message required' })
      }
      const user = getUser(session.email)
      if (!user || !user.membership_active) {
        return json(res, 403, { error: 'Active membership required' })
      }
      saveChatMessage(session.email, listenerId, 'user', 'You', text)
      const { reply, source } = await generateReply(session.email, listenerId, text)
      saveChatMessage(session.email, listenerId, 'assistant', listenerId, reply)
      return json(res, 200, { ok: true, reply, source })
    } catch (error) {
      return json(res, 400, { error: error.message })
    }
  }

  // POST /api/email-capture
  if (req.method === 'POST' && url.pathname === '/api/email-capture') {
    try {
      const body = await readJsonBody(req)
      const email = normalizeEmail(body.email)
      if (!isValidEmail(email)) {
        return json(res, 400, { error: 'Valid email required' })
      }
      const record = {
        email,
        incentive: 'Founding member rate locked for 3 months + Northstar reset pack',
        capturedAt: new Date().toISOString(),
      }
      db.run(
        'INSERT INTO email_leads (email, incentive, captured_at) VALUES ($1, $2, $3)',
        record.email, record.incentive, record.capturedAt
      )
      return json(res, 200, { ok: true, record })
    } catch (error) {
      return json(res, 400, { error: error.message })
    }
  }

  return json(res, 404, { error: 'Not found' })
})

server.listen(port, () => {
  console.log(`Northstar API listening on http://127.0.0.1:${port}`)
})
