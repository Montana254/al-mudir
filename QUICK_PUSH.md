# Quick Push Commands

## Copy-Paste Ready Commands

### From Your Local Machine Terminal

```bash
# Step 1: Navigate to project
cd al-mudir

# Step 2: Pull latest code
git pull origin main

# Step 3: Push to GitHub (Vercel auto-deploys)
git push origin main
```

That's it! Your site deploys in 30-60 seconds.

---

## Verify Deployment

After pushing, check:

1. **GitHub:** https://github.com/Montana254/al-mudir (should show latest commits)
2. **Vercel:** https://vercel.com/dashboard (should show "Deployment Successful")
3. **Live Site:** https://al-mudir.vercel.app

---

## What You'll See

✅ Green checkmark in Vercel = Deployment successful
✅ Website live at al-mudir.vercel.app
✅ All payment features active
✅ Analytics tracking enabled

---

## Troubleshooting

If push fails with auth error:
1. Ensure you're logged into GitHub locally: `git config --global user.email "your-email@example.com"`
2. Use Personal Access Token instead of password
3. Or use GitHub CLI: `gh auth login`

---

Done! 🚀
