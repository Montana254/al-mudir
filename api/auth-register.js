'use strict';
const { redis, withDb } = require('./_lib/redis');
const { sendOtpCode } = require('./_lib/email');
const { hashPassword, generateOtp, sanitize } = require('./_lib/auth-utils');
const { assignUniqueUserId, saveUserProfileSnapshot } = require('./_lib/user-profile');

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
    const otpChannel = String(body.otpChannel || 'email').toLowerCase() === 'phone' ? 'phone' : 'email';

    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, error: 'missing_fields', required: ['name', 'email', 'password'] });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'invalid_email' });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: 'password_too_short' });
    }
    if (otpChannel === 'phone' && !phone) {
      return res.status(400).json({ ok: false, error: 'phone_required_for_phone_otp' });
    }

    const existing = await redis('GET', 'user:' + email);
    if (existing) {
      return res.status(409).json({ ok: false, error: 'email_already_registered' });
    }

    const { hash, salt } = await hashPassword(password);
    const otp = generateOtp();
    const userId = await assignUniqueUserId(redis, email);

    const user = {
      userId,
      name,
      email,
      phone,
      passwordHash: hash,
      passwordSalt: salt,
      verified: false,
      verificationMethod: otpChannel,
      otpChannel: otpChannel,
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

    // Track user registration in system metrics
    try {
      const regRaw = await redis('GET', 'system:registered_users');
      const regData = (regRaw && typeof regRaw === 'object') ? regRaw : { count: 0, users: [] };
      if (!regData.users) regData.users = [];
      if (!regData.users.find(u => u.email === email)) {
        regData.users.push({ email, userId, name, registeredAt: new Date().toISOString() });
        regData.count = regData.users.length;
      }
      await redis('SET', 'system:registered_users', regData);
    } catch { /* best-effort tracking */ }

    try {
      const delivery = await sendOtpCode({ email, phone, otp, name, preferredChannel: otpChannel });
      user.verificationMethod = delivery.method;
      user.updatedAt = new Date().toISOString();
      await redis('SET', 'user:' + email, JSON.stringify(user));
      await saveUserProfileSnapshot(redis, user);
      return res.status(200).json({
        ok: true,
        requiresVerification: true,
        verificationMethod: delivery.method,
        deliveryTarget: delivery.target,
        email,
        userId
      });
    } catch (emailErr) {
      // Roll back user creation if email fails
      await redis('DEL', 'userid:' + userId);
      await redis('DEL', 'user:' + email);
      await redis('DEL', 'otp:' + email);
      return res.status(502).json({ ok: false, error: 'otp_send_failed', detail: String(emailErr.message).slice(0, 120) });
    }
  } catch (error) {
    const msg = String(error && error.message ? error.message : 'server_error');
    if (msg.includes('redis_not_configured')) {
      return res.status(503).json({ ok: false, error: 'storage_not_configured' });
    }
    if (msg.includes('email_not_configured') || msg.includes('sms_not_configured')) {
      return res.status(503).json({ ok: false, error: 'otp_not_configured' });
    }
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
