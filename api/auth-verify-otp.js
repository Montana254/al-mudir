'use strict';
const { redis, withDb } = require('./_lib/redis');
const { generateSessionToken, sanitize } = require('./_lib/auth-utils');
const { ensureUserRecord, saveUserProfileSnapshot, toSafeProfile } = require('./_lib/user-profile');
const { attachAdminFlag } = require('./_lib/admin-access');
const { runAgent } = require('./_lib/agents');

const rateLimitMap = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQ = 15;

// Per-email brute-force lockout: 5 wrong attempts → 15 min block
const otpAttemptMap = new Map();
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCKOUT_MS = 15 * 60 * 1000;

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
    const otp = sanitize(body.otp, 10).replace(/\s/g, '');

    if (!email || !otp) return res.status(400).json({ ok: false, error: 'missing_fields' });

    // Per-email brute-force lockout
    const attemptKey = email;
    const attemptEntry = otpAttemptMap.get(attemptKey);
    if (attemptEntry && attemptEntry.lockedUntil && Date.now() < attemptEntry.lockedUntil) {
      const remainMin = Math.ceil((attemptEntry.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ ok: false, error: 'otp_locked', detail: 'Too many failed attempts. Try again in ' + remainMin + ' minute(s).' });
    }

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
      // Track failed attempt per email
      const cur = otpAttemptMap.get(attemptKey) || { count: 0, lockedUntil: null };
      cur.count++;
      if (cur.count >= OTP_MAX_ATTEMPTS) {
        cur.lockedUntil = Date.now() + OTP_LOCKOUT_MS;
        cur.count = 0;
        otpAttemptMap.set(attemptKey, cur);
        return res.status(429).json({ ok: false, error: 'otp_locked', detail: 'Too many failed attempts. Account locked for 15 minutes.' });
      }
      otpAttemptMap.set(attemptKey, cur);
      return res.status(400).json({ ok: false, error: 'otp_invalid', attemptsLeft: OTP_MAX_ATTEMPTS - cur.count });
    }

    // OTP correct — clear attempt counter
    otpAttemptMap.delete(attemptKey);

    const userRaw = await redis('GET', 'user:' + email);
    if (!userRaw) return res.status(404).json({ ok: false, error: 'user_not_found' });

    const user = JSON.parse(userRaw);
    const ensured = await ensureUserRecord(redis, user);

    const purpose = otpData.purpose || 'signup';

    if (purpose === 'login') {
      // Login OTP — user is already verified, just create session
      ensured.user.updatedAt = new Date().toISOString();
    } else {
      // Signup OTP — mark account as verified
      ensured.user.verified = true;
      ensured.user.verifiedAt = new Date().toISOString();
      ensured.user.updatedAt = new Date().toISOString();
    }

    const sessionToken = generateSessionToken();
    await redis('SET', 'user:' + email, JSON.stringify(ensured.user));
    await saveUserProfileSnapshot(redis, ensured.user);
    await redis('DEL', 'otp:' + email);
    await redis('SET', 'session:' + sessionToken, JSON.stringify({ email, createdAt: new Date().toISOString() }));
    await redis('EXPIRE', 'session:' + sessionToken, 86400);

    // Fire welcome email agent on first-time signup verification
    if (purpose !== 'login') {
      try { await runAgent({ type: 'user.verified', payload: { email, name: ensured.user.name } }); } catch { /* best-effort */ }
    }

    return res.status(200).json({ ok: true, token: sessionToken, profile: attachAdminFlag(toSafeProfile(ensured.user)) });
  } catch (error) {
    const msg = String(error && error.message ? error.message : 'server_error');
    if (msg.includes('redis_not_configured')) {
      return res.status(503).json({ ok: false, error: 'storage_not_configured' });
    }
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
