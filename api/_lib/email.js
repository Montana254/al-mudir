'use strict';

const FROM = process.env.EMAIL_FROM || 'AL-MUDIR <noreply@al-mudir.org>';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Fallback: send OTP as a Telegram notification to the admin
async function sendOtpViaTelegram(to, otp, name) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) throw new Error('email_not_configured: no RESEND_API_KEY and Telegram fallback unavailable');

  const text = '\uD83D\uDD10 OTP Verification Request\n\n'
    + 'Name: ' + esc(name) + '\n'
    + 'Email: ' + esc(to) + '\n'
    + 'OTP Code: ' + otp + '\n\n'
    + 'This code expires in 10 minutes.\n'
    + 'Share this code with the user to complete their account verification.';

  const r = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text })
  });
  if (!r.ok) throw new Error('telegram_otp_send_failed');
  return r.json();
}

async function sendOtpEmail(to, otp, name) {
  const key = process.env.RESEND_API_KEY;

  // If no email API key, fall back to Telegram notification
  if (!key) return sendOtpViaTelegram(to, otp, name);

  const html = `<!DOCTYPE html>
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
      html
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('email_failed: ' + (err.message || err.name || res.status));
  }
  return res.json();
}

module.exports = { sendOtpEmail };
