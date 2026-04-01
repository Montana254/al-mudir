# Step 3.5: Stripe Payment Integration (Card Payments + Apple Pay/Google Pay)

## Why Stripe
- Industry standard for fintech
- 2.9% + $0.30 per transaction
- Enables Visa, Mastercard, Apple Pay, Google Pay automatically
- Webhook support for payment confirmations

## 1. Create Stripe Account

1. Go to https://stripe.com
2. Click "Sign up"
3. Email, password, business name: "AL-MUDIR"
4. Complete identity verification (takes 2-3 days) 
5. Once verified, go to Dashboard → Developers → API Keys
6. Copy your:
   - Publishable Key (pk_live_...)
   - Secret Key (sk_live_...)

## 2. Add Environment Variables

Create/update `.env.local`:
```
STRIPE_PUBLISHABLE_KEY=pk_live_YOUR_KEY
STRIPE_SECRET_KEY=sk_live_YOUR_KEY
STRIPE_WEBHOOK_SECRET=whsec_YOUR_SECRET (get from Dashboard → Webhooks)
```

## 3. Install Stripe SDK

```bash
npm install stripe
```

Add to `/api/_lib/stripe-handler.js`:
```javascript
'use strict';
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createPaymentIntent(amount, email, description) {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe uses cents
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true, // Enable Apple Pay, Google Pay, etc
      },
      metadata: {
        email: email,
        type: description // 'bot_activation', 'pro_subscription', 'deposit'
      },
      receipt_email: email
    });
    return {
      ok: true,
      clientSecret: paymentIntent.client_secret,
      amountUsd: amount
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      ok: false,
      error: err.message
    };
  }
}

async function confirmPayment(paymentIntentId) {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return {
    ok: intent.status === 'succeeded',
    status: intent.status,
    amountReceived: intent.amount_received / 100 // Convert back to dollars
  };
}

module.exports = { createPaymentIntent, confirmPayment };
```

## 4. Add API Endpoints

### Create Payment Intent
```javascript
POST /api/wallet?action=create_payment_intent
Body: {
  amount: 399,
  type: "bot_activation" // or "pro_subscription", "deposit"
}
Response: {
  ok: true,
  clientSecret: "pi_1234567890_secret_xxxxx",
  amountUsd: 399
}
```

Add to `/api/wallet.js`:
```javascript
if (action === 'create_payment_intent') {
  const amount = Number(body.amount) || 0;
  const type = String(body.type || 'deposit').toLowerCase();
  
  if (amount <= 0) {
    return res.status(400).json({ ok: false, error: 'invalid_amount' });
  }
  
  const { createPaymentIntent } = require('./_lib/stripe-handler');
  const result = await createPaymentIntent(amount, email, type);
  
  if (!result.ok) {
    return res.status(400).json(result);
  }
  
  return res.status(200).json(result);
}

if (action === 'confirm_payment') {
  const paymentIntentId = String(body.paymentIntentId || '').trim();
  if (!paymentIntentId) {
    return res.status(400).json({ ok: false, error: 'payment_intent_id_required' });
  }
  
  const { confirmPayment } = require('./_lib/stripe-handler');
  const result = await confirmPayment(paymentIntentId);
  
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: 'payment_not_confirmed' });
  }
  
  // Mark payment as verified in user wallet
  await logRevenue({
    type: body.type || 'payment',
    email: maskEmail(email),
    coin: 'USDT',
    feeUsd: Number(body.stripeFeesUsd) || 0,
    totalUsd: result.amountReceived,
    gateway: 'stripe',
    verified: true,
    txId: paymentIntentId,
    ts: new Date().toISOString()
  });
  
  return res.status(200).json({ ok: true, amountReceived: result.amountReceived });
}
```

## 5. Update Frontend Checkout Modal

In `index.html`, update the card payment handler:

