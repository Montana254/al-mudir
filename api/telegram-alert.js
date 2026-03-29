const rateLimitMap = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQ = 8;
const crypto = require('crypto');

function base64UrlDecode(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const withPad = normalized + (pad ? '='.repeat(4 - pad) : '');
  return Buffer.from(withPad, 'base64').toString('utf8');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifySignedToken(token, secret) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return { ok: false, error: 'token_format_invalid' };

    const payloadB64 = parts[0];
    const signature = parts[1];
    const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
    if (!safeEqual(signature, expected)) {
      return { ok: false, error: 'token_signature_invalid' };
    }

    const payloadText = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadText);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload?.exp || payload.exp < nowSec) {
      return { ok: false, error: 'token_expired' };
    }

    return { ok: true, payload: payload };
  } catch (_) {
    return { ok: false, error: 'token_decode_failed' };
  }
}

function sanitize(value, maxLen) {
  if (typeof value !== 'string') return 'N/A';
  return value.replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, maxLen) || 'N/A';
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

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (!value || value < 0) return 'N/A';
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / (1024 * 1024)).toFixed(2) + ' MB';
}

function renderLines(type, payload, ip) {
  if (type === 'user.created') {
    return [
      'AL-MUDIR EVENT: USER CREATED',
      '----------------------------',
      'Name: ' + sanitize(payload.name, 80),
      'Email: ' + sanitize(payload.email, 120),
      'Message: ' + sanitize(payload.message, 200),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  if (type === 'user.login') {
    return [
      'AL-MUDIR EVENT: USER LOGIN',
      '--------------------------',
      'Name: ' + sanitize(payload.name, 80),
      'Email: ' + sanitize(payload.email, 120),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  if (type === 'user.profile.updated') {
    return [
      'AL-MUDIR EVENT: PROFILE UPDATED',
      '-------------------------------',
      'Name: ' + sanitize(payload.name, 80),
      'Email: ' + sanitize(payload.email, 120),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  if (type === 'free.access.requested') {
    return [
      'AL-MUDIR EVENT: FREE ACCESS',
      '---------------------------',
      'Name: ' + sanitize(payload.name, 80),
      'Email: ' + sanitize(payload.email, 120),
      'Plan: ' + sanitize(payload.plan, 40),
      'User ID: ' + sanitize(payload.userId, 40),
      'Broker: ' + sanitize(payload.brokerName, 80),
      'Broker Account ID: ' + sanitize(payload.brokerAccountId, 80),
      'Broker Link: ' + sanitize(payload.brokerPartnershipLink, 200),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  if (type === 'crypto.payment.intent') {
    return [
      'AL-MUDIR EVENT: CRYPTO INTENT',
      '-----------------------------',
      'Name: ' + sanitize(payload.name, 80),
      'Email: ' + sanitize(payload.email, 120),
      'Amount: ' + sanitize(payload.amount, 40),
      'Currency: ' + sanitize(payload.currency, 16),
      'Hash: ' + sanitize(payload.transaction_hash, 200),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  if (type === 'kyc.submitted') {
    return [
      'AL-MUDIR EVENT: KYC SUBMITTED',
      '-----------------------------',
      'Name: ' + sanitize(payload.name, 80),
      'Email: ' + sanitize(payload.email, 120),
      'DOB: ' + sanitize(payload.dob, 20),
      'Country: ' + sanitize(payload.country, 60),
      'ID Type: ' + sanitize(payload.idType, 40),
      'Document No: ' + sanitize(payload.docNumber, 40),
      'File Name: ' + sanitize(payload.documentName, 120),
      'File Type: ' + sanitize(payload.documentType, 60),
      'File Size: ' + formatSize(payload.documentSize),
      'Auto Verify: ' + sanitize(payload.autoDecision, 40),
      'Reason: ' + sanitize(payload.autoReason, 200),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  if (type === 'wallet.linked') {
    return [
      'AL-MUDIR EVENT: WALLET LINKED',
      '-----------------------------',
      'Name: ' + sanitize(payload.name, 80),
      'Email: ' + sanitize(payload.email, 120),
      'Address: ' + sanitize(payload.address, 80),
      'Provider: ' + sanitize(payload.provider, 40),
      'Chain: ' + sanitize(payload.chain, 40),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  if (type === 'trade.executed') {
    return [
      'AL-MUDIR EVENT: TRADE EXECUTED',
      '------------------------------',
      'Email: ' + sanitize(payload.email, 120),
      'Mode: ' + sanitize(payload.mode, 10),
      'Coin: ' + sanitize(payload.coin, 10),
      'Amount: ' + sanitize(payload.amount, 30),
      'USD Value: ' + sanitize(payload.usd, 20),
      'Method: ' + sanitize(payload.method, 30),
      'TX ID: ' + sanitize(payload.txId, 80),
      'IP: ' + sanitize(ip, 80)
    ];
  }

  return null;
}

async function sendTelegramMessage(botToken, chatId, lines) {
  const response = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join('\n')
    })
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error('telegram_send_failed');
  }

  return data;
}

async function sendTelegramDocument(botToken, chatId, payload) {
  if (!payload.documentBase64 || !payload.documentName) {
    return null;
  }

  const base64 = String(payload.documentBase64).split(',').pop() || '';
  if (!base64) {
    return null;
  }

  const buffer = Buffer.from(base64, 'base64');
  const form = new FormData();
  const mimeType = sanitize(payload.documentType, 80) || 'application/octet-stream';
  const caption = [
    'AL-MUDIR KYC DOCUMENT',
    'Name: ' + sanitize(payload.name, 80),
    'Email: ' + sanitize(payload.email, 120),
    'Decision: ' + sanitize(payload.autoDecision, 40)
  ].join('\n');

  form.append('chat_id', String(chatId));
  form.append('caption', caption);
  form.append('document', new Blob([buffer], { type: mimeType }), sanitize(payload.documentName, 120));

  const response = await fetch('https://api.telegram.org/bot' + botToken + '/sendDocument', {
    method: 'POST',
    body: form
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error('telegram_document_send_failed');
  }

  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const tokenSecret = process.env.ACCESS_VERIFY_SECRET || process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !chatId) {
    return res.status(503).json({ ok: false, error: 'telegram_not_configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const type = sanitize(body.type || '', 60);
    const payload = body.payload || {};

    const allowed = new Set([
      'user.created',
      'user.login',
      'user.profile.updated',
      'free.access.requested',
      'crypto.payment.intent',
      'kyc.submitted',
      'wallet.linked',
      'trade.executed'
    ]);
    if (!allowed.has(type)) {
      return res.status(400).json({ ok: false, error: 'unsupported_event' });
    }

    if (type === 'free.access.requested') {
      if (!tokenSecret) {
        return res.status(503).json({ ok: false, error: 'token_secret_not_configured' });
      }

      const tokenResult = verifySignedToken(payload.verificationToken, tokenSecret);
      if (!tokenResult.ok) {
        return res.status(401).json({ ok: false, error: 'invalid_verification_token', detail: tokenResult.error });
      }

      const tokenPayload = tokenResult.payload || {};
      const email = sanitize(payload.email, 120);
      const userId = sanitize(payload.userId, 40);
      const brokerAccountId = sanitize(payload.brokerAccountId, 80);
      const brokerName = sanitize(payload.brokerName, 80);

      const claimsMatch = (
        safeEqual(tokenPayload.email, email) &&
        safeEqual(tokenPayload.userId, userId) &&
        safeEqual(tokenPayload.brokerAccountId, brokerAccountId) &&
        safeEqual(tokenPayload.brokerName, brokerName) &&
        tokenPayload.scope === 'free_access'
      );

      if (!claimsMatch) {
        return res.status(401).json({ ok: false, error: 'verification_claim_mismatch' });
      }
    }

    const lines = renderLines(type, payload, ip);
    if (!lines) {
      return res.status(400).json({ ok: false, error: 'invalid_payload' });
    }

    const messageData = await sendTelegramMessage(botToken, chatId, lines);
    let documentData = null;

    if (type === 'kyc.submitted' && payload.documentBase64 && payload.documentName) {
      documentData = await sendTelegramDocument(botToken, chatId, payload);
    }

    return res.status(200).json({
      ok: true,
      messageId: messageData.result?.message_id || null,
      documentMessageId: documentData?.result?.message_id || null
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'server_error', message: error.message });
  }
};