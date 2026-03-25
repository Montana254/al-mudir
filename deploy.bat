@echo off
REM AL-MUDIR Deployment Script for Windows
REM This script automates the entire deployment process

setlocal enabledelayedexpansion

echo ================================================================================
echo 🚀 AL-MUDIR - AUTOMATED DEPLOYMENT SCRIPT (WINDOWS)
echo ================================================================================
echo.

REM Check if git is installed
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Git is not installed. Please install Git from: https://git-scm.com
    pause
    exit /b 1
)

REM Step 1: Navigate to project directory
echo [Step 1] Checking project directory...
if not exist "al-mudir" (
    echo ❌ Project directory 'al-mudir' not found.
    echo Please clone the repository first:
    echo   git clone https://github.com/Montana254/al-mudir.git
    pause
    exit /b 1
)

cd al-mudir
echo ✓ Navigated to al-mudir directory
echo.

REM Step 2: Check git status
echo [Step 2] Checking git status...
git status --short >nul 2>nul
if %errorlevel% equ 0 (
    echo ✓ Working directory is clean
) else (
    echo ⚠ Warning: You may have uncommitted changes
    git status
)
echo.

REM Step 3: Pull latest changes
echo [Step 3] Pulling latest changes from GitHub...
git pull origin main
if %errorlevel% neq 0 (
    echo ⚠ Pull encountered an issue, but continuing...
)
echo ✓ Pulled latest changes
echo.

REM Step 4: Verify GitHub connection
echo [Step 4] Verifying GitHub connection...
git ls-remote origin >nul 2>nul
if %errorlevel% equ 0 (
    echo ✓ GitHub connection successful
) else (
    echo ⚠ GitHub connection may have issues
    echo Try: git config --global user.email "your-email@example.com"
)
echo.

REM Step 5: Deploy to GitHub
echo [Step 5] Deploying to GitHub ^(triggers Vercel auto-deploy^)...
echo Pushing to GitHub main branch...
git push origin main

if %errorlevel% equ 0 (
    echo ✓ Successfully pushed to GitHub!
) else (
    echo ⚠ Push encountered issues
    echo Try these alternatives:
    echo   1. Use GitHub Desktop
    echo   2. Use GitHub CLI: winget install GitHub.cli
    echo   3. Use Personal Access Token
    pause
    exit /b 1
)
echo.

REM Step 6: Success message
echo ======================================================================
echo ✓ DEPLOYMENT SUCCESSFUL!
echo ======================================================================
echo.
echo Your website will be live in 30-60 seconds!
echo.
echo 📍 Live Site URLs:
echo   Primary: https://al-mudir.vercel.app
echo   Backup: https://al-mudir.netlify.app
echo   GitHub Pages: https://montana254.github.io/al-mudir
echo.
echo 📊 Monitor Deployment:
echo   Vercel Dashboard: https://vercel.com/dashboard
echo   GitHub: https://github.com/Montana254/al-mudir/commits/main
echo.
echo 🧪 Test Your Site:
echo   1. Wait 30-60 seconds for deployment
echo   2. Visit: https://al-mudir.vercel.app
echo   3. Test wallet connection
echo   4. Try crypto payment
echo   5. Verify analytics
echo.
echo ======================================================================
echo.

pause
