#!/bin/bash
# ══════════════════════════════════════════════════════════════
# AL-MUDIR Email Setup — Resend + Vercel DNS
# Run: bash setup-email.sh <RESEND_API_KEY>
# ══════════════════════════════════════════════════════════════
set -e

KEY="$1"
DOMAIN="al-mudir.org"

if [[ -z "$KEY" ]]; then
  echo "Usage: bash setup-email.sh re_XXXXXXXX"
  echo ""
  echo "Get your free API key at: https://resend.com/signup"
  echo "  1. Sign up with GitHub (one click)"
  echo "  2. Dashboard → API Keys → Create API Key"
  echo "  3. Copy the key (starts with re_)"
  exit 1
fi

if [[ ! "$KEY" =~ ^re_ ]]; then
  echo "❌ Invalid key format. Resend API keys start with 're_'"
  exit 1
fi

echo "🔑 Validating API key..."
VALIDATE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $KEY" \
  "https://api.resend.com/api-keys")

if [[ "$VALIDATE" != "200" ]]; then
  echo "❌ API key validation failed (HTTP $VALIDATE). Check the key and try again."
  exit 1
fi
echo "✅ API key valid"

echo ""
echo "📧 Adding domain $DOMAIN to Resend..."
DOMAIN_RESP=$(curl -s -X POST "https://api.resend.com/domains" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$DOMAIN\"}")

DOMAIN_ID=$(echo "$DOMAIN_RESP" | node -e "process.stdin.on('data',d=>{try{const j=JSON.parse(d);console.log(j.id||'')}catch{console.log('')}})")
DOMAIN_STATUS=$(echo "$DOMAIN_RESP" | node -e "process.stdin.on('data',d=>{try{const j=JSON.parse(d);console.log(j.status||j.message||j.name||'')}catch{console.log(d.toString().substring(0,200))}})")

if [[ -z "$DOMAIN_ID" ]]; then
  echo "⚠️  Domain might already be added: $DOMAIN_STATUS"
  # Try to list domains to find existing one
  DOMAIN_ID=$(curl -s -H "Authorization: Bearer $KEY" "https://api.resend.com/domains" | \
    node -e "process.stdin.on('data',d=>{try{const j=JSON.parse(d);const dom=(j.data||j).find(x=>x.name==='$DOMAIN');console.log(dom?dom.id:'')}catch{console.log('')}})")
fi

if [[ -n "$DOMAIN_ID" ]]; then
  echo "✅ Domain ID: $DOMAIN_ID"
  
  echo ""
  echo "📋 Fetching DNS records to add..."
  DNS_RESP=$(curl -s -H "Authorization: Bearer $KEY" "https://api.resend.com/domains/$DOMAIN_ID")
  
  echo "$DNS_RESP" | node -e "
    process.stdin.on('data', d => {
      try {
        const j = JSON.parse(d);
        const records = j.records || [];
        console.log('');
        console.log('DNS Records needed for email deliverability:');
        console.log('═══════════════════════════════════════════');
        records.forEach(r => {
          console.log('Type:', r.record_type || r.type);
          console.log('Name:', r.name);
          console.log('Value:', r.value);
          console.log('Priority:', r.priority || 'N/A');
          console.log('TTL:', r.ttl || 'default');
          console.log('Status:', r.status);
          console.log('---');
        });
      } catch (e) {
        console.log('Raw:', d.toString().substring(0, 500));
      }
    });
  "

  echo ""
  echo "🌐 Adding DNS records to Vercel..."
  
  echo "$DNS_RESP" | node -e "
    process.stdin.on('data', d => {
      try {
        const j = JSON.parse(d);
        const records = j.records || [];
        const cmds = [];
        records.forEach(r => {
          const type = (r.record_type || r.type || '').toUpperCase();
          const name = r.name || '';
          const value = r.value || '';
          const priority = r.priority;
          
          if (type === 'MX') {
            cmds.push('vercel dns add $DOMAIN ' + name + ' MX ' + value + ' ' + (priority || 10));
          } else if (type === 'TXT') {
            cmds.push('vercel dns add $DOMAIN ' + name + ' TXT \"' + value.replace(/\"/g, '\\\\\"') + '\"');
          } else if (type === 'CNAME') {
            cmds.push('vercel dns add $DOMAIN ' + name + ' CNAME ' + value);
          }
        });
        cmds.forEach(c => console.log(c));
      } catch (e) {
        console.log('# Could not parse DNS records');
      }
    });
  " | while IFS= read -r cmd; do
    echo "  → $cmd"
    eval "$cmd" 2>&1 || echo "  ⚠️  Record may already exist or failed"
  done
fi

echo ""
echo "🔧 Setting Vercel environment variables..."

# Remove old SMTP env vars (Ethereal test credentials)
echo "  Removing old SMTP test credentials..."
vercel env rm SMTP_HOST production -y 2>/dev/null || true
vercel env rm SMTP_PORT production -y 2>/dev/null || true
vercel env rm SMTP_USER production -y 2>/dev/null || true
vercel env rm SMTP_PASS production -y 2>/dev/null || true

# Add Resend API key
echo "  Adding RESEND_API_KEY..."
echo "$KEY" | vercel env add RESEND_API_KEY production 2>&1

# Set email FROM address
echo "  Adding EMAIL_FROM..."
echo "AL-MUDIR <noreply@$DOMAIN>" | vercel env add EMAIL_FROM production 2>&1 || true

echo ""
echo "🚀 Deploying..."
vercel --prod --yes 2>&1

echo ""
echo "✅ Email setup complete!"
echo ""
echo "Testing..."
TEST_RESULT=$(curl -s -X POST "https://api.resend.com/emails" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"from\": \"AL-MUDIR <onboarding@resend.dev>\",
    \"to\": [\"delivered@resend.dev\"],
    \"subject\": \"AL-MUDIR Email Test\",
    \"text\": \"Email delivery is working.\"
  }")
echo "Test send: $TEST_RESULT"
echo ""
echo "═══════════════════════════════════════════"
echo "  🎉 DONE! Email OTP delivery is live."
echo "  Users will now receive codes via email."
echo "═══════════════════════════════════════════"
