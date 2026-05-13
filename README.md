# Yunique Fashion Store · Embedded Checkout

A working reference implementation of Yuno's Web SDK (Standard Flow) for an enterprise fashion retailer. Built as a Solutions Engineer case study — full payment lifecycle from cart to webhook, with production-grade patterns and a live demo of orchestration value.

**Stack:** Node.js · Express · Vanilla JS · Yuno Web SDK v1.6 · Sandbox mode
**Deploy:** Vercel serverless functions + static assets
**Status:** Demo-ready · Sandbox only

---

## What this demonstrates

| Capability | Where it lives |
|---|---|
| **Embedded checkout** — modal-mode Yuno SDK on merchant domain, no redirects | `public/checkout.html` |
| **Card payment end-to-end** — session → tokenization → authorization → fulfillment | `app.js` → `lib/yuno.js` |
| **Decline recovery UX** — auto-reload + session preservation on failed authorization | `public/checkout.html` |
| **Real-time webhook log** — auto-polling event dashboard for live visibility | `public/webhooks.html` |
| **Production-pattern webhooks** — HMAC + idempotency + fast-200 + defense-in-depth | `app.js` |
| **Dashboard-driven extensibility** — add wallets, BNPL, local PMs without code changes | Demoed live |
| **Light editorial theme** — fashion-brand aesthetic via CSS variables | `public/styles.css` |

---

## Project structure

```
yunique-checkout/
├── api/
│   └── index.js              # Vercel serverless wrapper (exports Express app)
├── lib/
│   └── yuno.js               # Yuno API client: createCustomer, createCheckoutSession, createPayment, getPayment
├── public/
│   ├── index.html            # Shopping cart (2 fashion line items, €438 total)
│   ├── checkout.html         # Yuno SDK mount + payment orchestration
│   ├── success.html          # Order confirmation
│   ├── webhooks.html         # Real-time webhook event viewer (2s polling)
│   └── styles.css            # Light editorial theme, CSS-variable-driven
├── app.js                    # Express routes + webhook handler with HMAC verification
├── server.js                 # Local dev entry point (port 3000)
├── package.json
├── vercel.json               # Routes /api/* to serverless function, static from public/
├── .env.example              # Documented env vars (never commit real .env)
└── README.md
```

---

## Architecture

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Yunique browser │◄──►│  Yunique backend │◄──►│     Yuno API     │
│                  │OTT │                  │REST│                  │
│  Yuno Web SDK    │    │  Express         │    │  Orchestrator    │
│  Card iframe     │    │  Session + Pay   │    │  Routing engine  │
│  Public key only │    │  Webhook recvr   │    │  PSP connections │
└──────────────────┘    └─────────▲────────┘    └─────────┬────────┘
                                  │                       │
                                  │  Webhook              │
                                  └───── signed (HMAC) ◄──┘
```

**Key principle:** `private-secret-key` never reaches the browser. Customer never leaves the merchant domain.

---

## Quick start (local development)

### Prerequisites

- Node.js 18+
- Yuno sandbox account ([dashboard.y.uno](https://dashboard.y.uno))
- Yuno Test Payment Gateway connection enabled in dashboard
- ngrok for webhook tunneling (or use Vercel deploy for HTTPS)

### Setup

```bash
git clone https://github.com/ilya2108/Yuno-SDK-ECom-Demo.git
cd Yuno-SDK-ECom-Demo
npm install
cp .env.example .env
```

### Configure `.env`

```bash
# Yuno API credentials (from dashboard.y.uno → Developers → API keys)
YUNO_PUBLIC_API_KEY=sandbox_...
YUNO_PRIVATE_SECRET_KEY=...
YUNO_ACCOUNT_ID=<your-account-uuid>
YUNO_API_BASE=https://api-sandbox.y.uno

# Webhook verification secrets (from dashboard.y.uno → Webhooks → your webhook)
YUNO_WEBHOOK_SECRET=<HMAC secret>
YUNO_WEBHOOK_X_API_KEY=<defense-in-depth header value>
YUNO_WEBHOOK_X_SECRET=<defense-in-depth header value>

# Public-facing URL (ngrok for local, Vercel URL for production)
PUBLIC_APP_URL=https://your-ngrok-url.ngrok-free.dev

# Local dev only — Vercel manages this in production
PORT=3000
```

### Yuno Dashboard prerequisites

Before running locally, configure in [dashboard.y.uno](https://dashboard.y.uno):

1. **Connections** → enable **Yuno Test Payment Gateway** (no credentials needed)
2. **Routing** → create Card route, conditions: Country=ES (or your test country), provider: Yuno Test Payment Gateway → **Publish**
3. **Checkout Builder** → toggle **Card** ON → **Publish**
4. **Webhooks** → register endpoint: `https://<your-public-url>/api/webhooks/yuno`
   - Enable HMAC signature
   - Add `x-api-key` and `x-secret` defense-in-depth headers
   - Subscribe to all Payment events

### Run

