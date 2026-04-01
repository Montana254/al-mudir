// ─────────────────────────────────────────────────────────────────
// Signals Paywall System
// 
// Implements 3-tier access to trading signals:
// 1. Free: Last signal blurred with only pair name
// 2. Broker Verified: Full signals (free for Exness users)
// 3. Pro Subscriber: Full signals + history + alerts + Telegram ($49/mo)
// ─────────────────────────────────────────────────────────────────

const SUBSCRIPTION_TIERS = {
  free: {
    name: 'Free Access',
    price: 0,
    billingCycle: 'lifetime',
    features: ['blurred_last_signal_only']
  },
  broker_verified: {
    name: 'Broker Verified',
    price: 0,
    billingCycle: 'lifetime',
    features: ['full_signals', 'history']
  },
  pro: {
    name: 'Pro Subscriber',
    price: 49,
    billingCycle: 'monthly',
    features: ['full_signals', 'history', 'real_time_alerts', 'telegram_link']
  }
};

async function checkSignalAccess(email) {
  try {
    const res = await fetch('/api/wallet?action=check_signal_access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email || '' })
    });
    const data = await res.json();
    if (!data.ok) return { tier: 'public', features: [] };
    return {
      tier: data.accessTier,
      features: data.features || [],
      expiry: data.expiry,
      brokerVerified: data.brokerVerified
    };
  } catch (err) {
    console.error('Signal access check failed:', err);
    return { tier: 'public', features: [] };
  }
}

function hasSignalFeature(features, feature) {
  return Array.isArray(features) && features.includes(feature);
}

function renderBlurredSignal(s) {
  // Show only pair name, everything else blurred
  const sideClass = s.side === 'BUY' ? 'text-green-300 border-green-500/40 bg-green-500/10' : 'text-red-300 border-red-500/40 bg-red-500/10';
  return '<article class="signal-card blur-sm opacity-50 pointer-events-none">'
    + '<div class="flex items-center justify-between">'
    + '<p class="text-sm font-semibold text-white blur-none">' + s.symbol + '</p>'
    + '<span class="signal-chip ' + sideClass + ' blur-none">' + s.side + '</span>'
    + '</div>'
    + '<div class="mt-2 flex items-center justify-between">'
    + '<span class="text-[10px] uppercase tracking-[0.1em] text-gray-500">&bull;&bull;&bull;&bull;&bull;&bullet;&bull;&bull;&bull;&bull;</span>'
    + '</div>'
    + '<div class="mt-3 grid grid-cols-2 gap-2 text-[11px]">'
    + '<p class="text-gray-600">••••••••••••</p>'
    + '<p class="text-gray-600">••••••••••••</p>'
    + '<p class="text-gray-600">••••••••••••</p>'
    + '<p class="text-gray-600">••••••••••••</p>'
    + '</div>'
    + '</article>';
}

function renderPaywallCTA() {
  return '<div class="rounded border border-white/10 bg-blue-500/5 p-6 text-center">'
    + '<h3 class="text-lg font-bold text-white mb-2">Unlock Full Signals</h3>'
    + '<p class="text-sm text-gray-300 mb-4">Get full signal details, history, and real-time alerts</p>'
    + '<div class="space-y-2">'
    + '<button id="subscribeBrokerVerifyBtn" class="w-full rounded border border-green-500/50 bg-green-500/10 py-2 text-sm text-green-300 hover:bg-green-500/20">Verify Broker (Free)</button>'
    + '<button id="subscribeProBtn" class="w-full rounded border border-blue-500/50 bg-blue-500/10 py-2 text-sm text-blue-300 hover:bg-blue-500/20">Subscribe Pro - $49/month</button>'
    + '</div>'
    + '</div>';
}

module.exports = {
  SUBSCRIPTION_TIERS,
  checkSignalAccess,
  hasSignalFeature,
  renderBlurredSignal,
  renderPaywallCTA
};
