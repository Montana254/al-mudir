'use strict';
const { redis } = require('./_lib/redis');
const { generateSessionToken, sanitize } = require('./_lib/auth-utils');

const rateLimitMap = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQ = 15;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + WINDOW_MS; }
  entry.count++;
  rateLimitMap.set(ip, entry);
  if (entry.count > MAX_REQ) return res.status(429).json({ ok: false, error: 'rate_limited' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const email = sanitize(body.email, 120).toLowerCase();
  const otp = sanitize(body.otp, 10).replace(/\s/g, '');

  if (!email || !otp) return res.status(400).json({ ok: false, error: 'missing_fields' });

  const otpRaw = await redis('GET', 'otp:' + email);
  if (!otpRaw) return res.status(400).json({ ok: false, error: 'otp_expired_or_invalid' });

  let otpData;
  try { otpData = JSON.parse(otpRaw); } catch {
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }

  if (Date.now() > otpData.exp) {
    await redis('DEL', 'otp:' + email);
    return res.status(400).json({ ok: false, error: 'otp_expired' });
  }
  if (otp !== String(otpData.code)) {
    return res.status(400).json({ ok: false, error: 'otp_invalid' });
  }

  const userRaw = await redis('GET', 'user:' + email);
  if (!userRaw) return res.status(404).json({ ok: false, error: 'user_not_found' });

  const user = JSON.parse(userRaw);
  user.verified = true;
  user.verifiedAt = new Date().toISOString();
  user.updatedAt = new Date().toISOString();

  const sessionToken = generateSessionToken();
  await redis('SET', 'user:' + email, JSON.stringify(user));
  await redis('DEL', 'otp:' + email);
  await redis('SET', 'session:' + sessionToken, JSON.stringify({ email, createdAt: new Date().toISOString() }));
  await redis('EXPIRE', 'session:' + sessionToken, 86400);

  const { passwordHash: _h, passwordSalt: _s, ...safeProfile } = user;
  return res.status(200).json({ ok: true, token: sessionToken, profile: safeProfile });
};