```bash
# Terminal 1: start the app
npm start
# → http://localhost:3000

# Terminal 2: tunnel webhooks (skip if using Vercel deploy)
ngrok http 3000
# → use the HTTPS URL as PUBLIC_APP_URL and in Yuno webhook config
```

Open `http://localhost:3000` (or your ngrok URL).

---

## Test cards

The Yuno Test Payment Gateway returns deterministic responses based on the card number used. Two ways to trigger specific outcomes:

1. **Use a test card** (table below) — recommended for demos
2. **Override via payment description** — set `description: "SUCCEEDED"` (or any status) when creating the payment; Yuno uses the description if no specific test card is matched

> **Yuno's evaluation order:** card data takes precedence over description. If they conflict, the card status wins.

All test cards use:
- **Expiration:** `11/28`
- **CVV (Visa/Mastercard/Diners/UATP):** `123`
- **CVV (Amex):** `1234`
- **Cardholder name:** any (e.g., `John Doe`)

### ✅ Positive scenarios

| Card | Scheme | Outcome | Use for |
|---|---|---|---|
| `4507 9900 0000 0002` | Visa | `SUCCEEDED` | **Primary happy-path demo** |
| `5252 4400 0000 0002` | Mastercard | `SUCCEEDED` | Alt scheme demo |
| `3700 0000 0000 002` | Amex | `SUCCEEDED` | 15-digit + 4-digit CVV demo |
| `3647 1660 0000 0002` | Diners | `SUCCEEDED` | Less common scheme test |
| `1139 0000 0000 0002` | UATP | `SUCCEEDED` | Travel-industry scheme |

### ❌ Negative scenarios (decline reasons)

All scheme suffixes follow the same pattern. Visa shown; replace prefix for Mastercard (`525244...`), Amex (`370000...`), Diners (`3647166...`), UATP (`1139000...`).

| Card | Outcome | Use for |
|---|---|---|
| `4507 9900 0000 0010` | `INSUFFICIENT_FUNDS` | Soft decline, retry candidate |
| `4507 9900 0000 0028` | `DECLINED_BY_BANK` | **Primary decline-retry demo** |
| `4507 9900 0000 0036` | `DO_NOT_HONOR` | Generic decline |
| `4507 9900 0000 0044` | `INVALID_SECURITY_CODE` | CVV validation failure |
| `4507 9900 0000 0051` | `INVALID_CARD_DATA` | Card data malformed |
| `4507 9900 0000 0069` | `REPORTED_STOLEN` | Fraud signal |
| `4507 9900 0000 0077` | `ERROR` | Generic processor error |

### 🔐 3DS scenarios (advanced)

Yuno's 3DS testing requires a 3DS provider connection (e.g., Cybersource 3DS) in addition to the Test Payment Gateway. Below are cards for the most useful flows once 3DS is configured.

| Card | Scheme | Expected 3DS 2.x | Use for |
|---|---|---|---|
| `4556 5579 5572 6624` | Visa | `AUTHENTICATED_APPLICATION_FRICTIONLESS` | Frictionless approve (silent 3DS) |
| `4929 2518 9704 7956` | Visa | `AUTHENTICATED_BROWSER_FRICTIONLESS` | Frictionless browser flow |
| `4916 9940 6425 2017` | Visa | `BROWSER_CHALLENGE` | **Challenge with OTP** |
| `4716 4293 2384 2524` | Visa | `NOT_AUTHENTICATED_BROWSER_FRICTIONLESS` | Failed frictionless |
| `5306 8899 4283 3340` | Mastercard | `BROWSER_CHALLENGE` | Mastercard challenge variant |
| `3486 3826 7931 507` | Amex | `BROWSER_CHALLENGE` | Amex challenge variant |

**3DS2 OTP codes** (for `BROWSER_CHALLENGE` cards):

| OTP | Transaction Status | Outcome |
|---|---|---|
| `1234` | Y | **Authenticated — payment proceeds** |
| `1111` | N | Authentication failed |
| `2222` | R | Authentication rejected |
| `3333` | U | Authentication unavailable |
| `4444` | A | Attempted (status A) |

OTP codes are universal across Visa, Mastercard, and Amex scenarios.

---

## Demo runbook

For demo purposes, here's the rehearsed flow against this implementation:

### 1. Happy path (2 min)
1. Open `https://<your-url>/` — fashion cart loads
2. Click **Checkout** — Yuno modal opens
3. Enter `4507 9900 0000 0002` / `11/28` / `123`, click **Pay**
4. Success page renders
5. Open Yuno Dashboard → **Payments** — transaction shows `SUCCEEDED`

### 2. Decline recovery (2 min)
1. Fresh checkout
2. Enter `4507 9900 0000 0028` (DECLINED_BY_BANK) — observe error
3. Page auto-reloads after ~2.5s, cart preserved
4. Retry with `4507 9900 0000 0002` — succeeds

### 3. Money shot — live payment method addition (3 min)
1. Open Yuno Dashboard → **Checkout Builder** in a second window
2. Toggle **Apple Pay** ON → **Publish**
3. Refresh the checkout page
4. Apple Pay button appears — zero code change, zero deploy

