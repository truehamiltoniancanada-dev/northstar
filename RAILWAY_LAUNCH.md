# Railway Launch Plan

This is the fastest way to launch Sentryharbor in production.

## Architecture

- Frontend: Vercel
- Backend: Railway
- Database: Railway Postgres or external Postgres

## What Railway Hosts

Railway should run the backend from `server.js`.

The existing `Dockerfile` is sufficient for a first launch:

- installs dependencies
- supports native modules like `better-sqlite3`
- starts `node server.js`

## Railway Service Setup

Create a new Railway project for the backend.

Deploy this repo to Railway or connect the GitHub repo.

Start command:

```bash
node server.js
```

Railway picks this up automatically from `railway.json`. The server reads the dynamic `PORT` environment variable Railway provides.

Healthcheck path is set to `/api/health` in `railway.json` so Railway marks the deploy ready as soon as the server responds.

## Required Railway Environment Variables

Set these in the Railway service:

```bash
APP_URL=https://www.sentryharbor.com
API_BASE_URL=https://api.sentryharbor.com
CORS_ORIGIN=https://www.sentryharbor.com
DATABASE_URL=postgres://user:password@host:5432/sentryharbor
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

Notes:

- Do not set `PORT` manually unless Railway requires it.
- Use Postgres in production.
- Do not leave `DEV_AUTH_CODES=true` in production.

## Vercel Frontend Environment Variable

Set this in the Vercel project:

```bash
VITE_API_BASE_URL=https://api.sentryharbor.com/api
```

Then redeploy the frontend.

## Stripe Webhook

In Stripe, point the webhook to:

```bash
https://api.sentryharbor.com/api/billing/webhook
```

Events to include at minimum:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Smoke Test Order

1. Open `https://api.sentryharbor.com/api/health`
2. Confirm `ok: true`
3. Confirm `emailConfigured: true`
4. Confirm `devAuthCodes: false`
5. Redeploy Vercel frontend with the Railway API URL
6. Load the frontend and confirm the title is `Sentryharbor`
7. Request a verification code
8. Confirm the code email arrives
9. Sign in successfully
10. Start Stripe checkout
11. Complete payment in test/live mode as intended
12. Confirm membership becomes active
13. Send a chat message and confirm response

## Likely Failure Modes

- `404` on `/api/health`: Railway service is not running or wrong domain used
- email sign-in fails: SendGrid or `EMAIL_FROM` is wrong
- checkout fails: Stripe live keys or `STRIPE_PRICE_ID` are wrong
- membership never activates: webhook URL or `STRIPE_WEBHOOK_SECRET` is wrong
- frontend still hits localhost: `VITE_API_BASE_URL` was not set before Vercel redeploy

## Launch Recommendation

Launch backend first on Railway.
Then point Vercel at it.
Then test sign-in before testing Stripe.
Then test Stripe before announcing launch.
