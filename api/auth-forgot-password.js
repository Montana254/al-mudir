'use strict';
const { redis, withDb } = require('./_lib/redis');
const { sanitize, generateOtp, hashPassword } = require('./_lib/auth-utils');
const { sendOtpCode } = require('./_lib/email');

const rateLimitMap = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQ = 8;

function resetKey(email) {
  return 'pwdreset:' + String(email || '').toLowerCase();
}

module.exports = withDb(async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + WINDOW_MS;
    }
    entry.count++;
    rateLimitMap.set(ip, entry);
    if (entry.count > MAX_REQ) {
      return res.status(429).json({ ok: false, error: 'rate_limited' });
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

    const action = String(body.action || '').toLowerCase();
    const email = sanitize(body.email, 120).toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: 'missing_email' });

    if (action === 'request') {
      const userRaw = await redis('GET', 'user:' + email);
      if (userRaw) {
        const user = typeof userRaw === 'string' ? JSON.parse(userRaw) : userRaw;
        const code = generateOtp();
        await redis('SET', resetKey(email), JSON.stringify({ code: code, exp: Date.now() + 10 * 60 * 1000 }));
        await redis('EXPIRE', resetKey(email), 600);
        try {
          await sendOtpCode({ email: email, phone: user.phone, otp: code, name: user.name, preferredChannel: user.otpChannel || 'email' });
        } catch (_) {
          // Keep generic response to avoid account enumeration.
        }
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'confirm') {
      const code = sanitize(body.code, 10).replace(/\D/g, '');
      const newPassword = String(body.newPassword || '');
      if (!code || !newPassword) return res.status(400).json({ ok: false, error: 'missing_fields' });
      if (newPassword.length < 8) return res.status(400).json({ ok: false, error: 'password_too_short' });

      const resetRaw = await redis('GET', resetKey(email));
      if (!resetRaw) return res.status(400).json({ ok: false, error: 'reset_code_expired' });
      const reset = typeof resetRaw === 'string' ? JSON.parse(resetRaw) : resetRaw;
      if (Date.now() > Number(reset.exp || 0)) {
        await redis('DEL', resetKey(email));
        return res.status(400).json({ ok: false, error: 'reset_code_expired' });
      }
      if (String(reset.code) !== code) {
        return res.status(400).json({ ok: false, error: 'reset_code_invalid' });
      }

      const userRaw = await redis('GET', 'user:' + email);
      if (!userRaw) return res.status(404).json({ ok: false, error: 'user_not_found' });
      const user = typeof userRaw === 'string' ? JSON.parse(userRaw) : userRaw;

      const hashed = await hashPassword(newPassword);
      user.passwordHash = hashed.hash;
      user.passwordSalt = hashed.salt;
      user.updatedAt = new Date().toISOString();
      await redis('SET', 'user:' + email, JSON.stringify(user));

      await redis('DEL', resetKey(email));
      await redis('DEL', 'otp:' + email);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'invalid_action' });
  } catch (error) {
    const msg = String(error && error.message ? error.message : 'server_error');
    if (msg.includes('redis_not_configured')) {
      return res.status(503).json({ ok: false, error: 'storage_not_configured' });
    }
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
