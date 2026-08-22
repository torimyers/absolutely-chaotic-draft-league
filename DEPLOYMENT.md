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

## Step 2: Deploy

### Option A: Automatic Deployment (Recommended)
- Simply push to the `main` branch
- Cloudflare Pages will automatically deploy within 1-2 minutes

Deployment is handled by Cloudflare Pages' own Git integration, configured in
step 1.2. No GitHub Actions workflow, API token or repository secret is needed -
Cloudflare builds straight from the connected repository.

### Option B: Manual Deployment
1. Go to Cloudflare Pages dashboard
2. Click on your project
3. Click "Create deployment"
4. Upload your files or trigger from GitHub

## Step 3: Set Up the Player Cache (D1)

Sleeper asks that `/players/nfl` be called at most once a day. It is roughly
5 MB, and without a cache in front of it every visitor pays that download.
This step puts a trimmed copy in D1, refreshed once a day for everyone.

It is optional. Skip it and the app fetches from Sleeper directly, exactly as
it did before - `/api/players` failing is a normal, handled case.

### 3.1 Create the database

```bash
npx wrangler d1 create fantasy-players
```

Copy the `database_id` it prints into `workers/player-sync/wrangler.toml`,
replacing `REPLACE_WITH_D1_DATABASE_ID`.

### 3.2 Create the tables

```bash
npx wrangler d1 execute fantasy-players --remote --file=schema.sql
```

### 3.3 Bind the database to Pages

In the Pages project: **Settings → Bindings → D1 database bindings**. Add a
binding named `DB` pointing at `fantasy-players`. Add it to both Production and
Preview, then redeploy so the binding takes effect.

The variable name must be exactly `DB` - that is what `functions/api/players.js`
reads.

### 3.4 Deploy the refresh Worker

Pages Functions cannot run on a schedule, so the daily refresh is a separate
Worker sharing the same database.

```bash
npx wrangler deploy --config workers/player-sync/wrangler.toml
```

Its cron is set in that file (`12 9 * * *`, daily at 09:12 UTC).

### 3.5 Set the manual-refresh secret

```bash
# Generate one, or use your own
openssl rand -hex 32

npx wrangler secret put REFRESH_SECRET --config workers/player-sync/wrangler.toml
```

### 3.6 Populate it

The cron will not fire until its next scheduled time, so run the first refresh
by hand:

```bash
curl -X POST https://player-sync.<your-subdomain>.workers.dev/refresh \
  -H "Authorization: Bearer $REFRESH_SECRET"
```

Expect something like:

```json
{"ok":true,"trigger":"manual","generation":1,"received":11400,"stored":2300,"durationMs":3100}
```

`received` is what Sleeper sent; `stored` is what survived filtering to
fantasy-relevant positions. Use the same call any time you want fresh injury
statuses without waiting for the cron.

### 3.7 Check it

```bash
curl -s -D - https://texasperfect.win/api/players?limit=5 | head -20
```

The `X-Players-Count`, `X-Players-Generation` and `X-Players-Refreshed-At`
response headers tell you which generation you are being served and when it
was built.

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
✅ **Minimal server-side code**: Two small Functions - a read-only D1 query and a scheduled refresh. No user data passes through either
✅ **Manual refresh is authenticated**: `REFRESH_SECRET` is a Worker secret, compared in constant time

## Performance Optimizations

The deployment includes:
- A D1-backed player cache: Sleeper's ~5 MB player list is fetched once a day and served trimmed, roughly 11x smaller in full and 83x smaller for a draft board's top 300
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

### Refreshing player data

The cron handles this daily. To force it - after a wave of injury news, say:

```bash
curl -X POST https://player-sync.<your-subdomain>.workers.dev/refresh \
  -H "Authorization: Bearer $REFRESH_SECRET"
```

A refresh writes a whole new generation before publishing it, so readers stay
on the previous one until the new copy is complete. A failed run leaves the old
data in place rather than a half-written table.

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