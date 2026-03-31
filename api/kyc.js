'use strict';
const { redis, withDb } = require('./_lib/redis');
const { sanitize } = require('./_lib/auth-utils');
const { ensureUserRecord, saveUserProfileSnapshot, toSafeProfile } = require('./_lib/user-profile');
const { isAdminEmail } = require('./_lib/admin-access');

// ─── Session resolver ──────────────────────────────────
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

// ─── Document validation ───────────────────────────────
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE = 5 * 1024 * 1024;  // 5 MB each

function validateDocDataUrl(dataUrl, label) {
  if (!dataUrl || typeof dataUrl !== 'string') return label + ' is missing';
  if (!dataUrl.startsWith('data:')) return label + ' is not a valid data URL';
  const mimeMatch = dataUrl.match(/^data:([^;,]+)/);
  if (!mimeMatch || !ALLOWED_MIME.includes(mimeMatch[1])) return label + ' has unsupported file type';
  const base64Part = dataUrl.split(',')[1] || '';
  const sizeEstimate = Math.ceil(base64Part.length * 0.75);
  if (sizeEstimate > MAX_FILE_SIZE) return label + ' exceeds 5 MB limit';
  return null;
}

// ─── ID document types & which require back ────────────
const ID_TYPES = {
  passport:         { label: 'Passport',             requiresBack: false },
  national_id:      { label: 'National ID Card',     requiresBack: true },
  drivers_license:  { label: "Driver's License",     requiresBack: true },
  residence_permit: { label: 'Residence Permit',     requiresBack: true }
};

const RESIDENCE_DOC_TYPES = [
  'utility_bill',
  'bank_statement',
  'government_letter',
  'tax_document',
  'tenancy_agreement'
];

// ─── Telegram helpers ──────────────────────────────────
async function sendTelegramText(lines) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) return null;
  const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: lines.join('\n') })
  });
  return res.ok ? (await res.json()) : null;
}

async function sendTelegramDoc(buffer, fileName, mimeType, caption) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) return null;
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption.slice(0, 1024));
  form.append('document', new Blob([buffer], { type: mimeType }), fileName);
  const res = await fetch('https://api.telegram.org/bot' + token + '/sendDocument', {
    method: 'POST',
    body: form
  });
  return res.ok ? (await res.json()) : null;
}

async function sendAdminKycEmailAlert(payload) {
  const adminTo = (process.env.ADMIN_ALERT_EMAIL || process.env.COMPLIANCE_EMAIL || process.env.EMAIL_FROM || '').trim();
  if (!adminTo) return null;

  const to = adminTo.includes('<')
    ? adminTo.replace(/^.*<([^>]+)>.*$/, '$1').trim()
    : adminTo;
  if (!to || !to.includes('@')) return null;

  const subject = 'AL-MUDIR KYC Submission — ' + (payload.email || 'unknown');
  const text = [
    'New KYC submission received.',
    'Name: ' + (payload.fullName || 'N/A'),
    'Email: ' + (payload.email || 'N/A'),
    'User ID: ' + (payload.userId || 'N/A'),
    'ID Type: ' + (payload.idType || 'N/A'),
    'Document Number: ' + (payload.idDocNumber || 'N/A'),
    'Nationality: ' + (payload.nationality || 'N/A'),
    'Submitted: ' + (payload.submittedAt || ''),
    'IP: ' + (payload.ip || 'unknown')
  ].join('\n');

  // Try Resend first.
  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  if (resendKey) {
    try {
      const from = (process.env.EMAIL_FROM || 'AL-MUDIR <noreply@al-mudir.org>').trim();
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + resendKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          text
        })
      });
      if (res.ok) return { provider: 'resend' };
    } catch (_) { /* fall through */ }
  }

  // SMTP fallback.
  const smtpHost = (process.env.SMTP_HOST || '').trim();
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').trim();
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const nodemailer = require('nodemailer');
      const transport = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
        auth: { user: smtpUser, pass: smtpPass }
      });
      await transport.sendMail({
        from: process.env.EMAIL_FROM || 'AL-MUDIR <noreply@al-mudir.org>',
        to,
        subject,
        text
      });
      return { provider: 'smtp' };
    } catch (_) { /* ignore */ }
  }

  return null;
}

function dataUrlToBuffer(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  return Buffer.from(base64, 'base64');
}

function dataUrlMime(dataUrl) {
  const m = dataUrl.match(/^data:([^;,]+)/);
  return m ? m[1] : 'application/octet-stream';
}

