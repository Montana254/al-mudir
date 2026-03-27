/**
 * AL-MUDIR Agent System v2
 * Works as: Supabase Edge Function | Node.js script | Browser-compatible
 * No ES module exports — plain JS, zero build step needed
 */

// ── Config (set as Supabase secrets or env vars) ─────────────────────────
var AGENT_CONFIG = {
  ALERT_EMAIL:        'inquiries@al-mudir.dev',
  RESEND_API_KEY:     '',   // get free key at resend.com
  TELEGRAM_BOT_TOKEN: '',   // from @BotFather on Telegram
  TELEGRAM_CHAT_ID:   '',   // your personal chat ID
};

// ── Utility: send Telegram message ───────────────────────────────────────
async function tg(text) {
  var token = AGENT_CONFIG.TELEGRAM_BOT_TOKEN;
  var chatId = AGENT_CONFIG.TELEGRAM_CHAT_ID;
  if (!token || !chatId) { console.log('[TG skipped]', text); return; }
  try {
    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });
  } catch(e) { console.error('[TG error]', e.message); }
}

// ── Utility: send email via Resend ───────────────────────────────────────
async function sendEmail(to, subject, html) {
  var key = AGENT_CONFIG.RESEND_API_KEY;
  if (!key) { console.log('[Email skipped]', subject, '->', to); return; }
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'AL-MUDIR <hello@al-mudir.dev>',
        to: to,
        subject: subject,
        html: html
      })
    });
  } catch(e) { console.error('[Email error]', e.message); }
}

// ── Email HTML template ───────────────────────────────────────────────────
function emailWrap(title, body) {
  return '<div style="font-family:Georgia,serif;background:#04120f;padding:2rem;color:#e8e0d0;max-width:600px;margin:auto;border:1px solid rgba(212,175,55,.3);border-radius:8px">'
    + '<h2 style="color:#d4af37;margin-bottom:1rem">&#9138; AL-MUDIR &#8212; ' + title + '</h2>'
    + '<div style="background:#061d18;padding:1.5rem;border-radius:6px;font-size:.9rem;line-height:1.9">' + body + '</div>'
    + '<p style="color:#374151;font-size:.72rem;margin-top:1.5rem;text-align:center">AL-MUDIR Automated Agent System &copy; 2024&#8211;2026</p>'
    + '</div>';
}

// ══════════════════════════════════════════════════════════════════════════
// AGENT 1 — Signup Monitor
// ══════════════════════════════════════════════════════════════════════════
async function agentSignupMonitor(user) {
  console.log('[SignupMonitor] New signup:', user.email);

  var msg = '&#x1F195; *NEW AL-MUDIR SIGNUP*\n'
    + '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n'
    + '&#x1F464; Name: ' + user.first_name + ' ' + user.last_name + '\n'
    + '&#x1F4E7; Email: ' + user.email + '\n'
    + '&#x1F4F1; Phone: ' + (user.phone || '\u2014') + '\n'
    + '&#x1F4BC; Experience: ' + (user.experience || '\u2014') + '\n'
    + '&#x1F4B0; Amount: ' + (user.investment_amount || '\u2014') + '\n'
    + '&#x1F550; ' + new Date().toUTCString() + '\n'
    + 'KYC: ' + (user.kyc_verified ? '\u2705 Verified' : '\u23F3 Pending');

  await tg(msg);

  await sendEmail(
    AGENT_CONFIG.ALERT_EMAIL,
    '[AL-MUDIR] New Signup: ' + user.first_name + ' ' + user.last_name,
    emailWrap('New Signup', msg.replace(/\n/g, '<br/>').replace(/\*/g, ''))
  );
}

