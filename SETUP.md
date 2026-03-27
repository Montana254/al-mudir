# AL-MUDIR — Master Deployment Guide
### You approve each step. I guide every click.

---

## YOUR FILE CHECKLIST
```
index.html          ✅ Main site + full dashboard
crypto-payment.js   ✅ Web3 wallet + all payments
sw.js               ✅ Service worker / PWA
vercel.json         ✅ Security headers + routing
agents.js           ✅ 6-agent management system
SETUP.md            ✅ This guide
```

---

# PHASE 1 — SUPABASE (10 minutes)

## Step 1.1 — Create account
1. Open: https://supabase.com
2. Click **Start your project** → Sign up with GitHub (easiest)
3. Once in dashboard → Click **New project**
4. Fill in:
   - **Name:** `al-mudir`
   - **Database password:** Generate a strong one, save it somewhere
   - **Region:** `eu-west-2 (London)` ← closest to your hubs
5. Click **Create new project** → wait ~2 minutes

## Step 1.2 — Create database tables
1. In your project → click **SQL Editor** (left sidebar)
2. Click **New query**
3. Paste this entire block and click **Run** (▶):

```sql
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  email             TEXT UNIQUE NOT NULL,
  phone             TEXT,
  experience        TEXT,
  investment_amount TEXT,
  objectives        TEXT,
  kyc_verified      BOOLEAN DEFAULT FALSE,
  vip_unlocked      BOOLEAN DEFAULT FALSE,
  exness_account_id TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Newsletter subscribers
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email  TEXT NOT NULL,
  method      TEXT NOT NULL,
  currency    TEXT,
  amount      NUMERIC,
  amount_usd  NUMERIC,
  tx_hash     TEXT,
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments               ENABLE ROW LEVEL SECURITY;

-- Allow public inserts (anon key)
CREATE POLICY "insert_users"    ON users                  FOR INSERT WITH CHECK (true);
CREATE POLICY "insert_nl"       ON newsletter_subscribers FOR INSERT WITH CHECK (true);
CREATE POLICY "insert_payments" ON payments               FOR INSERT WITH CHECK (true);
```

4. You should see **Success. No rows returned.** — that's correct ✓

## Step 1.3 — Get your API keys
1. Left sidebar → **Settings** → **API**
2. Copy these two values:

```
Project URL:     https://xxxxxxxx.supabase.co
anon public key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

3. Open `index.html` in any text editor
4. Find these two lines (near the bottom, inside `<script>`):
```javascript
const SB_URL  = 'https://YOUR_PROJECT_ID.supabase.co';
const SB_KEY  = 'YOUR_ANON_PUBLIC_KEY';
```
5. Replace with your real values. Save the file.

---

# PHASE 2 — GITHUB (5 minutes)

## Step 2.1 — Push your new files
Open your terminal / command prompt and run:

```bash
# Navigate to your project folder
cd path/to/your/Montana-project

# Copy the new files in (or drag them into the folder manually)
# Files to add/replace:
#   index.html
#   crypto-payment.js
#   sw.js
#   vercel.json
#   agents.js

# Add, commit, push
git add .
git commit -m "v2: Full rebuild — dashboard, wallet, payments, agents, KYC"
git push origin main
```

If you don't have Git installed: just upload the files directly on GitHub.com:
1. Go to https://github.com/Montana254/Montana
2. Click **Add file** → **Upload files**
3. Drag all 5 files in
4. Click **Commit changes**

---

# PHASE 3 — VERCEL (2 minutes, already connected)

## Step 3.1 — Trigger redeploy
Since your repo is already on Vercel, pushing to GitHub will auto-deploy.

1. Go to https://vercel.com → your project
2. You'll see a new deployment triggered automatically
3. Wait ~60 seconds for it to go green ✓
4. Click **Visit** to see your live site

## Step 3.2 — Verify deployment
Check these work on the live site:
- [ ] Homepage loads with gold theme
- [ ] TradingView chart appears
- [ ] Registration form submits
- [ ] KYC flow works
- [ ] Dashboard opens after KYC
- [ ] Wallet connect button works (needs MetaMask/Trust Wallet)
- [ ] Currency converter works

---

# PHASE 4 — AGENTS SETUP (15 minutes)

The 6 agents live in `agents.js` and run as Supabase Edge Functions.

## Step 4.1 — Set up Resend (free email service)
1. Go to https://resend.com → Sign up free (3,000 emails/month free)
2. Go to **API Keys** → Create API key
3. Copy the key (starts with `re_`)

## Step 4.2 — Set up Telegram bot for alerts
1. Open Telegram → search for **@BotFather**
2. Send `/newbot` → follow prompts → you'll get a bot token
3. Start a chat with your new bot
4. Get your chat ID: visit `https://api.telegram.org/bot{YOUR_TOKEN}/getUpdates`
5. Send a message to your bot, then check the URL above — find `"chat":{"id":XXXXXX}`