```javascript
// Replace existing card handlers with Stripe integration
async function handleStripePayment(amount, type) {
  if (!currentUser || !currentUser.token) {
    return alert('Sign in required');
  }
  
  try {
    // Step 1: Create payment intent
    var res = await fetch('/api/wallet', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        action: 'create_payment_intent',
        amount: amount,
        type: type
      })
    });
    
    var data = await res.json();
    if (!data.ok) {
      alert('Payment error: ' + (data.error || 'Failed'));
      return;
    }
    
    // Step 2: Show Stripe Elements form
    showStripeCheckoutModal({
      clientSecret: data.clientSecret,
      amount: amount,
      type: type
    });
    
  } catch (err) {
    console.error('Payment error:', err);
    alert('Failed to initialize payment');
  }
}

// Add Stripe Elements to checkout modal
function showStripeCheckoutModal(options) {
  var modal = document.getElementById('checkoutModal');
  if (!modal) return;
  
  var html = '<div class="border border-white/20 rounded p-6">' +
    '<h3 class="text-lg font-bold mb-4">Payment Details</h3>' +
    '<form id="stripePaymentForm">' +
      '<div id="card-element" class="border border-white/20 rounded p-3 mb-4"></div>' +
      '<div id="card-errors" class="text-red-400 mb-4"></div>' +
      '<button type="submit" class="w-full py-2 bg-green-600 rounded">Pay $' + options.amount + '</button>' +
    '</form>' +
    '</div>';
  
  modal.innerHTML = html;
  modal.classList.remove('hidden');
  
  // Initialize Stripe Elements (requires @stripe/js)
  var cardElement = document.getElementById('card-element');
  var form = document.getElementById('stripePaymentForm');
  
  form.addEventListener('submit', async function(evt) {
    evt.preventDefault();
    await createPaymentWithStripeElements(options);
  });
}
```

## 6. Add Stripe.js to HTML Head

Add before closing `</head>` tag:
```html
<script src="https://js.stripe.com/v3/"></script>
```

## 7. Handle Webhook Confirmations

Stripe sends confirmations to: `POST /api/stripe-webhook`

Create `/api/stripe-webhook.js`:
```javascript
'use strict';
const { redis } = require('./_lib/redis'); 
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send('Webhook Error: ' + err.message);
  }
  
  // Handle payment success
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    console.log('Payment succeeded:', paymentIntent.id, paymentIntent.amount_received);
    // Payment verified in confirm_payment action
  }
  
  return res.status(200).json({ ok: true });
};
```

## 8. Update Checkout Modal to Use Stripe

Replace Trust Wallet sections with Stripe button:
```html
<button onclick="handleStripePayment(399, 'bot_activation')" class="w-full py-2 rounded border border-blue-500 bg-blue-500/10 text-blue-300">
  <i class="fa-brands fa-cc-stripe mr-2"></i>
  Pay with Card ($399)
</button>
```

## 9. Test Integration

1. **Test Card Numbers (don't use real cards):**
   - Success: `4242 4242 4242 4242`
   - Decline: `4000 0000 0000 0002`
   - 3D Secure: `4000 0025 0000 3155`

2. **Test in Stripe Dashboard:**
   - Dashboard → Events
   - Verify `payment_intent.succeeded` events arrive
   - Check for any errors or failed payments

3. **Test on AL-MUDIR:**
   - Click "Activate Bot" → Card payment
   - Use test card 4242...
   - Verify payment shows in Stripe Dashboard
   - Verify user gets bot activation confirmation

## Revenue Enablement

With Stripe:
- Bot activations: $399 × 50/month = $19,950
- Signals subscriptions: $49 × 100/month = $4,900
- Deposits trigger 0.05% fee = $50 per $100k
- **Total potential:** $25k-40k/month

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Invalid API key" | Check STRIPE_SECRET_KEY env var |
| "Webhook signature mismatch" | Verify STRIPE_WEBHOOK_SECRET matches generated secret |
| "Card declined" | Normal during testing; Stripe sandbox expects test cards only |
| "3D Secure challenge" | User may see additional authentication screen; normal and secure |

## Files to Create/Modify
- `/api/_lib/stripe-handler.js` (new)
- `/api/stripe-webhook.js` (new)
- `/api/wallet.js` - Add create_payment_intent and confirm_payment actions
- `/index.html` - Update checkout modal with Stripe Elements
- `.env.local` - Add STRIPE keys

## Timeline
- Stripe signup + verification: 2-3 days
- Code integration: 2-3 hours
- Testing: 1 hour
- **Total: 3-4 days before live**

## Next: Webhook Setup

In Stripe Dashboard:
1. Developers → Webhooks
2. Add endpoint: `https://al-mudir.org/api/stripe-webhook`
3. Select events: `payment_intent.succeeded`, `payment_intent.failed`
4. Copy Webhook Secret to .env
