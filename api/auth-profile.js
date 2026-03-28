'use strict';
const { redis, withDb } = require('./_lib/redis');
const { sanitize } = require('./_lib/auth-utils');

async function resolveSession(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return { error: 'invalid_token', status: 401 };
  const sessionRaw = await redis('GET', 'session:' + token);
  if (!sessionRaw) return { error: 'session_expired', status: 401 };
  const session = JSON.parse(sessionRaw);
  const userRaw = await redis('GET', 'user:' + session.email);
  if (!userRaw) return { error: 'user_not_found', status: 404 };
  return { token, user: JSON.parse(userRaw) };
}

module.exports = withDb(async function handler(req, res) {
  try {
    if (!['GET', 'PUT', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, PUT, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const ctx = await resolveSession(req);
    if (ctx.error) return res.status(ctx.status).json({ ok: false, error: ctx.error });

    const { token, user } = ctx;

    if (req.method === 'GET') {
      const { passwordHash: _h, passwordSalt: _s, ...safe } = user;
      return res.status(200).json({ ok: true, profile: safe });
    }

    // PUT / POST — update profile fields
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

    if (body.name !== undefined && body.name !== null) {
      const n = sanitize(body.name, 80);
      if (n) user.name = n;
    }
    if (body.phone !== undefined) {
      user.phone = body.phone ? sanitize(body.phone, 20) : null;
    }
    if (body.brokerName && body.brokerAccountId) {
      const bName = sanitize(body.brokerName, 80);
      const bId = sanitize(body.brokerAccountId, 60);
      if (bName && bId) {
        user.brokerSignup = true;
        user.brokerProfile = {
          name: bName,
          accountId: bId,
          submittedAt: (user.brokerProfile && user.brokerProfile.submittedAt) || new Date().toISOString()
        };
      }
    }
    if (body.kycState) {
      const allowed = ['unverified', 'pending', 'verified'];
      if (allowed.includes(body.kycState)) user.kycState = body.kycState;
    }
    if (body.kycData) {
      user.kycData = body.kycData;
    }
    if (typeof body.freeAccess === 'boolean') {
      user.freeAccess = body.freeAccess;
      if (body.freeAccess && !user.freeAccessGrantedAt) {
        user.freeAccessGrantedAt = new Date().toISOString();
      }
    }

    user.updatedAt = new Date().toISOString();
    await redis('SET', 'user:' + user.email, JSON.stringify(user));
    await redis('EXPIRE', 'session:' + token, 86400);

    const { passwordHash: _h, passwordSalt: _s, ...safe } = user;
    return res.status(200).json({ ok: true, profile: safe });
  } catch (error) {
    const msg = String(error && error.message ? error.message : 'server_error');
    if (msg.includes('redis_not_configured')) {
      return res.status(503).json({ ok: false, error: 'storage_not_configured' });
    }
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
