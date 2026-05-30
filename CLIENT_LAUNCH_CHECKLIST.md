# Sentryharbor — Launch Checklist

Everything in this document requires action on your end. The code is ready to deploy.

---

## 1. Deploy Backend to Railway

1. Push the latest code to your GitHub repo.
2. In your Railway project, trigger a redeploy (or it will redeploy automatically on push).
3. Confirm the following environment variables are set in Railway:

| Variable | Value |
|---|---|
| `PORT` | `8787` |
| `APP_URL` | `https://sentryharbor.com` |
| `API_BASE_URL` | Your backend URL (e.g. `https://api.sentryharbor.com`) |
| `CORS_ORIGIN` | `https://sentryharbor.com` |
| `DATABASE_URL` | Set automatically by the Railway Postgres plugin |
| `DEV_AUTH_CODES` | `false` |
| `OPENAI_API_KEY` | Your OpenAI key |
| `OPENAI_MODEL` | `gpt-4.1-mini` |
| `STRIPE_SECRET_KEY` | Your Stripe live secret key |
| `STRIPE_WEBHOOK_SECRET` | From Stripe → Webhooks (see section 3) |
| `STRIPE_PRICE_ID` | Your $24/month price ID |
| `EMAIL_PROVIDER` | `sendgrid` or `resend` |
| `EMAIL_FROM` | Your verified sender address |
| `SENDGRID_API_KEY` | Your SendGrid key (or `RESEND_API_KEY` if using Resend) |

4. After deploy, visit `https://api.sentryharbor.com/api/health` — every field should show `true` or `postgres`.

---

## 2. Deploy Frontend to Vercel

1. Connect your GitHub repo to [vercel.com](https://vercel.com).
2. Set this environment variable in the Vercel project settings (under **Settings → Environment Variables**):

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://api.sentryharbor.com/api` |

3. Deploy. Vercel will run `npm run build` and serve the `dist/` folder automatically.

---

## 3. Register the Stripe Webhook

This step is required for subscription activation to work after payment.

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com) → **Developers → Webhooks → Add endpoint**.
2. Set the URL to: `https://api.sentryharbor.com/api/billing/webhook`
3. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. After saving, copy the **Signing secret** (`whsec_...`) and add it as `STRIPE_WEBHOOK_SECRET` in Railway.
5. Trigger a Railway redeploy so the new secret takes effect.

---

## 4. Smoke Test

Once both services are live, verify end-to-end:

- [ ] Visit `https://sentryharbor.com` — the app loads
- [ ] Enter your email → receive a verification code email
- [ ] Sign in with the code
- [ ] Click Subscribe → Stripe checkout opens with the $24/month price
- [ ] Complete a test payment (Stripe test card: `4242 4242 4242 4242`, any future date, any CVC)
- [ ] Confirm membership activates and chat unlocks
- [ ] Send a message — AI responds
- [ ] Sign out and back in — chat history is preserved

---

## Summary

| Task | Where |
|---|---|
| Confirm Railway env vars and redeploy | Railway dashboard |
| Set `VITE_API_BASE_URL` and deploy frontend | Vercel dashboard |
| Register Stripe webhook, copy secret to Railway | Stripe dashboard → Railway dashboard |
| Smoke test | Browser |
