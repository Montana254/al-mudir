'use strict';
const crypto = require('crypto');
const { redis, withDb } = require('./_lib/redis');
const { sanitize, generateOtp } = require('./_lib/auth-utils');
const { sendOtpCode } = require('./_lib/email');

const sendRateMap = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_SEND_REQ = 3;

function parseBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return req.body || {};
}

async function resolveSessionEmail(req) {
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!auth || auth.length < 32) return null;
  const sessionRaw = await redis('GET', 'session:' + auth);
  if (!sessionRaw) return null;
  const session = typeof sessionRaw === 'string' ? JSON.parse(sessionRaw) : sessionRaw;
  return String(session.email || '').toLowerCase();
}

module.exports = withDb(async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const email = await resolveSessionEmail(req);
    if (!email) return res.status(401).json({ ok: false, error: 'session_expired' });

    const body = parseBody(req);
    if (!body) return res.status(400).json({ ok: false, error: 'invalid_json' });
    const action = String(body.action || '').toLowerCase();

    const userRaw = await redis('GET', 'user:' + email);
    if (!userRaw) return res.status(404).json({ ok: false, error: 'user_not_found' });
    const user = typeof userRaw === 'string' ? JSON.parse(userRaw) : userRaw;

    if (action === 'send') {
      const now = Date.now();
      const entry = sendRateMap.get(email) || { count: 0, resetAt: now + WINDOW_MS };
      if (now > entry.resetAt) {
        entry.count = 0;
        entry.resetAt = now + WINDOW_MS;
      }
      entry.count++;
      sendRateMap.set(email, entry);
      if (entry.count > MAX_SEND_REQ) {
        return res.status(429).json({ ok: false, error: 'rate_limited' });
      }

      const code = generateOtp();
      await redis('SET', 'withdraw_otp:' + email, JSON.stringify({ code: code, exp: Date.now() + 5 * 60 * 1000 }));
      await redis('EXPIRE', 'withdraw_otp:' + email, 300);

      await sendOtpCode({
        email: email,
        phone: user.phone,
        otp: code,
        name: user.name,
        preferredChannel: user.otpChannel || 'email'
      });

      return res.status(200).json({ ok: true });
    }

    if (action === 'verify') {
      const code = sanitize(body.code, 10).replace(/\D/g, '');
      if (!code || code.length !== 6) return res.status(400).json({ ok: false, error: 'invalid_code' });

      const otpRaw = await redis('GET', 'withdraw_otp:' + email);
      if (!otpRaw) return res.status(400).json({ ok: false, error: 'otp_expired' });
      const otp = typeof otpRaw === 'string' ? JSON.parse(otpRaw) : otpRaw;
      if (Date.now() > Number(otp.exp || 0)) {
        await redis('DEL', 'withdraw_otp:' + email);
        return res.status(400).json({ ok: false, error: 'otp_expired' });
      }
      if (String(otp.code) !== code) return res.status(400).json({ ok: false, error: 'otp_invalid' });

      await redis('DEL', 'withdraw_otp:' + email);
      const token = crypto.randomBytes(24).toString('hex');
      await redis('SET', 'withdraw_2fa_token:' + email + ':' + token, JSON.stringify({ ok: true, at: Date.now() }));
      await redis('EXPIRE', 'withdraw_2fa_token:' + email + ':' + token, 300);
      return res.status(200).json({ ok: true, token: token });
    }

    return res.status(400).json({ ok: false, error: 'invalid_action' });
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