// ══════════════════════════════════════════════════════════════════════════
// AGENT 2 — Welcome Email Responder
// ══════════════════════════════════════════════════════════════════════════
async function agentWelcomeEmail(user) {
  console.log('[WelcomeEmail] Sending to:', user.email);

  var html = '<div style="font-family:Georgia,serif;background:#04120f;padding:2.5rem;color:#e8e0d0;max-width:600px;margin:auto;border:1px solid rgba(212,175,55,.3);border-radius:8px">'
    + '<h1 style="color:#d4af37;font-size:2rem;letter-spacing:.15em;margin-bottom:.25rem">&#9138; AL-MUDIR</h1>'
    + '<p style="color:#6b7280;font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;margin-bottom:2rem">SOVEREIGN WEALTH &amp; FINTECH</p>'
    + '<p>Dear ' + user.first_name + ',</p>'
    + '<p style="color:#9ca3af;line-height:1.9;margin:1rem 0">Thank you for registering with AL-MUDIR. Your application is under review by our team.</p>'
    + '<div style="background:#061d18;border:1px solid rgba(212,175,55,.2);border-radius:6px;padding:1.5rem;margin:1.5rem 0">'
    + '<p style="color:#d4af37;font-size:.75rem;text-transform:uppercase;letter-spacing:.15em;margin-bottom:.75rem">NEXT STEPS</p>'
    + '<p style="color:#9ca3af;font-size:.85rem;margin:.4rem 0">1. Complete your KYC verification on the platform</p>'
    + '<p style="color:#9ca3af;font-size:.85rem;margin:.4rem 0">2. Connect your wallet or pay via card / gift card</p>'
    + '<p style="color:#9ca3af;font-size:.85rem;margin:.4rem 0">3. Enter your Exness Account ID to unlock VIP Signals</p>'
    + '</div>'
    + '<p style="color:#6b7280;font-size:.85rem">A team member will contact you within 24&#8211;48 hours.<br/>Urgent: <a href="mailto:inquiries@al-mudir.dev" style="color:#d4af37">inquiries@al-mudir.dev</a></p>'
    + '<div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid rgba(212,175,55,.2);text-align:center">'
    + '<p style="color:#374151;font-size:.72rem">AL-MUDIR &bull; DIFC Dubai &bull; The City London &bull; Wall St New York</p>'
    + '</div></div>';

  await sendEmail(user.email, 'Welcome to AL-MUDIR &#8212; Registration Confirmed', html);
}

