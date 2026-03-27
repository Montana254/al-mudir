const rateLimitMap = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQ = 8;

function sanitize(value, maxLen) {
  if (typeof value !== 'string') return 'N/A';
  return value.replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, maxLen) || 'N/A';
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + WINDOW_MS;
  }
  entry.count += 1;
  rateLimitMap.set(ip, entry);
  return entry.count > MAX_REQ;
}

function renderLines(type, payload, ip) {
  if (type === 'user.created') {
    return [
      'AL-MUDIR EVENT: USER CREATED',
      '----------------------------',
      'Name: ' + sanitize(payload.name, 80),
      'Email: ' + sanitize(payload.email, 120),
      'Message: ' + sanitize(payload.message, 200),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  if (type === 'user.login') {
    return [
      'AL-MUDIR EVENT: USER LOGIN',
      '--------------------------',
      'Name: ' + sanitize(payload.name, 80),
      'Email: ' + sanitize(payload.email, 120),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  if (type === 'free.access.requested') {
    return [
      'AL-MUDIR EVENT: FREE ACCESS',
      '---------------------------',
      'Name: ' + sanitize(payload.name, 80),
      'Email: ' + sanitize(payload.email, 120),
      'Plan: ' + sanitize(payload.plan, 40),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  if (type === 'crypto.payment.intent') {
    return [
      'AL-MUDIR EVENT: CRYPTO INTENT',
      '-----------------------------',
      'Name: ' + sanitize(payload.name, 80),
      'Email: ' + sanitize(payload.email, 120),
      'Amount: ' + sanitize(payload.amount, 40),
      'Currency: ' + sanitize(payload.currency, 16),
      'Hash: ' + sanitize(payload.transaction_hash, 200),
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
  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return res.status(503).json({ ok: false, error: 'telegram_not_configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const type = sanitize(body.type || '', 60);
    const payload = body.payload || {};

    const allowed = new Set([
      'user.created',
      'user.login',
      'free.access.requested',
      'crypto.payment.intent'
    ]);
    if (!allowed.has(type)) {
      return res.status(400).json({ ok: false, error: 'unsupported_event' });
    }

    const lines = renderLines(type, payload, ip);
    if (!lines) {
      return res.status(400).json({ ok: false, error: 'invalid_payload' });
    }

    const response = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join('\n')
      })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      return res.status(502).json({ ok: false, error: 'telegram_send_failed', details: data });
    }

    return res.status(200).json({ ok: true, messageId: data.result?.message_id || null });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'server_error', message: error.message });
  }
};