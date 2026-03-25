# AL-MUDIR Deployment Script for Windows PowerShell
# Run as: powershell -ExecutionPolicy Bypass -File deploy.ps1

Write-Host "================================================================================" -ForegroundColor Green
Write-Host "🚀 AL-MUDIR - AUTOMATED DEPLOYMENT SCRIPT (PowerShell)" -ForegroundColor Green
Write-Host "================================================================================" -ForegroundColor Green
Write-Host ""

# Check if git is installed
try {
    $gitVersion = git --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Git not found"
    }
    Write-Host "✓ Git detected: $gitVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Git is not installed. Please install from: https://git-scm.com" -ForegroundColor Red
    Write-Host "After installation, run this script again."
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""

# Step 1: Navigate to project directory
Write-Host "[Step 1] Checking project directory..." -ForegroundColor Blue
if (-not (Test-Path "al-mudir")) {
    Write-Host "❌ Project directory 'al-mudir' not found." -ForegroundColor Red
    Write-Host "Please clone the repository first:"
    Write-Host "  git clone https://github.com/Montana254/al-mudir.git"
    Read-Host "Press Enter to exit"
    exit 1
}

Set-Location "al-mudir"
Write-Host "✓ Navigated to al-mudir directory" -ForegroundColor Green
Write-Host ""

# Step 2: Check git status
Write-Host "[Step 2] Checking git status..." -ForegroundColor Blue
$gitStatus = git status --porcelain 2>$null
if ([string]::IsNullOrEmpty($gitStatus)) {
    Write-Host "✓ Working directory is clean" -ForegroundColor Green
} else {
    Write-Host "ℹ Some local changes detected:" -ForegroundColor Yellow
    Write-Host $gitStatus
}
Write-Host ""

# Step 3: Pull latest changes
Write-Host "[Step 3] Pulling latest changes from GitHub..." -ForegroundColor Blue
git pull origin main
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Pulled latest changes" -ForegroundColor Green
} else {
    Write-Host "⚠ Pull encountered a warning" -ForegroundColor Yellow
}
Write-Host ""

# Step 4: Verify GitHub connection
Write-Host "[Step 4] Verifying GitHub connection..." -ForegroundColor Blue
$gitCheck = git ls-remote origin 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ GitHub connection successful" -ForegroundColor Green
} else {
    Write-Host "⚠ GitHub connection may need authentication" -ForegroundColor Yellow
    Write-Host "Try: git config --global user.email 'your-email@example.com'"
}
Write-Host ""

# Step 5: Deploy to GitHub
Write-Host "[Step 5] Deploying to GitHub (triggers Vercel auto-deploy)..." -ForegroundColor Blue
Write-Host "Pushing to GitHub main branch..."
git push origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Successfully pushed to GitHub!" -ForegroundColor Green
} else {
    Write-Host "❌ Push failed. Try these alternatives:" -ForegroundColor Red
    Write-Host "  1. Install GitHub Desktop"
    Write-Host "  2. Install GitHub CLI: winget install GitHub.cli"
    Write-Host "  3. Use Personal Access Token instead of password"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host ""

# Success message
Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "✓ DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
Write-Host "==========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Your website will be live in 30-60 seconds!" -ForegroundColor Cyan
Write-Host ""
Write-Host "📍 Live Site URLs:" -ForegroundColor Yellow
Write-Host "  Primary: https://al-mudir.vercel.app"
Write-Host "  Backup: https://al-mudir.netlify.app"
Write-Host "  GitHub Pages: https://montana254.github.io/al-mudir"
Write-Host ""
Write-Host "📊 Monitor Deployment:" -ForegroundColor Yellow
Write-Host "  Vercel: https://vercel.com/dashboard"
Write-Host "  GitHub: https://github.com/Montana254/al-mudir/commits/main"
Write-Host ""
Write-Host "🧪 Test Your Site:" -ForegroundColor Yellow
Write-Host "  1. Wait 30-60 seconds for deployment"
Write-Host "  2. Visit: https://al-mudir.vercel.app"
Write-Host "  3. Test wallet connection"
Write-Host "  4. Try crypto payment"
Write-Host "  5. Check analytics tracking"
Write-Host ""
Write-Host "==========================================================================" -ForegroundColor Green
Write-Host ""

Read-Host "Press Enter to close this window"
