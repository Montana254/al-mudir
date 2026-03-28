'use strict';
const { redis } = require('./_lib/redis');
const { verifyPassword, generateSessionToken, sanitize } = require('./_lib/auth-utils');

const rateLimitMap = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQ = 10;

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
  const password = String(body.password || '');

  if (!email || !password) return res.status(400).json({ ok: false, error: 'missing_fields' });

  const userRaw = await redis('GET', 'user:' + email);
  // Return same error for unknown email and wrong password (prevent user enumeration)
  if (!userRaw) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

  const user = JSON.parse(userRaw);

  if (!user.verified) {
    return res.status(403).json({ ok: false, error: 'account_not_verified', requiresVerification: true, email });
  }

  const valid = await verifyPassword(password, user.passwordHash, user.passwordSalt);
  if (!valid) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

  const sessionToken = generateSessionToken();
  await redis('SET', 'session:' + sessionToken, JSON.stringify({ email, createdAt: new Date().toISOString() }));
  await redis('EXPIRE', 'session:' + sessionToken, 86400);

  const { passwordHash: _h, passwordSalt: _s, ...safeProfile } = user;
  return res.status(200).json({ ok: true, token: sessionToken, profile: safeProfile });
};
