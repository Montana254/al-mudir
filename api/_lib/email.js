'use strict';

const nodemailer = require('nodemailer');

const FROM = process.env.EMAIL_FROM || 'AL-MUDIR <noreply@al-mudir.org>';
const SMTP_HOST = (process.env.SMTP_HOST || '').trim();
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = (process.env.SMTP_USER || '').trim();
const SMTP_PASS = (process.env.SMTP_PASS || '').trim();
const TWILIO_SID = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TWILIO_TOKEN = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const TWILIO_FROM = (process.env.TWILIO_FROM_NUMBER || '').trim();

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildOtpHtml(otp, name) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:32px;background:#04120f;font-family:Arial,sans-serif;">
<h2 style="color:#d4af37;margin:0 0 4px;font-size:22px;letter-spacing:3px;font-family:Georgia,serif;">AL-MUDIR</h2>
<p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:3px;margin:0 0 28px;">Private Wealth &amp; Fintech Ventures</p>
<p style="color:#e8e0d0;font-size:14px;margin:0 0 8px;">Hello ${esc(name)},</p>
<p style="color:#e8e0d0;font-size:14px;margin:0 0 20px;">Your one-time verification code for AL-MUDIR is:</p>
<div style="background:#0e1114;border:1px solid #242a31;border-radius:8px;padding:32px;text-align:center;margin:0 0 24px;">
  <span style="font-size:44px;font-weight:700;letter-spacing:18px;color:#d4af37;font-family:'Courier New',monospace;">${otp}</span>
</div>
<p style="color:#888;font-size:12px;margin:0 0 6px;">This code expires in <strong style="color:#e8e0d0;">10 minutes</strong>.</p>
<p style="color:#555;font-size:11px;margin:28px 0 0;border-top:1px solid #1a1a1a;padding-top:16px;">If you did not create an AL-MUDIR account, you can safely ignore this email.</p>
</body></html>`;
}

// Fallback: send OTP as a Telegram notification to the admin
// Admin must forward the code to the user (interim until Resend/SMTP is configured)
async function sendOtpViaTelegram(to, otp, name) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) throw new Error('email_not_configured: no email provider and Telegram fallback unavailable');

  const text = '\uD83D\uDD10 OTP Verification — FORWARD TO USER\n\n'
    + '\uD83D\uDC64 Name: ' + esc(name) + '\n'
    + '\uD83D\uDCE7 Email: ' + esc(to) + '\n'
    + '\uD83D\uDD22 OTP Code: <b>' + otp + '</b>\n\n'
    + '\u23F0 Expires in 10 minutes.\n'
    + '\n\u26A0\uFE0F No email provider configured. Set RESEND_API_KEY on Vercel to enable direct email delivery.\n'
    + 'Run: bash setup-email.sh <your-resend-key>';

  const r = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
  });
  if (!r.ok) throw new Error('telegram_otp_send_failed');
  return r.json();
}

// Path 1: Resend API (primary)
async function sendViaResend(to, otp, name) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM,
      to: [String(to)],
      subject: 'Your AL-MUDIR verification code: ' + otp,
      html: buildOtpHtml(otp, name)
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('resend_failed: ' + (err.message || err.name || res.status));
  }
  return true;
}

// Path 2: SMTP via nodemailer (any SMTP provider — Gmail, Brevo, Mailtrap, etc.)
async function sendViaSmtp(to, otp, name) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return false;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  await transporter.sendMail({
    from: FROM,
    to: String(to),
    subject: 'Your AL-MUDIR verification code: ' + otp,
    html: buildOtpHtml(otp, name),
    text: 'Your AL-MUDIR verification code is: ' + otp + '. This code expires in 10 minutes.'
  });
  return true;
}

// Master email sender: tries Resend → SMTP → Telegram fallback
async function sendOtpEmail(to, otp, name) {
  // Try Resend API first
  try { if (await sendViaResend(to, otp, name)) return { provider: 'resend' }; } catch (e) {
    console.error('[email] Resend failed:', e.message);
  }

  // Try SMTP second
  try { if (await sendViaSmtp(to, otp, name)) return { provider: 'smtp' }; } catch (e) {
    console.error('[email] SMTP failed:', e.message);
  }

  // Final fallback: Telegram (admin-facing)
  await sendOtpViaTelegram(to, otp, name);
  return { provider: 'telegram_fallback' };
}

async function sendOtpSms(to, otp, name) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    throw new Error('sms_not_configured');
  }

  const body = new URLSearchParams();
  body.set('To', String(to));
  body.set('From', TWILIO_FROM);
  body.set('Body', 'AL-MUDIR verification code for ' + String(name || 'client') + ': ' + otp + '. Expires in 10 minutes.');

  const auth = Buffer.from(TWILIO_SID + ':' + TWILIO_TOKEN).toString('base64');
  const res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + TWILIO_SID + '/Messages.json', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error('sms_failed: ' + (data.message || res.status));
  }

  return data;
}

function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at <= 1) return value;
  return value.slice(0, 2) + '***' + value.slice(at);
}

function maskPhone(phone) {
  const value = String(phone || '').trim();
  if (value.length < 5) return value;
  return value.slice(0, 3) + '***' + value.slice(-2);
}

async function sendOtpCode(params) {
  const email = String(params && params.email || '').trim();
  const phone = String(params && params.phone || '').trim();
  const otp = String(params && params.otp || '').trim();
  const name = String(params && params.name || 'Client').trim();
  const preferredChannel = String(params && params.preferredChannel || 'email').trim().toLowerCase();

  if (preferredChannel === 'phone' && phone) {
    try {
      await sendOtpSms(phone, otp, name);
      return { method: 'phone', target: maskPhone(phone) };
    } catch (error) {
      if (!email) throw error;
    }
  }

  await sendOtpEmail(email, otp, name);
  return { method: 'email', target: maskEmail(email) };
}

module.exports = { sendOtpEmail, sendOtpCode };
