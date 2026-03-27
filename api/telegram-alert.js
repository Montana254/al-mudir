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

    if (eventType !== 'user.created') {
      return res.status(400).json({ ok: false, error: 'unsupported_event' });
    }

    const lines = [
      '\u{1F4CB} NEW AL-MUDIR INQUIRY',
      '\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014',
      'Name:    ' + sanitize(payload.name, 100),
      'Email:   ' + sanitize(payload.email, 200),
      'Message: ' + sanitize(payload.message, 500),
      '\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014\u2014',
      'IP: ' + ip
    ];

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