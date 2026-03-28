#!/bin/bash
TS=$(date +%s)
EMAIL="testuser${TS}@test.io"
curl -s -X POST https://al-mudir.org/api/auth-register \
  -H "Content-Type: application/json" \
  -d '{"email":"'"$EMAIL"'","password":"TestPass@123456","name":"Test User","phone":"+971505551234","otpChannel":"email"}' 
