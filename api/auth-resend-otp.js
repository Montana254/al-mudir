'use strict';
const { redis } = require('./_lib/redis');
const { sendOtpEmail } = require('./_lib/email');
const { generateOtp, sanitize } = require('./_lib/auth-utils');

const rateLimitMap = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQ = 3;

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
  if (entry.count > MAX_REQ) {
    return res.status(429).json({ ok: false, error: 'rate_limited', detail: 'Max 3 resends per 10 minutes.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const email = sanitize(body.email, 120).toLowerCase();
  if (!email) return res.status(400).json({ ok: false, error: 'missing_email' });

  const userRaw = await redis('GET', 'user:' + email);
  if (!userRaw) return res.status(404).json({ ok: false, error: 'user_not_found' });

  const user = JSON.parse(userRaw);
  if (user.verified) return res.status(400).json({ ok: false, error: 'already_verified' });

  const otp = generateOtp();
  await redis('SET', 'otp:' + email, JSON.stringify({ code: otp, exp: Date.now() + 10 * 60 * 1000 }));
  await redis('EXPIRE', 'otp:' + email, 600);
  await sendOtpEmail(email, otp, user.name);

  return res.status(200).json({ ok: true });
};
