'use strict';

const FROM = process.env.EMAIL_FROM || 'AL-MUDIR <noreply@al-mudir.org>';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function sendOtpEmail(to, otp, name) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('email_not_configured: RESEND_API_KEY is not set');

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
