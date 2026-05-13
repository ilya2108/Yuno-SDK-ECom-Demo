// app.js
// Express app — shared between local dev (server.js) and Vercel serverless (api/index.js).

require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const yuno = require('./lib/yuno');

// In-memory webhook event store for the demo (latest first, capped at 50)
const WEBHOOK_EVENTS = [];
const SEEN_EVENT_IDS = new Set();   // idempotency dedup

function recordEvent(event) {
  WEBHOOK_EVENTS.unshift({
    received_at: new Date().toISOString(),
    event,
  });
  while (WEBHOOK_EVENTS.length > 50) WEBHOOK_EVENTS.pop();
}

function verifyHmacSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader, 'base64'),
      Buffer.from(expected, 'base64')
    );
  } catch {
    return false;
  }
}

const app = express();
// Capture the raw body so we can verify HMAC signatures on webhooks
// (HMAC must be computed over the EXACT bytes Yuno sent, not the re-serialized JSON).
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Expose public Yuno key to the frontend (NOT the private secret).
app.get('/api/config', (_req, res) => {
  res.json({
    publicApiKey: process.env.YUNO_PUBLIC_API_KEY,
  });
});

// Demo cart — hardcoded for the case study.
const DEMO_ORDER = {
  currency: 'EUR',
  country: 'ES',
  items: [
    { sku: 'YQ-001', name: 'Oversized Wool Coat',  price: 24900 },
    { sku: 'YQ-002', name: 'Silk Slip Dress',      price: 18900 },
  ],
};
const DEMO_TOTAL = DEMO_ORDER.items.reduce((s, i) => s + i.price, 0);

app.get('/api/cart', (_req, res) => {
  res.json({ ...DEMO_ORDER, total: DEMO_TOTAL });
});

// Create checkout session — called from frontend before SDK init.
app.post('/api/checkout-session', async (_req, res) => {
  try {
    // In real app: lookup or create customer for the logged-in user.
    // For the demo we create a fresh guest customer per checkout.
    const merchantCustomerId = `guest-${Date.now()}`;
    const customer = await yuno.createCustomer({
      merchantCustomerId,
      firstName: 'Demo',
      lastName: 'Buyer',
      email: `${merchantCustomerId}@yunique.example`,
      country: DEMO_ORDER.country,
    });

    const merchantOrderId = `order-${Date.now()}`;
    const session = await yuno.createCheckoutSession({
      customerId: customer.id,
      // Yuno expects amount in decimal major units (e.g. "438.00"), not cents.
      amount: (DEMO_TOTAL / 100).toFixed(2),
      currency: DEMO_ORDER.currency,
      country: DEMO_ORDER.country,
      merchantOrderId,
      callbackUrl: `${process.env.PUBLIC_APP_URL}/success.html`,
    });

    res.json({
      checkoutSession: session.checkout_session,
      customerId: customer.id,
      merchantOrderId,
      amount: DEMO_TOTAL,            // keep cents internally for the frontend
      currency: DEMO_ORDER.currency,
      country: DEMO_ORDER.country,
    });
  } catch (e) {
    console.error('checkout-session error', e.status, e.body || e.message);
    res.status(500).json({ error: 'checkout_session_failed', detail: e.body || e.message });
  }
});

// Create payment after SDK callback returns the One-Time Token.
app.post('/api/payments', async (req, res) => {
  try {
    const {
      oneTimeToken,
      checkoutSession,
      customerId,
      merchantOrderId,
      amount,
      currency,
      country,
    } = req.body;

    const payment = await yuno.createPayment({
      oneTimeToken,
      checkoutSession,
      customerId,
      merchantOrderId,
      // Frontend sent cents; Yuno expects decimal major units.
      amount: (amount / 100).toFixed(2),
      currency,
      country,
    });

    res.json({
      id: payment.id,
      status: payment.status,
      sdk_action_required: payment.checkout?.sdk_action_required ?? false,
    });
  } catch (e) {
    console.error('create payment error', e.status, e.body || e.message);
    res.status(500).json({ error: 'payment_failed', detail: e.body || e.message });
  }
});

// Yuno webhook receiver.
// Production patterns demonstrated:
//   1. Defense in depth: HMAC signature + shared-secret headers (x-api-key + x-secret)
//   2. Idempotency dedup (Yuno may deliver the same event multiple times)
//   3. Fast 200 response (Yuno expects <5s or it retries)
//   4. In-memory event store for demo visibility (in prod: enqueue async job, write to DB)
app.post('/api/webhook', (req, res) => {
  const hmacSecret = process.env.YUNO_WEBHOOK_SECRET;
  const expectedApiKey = process.env.YUNO_WEBHOOK_X_API_KEY;
  const expectedSecret = process.env.YUNO_WEBHOOK_X_SECRET;

  // 1a) Shared-secret headers — first line of defense, cheap to check.
  //     Use timing-safe comparison to avoid leaking info via response time.
  function safeEqualStr(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  }

  if (expectedApiKey && !safeEqualStr(req.headers['x-api-key'], expectedApiKey)) {
    console.warn('[webhook ✗] x-api-key mismatch');
    return res.status(401).json({ error: 'invalid_api_key' });
  }
  if (expectedSecret && !safeEqualStr(req.headers['x-secret'], expectedSecret)) {
    console.warn('[webhook ✗] x-secret mismatch');
    return res.status(401).json({ error: 'invalid_secret' });
  }

  // 1b) HMAC signature — cryptographic verification of payload integrity + authenticity.
  if (hmacSecret) {
    const sig = req.headers['x-hmac-signature'];
    if (!verifyHmacSignature(req.rawBody, sig, hmacSecret)) {
      console.warn('[webhook ✗] invalid or missing HMAC signature');
      return res.status(401).json({ error: 'invalid_signature' });
    }
  } else {
    console.warn('[webhook ⚠] YUNO_WEBHOOK_SECRET not set — accepting unverified (dev only)');
  }

  const event = req.body || {};
  const payment = event?.data?.payment;
  const eventKey = event?.id
    || `${event?.type_event}-${payment?.id}-${payment?.updated_at}`;

  // 2) Idempotency — same event may arrive twice (network retries, at-least-once delivery).
  //    Processing PAYMENT_SUCCEEDED twice could double-ship an order.
  if (eventKey && SEEN_EVENT_IDS.has(eventKey)) {
    console.log(`[webhook ↻] duplicate ignored: ${eventKey}`);
    return res.status(200).json({ status: 'duplicate_ignored' });
  }
  if (eventKey) SEEN_EVENT_IDS.add(eventKey);

  // 3) Record + log (in prod: enqueue async job here — DB write, fulfillment, email, etc.)
  recordEvent(event);
  console.log(`[webhook ✓] ${event?.type_event || 'unknown'} · payment=${payment?.id?.slice(0,8) || '?'} · status=${payment?.status || '?'}`);

  // 4) Fast 200 — don't keep Yuno waiting on heavy work
  res.status(200).json({ received: true });
});

// Demo-only: expose the in-memory event log so /webhooks.html can poll and display it.
// In production this would never exist as a public endpoint.
app.get('/api/webhook-log', (_req, res) => {
  res.json({ events: WEBHOOK_EVENTS, count: WEBHOOK_EVENTS.length });
});

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

module.exports = app;