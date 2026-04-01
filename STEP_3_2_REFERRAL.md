# Step 3.2: Referral Program Implementation Guide

## Overview
Create a $25 credit reward system that turns users into salespeople: 50 referrals × $25 = $1,250/bot activation cycle.

## Database Schema (User Fields to Add)
```javascript
user.referralCode = 'AL' + randomCode(8);  // e.g. AL84K92M
user.referralStats = {
  totalReferrals: 0,           // Count of successful signups
  creditsEarned: 0,             // Total $25 credits earned
  referralSet: ['email1@x.com', 'email2@x.com']  // Set of referred users
};
```

## API Endpoints to Create

### 1. Generate Referral Code (on signup)
```javascript
POST /api/wallet?action=generate_referral_code
Response: { ok: true, referralCode: "AL84K92M" }
```

### 2. Track Referral Click
```javascript
GET /api/auth-register.js (already exists)
// Add parameter handling for ?ref=AL84K92M
// Store in session: session.referrerCode = "AL84K92M"
```

### 3. Process Bot Activation with Referral
```javascript
POST /api/wallet?action=activate_bot_with_referral
Body: { referrerCode: "AL84K92M" }
// 1. Find referrer by code
// 2. Add $25 USDT to referrer wallet
// 3. Update referralStats
// 4. Log referral commission as revenue
```

### 4. Get Referral Stats
```javascript
POST /api/wallet?action=get_referral_stats
Response: { 
  ok: true,
  referralCode: "AL84K92M",
  totalReferrals: 12,
  creditsEarned: 300,
  shareUrl: "https://al-mudir.org/?ref=AL84K92M"
}
```

## Frontend Components

### Profile Tab - Referral Section
```html
<div class="profile-section">
  <h3>Your Referral Link</h3>
  <p>Earn $25 USDT credit for every bot activation</p>
  
  <!-- Referral Code Display -->
  <input type="text" id="userReferralCode" readonly />
  <button id="copyReferralLinkBtn">Copy Link</button>
  
  <!-- Share Buttons -->
  <button id="shareWhatsApp"><i class="fab fa-whatsapp"></i> WhatsApp</button>
  <button id="shareTelegram"><i class="fab fa-telegram"></i> Telegram</button>
  <button id="shareTwitter"><i class="fab fa-twitter"></i> Twitter</button>
  
  <!-- Referral Stats -->
  <div class="grid grid-cols-3 gap-4">
    <div>
      <p class="text-gray-500">Total Referrals</p>
      <p class="text-2xl font-bold" id="referralCount">0</p>
    </div>
    <div>
      <p class="text-gray-500">Credits Earned</p>
      <p class="text-2xl font-bold" id="creditsEarned">$0</p>
    </div>
    <div>
      <p class="text-gray-500">Conversion Rate</p>
      <p class="text-2xl font-bold" id="conversionRate">0%</p>
    </div>
  </div>
</div>
```

## ShareLink URLs
```javascript
const referralUrl = 'https://al-mudir.org/?ref=' + userCode;

// WhatsApp
whatsAppLink = 'https://wa.me/?text=Join AL-MUDIR and earn $25 credit. ' + referralUrl;

// Telegram
telegramLink = 'https://t.me/share/url?url=' + referralUrl + '&text=Join AL-MUDIR';

// Twitter
twitterLink = 'https://twitter.com/intent/tweet?text=Making+$25+on+every+bot+activation+with+AL-MUDIR&url=' + referralUrl;
```

## Implementation Steps

1. **Add referral code generation to signup** (auth-register.js)
   ```javascript
   user.referralCode = 'AL' + crypto.randomBytes(4).toString('hex').toUpperCase();
   user.referralStats = { totalReferrals: 0, creditsEarned: 0, referralSet: [] };
   ```

2. **Track referral parameter in signup** (auth-register.js)
   ```javascript
   if (query.ref && query.ref.match(/^AL[A-Z0-9]{8}$/)) {
     session.referrerCode = query.ref;
     // Log this for bot activation processing
   }
   ```

3. **Add wallet credit on bot activation** (api/wallet.js - bot_activate action)
   ```javascript
   if (body.referrerCode) {
     const referrer = await redis('GET', 'user_by_referral_code:' + body.referrerCode);
     if (referrer) {
       const referrerUser = JSON.parse(referrer);
       referrerUser.referralStats.creditsEarned += 25;
       referrerUser.referralStats.totalReferrals++;
       referrerUser.referralStats.referralSet.push(email);
       // Add $25 to wallet
       await setWalletBalance(referrerUser.email, 'USDT', currentBalance + 25);
     }
   }
   ```

4. **Add referral UI to profile dashboard**  
   Show in Profile → Tab, with prominent copy URL + share buttons

5. **Display referral link in homepage footer**
```html
<!-- After signup incentive -->
<p>Share your referral link for $25 credits per bot activation</p>
<a href="https://al-mudir.org/?ref=YOURCODE">https://al-mudir.org/?ref=YOURCODE</a>
```

## Revenue Math
- 50 referrals × $25 = $1,250 incremental revenue  
- At 5% conversion (50 out of 1,000 users), this is ~$2,500/month sustainable

## Testing Checklist
- [ ] User generates referral code on signup
- [ ] referralCode stored in profile
- [ ] Sharing button generates correct URLs for WhatsApp/Telegram/Twitter
- [ ] Query parameter ?ref=CODE stores referrer info  
- [ ] Bot activation checks referrer code
- [ ] Referrer receives $25 USDT wallet credit
- [ ] referralStats update correctly
- [ ] referralCount and creditsEarned display updated on profile

## Files to Modify
- `/api/auth-register.js` - Add referral code generation
- `/api/wallet.js` - Add get_referral_stats, process referral reward on bot activation
- `/api/auth-profile.js` - Return referral data in profile fetch
- `/index.html` - Add referral UI to profile section, add share buttons
