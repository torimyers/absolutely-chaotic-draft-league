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

### 2.5.4 Rate limiting (already done)

The sync endpoints have no authentication by design, so they are rate limited
per IP. This is enforced in the Functions themselves, against the same D1
database, so **it needs no plan tier, no WAF rule and no extra setup** - creating
the table in 2.5.2 is all it takes.

| Endpoint | Limit per IP |
|---|---|
| `POST /api/profile/link` | 10 / minute |
| `PUT /api/profile` | 20 / minute |
| `GET /api/profile` | 60 / minute |

Linking is tightest because it is the only path that makes your deployment call
Sleeper; leaving it open would turn the site into a free proxy for hammering
their API. Over-limit requests get `429` and a `Retry-After`. A real session uses
a handful of requests, so these are far above normal use.

Details and the reasoning are in `lib/rate-limit.js`. To change a limit, edit
`LIMITS` there.

**Upgrading an existing deployment:** re-run 2.5.2. Every statement in
`schema.sql` is `IF NOT EXISTS`, so it only adds the counter table. Until you do,
the limiter fails open - sync keeps working, but unthrottled - and logs a warning
on each request.

If you are on a plan that includes **WAF → Rate limiting rules**, adding a rule
on `/api/*` there as well is worth doing: it blocks abuse at the edge before it
reaches your Functions or your D1 write quota. It is a bonus, not a requirement.

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
✅ **Minimal server-side code**: The only server code is the optional profile
sync in `functions/api/profile/`, which stores a fixed, range-checked list of
league settings and nothing else. Leave sync unconfigured and the site is fully
static.

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