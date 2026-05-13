// lib/yuno.js
// Server-side Yuno API client. Never import this from frontend code.
// All calls use private-secret-key — keep this file out of any browser bundle.

const BASE = process.env.YUNO_API_BASE || 'https://api-sandbox.y.uno';

function headers(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'yunique-checkout/0.1.0 (+demo)',
    'public-api-key': process.env.YUNO_PUBLIC_API_KEY,
    'private-secret-key': process.env.YUNO_PRIVATE_SECRET_KEY,
    ...extra,
  };
}

async function call(method, path, body, extraHeaders = {}) {
  const h = headers(extraHeaders);
  console.log(`\n[yuno →] ${method} ${BASE}${path}`);
  console.log(`[yuno →] headers: ${Object.keys(h).join(', ')}`);
  if (body) console.log(`[yuno →] body: ${JSON.stringify(body).slice(0, 300)}`);

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  console.log(`[yuno ←] ${res.status} ${res.headers.get('content-type') || 'no content-type'}`);
  console.log(`[yuno ←] body: ${text.slice(0, 300)}`);

  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!res.ok) {
    const err = new Error(`Yuno API ${method} ${path} → ${res.status}`);
    err.status = res.status;
    err.body = data;
    err.path = path;
    throw err;
  }
  return data;
}

// 1) Create or reuse a customer.
// merchantCustomerId — your stable ID for this user (email hash, user UUID, etc.)
async function createCustomer({ merchantCustomerId, firstName, lastName, email, country }) {
  return call('POST', '/v1/customers', {
    merchant_customer_id: merchantCustomerId,
    first_name: firstName,
    last_name: lastName,
    email,
    country,
  });
}

// 2) Create checkout session for SDK_CHECKOUT workflow.
// callbackUrl is where Yuno redirects back after 3DS challenges (must be HTTPS in prod).
async function createCheckoutSession({
  customerId,
  amount,           // integer or string, in minor units depending on currency (see Yuno docs)
  currency,         // e.g. "EUR", "USD"
  country,          // ISO-2, e.g. "ES"
  merchantOrderId,  // your order ID
  description = 'Yunique Fashion Store order',
  callbackUrl,
}) {
  return call('POST', '/v1/checkout/sessions', {
    account_id: process.env.YUNO_ACCOUNT_ID,
    customer_id: customerId,
    merchant_order_id: merchantOrderId,
    payment_description: description,
    country,
    amount: { currency, value: String(amount) },
    callback_url: callbackUrl,
    workflow: 'SDK_CHECKOUT',
  });
}

// 3) Create payment after SDK returns one-time token (OTT).
async function createPayment({
  oneTimeToken,
  checkoutSession,
  customerId,
  merchantOrderId,
  amount,
  currency,
  country,
  description = 'Yunique Fashion Store order',
  idempotencyKey,
}) {
  return call(
    'POST',
    '/v1/payments',
    {
      description,
      account_id: process.env.YUNO_ACCOUNT_ID,
      merchant_order_id: merchantOrderId,
      country,
      amount: { currency, value: String(amount) },
      checkout: { session: checkoutSession },
      customer_payer: { id: customerId },
      payment_method: { token: oneTimeToken },
    },
    { 'X-idempotency-key': idempotencyKey || `${merchantOrderId}-${Date.now()}` }
  );
}

async function getPayment(paymentId) {
  return call('GET', `/v1/payments/${paymentId}`);
}

module.exports = {
  createCustomer,
  createCheckoutSession,
  createPayment,
  getPayment,
};