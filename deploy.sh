#!/bin/bash

# AL-MUDIR Deployment Script for Local Machine
# This script automates the entire deployment process

set -e  # Exit on error

echo "================================================================================"
echo "🚀 AL-MUDIR - AUTOMATED DEPLOYMENT SCRIPT"
echo "================================================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Please install Git first."
    exit 1
fi

# Step 1: Navigate to project directory
echo -e "${BLUE}Step 1: Checking project directory...${NC}"
if [ ! -d "al-mudir" ]; then
    echo -e "${YELLOW}Project directory 'al-mudir' not found.${NC}"
    echo "Please clone the repository first:"
    echo "  git clone https://github.com/Montana254/al-mudir.git"
    exit 1
fi

cd al-mudir
echo -e "${GREEN}✓ Navigated to al-mudir directory${NC}"
echo ""

# Step 2: Check git status
echo -e "${BLUE}Step 2: Checking git status...${NC}"
if [ -z "$(git status --porcelain)" ]; then
    echo -e "${GREEN}✓ Working directory is clean${NC}"
else
    echo -e "${YELLOW}⚠ Warning: You have uncommitted changes${NC}"
    git status
fi
echo ""

# Step 3: Pull latest changes
echo -e "${BLUE}Step 3: Pulling latest changes from GitHub...${NC}"
git pull origin main
echo -e "${GREEN}✓ Pulled latest changes${NC}"
echo ""

# Step 4: Check GitHub authentication
echo -e "${BLUE}Step 4: Verifying GitHub authentication...${NC}"
if git ls-remote origin &> /dev/null; then
    echo -e "${GREEN}✓ GitHub authentication successful${NC}"
else
    echo -e "${YELLOW}⚠ GitHub authentication may have issues${NC}"
    echo "Try: git config --global user.email 'your-email@example.com'"
fi
echo ""

# Step 5: Deploy to GitHub (triggers Vercel)
echo -e "${BLUE}Step 5: Deploying to GitHub (this triggers Vercel auto-deploy)...${NC}"
echo "Pushing to GitHub main branch..."
git push origin main

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Successfully pushed to GitHub!${NC}"
else
    echo -e "${YELLOW}⚠ Push may have encountered authentication issues${NC}"
    echo "Try these alternatives:"
    echo "  1. Use GitHub CLI: gh auth login"
    echo "  2. Use SSH key: ssh-keygen and add to GitHub"
    echo "  3. Use Personal Access Token instead of password"
    exit 1
fi
echo ""

# Step 6: Verify deployment url
echo -e "${BLUE}Step 6: Deployment initiated!${NC}"
echo ""
echo -e "${GREEN}═════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ DEPLOYMENT SUCCESSFUL!${NC}"
echo -e "${GREEN}═════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Your website will be live in 30-60 seconds!"
echo ""
echo -e "${YELLOW}📍 Live Site URLs:${NC}"
echo "  Primary: https://al-mudir.vercel.app"
echo "  Backup: https://al-mudir.netlify.app (optional)"
echo "  GitHub Pages: https://montana254.github.io/al-mudir (optional)"
echo ""
echo -e "${YELLOW}📊 Monitor Deployment:${NC}"
echo "  Vercel Dashboard: https://vercel.com/dashboard"
echo "  GitHub Commits: https://github.com/Montana254/al-mudir/commits/main"
echo ""
echo -e "${YELLOW}🧪 Test Your Site:${NC}"
echo "  1. Wait 30-60 seconds for deployment"
echo "  2. Visit: https://al-mudir.vercel.app"
echo "  3. Test wallet connection"
echo "  4. Try crypto payment"
echo "  5. Check analytics tracking"
echo ""
echo -e "${GREEN}═════════════════════════════════════════════════════════════════${NC}"
echo ""
