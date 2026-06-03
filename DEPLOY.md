# Sentryharbor Deployment

This app is not a pure static site.

- The frontend is a Vite app.
- The backend is a standalone Node HTTP server in `server.js`.
- A production deployment needs both pieces.

## Recommended Production Shape

Use a split deployment:

1. Frontend on Vercel
2. Backend on a normal Node host
3. Postgres for production data
4. Stripe live keys
5. Real email delivery
6. `DEV_AUTH_CODES=false`

This is the fastest path to a real launch because the current backend is not written as Vercel serverless functions.

## Frontend Deployment

Deploy the Vite frontend to Vercel.

Required frontend environment variable:

```bash
VITE_API_BASE_URL=https://api.sentryharbor.com/api
```

Build settings:

- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`

## Backend Deployment

Deploy `server.js` on a Node host that supports a long-running process.

Examples:

- Railway
- Render
- Fly.io
- VPS with systemd + nginx

Required backend environment variables:

```bash
PORT=8787
APP_URL=https://www.sentryharbor.com
API_BASE_URL=https://api.sentryharbor.com
CORS_ORIGIN=https://www.sentryharbor.com
DATABASE_URL=postgres://...
STRIPE_SECRET_KEY=***
STRIPE_WEBHOOK_SECRET=***
STRIPE_PRICE_ID=price_...
OPENAI_API_KEY=***
OPENAI_MODEL=gpt-4.1-mini
EMAIL_PROVIDER=sendgrid
EMAIL_FROM=Sentryharbor <hello@sentryharbor.com>
SENDGRID_API_KEY=***
DEV_AUTH_CODES=false
```

The Railway backend uses `node server.js` as its start command (configured in `railway.json`).

## Production Notes

- Do not use SQLite for production.
- Do not leave `DEV_AUTH_CODES=true` in production.
- Confirm Stripe webhook delivery to `/api/billing/webhook`.
- Confirm the frontend is pointed at the backend URL, not localhost.

## Launch Checklist

1. Backend `/api/health` returns `200`.
2. Frontend loads with the `Sentryharbor` title.
3. Sign-in code request succeeds.
4. Verification code email arrives.
5. Verification login succeeds.
6. Stripe checkout opens.
7. Stripe webhook marks membership active.
8. Chat responses work.
9. Crisis escalation returns urgent guidance.

## Current State

- Frontend root deploy is reachable.
- Root title is now `Sentryharbor`.
- The current Vercel deploy does not serve `/api/*`.
- A live launch requires deploying the backend separately or refactoring it into Vercel API routes.
