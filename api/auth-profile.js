'use strict';
const { redis, withDb } = require('./_lib/redis');
const { sanitize, hashPassword, verifyPassword } = require('./_lib/auth-utils');
const { ensureUserRecord, saveUserProfileSnapshot, toSafeProfile } = require('./_lib/user-profile');

async function resolveSession(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return { error: 'invalid_token', status: 401 };
  const sessionRaw = await redis('GET', 'session:' + token);
  if (!sessionRaw) return { error: 'session_expired', status: 401 };
  const session = JSON.parse(sessionRaw);
  const userRaw = await redis('GET', 'user:' + session.email);
  if (!userRaw) return { error: 'user_not_found', status: 404 };
  return { token, session, user: JSON.parse(userRaw) };
}

module.exports = withDb(async function handler(req, res) {
  try {
    if (!['GET', 'PUT', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, PUT, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const ctx = await resolveSession(req);
    if (ctx.error) return res.status(ctx.status).json({ ok: false, error: ctx.error });

    const { token } = ctx;
    const ensured = await ensureUserRecord(redis, ctx.user);
    const user = ensured.user;
    if (ensured.changed) await redis('SET', 'user:' + user.email, JSON.stringify(user));

    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, profile: toSafeProfile(user) });
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

    // ── Password change action ──
    if (body.action === 'changePassword') {
      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ ok: false, error: 'missing_fields' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ ok: false, error: 'password_too_short' });
      }
      if (newPassword.length > 72) {
        return res.status(400).json({ ok: false, error: 'password_too_long' });
      }
      const valid = await verifyPassword(currentPassword, user.passwordHash, user.passwordSalt);
      if (!valid) {
        return res.status(403).json({ ok: false, error: 'incorrect_password' });
      }
      const { hash, salt } = await hashPassword(newPassword);
      user.passwordHash = hash;
      user.passwordSalt = salt;
      user.updatedAt = new Date().toISOString();
      await redis('SET', 'user:' + user.email, JSON.stringify(user));
      await saveUserProfileSnapshot(redis, user);
      await redis('EXPIRE', 'session:' + token, 86400);
      return res.status(200).json({ ok: true, message: 'password_changed' });
    }

    if (body.name !== undefined && body.name !== null) {
      const n = sanitize(body.name, 80);
      if (n) user.name = n;
    }
    if (body.phone !== undefined) {
      user.phone = body.phone ? sanitize(body.phone, 20) : null;
    }
    if (body.otpChannel !== undefined) {
      const nextChannel = String(body.otpChannel || '').toLowerCase();
      if (nextChannel === 'email' || (nextChannel === 'phone' && user.phone)) {
        user.otpChannel = nextChannel;
      }
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
      const allowed = ['unverified', 'pending', 'verified', 'rejected'];
      if (allowed.includes(body.kycState)) user.kycState = body.kycState;
    }
    if (body.kycData) {
      user.kycData = body.kycData;
    }
    if (body.profilePic !== undefined) {
      if (body.profilePic && typeof body.profilePic === 'string' && body.profilePic.startsWith('data:image/') && body.profilePic.length < 200000) {
        user.profilePic = body.profilePic;
      } else if (!body.profilePic) {
        user.profilePic = null;
      }
    }
    // Wallet linking — once linked, only the stored address can be unlinked
    if (body.linkedWallet !== undefined) {
      if (body.linkedWallet && typeof body.linkedWallet === 'object') {
        const addr = sanitize(String(body.linkedWallet.address || ''), 128);
        const provider = sanitize(String(body.linkedWallet.provider || ''), 30);
        const chain = sanitize(String(body.linkedWallet.chain || ''), 40);
        if (addr && /^(0x[0-9a-fA-F]{40}|[a-zA-Z0-9]{20,128})$/.test(addr)) {
          user.linkedWallet = {
            address: addr,
            provider: provider,
            chain: chain,
            linkedAt: new Date().toISOString()
          };
        }
      } else if (body.linkedWallet === null) {
        user.linkedWallet = null;
      }
    }
    if (typeof body.freeAccess === 'boolean') {
      user.freeAccess = body.freeAccess;
      if (body.freeAccess && !user.freeAccessGrantedAt) {
        user.freeAccessGrantedAt = new Date().toISOString();
      }
    }
    if (body.securityPrefs && typeof body.securityPrefs === 'object') {
      const sp = body.securityPrefs;
      user.securityPrefs = {
        twoFA: sp.twoFA === true,
        email: sp.email !== false,
        sms: sp.sms === true,
        telegram: sp.telegram === true
      };
    }

    user.updatedAt = new Date().toISOString();
    await redis('SET', 'user:' + user.email, JSON.stringify(user));
    await saveUserProfileSnapshot(redis, user);
    await redis('EXPIRE', 'session:' + token, 86400);

    return res.status(200).json({ ok: true, profile: toSafeProfile(user) });
  } catch (error) {
    const msg = String(error && error.message ? error.message : 'server_error');
    if (msg.includes('redis_not_configured')) {
      return res.status(503).json({ ok: false, error: 'storage_not_configured' });
    }
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