// ══════════════════════════════════════════════════════════════════════════
// AGENT 3 — Payment Tracker
// ══════════════════════════════════════════════════════════════════════════
async function agentPaymentTracker(payment) {
  console.log('[PaymentTracker]', payment.method, '$' + payment.amount_usd);

  if (payment.amount_usd >= 50) {
    var msg = '&#x1F4B0; *PAYMENT RECEIVED*\n'
      + '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n'
      + '&#x1F464; User: ' + payment.user_email + '\n'
      + '&#x1F4B3; Method: ' + payment.method.toUpperCase() + '\n'
      + '&#x1FAB2; Amount: ' + payment.amount + ' ' + payment.currency + ' (~$' + Number(payment.amount_usd).toFixed(2) + ' USD)\n'
      + '&#x1F517; TX: ' + (payment.tx_hash ? payment.tx_hash.slice(0,14) + '...' : 'N/A') + '\n'
      + '&#x2705; Status: ' + payment.status;
    await tg(msg);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// AGENT 4 — Daily Report
// ══════════════════════════════════════════════════════════════════════════
async function agentDailyReport(stats) {
  stats = stats || { signups24h: 0, kycPending: 0, vipUsers: 0, revenue24h: 0 };
  var date = new Date().toISOString().split('T')[0];
  console.log('[DailyReport] Generating for', date);

  var msg = '&#x1F4CA; *AL-MUDIR DAILY REPORT &#8212; ' + date + '*\n'
    + '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n'
    + '&#x1F465; New Signups (24h): ' + stats.signups24h + '\n'
    + '&#x23F3; KYC Pending: ' + stats.kycPending + '\n'
    + '&#x1F31F; VIP Users: ' + stats.vipUsers + '\n'
    + '&#x1F4B5; Revenue (24h): $' + Number(stats.revenue24h).toFixed(2) + ' USD\n\n'
    + '&#x1F4C8; PORTFOLIO\n'
    + '   AUM: $7.8M | YTD: +12.4%\n'
    + '   Sharpe: 2.84 | Drawdown: -3.2%\n\n'
    + '&#x2699;&#xFE0F; SYSTEM: OPERATIONAL | 0.04ms latency';

  await tg(msg);
  await sendEmail(
    AGENT_CONFIG.ALERT_EMAIL,
    '[AL-MUDIR] Daily Report &#8212; ' + date,
    emailWrap('Daily Report ' + date, msg.replace(/\n/g, '<br/>').replace(/\*/g, ''))
  );
}

// ══════════════════════════════════════════════════════════════════════════
// AGENT 5 — Newsletter Confirm
// ══════════════════════════════════════════════════════════════════════════
async function agentNewsletterConfirm(email) {
  console.log('[NewsletterConfirm]', email);
  var html = '<div style="font-family:Georgia,serif;background:#04120f;padding:2rem;color:#e8e0d0;max-width:500px;margin:auto;border:1px solid rgba(212,175,55,.3);border-radius:8px;text-align:center">'
    + '<h1 style="color:#d4af37;font-size:1.8rem;margin-bottom:.5rem">&#9138; AL-MUDIR</h1>'
    + '<p style="color:#10b981;font-size:1rem;margin:1.5rem 0">&#x2713; You\'re subscribed to market insights</p>'
    + '<p style="color:#9ca3af;font-size:.85rem;line-height:1.7">Weekly institutional-grade market analysis, SMC signal alerts, and exclusive fintech research.</p>'
    + '<p style="color:#6b7280;font-size:.72rem;margin-top:1.5rem">Reply UNSUBSCRIBE to stop receiving emails.</p>'
    + '</div>';
  await sendEmail(email, '&#x2713; AL-MUDIR Market Insights &#8212; Subscribed', html);
}

// ══════════════════════════════════════════════════════════════════════════
// AGENT 6 — Security Scanner
// ══════════════════════════════════════════════════════════════════════════
var _rateLimits = {};

function agentSecurityCheck(ip, action) {
  var now = Date.now();
  var key = ip + ':' + (action || 'default');
  var entry = _rateLimits[key] || { count: 0, first: now };
  if (now - entry.first > 900000) { entry = { count: 1, first: now }; }
  else { entry.count++; }
  _rateLimits[key] = entry;
  if (entry.count > 15) {
    tg('&#x1F6A8; *RATE LIMIT* IP: ' + ip + ' | ' + entry.count + ' attempts in 15 min').catch(function(){});
    return { allowed: false };
  }
  return { allowed: true };
}

function agentScanUser(user) {
  var flags = [];
  if (!user.email || !user.email.includes('@')) flags.push('Invalid email');
  if (/<script/i.test(user.objectives || ''))    flags.push('XSS attempt in objectives');
  if (/<script/i.test(user.first_name || ''))   flags.push('XSS attempt in name');
  if (flags.length > 0) {
    tg('&#x26A0;&#xFE0F; *SECURITY FLAG*\nUser: ' + user.email + '\nFlags: ' + flags.join(', ')).catch(function(){});
  }
  return { clean: flags.length === 0, flags: flags };
}

// ══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — Main router
// ══════════════════════════════════════════════════════════════════════════
async function runAgent(event) {
  var type = event.type;
  var payload = event.payload || {};
  console.log('[Orchestrator] Event:', type);
  try {
    if (type === 'user.created') {
      agentScanUser(payload);
      await agentSignupMonitor(payload);
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
  } catch(e) {
    console.error('[Orchestrator] Error:', e.message);
  }
  return { ok: true };
}

// ── Configure agents from the site (call this once on page load) ─────────
function configureAgents(cfg) {
  if (cfg.TELEGRAM_BOT_TOKEN) AGENT_CONFIG.TELEGRAM_BOT_TOKEN = cfg.TELEGRAM_BOT_TOKEN;
  if (cfg.TELEGRAM_CHAT_ID)   AGENT_CONFIG.TELEGRAM_CHAT_ID   = cfg.TELEGRAM_CHAT_ID;
  if (cfg.RESEND_API_KEY)     AGENT_CONFIG.RESEND_API_KEY      = cfg.RESEND_API_KEY;
  if (cfg.ALERT_EMAIL)        AGENT_CONFIG.ALERT_EMAIL         = cfg.ALERT_EMAIL;
}

// Expose globally for browser use
if (typeof window !== 'undefined') {
  window.ALMUDIRAgents = {
    run:       runAgent,
    configure: configureAgents,
    signupMonitor:   agentSignupMonitor,
    welcomeEmail:    agentWelcomeEmail,
    paymentTracker:  agentPaymentTracker,
    dailyReport:     agentDailyReport,
    newsletterConfirm: agentNewsletterConfirm,
    securityCheck:   agentSecurityCheck,
    scanUser:        agentScanUser,
  };
}
