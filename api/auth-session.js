'use strict';
const { redis, withDb } = require('./_lib/redis');

module.exports = withDb(async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (!token || !/^[0-9a-f]{64}$/.test(token)) {
      return res.status(401).json({ ok: false, error: 'invalid_token' });
    }

    const sessionRaw = await redis('GET', 'session:' + token);
    if (!sessionRaw) return res.status(401).json({ ok: false, error: 'session_expired' });

    const session = JSON.parse(sessionRaw);
    const userRaw = await redis('GET', 'user:' + session.email);
    if (!userRaw) return res.status(404).json({ ok: false, error: 'user_not_found' });

    const user = JSON.parse(userRaw);
    // Slide session TTL on each validated request
    await redis('EXPIRE', 'session:' + token, 86400);

    const { passwordHash: _h, passwordSalt: _s, ...safeProfile } = user;
    return res.status(200).json({ ok: true, profile: safeProfile });
  } catch (error) {
    const msg = String(error && error.message ? error.message : 'server_error');
    if (msg.includes('redis_not_configured')) {
      return res.status(503).json({ ok: false, error: 'storage_not_configured' });
    }
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
