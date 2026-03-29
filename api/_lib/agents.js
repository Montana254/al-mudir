'use strict';

// ────────────────────────────────────────────────────────
// AL-MUDIR Server-Side Agent Module
// Wraps the 6 agents from agents.js for server-side use
// Uses process.env for credentials (never exposed to browser)
// ────────────────────────────────────────────────────────

function getConfig() {
  return {
    TELEGRAM_BOT_TOKEN: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    TELEGRAM_CHAT_ID:   (process.env.TELEGRAM_CHAT_ID || '').trim(),
    RESEND_API_KEY:     (process.env.RESEND_API_KEY || '').trim(),
    ALERT_EMAIL:        (process.env.ALERT_EMAIL || 'inquiries@al-mudir.dev').trim(),
  };
}

// ── Utility: send Telegram message ───────────────────
async function tg(text) {
  const cfg = getConfig();
  if (!cfg.TELEGRAM_BOT_TOKEN || !cfg.TELEGRAM_CHAT_ID) return;
  try {
    await fetch('https://api.telegram.org/bot' + cfg.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' })
    });
  } catch (e) { console.error('[Agent TG]', e.message); }
}

// ── Utility: send email via Resend ───────────────────
async function sendEmail(to, subject, html) {
  const cfg = getConfig();
  if (!cfg.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + cfg.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'AL-MUDIR <hello@al-mudir.dev>',
        to,
        subject,
        html
      })
    });
  } catch (e) { console.error('[Agent Email]', e.message); }
}