## Step 4.3 — Deploy agents as Supabase Edge Function
1. In Supabase → **Edge Functions** (left sidebar)
2. Click **New Function** → name it `agents`
3. Paste the contents of `agents.js`
4. Click **Deploy**

## Step 4.4 — Set environment variables
In Supabase → Edge Functions → your `agents` function → **Secrets**:
```
SUPABASE_URL         = https://your-project.supabase.co
SUPABASE_SERVICE_KEY = your-service-role-key (from Settings → API)
ALERT_EMAIL          = inquiries@al-mudir.dev
RESEND_API_KEY       = re_xxxxxxxxxxxx
TELEGRAM_BOT_TOKEN   = 123456:ABCdef...
TELEGRAM_CHAT_ID     = your-chat-id
```

## Step 4.5 — Set up Supabase webhooks (triggers agents automatically)
1. Supabase → **Database** → **Webhooks**
2. Click **Create webhook**:
   - Name: `on_user_created`
   - Table: `users`
   - Events: `INSERT`
   - URL: `https://your-project.supabase.co/functions/v1/agents`
   - Payload: `{"type":"user.created","payload":{{record}}}`
3. Create another:
   - Name: `on_newsletter`
   - Table: `newsletter_subscribers`
   - Events: `INSERT`
   - URL: same
   - Payload: `{"type":"newsletter.subscribed","payload":{{record}}}`

## Step 4.6 — Set up daily report (cron job)
1. Supabase → **Database** → **Extensions** → enable `pg_cron`
2. SQL Editor → Run:
```sql
SELECT cron.schedule(
  'daily-almudir-report',
  '0 8 * * *',  -- every day at 08:00 UTC
  $$
    SELECT net.http_post(
      url := 'https://your-project.supabase.co/functions/v1/agents',
      body := '{"type":"daily.report","payload":{}}'::jsonb
    );
  $$
);
```

---

# PHASE 5 — FINAL VERIFICATION

Once everything is deployed, test this full user journey:

```
1. Visit your Vercel URL
2. Click "Access Portal" → Register with real email
3. Complete KYC (upload any image)
4. Dashboard opens ✓
5. Go to Payment → connect MetaMask → send tiny amount
6. Go to Free Access → enter Exness ID (123456789) → VIP unlocks
7. Check your Telegram — you should see signup alert ✓
8. Check your email — welcome email received ✓
```

---

# QUICK REFERENCE

| Service  | URL                          | Purpose              |
|----------|------------------------------|----------------------|
| Supabase | https://app.supabase.com     | Database + functions |
| Vercel   | https://vercel.com           | Hosting              |
| Resend   | https://resend.com           | Email delivery       |
| Telegram | @BotFather                   | Alert bot setup      |
| Exness   | exnesstrack.org/a/aczb4cfol7 | Broker partner link  |

---

# WHAT EACH AGENT DOES

| Agent                 | What it monitors              | How it alerts          |
|-----------------------|-------------------------------|------------------------|
| SignupMonitorAgent    | Every new registration        | Telegram + Email       |
| InquiryResponderAgent | New signups + newsletter subs | Welcome email auto-sent|
| PaymentTrackerAgent   | All payments ≥ $100           | Telegram alert         |
| DailyReportAgent      | Full daily summary            | Email + Telegram 8am   |
| SecurityAgent         | Rate limits + XSS attempts    | Telegram warning       |
| OrchestratorAgent     | Coordinates all agents        | Internal router        |
