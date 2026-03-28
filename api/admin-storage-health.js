'use strict';
const crypto = require('crypto');
const { redis, withDb } = require('./_lib/redis');

const rateLimitMap = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQ = 30;

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getAdminSecret() {
  return String(process.env.ADMIN_HEALTH_TOKEN || process.env.TG_DB_SECRET || process.env.ACCESS_VERIFY_SECRET || process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

function getBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + WINDOW_MS;
  }
  entry.count += 1;
  rateLimitMap.set(ip, entry);
  return entry.count > MAX_REQ;
}

function isIpAllowed(ip) {
  const allowRaw = String(process.env.ADMIN_HEALTH_ALLOW_IPS || '').trim();
  if (!allowRaw) return true;
  const allowed = allowRaw.split(',').map((x) => x.trim()).filter(Boolean);
  return allowed.includes(ip);
}

module.exports = withDb(async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const ip = getIp(req);
    if (isRateLimited(ip)) {
      return res.status(429).json({ ok: false, error: 'rate_limited' });
    }
    if (!isIpAllowed(ip)) {
      return res.status(403).json({ ok: false, error: 'ip_not_allowed' });
    }

    const expected = getAdminSecret();
    const presented = getBearerToken(req);
    if (!expected || !presented || !safeEqual(expected, presented)) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const healthKey = 'health:lastCheck';
    const stamp = new Date().toISOString();
    await redis('SET', healthKey, stamp);
    const readBack = await redis('GET', healthKey);

    const dbText = {
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && (process.env.TELEGRAM_DB_CHAT_ID || process.env.TELEGRAM_CHAT_ID)),
      encryptedAtRest: Boolean(process.env.TG_DB_SECRET || process.env.ACCESS_VERIFY_SECRET || process.env.TELEGRAM_BOT_TOKEN),
      lastCheckWriteReadOk: readBack === stamp,
      chatIdConfigured: Boolean(process.env.TELEGRAM_DB_CHAT_ID || process.env.TELEGRAM_CHAT_ID),
      separateDbChatConfigured: Boolean(process.env.TELEGRAM_DB_CHAT_ID),
      usedAdminSecretSource: process.env.ADMIN_HEALTH_TOKEN ? 'ADMIN_HEALTH_TOKEN' : process.env.TG_DB_SECRET ? 'TG_DB_SECRET' : process.env.ACCESS_VERIFY_SECRET ? 'ACCESS_VERIFY_SECRET' : 'TELEGRAM_BOT_TOKEN'
    };

    return res.status(200).json({ ok: true, storage: dbText });
  } catch (error) {
    const msg = String(error && error.message ? error.message : 'server_error');
    if (msg.includes('redis_not_configured')) {
      return res.status(503).json({ ok: false, error: 'storage_not_configured' });
    }
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});