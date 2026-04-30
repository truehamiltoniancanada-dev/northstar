# Northstar Local Setup

## 1. Environment

Use `.env.example` as the template. The key runtime fields are now:

```env
PORT=8787
APP_URL=http://127.0.0.1:5173
API_BASE_URL=http://127.0.0.1:8787
CORS_ORIGIN=http://127.0.0.1:5173
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=5
VITE_API_BASE_URL=http://127.0.0.1:8787/api
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
EMAIL_PROVIDER=resend
EMAIL_FROM=
RESEND_API_KEY=
DEV_AUTH_CODES=true
```

Notes:

- `API_BASE_URL` is returned by `/api/health` so the frontend can discover the backend base URL.
- `VITE_API_BASE_URL` lets a hosted frontend point directly at a separate hosted backend.
- `CORS_ORIGIN` should be tightened to your real frontend origin outside local development.
- `AUTH_RATE_LIMIT_WINDOW_MS` and `AUTH_RATE_LIMIT_MAX` throttle auth abuse at the API layer.
- `DEV_AUTH_CODES=true` is useful locally because the verification code is returned in the API response and shown in the UI.

## 2. Start the app

Backend:

```bash
npm run start:api
```

Frontend:

```bash
npm run dev
```

## 3. Auth flow

Northstar now uses verification-code auth with server-side sessions.

Local dev flow:

1. Enter an email in the app
2. Click `Send code`
3. If `DEV_AUTH_CODES=true`, the code appears in a dev banner
4. Enter the 6-digit code
5. Click `Verify and continue`

Production flow:

- Set `DEV_AUTH_CODES=false`
- Configure a mail provider so `request-code` can actually deliver email

### Resend setup

The current production-path implementation supports Resend.

Set:

```env
EMAIL_PROVIDER=resend
EMAIL_FROM=Northstar <hello@your-domain.com>
RESEND_API_KEY=re_...
```

Behavior:

- If Resend is configured, `/api/auth/request-code` sends a real verification email
- If it is not configured and `DEV_AUTH_CODES=false`, sign-in cannot complete

## 4. Stripe test mode

To enable paid membership checkout:

1. Create a product named `Northstar Core` in Stripe test mode
2. Create a recurring monthly price for `$24.00`
3. Put the resulting `price_...` id into `STRIPE_PRICE_ID`
4. Add your Stripe test secret key to `STRIPE_SECRET_KEY`

Forward webhooks locally:

```bash
stripe listen --forward-to http://127.0.0.1:8787/api/billing/webhook
```

Then place the returned signing secret into `STRIPE_WEBHOOK_SECRET`.

Useful test card:

```text
4242 4242 4242 4242
```

Use any future expiry date, any CVC, and any ZIP.

## 5. Model-backed chat

To move chat off fallback replies, set:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
```

Behavior:

- If `OPENAI_API_KEY` is set, `/api/chat` uses the OpenAI Responses API
- If it is not set, the app falls back to built-in listener-specific replies
- Chat history is persisted in SQLite and reloaded per listener

## 6. Current backend behavior

- Verification-code challenges are stored in SQLite
- Successful verification creates a single active server-side session token per user
- Protected endpoints require `Authorization: Bearer <token>`
- Membership state is driven by stored Stripe subscription status
- Chat access is blocked unless membership is active
- Chat history can be reloaded from `/api/chat/history?listenerId=...`
- Email captures are stored in SQLite at `data/northstar.db`
- Billing management uses the Stripe billing portal when configured

## 7. Cheapest workable deployment

If the goal is minimum cost with the current codebase, use this stack:

- Frontend: Vercel
- Backend: Railway
- Email: Resend
- Billing: Stripe test mode first, then live mode later

Why this stack:

- Vercel is a clean free-tier fit for the Vite frontend
- Railway is a better fit than serverless platforms for a long-running Node process with SQLite
- Resend is the simplest transactional email provider supported by the current backend
- Stripe is already wired in the backend

### Frontend on Vercel

Build settings:

```text
Framework preset: Vite
Build command: npm run build
Output directory: dist
```

Frontend environment variable:

```env
VITE_API_BASE_URL=https://your-backend-domain.up.railway.app/api
```

### Backend environment variables (Railway)

```env
PORT=8787
APP_URL=https://your-frontend-domain.vercel.app
API_BASE_URL=https://your-backend-domain.up.railway.app
CORS_ORIGIN=https://your-frontend-domain.vercel.app
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=5
DEV_AUTH_CODES=false
DATABASE_URL=postgres://user:password@host:5432/northstar
EMAIL_PROVIDER=resend
EMAIL_FROM=Northstar <hello@your-domain.com>
RESEND_API_KEY=re_...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
OPENAI_API_KEY=sk_...
OPENAI_MODEL=gpt-4.1-mini
```

Important note:

- This stack defaults to SQLite for local development so no extra setup is needed.
- For production, set `DATABASE_URL` to a Postgres connection string to move persistence off local disk.
- Railway's hobby tier includes a small persistent disk, but a hosted Postgres (Neon, Supabase, Railway's own Postgres) is more reliable for production.
- If you use Neon or Supabase, set `DATABASE_URL` and remove the `data/` directory concern entirely.

### Stripe webhook target

In Stripe, point the webhook to:

```text
https://your-backend-domain.up.railway.app/api/billing/webhook
```

Listen at minimum for:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## 8. Remaining production gaps

Still not fully production-complete:

- auth rate limiting is in-memory only, so it resets on restart and does not coordinate across multiple instances
- no cookie-based session transport yet, only bearer tokens in the client
- no outbound provider abstraction beyond Resend for email
- live external verification still depends on real Stripe/OpenAI/Resend credentials
