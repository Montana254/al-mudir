'use strict';
const { redis, withDb } = require('./_lib/redis');
const { verifyPassword, generateSessionToken, sanitize } = require('./_lib/auth-utils');
const { ensureUserRecord, getOtpDeliveryPreview, saveUserProfileSnapshot, toSafeProfile } = require('./_lib/user-profile');

const rateLimitMap = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQ = 10;

module.exports = withDb(async function handler(req, res) {
  try {
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

    let body = {};
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body);
      } catch {
        return res.status(400).json({ ok: false, error: 'invalid_json' });
      }
    } else {
      body = req.body || {};
    }

    const email = sanitize(body.email, 120).toLowerCase();
    const password = String(body.password || '');

    if (!email || !password) return res.status(400).json({ ok: false, error: 'missing_fields' });

    const userRaw = await redis('GET', 'user:' + email);
    // Return same error for unknown email and wrong password (prevent user enumeration)
    if (!userRaw) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

    const user = JSON.parse(userRaw);
    const ensured = await ensureUserRecord(redis, user);
    if (ensured.changed) await redis('SET', 'user:' + email, JSON.stringify(ensured.user));
    await saveUserProfileSnapshot(redis, ensured.user);

    if (!ensured.user.verified) {
      const delivery = getOtpDeliveryPreview(ensured.user);
      return res.status(403).json({ ok: false, error: 'account_not_verified', requiresVerification: true, email, verificationMethod: delivery.method, deliveryTarget: delivery.target });
    }

    const valid = await verifyPassword(password, ensured.user.passwordHash, ensured.user.passwordSalt);
    if (!valid) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

    const sessionToken = generateSessionToken();
    await redis('SET', 'session:' + sessionToken, JSON.stringify({ email, createdAt: new Date().toISOString() }));
    await redis('EXPIRE', 'session:' + sessionToken, 86400);

    return res.status(200).json({ ok: true, token: sessionToken, profile: toSafeProfile(ensured.user) });
  } catch (error) {
    const msg = String(error && error.message ? error.message : 'server_error');
    if (msg.includes('redis_not_configured')) {
      return res.status(503).json({ ok: false, error: 'storage_not_configured' });
    }
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