### 4. Webhook log (1 min)
1. Open `https://<your-url>/webhooks.html`
2. Showcase the event stream: signed events arriving in real time
3. Open the raw payload toggle to show HMAC signature verification

---

## Webhook security model

The webhook handler at `POST /api/webhooks/yuno` implements three independent verification layers, plus idempotency protection.

### Defense-in-depth verification (in order, fastest first)

```
1. Header check: x-api-key matches YUNO_WEBHOOK_X_API_KEY
2. Header check: x-secret matches YUNO_WEBHOOK_X_SECRET
3. HMAC-SHA256: signature verified over raw body bytes (not re-serialized JSON)
   Uses crypto.timingSafeEqual to prevent timing attacks
4. Idempotency: event ID checked against seen-events set; duplicates short-circuit
```

If any check fails: returns `401`, never reaches business logic.
If all pass: returns `200` immediately, processes event.

### Why all three

Each protects against a different threat:
- **HMAC** — forged events from anyone who knows the URL
- **x-api-key/x-secret** — additional shared-secret factors if HMAC key leaks
- **Idempotency** — at-least-once delivery shipping the same order twice

### Production considerations not yet implemented

- **Idempotency state is in-memory** — use Redis with TTL in production
- **Webhook processing is synchronous** — push to queue (SQS/Pub/Sub) and ack fast
- **No retry-from-dead-letter** — pair with daily reconciliation against Yuno settlement file

---

## Amount handling

> **Critical gotcha:** Yuno uses **major units** (e.g., `"438.00"`) at the API boundary, **not** minor units (e.g., `43800` cents) like Stripe.

This implementation stores amounts in cents internally and converts at the Yuno client boundary:

```js
// lib/yuno.js — when creating payment
amount: { currency: "EUR", value: (cents / 100).toFixed(2) }
```

This prevents the classic 100× overcharge bug where `438` becomes `43,800` if interpreted as cents.

---

## Deployment

See **DEPLOY.md** (or the conversation that generated this project) for step-by-step Vercel instructions. TL;DR:

1. Push to GitHub
2. Import on [vercel.com/new](https://vercel.com/new)
3. Add env vars (all of `.env` minus `PORT`)
4. Deploy → get URL
5. Add `PUBLIC_APP_URL` env var with the deployed URL → redeploy
6. Update Yuno webhook URL in dashboard to point at deployed endpoint

---

## Configuration reference

| Variable | Required | Purpose |
|---|---|---|
| `YUNO_PUBLIC_API_KEY` | Yes | Client-side SDK initialization |
| `YUNO_PRIVATE_SECRET_KEY` | Yes | Server-side API auth · NEVER ship to browser |
| `YUNO_ACCOUNT_ID` | Yes | Yuno account identifier (UUID) |
| `YUNO_API_BASE` | Yes | `https://api-sandbox.y.uno` (sandbox) or `https://api.y.uno` (prod) |
| `YUNO_WEBHOOK_SECRET` | Yes | HMAC SHA-256 signing secret |
| `YUNO_WEBHOOK_X_API_KEY` | Yes | Defense-in-depth header value |
| `YUNO_WEBHOOK_X_SECRET` | Yes | Defense-in-depth header value |
| `PUBLIC_APP_URL` | Yes | Full HTTPS URL of deployed app (for `callback_url`) |
| `PORT` | No | Local dev only (Vercel sets automatically) |

---

## Tech stack

- **Runtime:** Node.js 18+
- **Framework:** Express 4.x (stateless, serverless-compatible)
- **Frontend:** Vanilla HTML/CSS/JS — no framework, no build step
- **Payments:** Yuno Web SDK v1.6 (Standard Flow / Full SDK)
- **Crypto:** Node `crypto` module — `createHmac`, `timingSafeEqual`
- **Deploy:** Vercel serverless functions + static asset CDN
- **Local tunneling:** ngrok (HTTPS required by Yuno API for `callback_url`)

---

## Known limitations & roadmap

### Demo-grade trade-offs
- Modal-mode SDK (not element-mode inline rendering) — chosen for ship reliability
- In-memory webhook dedup — fine for demo, needs Redis in prod
- Synchronous webhook processing — needs async queue at scale
- Hardcoded cart with 2 items — no product catalog or session management
- No customer authentication — checkout is single-flow guest

### Production roadmap
1. **Wallets** — Apple Pay, Google Pay (dashboard toggle + domain verification)
2. **Network tokenization** — `vault_on_success: true`, Yuno as TSP
3. **3DS configuration** — EU SCA compliance, embedded challenge
4. **Smart routing** — automatic retry on soft declines through alternate PSPs
5. **Reconciliation** — daily settlement file matching via Yuno Reconciliation product

---

## License

Reference implementation, no license — built as a demo deliverable. Not intended for production use without security review.

---

## Acknowledgments

- **Yuno docs** — [docs.y.uno](https://docs.y.uno) · all integration patterns sourced from official quickstart
- **Yuno Test Payment Gateway** — deterministic sandbox responses make demos repeatable