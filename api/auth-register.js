'use strict';
const { redis, withDb } = require('./_lib/redis');
const { sendOtpEmail } = require('./_lib/email');
const { hashPassword, generateOtp, sanitize } = require('./_lib/auth-utils');

const rateLimitMap = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQ = 5;

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

    const name = sanitize(body.name, 80);
    const email = sanitize(body.email, 120).toLowerCase();
    const password = String(body.password || '');
    const phone = body.phone ? sanitize(body.phone, 20) : null;

    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, error: 'missing_fields', required: ['name', 'email', 'password'] });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'invalid_email' });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: 'password_too_short' });
    }

    const existing = await redis('GET', 'user:' + email);
    if (existing) {
      return res.status(409).json({ ok: false, error: 'email_already_registered' });
    }

    const { hash, salt } = await hashPassword(password);
    const otp = generateOtp();

    const user = {
      name,
      email,
      phone,
      passwordHash: hash,
      passwordSalt: salt,
      verified: false,
      verificationMethod: 'email',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      brokerSignup: false,
      brokerProfile: null,
      freeAccess: false,
      kycState: 'unverified'
    };

    await redis('SET', 'user:' + email, JSON.stringify(user));
    await redis('SET', 'otp:' + email, JSON.stringify({ code: otp, exp: now + 10 * 60 * 1000 }));
    await redis('EXPIRE', 'otp:' + email, 600);

    try {
      await sendOtpEmail(email, otp, name);
    } catch (emailErr) {
      // Roll back user creation if email fails
      await redis('DEL', 'user:' + email);
      await redis('DEL', 'otp:' + email);
      return res.status(502).json({ ok: false, error: 'email_send_failed', detail: String(emailErr.message).slice(0, 120) });
    }

    return res.status(200).json({ ok: true, requiresVerification: true, verificationMethod: 'email', email });
  } catch (error) {
    const msg = String(error && error.message ? error.message : 'server_error');
    if (msg.includes('redis_not_configured')) {
      return res.status(503).json({ ok: false, error: 'storage_not_configured' });
    }
    if (msg.includes('email_not_configured')) {
      return res.status(503).json({ ok: false, error: 'email_not_configured' });
    }
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
