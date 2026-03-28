const crypto = require('crypto');

const rateLimitMap = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQ = 20;

function sanitize(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, maxLen);
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

function signPayload(payload, secret) {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return payloadB64 + '.' + signature;
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

  const tokenSecret = process.env.ACCESS_VERIFY_SECRET || process.env.TELEGRAM_BOT_TOKEN;
  if (!tokenSecret) {
    return res.status(503).json({ ok: false, error: 'token_secret_not_configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    const email = sanitize(body.email, 120).toLowerCase();
    const userId = sanitize(body.userId, 40).toUpperCase();
    const brokerName = sanitize(body.brokerName, 80);
    const brokerAccountId = sanitize(body.brokerAccountId, 80);

    if (!email || !userId || !brokerName || !brokerAccountId) {
      return res.status(400).json({ ok: false, error: 'missing_required_fields' });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      scope: 'free_access',
      email: email,
      userId: userId,
      brokerName: brokerName,
      brokerAccountId: brokerAccountId,
      iat: nowSec,
      exp: nowSec + (10 * 60)
    };

    const token = signPayload(payload, tokenSecret);
    return res.status(200).json({ ok: true, token: token, expiresAt: payload.exp });
  } catch (_) {
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};
