# Deployment Guide for texasperfect.win

This guide will help you deploy your Fantasy Football Command Center to texasperfect.win using Cloudflare Pages.

## Prerequisites

1. GitHub account with this repository
2. Cloudflare account
3. Domain (texasperfect.win) added to Cloudflare

## Step 1: Cloudflare Setup

### 1.1 Add Your Domain to Cloudflare (if not already done)

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click "Add a Site"
3. Enter `texasperfect.win`
4. Select the Free plan
5. Update your domain's nameservers to Cloudflare's (provided during setup)

### 1.2 Create a Cloudflare Pages Project

1. In Cloudflare Dashboard, go to "Pages" (left sidebar)
2. Click "Create a project"
3. Connect to Git provider (GitHub)
4. Select your repository: `absolutely-chaotic-draft-league`
5. Configure build settings:
   - Framework preset: None
   - Build command: (leave empty - we're deploying static files)
   - Build output directory: `/`
   - Root directory: `/`
6. Click "Save and Deploy"

### 1.3 Set Custom Domain

1. After first deployment, go to your Pages project
2. Click "Custom domains" tab
3. Click "Set up a custom domain"
4. Enter `texasperfect.win`
5. Cloudflare will automatically configure DNS

## Step 2: GitHub Actions Setup (Optional - for automated deployments)

### 2.1 Get Cloudflare API Token

1. Go to Cloudflare Dashboard → My Profile → API Tokens
2. Click "Create Token"
3. Use "Custom token" template with these permissions:
   - Account: Cloudflare Pages:Edit
   - Zone: Zone:Read
4. Copy the token

### 2.2 Get Your Account ID

1. Go to any domain in your Cloudflare account
2. Right sidebar shows "Account ID"
3. Copy this ID

### 2.3 Add Secrets to GitHub

1. Go to your GitHub repository
2. Settings → Secrets and variables → Actions
3. Add these secrets:
   - `CLOUDFLARE_API_TOKEN`: Your API token from step 2.1
   - `CLOUDFLARE_ACCOUNT_ID`: Your account ID from step 2.2

## Step 3: Deploy

### Option A: Automatic Deployment (Recommended)
- Simply push to the `main` branch
- Cloudflare Pages will automatically deploy within 1-2 minutes

### Option B: Manual Deployment
1. Go to Cloudflare Pages dashboard
2. Click on your project
3. Click "Create deployment"
4. Upload your files or trigger from GitHub

## Step 4: Verify Deployment

1. Visit https://texasperfect.win
2. Check that:
   - The app loads correctly
   - HTTPS is working (automatic with Cloudflare)
   - Service worker registers properly
   - Sleeper API calls work

## Security Features Included

✅ **SSL/TLS**: Automatic HTTPS with Cloudflare
✅ **Security Headers**: Configured in `_headers` file
✅ **CSP**: Content Security Policy for XSS protection
✅ **HSTS**: Enforced via Cloudflare
✅ **No server-side code**: Static site = reduced attack surface

## Performance Optimizations

The deployment includes:
- Cloudflare CDN for global distribution
- Brotli compression
- HTTP/3 support
- Aggressive caching for static assets
- Service Worker for offline support

## Monitoring

1. **Cloudflare Analytics**: View in Pages project dashboard
2. **Web Analytics**: Enable in Cloudflare dashboard (free)
3. **Error Tracking**: Check browser console for any issues

## Troubleshooting

### Domain Not Working
- Ensure nameservers are pointed to Cloudflare
- Wait 24-48 hours for DNS propagation
- Check DNS settings in Cloudflare dashboard

### App Not Loading
- Clear browser cache
- Check browser console for errors
- Verify all files are in repository

### API Issues
- Sleeper API is called from browser (no CORS issues)
- Check network tab for failed requests

## Maintenance

### Updating Content
1. Make changes locally
2. Commit and push to GitHub
3. Cloudflare automatically deploys

### Updating Configuration
- Edit environment variables in index.html meta tags
- No server restart needed

## Support

- Cloudflare Status: https://www.cloudflarestatus.com/
- Cloudflare Docs: https://developers.cloudflare.com/pages/
- Sleeper API: https://docs.sleeper.app/

---

Your fantasy football app is now live at https://texasperfect.win! 🎉