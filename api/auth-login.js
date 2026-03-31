'use strict';
const { redis, withDb } = require('./_lib/redis');
const { verifyPassword, hashPassword, generateSessionToken, generateOtp, sanitize } = require('./_lib/auth-utils');
const { ensureUserRecord, getOtpDeliveryPreview, saveUserProfileSnapshot, toSafeProfile } = require('./_lib/user-profile');
const { sendOtpCode } = require('./_lib/email');

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

    const action = sanitize(body.action, 40).toLowerCase() || 'login';

    // Forgot-password step 1: request reset OTP
    if (action === 'forgot_password_request') {
      const email = sanitize(body.email, 120).toLowerCase();
      if (!email) return res.status(400).json({ ok: false, error: 'missing_email' });

      const userRaw = await redis('GET', 'user:' + email);
      // Avoid user enumeration
      if (!userRaw) return res.status(200).json({ ok: true, sent: true });

      const user = JSON.parse(userRaw);
      const ensured = await ensureUserRecord(redis, user);
      if (ensured.changed) await redis('SET', 'user:' + email, JSON.stringify(ensured.user));

      const cooldownKey = 'pwd_reset_lock:' + email;
      const cooldown = await redis('GET', cooldownKey);
      if (cooldown) {
        let retryAfter = 0;
        try { retryAfter = Math.max(0, parseInt(await redis('TTL', cooldownKey), 10) || 0); } catch {}
        return res.status(429).json({ ok: false, error: 'cooldown_active', retryAfter: retryAfter || 60 });
      }

      const otp = generateOtp();
      await redis('SET', 'otp_reset:' + email, JSON.stringify({ code: otp, exp: Date.now() + 10 * 60 * 1000 }));
      await redis('EXPIRE', 'otp_reset:' + email, 600);
      await redis('SET', cooldownKey, '1');
      await redis('EXPIRE', cooldownKey, 60);

      const delivery = await sendOtpCode({
        email,
        phone: ensured.user.phone,
        otp,
        name: ensured.user.name,
        preferredChannel: ensured.user.otpChannel || 'email'
      });

      return res.status(200).json({
        ok: true,
        sent: true,
        verificationMethod: delivery.method,
        deliveryTarget: delivery.target,
        cooldownSec: 60
      });
    }

    // Forgot-password step 2: confirm OTP and set new password
    if (action === 'forgot_password_confirm') {
      const email = sanitize(body.email, 120).toLowerCase();
      const otp = sanitize(body.otp, 10).replace(/\s/g, '');
      const newPassword = String(body.newPassword || '');
      const confirmPassword = String(body.confirmPassword || '');

      if (!email || !otp || !newPassword || !confirmPassword) {
        return res.status(400).json({ ok: false, error: 'missing_fields' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ ok: false, error: 'password_too_short' });
      }
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ ok: false, error: 'password_mismatch' });
      }

      const resetRaw = await redis('GET', 'otp_reset:' + email);
      if (!resetRaw) return res.status(400).json({ ok: false, error: 'otp_expired_or_invalid' });

      let resetData;
      try { resetData = JSON.parse(resetRaw); } catch {
        return res.status(400).json({ ok: false, error: 'otp_expired_or_invalid' });
      }

      if (Date.now() > resetData.exp) {
        await redis('DEL', 'otp_reset:' + email);
        return res.status(400).json({ ok: false, error: 'otp_expired' });
      }
      if (otp !== String(resetData.code)) {
        return res.status(400).json({ ok: false, error: 'otp_invalid' });
      }

      const userRaw = await redis('GET', 'user:' + email);
      if (!userRaw) return res.status(404).json({ ok: false, error: 'user_not_found' });
      const user = JSON.parse(userRaw);
      const ensured = await ensureUserRecord(redis, user);

      const next = await hashPassword(newPassword);
      ensured.user.passwordHash = next.hash;
      ensured.user.passwordSalt = next.salt;
      ensured.user.updatedAt = new Date().toISOString();

      await redis('SET', 'user:' + email, JSON.stringify(ensured.user));
      await saveUserProfileSnapshot(redis, ensured.user);
      await redis('DEL', 'otp_reset:' + email);

      return res.status(200).json({ ok: true, reset: true });
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
      // Send a fresh OTP so the user is never told "expired"
      const otp = generateOtp();
      await redis('SET', 'otp:' + email, JSON.stringify({ code: otp, exp: Date.now() + 10 * 60 * 1000, purpose: 'signup' }));
      await redis('EXPIRE', 'otp:' + email, 600);
      const delivery = await sendOtpCode({ email, phone: ensured.user.phone, otp, name: ensured.user.name, preferredChannel: ensured.user.otpChannel || 'email' });
      return res.status(403).json({ ok: false, error: 'account_not_verified', requiresVerification: true, email, verificationMethod: delivery.method, deliveryTarget: delivery.target });
    }

    const valid = await verifyPassword(password, ensured.user.passwordHash, ensured.user.passwordSalt);
    if (!valid) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

    // Always require OTP on every sign-in
    const otp = generateOtp();
    await redis('SET', 'otp:' + email, JSON.stringify({ code: otp, exp: Date.now() + 10 * 60 * 1000, purpose: 'login' }));
    await redis('EXPIRE', 'otp:' + email, 600);

    const delivery = await sendOtpCode({ email, phone: ensured.user.phone, otp, name: ensured.user.name, preferredChannel: ensured.user.otpChannel || 'email' });

    return res.status(200).json({
      ok: true,
      requiresOtp: true,
      email,
      verificationMethod: delivery.method,
      deliveryTarget: delivery.target
    });
  } catch (error) {
    const msg = String(error && error.message ? error.message : 'server_error');
    if (msg.includes('redis_not_configured')) {
      return res.status(503).json({ ok: false, error: 'storage_not_configured' });
    }
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