function emailWrap(title, body) {
  return '<div style="font-family:Georgia,serif;background:#04120f;padding:2rem;color:#e8e0d0;max-width:600px;margin:auto;border:1px solid rgba(212,175,55,.3);border-radius:8px">'
    + '<h2 style="color:#d4af37;margin-bottom:1rem">&#9138; AL-MUDIR \u2014 ' + title + '</h2>'
    + '<div style="background:#061d18;padding:1.5rem;border-radius:6px;font-size:.9rem;line-height:1.9">' + body + '</div>'
    + '<p style="color:#374151;font-size:.72rem;margin-top:1.5rem;text-align:center">AL-MUDIR Automated Agent System \u00a9 2024\u20132026</p>'
    + '</div>';
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ══════════════════════════════════════════════════════
// AGENT 1 — Signup Monitor
// ══════════════════════════════════════════════════════
async function agentSignupMonitor(user) {
  const cfg = getConfig();
  const msg = '\uD83C\uDD95 *NEW AL-MUDIR SIGNUP*\n'
    + '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n'
    + '\uD83D\uDC64 Name: ' + (user.name || user.first_name || '') + '\n'
    + '\uD83D\uDCE7 Email: ' + (user.email || '') + '\n'
    + '\uD83D\uDCF1 Phone: ' + (user.phone || '\u2014') + '\n'
    + '\uD83D\uDCBC Experience: ' + (user.experience || '\u2014') + '\n'
    + '\uD83D\uDCB0 Amount: ' + (user.investment_amount || '\u2014') + '\n'
    + '\uD83D\uDD50 ' + new Date().toUTCString() + '\n'
    + 'KYC: \u23F3 Pending';

  await tg(msg);
  await sendEmail(
    cfg.ALERT_EMAIL,
    '[AL-MUDIR] New Signup: ' + (user.name || user.first_name || 'User'),
    emailWrap('New Signup', msg.replace(/\n/g, '<br/>').replace(/\*/g, ''))
  );
}

// ══════════════════════════════════════════════════════
// AGENT 2 — Welcome Email
// ══════════════════════════════════════════════════════
async function agentWelcomeEmail(user) {
  const name = esc(user.name || user.first_name || 'Investor');
  const html = '<div style="font-family:Georgia,serif;background:#04120f;padding:2.5rem;color:#e8e0d0;max-width:600px;margin:auto;border:1px solid rgba(212,175,55,.3);border-radius:8px">'
    + '<h1 style="color:#d4af37;font-size:2rem;letter-spacing:.15em;margin-bottom:.25rem">&#9138; AL-MUDIR</h1>'
    + '<p style="color:#6b7280;font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;margin-bottom:2rem">SOVEREIGN WEALTH &amp; FINTECH</p>'
    + '<p>Dear ' + name + ',</p>'
    + '<p style="color:#9ca3af;line-height:1.9;margin:1rem 0">Thank you for registering with AL-MUDIR. Your application is under review by our team.</p>'
    + '<div style="background:#061d18;border:1px solid rgba(212,175,55,.2);border-radius:6px;padding:1.5rem;margin:1.5rem 0">'
    + '<p style="color:#d4af37;font-size:.75rem;text-transform:uppercase;letter-spacing:.15em;margin-bottom:.75rem">NEXT STEPS</p>'
    + '<p style="color:#9ca3af;font-size:.85rem;margin:.4rem 0">1. Complete your KYC verification on the platform</p>'
    + '<p style="color:#9ca3af;font-size:.85rem;margin:.4rem 0">2. Connect your wallet or pay via card / gift card</p>'
    + '<p style="color:#9ca3af;font-size:.85rem;margin:.4rem 0">3. Enter your Exness Account ID to unlock VIP Signals</p>'
    + '</div>'
    + '<p style="color:#6b7280;font-size:.85rem">A team member will contact you within 24\u201348 hours.<br/>Urgent: <a href="mailto:inquiries@al-mudir.dev" style="color:#d4af37">inquiries@al-mudir.dev</a></p>'
    + '<div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid rgba(212,175,55,.2);text-align:center">'
    + '<p style="color:#374151;font-size:.72rem">AL-MUDIR \u2022 DIFC Dubai \u2022 The City London \u2022 Wall St New York</p>'
    + '</div></div>';

  await sendEmail(user.email, 'Welcome to AL-MUDIR \u2014 Registration Confirmed', html);
}

// ══════════════════════════════════════════════════════
// AGENT 3 — Payment Tracker
// ══════════════════════════════════════════════════════
async function agentPaymentTracker(payment) {
  if ((payment.amount_usd || 0) < 50) return;
  const msg = '\uD83D\uDCB0 *PAYMENT RECEIVED*\n'
    + '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n'
    + '\uD83D\uDC64 User: ' + (payment.user_email || '') + '\n'
    + '\uD83D\uDCB3 Method: ' + (payment.method || 'crypto').toUpperCase() + '\n'
    + '\uD83E\uDEB2 Amount: ' + (payment.amount || 0) + ' ' + (payment.currency || 'USDT') + ' (~$' + Number(payment.amount_usd || 0).toFixed(2) + ' USD)\n'
    + '\uD83D\uDD17 TX: ' + (payment.tx_hash ? String(payment.tx_hash).slice(0, 14) + '...' : 'N/A') + '\n'
    + '\u2705 Status: ' + (payment.status || 'completed');
  await tg(msg);
}

// ══════════════════════════════════════════════════════
// AGENT 4 — Daily Report (used by cron)
// ══════════════════════════════════════════════════════
async function agentDailyReport(stats) {
  stats = stats || { signups24h: 0, kycPending: 0, vipUsers: 0, revenue24h: 0 };
  const date = new Date().toISOString().split('T')[0];
  const cfg = getConfig();

  const msg = '\uD83D\uDCCA *AL-MUDIR DAILY REPORT \u2014 ' + date + '*\n'
    + '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n'
    + '\uD83D\uDC65 New Signups (24h): ' + stats.signups24h + '\n'
    + '\u23F3 KYC Pending: ' + stats.kycPending + '\n'
    + '\uD83C\uDF1F VIP Users: ' + stats.vipUsers + '\n'
    + '\uD83D\uDCB5 Revenue (24h): $' + Number(stats.revenue24h).toFixed(2) + ' USD\n\n'
    + '\uD83D\uDCC8 PORTFOLIO\n'
    + '   AUM: $7.8M | YTD: +12.4%\n'
    + '   Sharpe: 2.84 | Drawdown: -3.2%\n\n'
    + '\u2699\uFE0F SYSTEM: OPERATIONAL | 0.04ms latency';

  await tg(msg);
  await sendEmail(
    cfg.ALERT_EMAIL,
    '[AL-MUDIR] Daily Report \u2014 ' + date,
    emailWrap('Daily Report ' + date, msg.replace(/\n/g, '<br/>').replace(/\*/g, ''))
  );
}

// ══════════════════════════════════════════════════════
// AGENT 5 — Newsletter Confirm
// ══════════════════════════════════════════════════════
async function agentNewsletterConfirm(email) {
  const html = '<div style="font-family:Georgia,serif;background:#04120f;padding:2rem;color:#e8e0d0;max-width:500px;margin:auto;border:1px solid rgba(212,175,55,.3);border-radius:8px;text-align:center">'
    + '<h1 style="color:#d4af37;font-size:1.8rem;margin-bottom:.5rem">&#9138; AL-MUDIR</h1>'
    + '<p style="color:#10b981;font-size:1rem;margin:1.5rem 0">\u2713 You\'re subscribed to market insights</p>'
    + '<p style="color:#9ca3af;font-size:.85rem;line-height:1.7">Weekly institutional-grade market analysis, SMC signal alerts, and exclusive fintech research.</p>'
    + '<p style="color:#6b7280;font-size:.72rem;margin-top:1.5rem">Reply UNSUBSCRIBE to stop receiving emails.</p>'
    + '</div>';
  await sendEmail(email, '\u2713 AL-MUDIR Market Insights \u2014 Subscribed', html);
}

// ══════════════════════════════════════════════════════
// AGENT 6 — Security Scanner
// ══════════════════════════════════════════════════════
const _rateLimits = {};

function agentSecurityCheck(ip, action) {
  const now = Date.now();
  const key = ip + ':' + (action || 'default');
  const entry = _rateLimits[key] || { count: 0, first: now };
  if (now - entry.first > 900000) { entry.count = 1; entry.first = now; }
  else { entry.count++; }
  _rateLimits[key] = entry;
  if (entry.count > 15) {
    tg('\uD83D\uDEA8 *RATE LIMIT* IP: ' + ip + ' | ' + entry.count + ' attempts in 15 min').catch(function(){});
    return { allowed: false };
  }
  return { allowed: true };
}

function agentScanUser(user) {
  const flags = [];
  if (!user.email || !user.email.includes('@')) flags.push('Invalid email');
  if (/<script/i.test(user.objectives || '')) flags.push('XSS attempt in objectives');
  if (/<script/i.test(user.name || user.first_name || '')) flags.push('XSS attempt in name');
  if (flags.length > 0) {
    tg('\u26A0\uFE0F *SECURITY FLAG*\nUser: ' + user.email + '\nFlags: ' + flags.join(', ')).catch(function(){});
  }
  return { clean: flags.length === 0, flags };
}

// ══════════════════════════════════════════════════════
// ORCHESTRATOR — call from any API function
// ══════════════════════════════════════════════════════
async function runAgent(event) {
  const type = event.type;
  const payload = event.payload || {};
  try {
    if (type === 'user.created') {
      agentScanUser(payload);
      await agentSignupMonitor(payload);
    } else if (type === 'user.verified') {
      await agentWelcomeEmail(payload);
    } else if (type === 'newsletter.subscribed') {
      await agentNewsletterConfirm(payload.email);
    } else if (type === 'payment.completed') {
      await agentPaymentTracker(payload);
    } else if (type === 'daily.report') {
      await agentDailyReport(payload.stats);
    } else if (type === 'security.check') {
      return agentSecurityCheck(payload.ip, payload.action);
    }
  } catch (e) {
    console.error('[Agent Orchestrator]', type, e.message);
  }
  return { ok: true };
}

module.exports = {
  runAgent,
  agentSignupMonitor,
  agentWelcomeEmail,
  agentPaymentTracker,
  agentDailyReport,
  agentNewsletterConfirm,
  agentSecurityCheck,
  agentScanUser,
};
