'use strict';
const { redis, withDb } = require('./_lib/redis');
const { sendOtpCode } = require('./_lib/email');
const { generateOtp, sanitize } = require('./_lib/auth-utils');
const { ensureUserRecord } = require('./_lib/user-profile');

const rateLimitMap = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQ = 3;
const RESEND_COOLDOWN_SEC = 60;

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
    if (entry.count > MAX_REQ) {
      return res.status(429).json({ ok: false, error: 'rate_limited', detail: 'Max 3 resends per 10 minutes.' });
    }

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
    if (!email) return res.status(400).json({ ok: false, error: 'missing_email' });

    // Per-user resend cooldown to avoid OTP hammering
    const cooldownKey = 'otp_resend_lock:' + email;
    const lockVal = await redis('GET', cooldownKey);
    if (lockVal) {
      let retryAfter = 0;
      try { retryAfter = Math.max(0, parseInt(await redis('TTL', cooldownKey), 10) || 0); } catch {}
      return res.status(429).json({
        ok: false,
        error: 'cooldown_active',
        detail: 'Please wait before requesting another code.',
        retryAfter: retryAfter || RESEND_COOLDOWN_SEC
      });
    }

    const userRaw = await redis('GET', 'user:' + email);
    if (!userRaw) return res.status(404).json({ ok: false, error: 'user_not_found' });

    const ensured = await ensureUserRecord(redis, JSON.parse(userRaw));
    const user = ensured.user;
    if (ensured.changed) await redis('SET', 'user:' + email, JSON.stringify(user));

    // Allow OTP resend for both unverified (signup) and verified (login) users
    // Check if there's a pending OTP — if not and user is verified, they need to login first
    const existingOtp = await redis('GET', 'otp:' + email);
    if (!existingOtp && user.verified) {
      return res.status(400).json({ ok: false, error: 'no_pending_otp' });
    }

    // Determine purpose from existing OTP
    let purpose = 'signup';
    if (existingOtp) {
      try { purpose = JSON.parse(existingOtp).purpose || 'signup'; } catch {}
    }

    const otp = generateOtp();
    await redis('SET', 'otp:' + email, JSON.stringify({ code: otp, exp: Date.now() + 10 * 60 * 1000, purpose: purpose }));
    await redis('EXPIRE', 'otp:' + email, 600);
    const delivery = await sendOtpCode({ email, phone: user.phone, otp, name: user.name, preferredChannel: user.otpChannel || 'email' });
    await redis('SET', cooldownKey, '1');
    await redis('EXPIRE', cooldownKey, RESEND_COOLDOWN_SEC);
    user.verificationMethod = delivery.method;
    user.updatedAt = new Date().toISOString();
    await redis('SET', 'user:' + email, JSON.stringify(user));

    return res.status(200).json({
      ok: true,
      verificationMethod: delivery.method,
      deliveryTarget: delivery.target,
      cooldownSec: RESEND_COOLDOWN_SEC
    });
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