// ─── Admin auth (simple secret-based) ──────────────────
function isAdmin(req) {
  const secret = (process.env.ADMIN_SECRET || process.env.ACCESS_VERIFY_SECRET || '').trim();
  if (!secret) return false;
  const provided = req.headers['x-admin-secret'] || '';
  if (!provided) return false;
  const crypto = require('crypto');
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch { return false; }
}

// ─── Handler ───────────────────────────────────────────
module.exports = withDb(async function handler(req, res) {
  try {
    // ── GET: Fetch KYC status ──────────────────────────
    if (req.method === 'GET') {
      const ctx = await resolveSession(req);
      if (ctx.error) return res.status(ctx.status).json({ ok: false, error: ctx.error });
      const user = ctx.user;
      return res.status(200).json({
        ok: true,
        kyc: {
          state: user.kycState || 'unverified',
          submittedAt: user.kycData?.submittedAt || null,
          reviewedAt: user.kycData?.reviewedAt || null,
          rejectionReason: user.kycData?.rejectionReason || null,
          documents: {
            identity: !!user.kycData?.idDocFrontName,
            identityBack: !!user.kycData?.idDocBackName,
            residence: !!user.kycData?.residenceDocName
          }
        }
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    // Parse body
    let body = {};
    if (typeof req.body === 'string') {
      try { body = JSON.parse(req.body); } catch {
        return res.status(400).json({ ok: false, error: 'invalid_json' });
      }
    } else {
      body = req.body || {};
    }

    const action = String(body.action || 'submit').toLowerCase();

    // ── POST action=review (admin) ─────────────────────
    if (action === 'review') {
      if (!isAdmin(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const targetEmail = sanitize(body.email, 120).toLowerCase();
      if (!targetEmail) return res.status(400).json({ ok: false, error: 'email_required' });
      const userRaw = await redis('GET', 'user:' + targetEmail);
      if (!userRaw) return res.status(404).json({ ok: false, error: 'user_not_found' });
      const user = JSON.parse(userRaw);
      const decision = String(body.decision || '').toLowerCase();
      if (!['verified', 'rejected'].includes(decision)) {
        return res.status(400).json({ ok: false, error: 'decision_must_be_verified_or_rejected' });
      }
      user.kycState = decision;
      if (!user.kycData) user.kycData = {};
      user.kycData.reviewedAt = new Date().toISOString();
      user.kycData.reviewedBy = 'admin';
      if (decision === 'rejected') {
        user.kycData.rejectionReason = sanitize(body.reason || 'Documents did not pass review', 500);
      } else {
        user.kycData.rejectionReason = null;
      }
      user.updatedAt = new Date().toISOString();
      await redis('SET', 'user:' + targetEmail, JSON.stringify(user));
      await saveUserProfileSnapshot(redis, user);

      // Notify via Telegram
      await sendTelegramText([
        'AL-MUDIR KYC REVIEW',
        '--------------------',
        'Email: ' + targetEmail,
        'Name: ' + (user.name || 'N/A'),
        'Decision: ' + decision.toUpperCase(),
        decision === 'rejected' ? 'Reason: ' + (user.kycData.rejectionReason || 'N/A') : '',
        'Reviewed At: ' + user.kycData.reviewedAt
      ].filter(Boolean));

      return res.status(200).json({ ok: true, state: decision });
    }

    // ── POST action=admin_queue (admin dashboard, session-based) ──
    if (action === 'admin_queue') {
      const adminCtx = await resolveSession(req);
      if (adminCtx.error) return res.status(adminCtx.status).json({ ok: false, error: adminCtx.error });
      if (!isAdminEmail(adminCtx.user.email)) return res.status(403).json({ ok: false, error: 'forbidden' });

      const regRaw = await redis('GET', 'system:registered_users');
      const regData = (regRaw && typeof regRaw === 'object') ? regRaw : { users: [] };
      const queue = [];

      for (const entry of (regData.users || [])) {
        const email = String(entry && entry.email || '').toLowerCase();
        if (!email) continue;

        const userRaw = await redis('GET', 'user:' + email);
        if (!userRaw) continue;
        const userObj = typeof userRaw === 'string' ? JSON.parse(userRaw) : userRaw;
        if (userObj.kycState !== 'pending') continue;

        const docsRaw = await redis('GET', 'kyc_docs:' + email);
        const docs = docsRaw ? (typeof docsRaw === 'string' ? JSON.parse(docsRaw) : docsRaw) : null;
        const kyc = userObj.kycData || {};
        const addr = kyc.address || {};

        queue.push({
          email: email,
          name: userObj.name || '',
          userId: userObj.userId || '',
          state: userObj.kycState || 'pending',
          submittedAt: kyc.submittedAt || null,
          idType: kyc.idType || null,
          idDocNumber: kyc.idDocNumber || null,
          nationality: kyc.nationality || null,
          dob: kyc.dob || null,
          address: {
            street: addr.street || '',
            city: addr.city || '',
            state: addr.state || '',
            postalCode: addr.postalCode || '',
            country: addr.country || ''
          },
          documents: {
            idFront: !!(docs && docs.idDocFront),
            idBack: !!(docs && docs.idDocBack),
            residence: !!(docs && docs.residenceDoc),
            idFrontName: kyc.idDocFrontName || null,
            idBackName: kyc.idDocBackName || null,
            residenceName: kyc.residenceDocName || null
          }
        });
      }

      queue.sort(function(a, b) {
        return new Date(a.submittedAt || 0).getTime() - new Date(b.submittedAt || 0).getTime();
      });

      return res.status(200).json({ ok: true, queue: queue, count: queue.length });
    }

    // ── POST action=admin_review (admin dashboard, session-based) ──
    if (action === 'admin_review') {
      const adminCtx = await resolveSession(req);
      if (adminCtx.error) return res.status(adminCtx.status).json({ ok: false, error: adminCtx.error });
      if (!isAdminEmail(adminCtx.user.email)) return res.status(403).json({ ok: false, error: 'forbidden' });

      const targetEmail = sanitize(body.email, 120).toLowerCase();
      const decision = String(body.decision || '').toLowerCase();
      const reason = sanitize(body.reason || '', 500);

      if (!targetEmail) return res.status(400).json({ ok: false, error: 'email_required' });
      if (!['verified', 'rejected'].includes(decision)) return res.status(400).json({ ok: false, error: 'invalid_decision' });
      if (decision === 'rejected' && !reason) return res.status(400).json({ ok: false, error: 'rejection_reason_required' });

      const targetRaw = await redis('GET', 'user:' + targetEmail);
      if (!targetRaw) return res.status(404).json({ ok: false, error: 'user_not_found' });
      const targetUser = typeof targetRaw === 'string' ? JSON.parse(targetRaw) : targetRaw;

      targetUser.kycState = decision;
      if (!targetUser.kycData) targetUser.kycData = {};
      targetUser.kycData.reviewedAt = new Date().toISOString();
      targetUser.kycData.reviewedBy = adminCtx.user.email;
      targetUser.kycData.rejectionReason = decision === 'rejected' ? reason : null;
      targetUser.updatedAt = new Date().toISOString();

      await redis('SET', 'user:' + targetEmail, JSON.stringify(targetUser));
      await saveUserProfileSnapshot(redis, targetUser);

      await sendTelegramText([
        'AL-MUDIR KYC REVIEW',
        '--------------------',
        'Email: ' + targetEmail,
        'Name: ' + (targetUser.name || 'N/A'),
        'Decision: ' + decision.toUpperCase(),
        decision === 'rejected' ? 'Reason: ' + reason : '',
        'Reviewed By: ' + adminCtx.user.email,
        'Reviewed At: ' + targetUser.kycData.reviewedAt
      ].filter(Boolean));

      return res.status(200).json({ ok: true, state: decision, reviewedAt: targetUser.kycData.reviewedAt });
    }

    // ── POST action=admin_verify_all (bulk verify every pending user) ──
    if (action === 'admin_verify_all') {
      const adminCtx = await resolveSession(req);
      if (adminCtx.error) return res.status(adminCtx.status).json({ ok: false, error: adminCtx.error });
      if (!isAdminEmail(adminCtx.user.email)) return res.status(403).json({ ok: false, error: 'forbidden' });

      const regRaw = await redis('GET', 'system:registered_users');
      const regData = (regRaw && typeof regRaw === 'object') ? regRaw : { users: [] };
      const now = new Date().toISOString();
      let verified = 0;

      for (const entry of (regData.users || [])) {
        const email = String(entry && entry.email || '').toLowerCase();
        if (!email) continue;
        const userRaw = await redis('GET', 'user:' + email);
        if (!userRaw) continue;
        const userObj = typeof userRaw === 'string' ? JSON.parse(userRaw) : userRaw;
        if (userObj.kycState !== 'pending') continue;

        userObj.kycState = 'verified';
        if (!userObj.kycData) userObj.kycData = {};
        userObj.kycData.reviewedAt = now;
        userObj.kycData.reviewedBy = adminCtx.user.email;
        userObj.kycData.rejectionReason = null;
        userObj.updatedAt = now;

        await redis('SET', 'user:' + email, JSON.stringify(userObj));
        await saveUserProfileSnapshot(redis, userObj);
        verified++;
      }

      await sendTelegramText([
        'AL-MUDIR BULK KYC VERIFICATION',
        '-------------------------------',
        'Verified: ' + verified + ' users',
        'Admin: ' + adminCtx.user.email,
        'Time: ' + now
      ]);

      return res.status(200).json({ ok: true, verified: verified });
    }

    // ── POST action=submit (user KYC submission) ───────
    const ctx = await resolveSession(req);
    if (ctx.error) return res.status(ctx.status).json({ ok: false, error: ctx.error });

    const ensured = await ensureUserRecord(redis, ctx.user);
    const user = ensured.user;
    if (ensured.changed) await redis('SET', 'user:' + user.email, JSON.stringify(user));

    // Block resubmission if already verified
    if (user.kycState === 'verified') {
      return res.status(400).json({ ok: false, error: 'already_verified' });
    }

    // ── Validate personal info ─────────────────────────
    const fullName = sanitize(body.fullName, 120);
    const dob = sanitize(body.dob, 10);
    const nationality = sanitize(body.nationality, 60);
    const addressStreet = sanitize(body.addressStreet, 200);
    const addressCity = sanitize(body.addressCity, 80);
    const addressState = sanitize(body.addressState, 80);
    const addressPostal = sanitize(body.addressPostal, 20);
    const addressCountry = sanitize(body.addressCountry, 60);

    if (!fullName || fullName === 'N/A') return res.status(400).json({ ok: false, error: 'full_name_required' });
    if (!dob || dob === 'N/A') return res.status(400).json({ ok: false, error: 'dob_required' });
    if (!nationality || nationality === 'N/A') return res.status(400).json({ ok: false, error: 'nationality_required' });
    if (!addressStreet || addressStreet === 'N/A') return res.status(400).json({ ok: false, error: 'address_required' });
    if (!addressCity || addressCity === 'N/A') return res.status(400).json({ ok: false, error: 'city_required' });
    if (!addressCountry || addressCountry === 'N/A') return res.status(400).json({ ok: false, error: 'country_required' });

    // Age check
    const ageMs = Date.now() - new Date(dob).getTime();
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
    if (!(ageYears >= 18)) return res.status(400).json({ ok: false, error: 'must_be_18_or_older' });

    // ── Validate ID document ───────────────────────────
    const idType = String(body.idType || '').toLowerCase();
    if (!ID_TYPES[idType]) return res.status(400).json({ ok: false, error: 'invalid_id_type' });
    const idMeta = ID_TYPES[idType];

    const idDocNumber = sanitize(body.idDocNumber, 40);
    if (!idDocNumber || idDocNumber === 'N/A' || !/^[A-Za-z0-9\-]{4,40}$/.test(idDocNumber)) {
      return res.status(400).json({ ok: false, error: 'invalid_document_number' });
    }

    // Front side (always required)
    const frontErr = validateDocDataUrl(body.idDocFront, 'ID front');
    if (frontErr) return res.status(400).json({ ok: false, error: frontErr });

    // Back side (required for national_id, drivers_license, residence_permit)
    if (idMeta.requiresBack) {
      const backErr = validateDocDataUrl(body.idDocBack, 'ID back');
      if (backErr) return res.status(400).json({ ok: false, error: backErr });
    }

    // ── Validate proof of residence ────────────────────
    const residenceDocType = String(body.residenceDocType || '').toLowerCase();
    if (!RESIDENCE_DOC_TYPES.includes(residenceDocType)) {
      return res.status(400).json({ ok: false, error: 'invalid_residence_doc_type' });
    }
    const residenceErr = validateDocDataUrl(body.residenceDoc, 'Proof of residence');
    if (residenceErr) return res.status(400).json({ ok: false, error: residenceErr });

    // ── Build KYC record ───────────────────────────────
    const submittedAt = new Date().toISOString();
    const kycData = {
      fullName,
      dob,
      nationality,
      address: {
        street: addressStreet,
        city: addressCity,
        state: addressState !== 'N/A' ? addressState : '',
        postalCode: addressPostal !== 'N/A' ? addressPostal : '',
        country: addressCountry
      },
      idType,
      idDocNumber,
      idDocFrontName: sanitize(body.idDocFrontName, 120),
      idDocFrontType: dataUrlMime(body.idDocFront),
      idDocBackName: idMeta.requiresBack ? sanitize(body.idDocBackName, 120) : null,
      idDocBackType: idMeta.requiresBack ? dataUrlMime(body.idDocBack) : null,
      residenceDocType,
      residenceDocName: sanitize(body.residenceDocName, 120),
      residenceDocMimeType: dataUrlMime(body.residenceDoc),
      submittedAt,
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null
    };

    // Store documents separately (keyed by email) to avoid bloating user record
    const docKey = 'kyc_docs:' + user.email.toLowerCase();
    const docPayload = {
      idDocFront: body.idDocFront,
      idDocBack: idMeta.requiresBack ? body.idDocBack : null,
      residenceDoc: body.residenceDoc,
      storedAt: submittedAt
    };
    await redis('SET', docKey, JSON.stringify(docPayload));

    // Update user record
    user.kycState = 'pending';
    user.kycData = kycData;
    user.updatedAt = submittedAt;
    await redis('SET', 'user:' + user.email, JSON.stringify(user));
    await saveUserProfileSnapshot(redis, user);

    // ── Notify admin via Telegram + email ──────────────
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const safeIp = sanitize(ip, 80);
    await sendTelegramText([
      '🔐 AL-MUDIR KYC SUBMISSION',
      '===========================',
      'Name: ' + fullName,
      'Email: ' + user.email,
      'User ID: ' + (user.userId || 'N/A'),
      'DOB: ' + dob,
      'Nationality: ' + nationality,
      '',
      '📍 Address:',
      addressStreet,
      addressCity + (addressState !== 'N/A' ? ', ' + addressState : '') + (addressPostal !== 'N/A' ? ' ' + addressPostal : ''),
      addressCountry,
      '',
      '🪪 Identity Document:',
      'Type: ' + idMeta.label,
      'Number: ' + idDocNumber,
      'Front: ' + (kycData.idDocFrontName || 'uploaded'),
      'Back: ' + (idMeta.requiresBack ? (kycData.idDocBackName || 'uploaded') : 'N/A (not required)'),
      '',
      '🏠 Proof of Residence:',
      'Type: ' + residenceDocType.replace(/_/g, ' '),
      'File: ' + (kycData.residenceDocName || 'uploaded'),
      '',
      'IP: ' + safeIp,
      'Submitted: ' + submittedAt,
      '',
      '⏳ Status: PENDING REVIEW',
      'Documents attached below ↓'
    ]);

    // Best-effort compliance email alert for faster admin response.
    await sendAdminKycEmailAlert({
      fullName,
      email: user.email,
      userId: user.userId || 'N/A',
      idType: idMeta.label,
      idDocNumber,
      nationality,
      submittedAt,
      ip: safeIp
    });

    // Send documents to Telegram
    const idLabel = user.email + ' — ' + idMeta.label;
    try {
      await sendTelegramDoc(
        dataUrlToBuffer(body.idDocFront),
        kycData.idDocFrontName || 'id_front.jpg',
        kycData.idDocFrontType,
        '🪪 ID FRONT — ' + idLabel
      );
    } catch (_) {}

    if (idMeta.requiresBack && body.idDocBack) {
      try {
        await sendTelegramDoc(
          dataUrlToBuffer(body.idDocBack),
          kycData.idDocBackName || 'id_back.jpg',
          kycData.idDocBackType,
          '🪪 ID BACK — ' + idLabel
        );
      } catch (_) {}
    }

    try {
      await sendTelegramDoc(
        dataUrlToBuffer(body.residenceDoc),
        kycData.residenceDocName || 'residence_proof.pdf',
        kycData.residenceDocMimeType,
        '🏠 PROOF OF RESIDENCE — ' + user.email
      );
    } catch (_) {}

    return res.status(200).json({
      ok: true,
      state: 'pending',
      profile: toSafeProfile(user)
    });
  } catch (error) {
    const msg = String(error?.message || 'server_error');
    if (msg.includes('redis_not_configured')) {
      return res.status(503).json({ ok: false, error: 'storage_not_configured' });
    }
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
