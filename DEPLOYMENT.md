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

## Step 2.5: Enable Cross-Device Sync (Optional)

Skip this and the site stays a purely static deployment: the sync endpoints
answer `503`, the configuration panel keeps working, and every setup stays in
the browser that created it. Do it and a user can type their Sleeper username on
a second device and pull their league settings down.

Read the security note in [README.md](README.md#-cross-device-sync) first - this
is username-keyed sync, not a password-protected account.

### 2.5.1 Create the database

```bash
npx wrangler d1 create fantasy-profiles
```

Then uncomment the `[[d1_databases]]` block at the bottom of `wrangler.toml` and
paste in the `database_id` it printed.

That block ships commented out on purpose. A Pages build that reads a binding
for a database missing from the account fails outright, so leaving a placeholder
ID in there would make the repository undeployable for anyone who has not done
this step.

### 2.5.2 Create the table

```bash
npx wrangler d1 execute fantasy-profiles --remote --file=./schema.sql
```

### 2.5.3 Bind it to the Pages project

`wrangler.toml` covers manual `wrangler pages deploy` runs. The Git-integrated
deployment reads its bindings from the dashboard, so add it there too:

1. Pages project → **Settings** → **Functions** → **D1 database bindings**
2. Add a binding for both Production and Preview:
   - Variable name: `DB`
   - D1 database: `fantasy-profiles`
3. Redeploy for the binding to take effect

### 2.5.4 Rate-limit the endpoints

The sync endpoints have no authentication by design, so put a limit in front of
them: Cloudflare dashboard → **Security** → **WAF** → **Rate limiting rules**.

A reasonable starting rule: if `URI Path` starts with `/api/`, allow 30 requests
per minute per IP, then block for a minute. Normal use is a handful of requests
per session, so this is far above what a real user generates.

### 2.5.5 Check it

```bash
# No profile for a valid-looking ID -> 404 (endpoints are live)
curl -i "https://texasperfect.win/api/profile?userId=123456789012"

# 503 instead means the D1 binding is missing
```

### Running it locally

```bash
npm run serve
```

With the binding commented out this serves the site with sync unconfigured -
the endpoints answer 503, exactly as a fresh deployment does. To exercise sync
locally, uncomment the block and seed a local database:

```bash
npx wrangler d1 execute fantasy-profiles --local --file=./schema.sql
```

Local state lives in `.wrangler/` and is gitignored. `npm test` needs none of
this: it carries its own binding in `tests/wrangler.test.toml` and runs against
a throwaway database.

### A binding NOT to set in production

The Functions read an optional `SLEEPER_API_BASE` binding, which exists so the
test suite can point them at a stub instead of the real Sleeper. Leave it unset
everywhere except tests - unset means the real API, which is what every
deployment wants. Setting it in production would send account lookups somewhere
other than Sleeper.

## Step 3: Verify Deployment

## Step 2.6: Enable the Player Cache (Optional)

Sleeper asks that `/players/nfl` be called at most once a day. It is roughly
5 MB, and with nothing in front of it every visitor pays that download. This
puts a trimmed copy in D1 - the same database as step 2.5 - refreshed once a
day for everyone.

Skip it and the app fetches from Sleeper directly, exactly as it did before:
`/api/players` answering 503 is a handled case, not an error.

Step 2.5 already created the database, applied `schema.sql` (which carries the
player tables too) and bound `DB` to the Pages project. What remains is the
Worker that refreshes it, which is separate because Pages Functions cannot run
on a Cron Trigger.

### 2.6.1 Enable the Worker's binding

Uncomment the `[[d1_databases]]` block at the bottom of
`workers/player-sync/wrangler.toml` and paste in the same `database_id` used in
step 2.5. It ships commented out for the same reason that one does.

### 2.6.2 Deploy the Worker

```bash
npx wrangler deploy --config workers/player-sync/wrangler.toml
```

The cron is set in that file: `12 9 * * *`, daily at 09:12 UTC.

### 2.6.3 Set the manual-refresh secret

```bash
openssl rand -hex 32   # generate one, or use your own
npx wrangler secret put REFRESH_SECRET --config workers/player-sync/wrangler.toml
```

### 2.6.4 Populate it

The cron will not fire until its next scheduled time, so run the first refresh
by hand:

```bash
curl -X POST https://player-sync.<your-subdomain>.workers.dev/refresh \
  -H "Authorization: Bearer $REFRESH_SECRET"
```

```json
{"ok":true,"trigger":"manual","generation":1,"received":11400,"stored":2300,"durationMs":3100}
```

`received` is what Sleeper sent; `stored` is what survived filtering to
fantasy-relevant positions. Use the same call any time you want fresh injury
statuses without waiting for the cron.

### 2.6.5 Check it

```bash
curl -s -D - "https://texasperfect.win/api/players?limit=5" | head -20
```

`X-Players-Count`, `X-Players-Generation` and `X-Players-Refreshed-At` say which
generation you are being served and when it was built. A 503 means the binding
is missing; a 503 saying the cache is not populated means the Worker has not run
yet.


1. Visit https://texasperfect.win
2. Check that:
   - The app loads correctly
   - HTTPS is working (automatic with Cloudflare)
   - Service worker registers properly
   - Sleeper API calls work
   - Your league setup survives a refresh (it should never re-prompt for it)
3. Run `npm test` locally before deploying anything non-trivial - it covers the
   sync endpoints and the startup path end to end

## Security Features Included

✅ **SSL/TLS**: Automatic HTTPS with Cloudflare
✅ **Security Headers**: Configured in `_headers` file
✅ **CSP**: Content Security Policy for XSS protection
✅ **HSTS**: Enforced via Cloudflare
✅ **Minimal server-side code**: Two optional Functions - profile sync in
`functions/api/profile/`, which stores a fixed, range-checked list of league
settings and nothing else, and a read-only player-cache query in
`functions/api/players.js`. Leave both unconfigured and the site is fully static.
✅ **The player cache holds no user data**: It is a trimmed copy of Sleeper's
public player list, identical for every visitor
✅ **Manual refresh is authenticated**: `REFRESH_SECRET` is a Worker secret,
compared in constant time

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