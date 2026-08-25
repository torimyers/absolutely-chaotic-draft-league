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

Put the `database_id` it prints into the `PROFILES_DB` block in `wrangler.toml`.

**That file is where bindings live, not the dashboard.** With a Wrangler
configuration file present, Cloudflare treats it as the source of truth for a
Pages project: the dashboard shows the same fields read-only, and a binding
added there does not survive. A binding commented out here is a binding the
project does not have.

The flip side is that a build naming a database missing from the account fails
outright, which is what broke the Pages check on #7. If you are setting this
repository up in a different Cloudflare account, replace both ids with your
own.

### 2.5.2 Create the table

```bash
npx wrangler d1 execute fantasy-profiles --remote --file=./schema.sql
```

### 2.5.3 Redeploy

Bindings attach at deploy time, so the deployment currently serving your site
does not pick up a change to `wrangler.toml` until a new one is built. Push the
change, or use **Deployments → latest → Retry deployment**.

You can confirm what the project actually has under **Settings → Functions →
D1 database bindings**. Those fields are read-only and mirror `wrangler.toml`;
if `PROFILES_DB` is not listed there after a deploy, the file is what to fix.

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

## Step 2.6: Enable the Player Cache (Optional)

Sleeper asks that `/players/nfl` be called at most once a day. It is roughly
5 MB, and with nothing in front of it every visitor pays that download. This
puts a trimmed copy in D1, refreshed once a day for everyone.

Skip it and the app fetches from Sleeper directly, exactly as it did before:
`/api/players` answering 503 is a handled case, not an error.

This is a **second database**, separate from the sync one in step 2.5. The two
have nothing in common and very different write patterns - profiles takes a row
at a time from real users, this is rewritten wholesale every day - and keeping
them apart means the refresh job never holds a connection to user data.

### 2.6.1 Create the database

```bash
npx wrangler d1 create fantasy-players
npx wrangler d1 execute fantasy-players --remote --file=./schema-players.sql
```

Put the `database_id` it prints into the `PLAYERS_DB` block in **both**
`wrangler.toml` and `workers/player-sync/wrangler.toml`.

Two files because they are two deployments: the Pages Function reads this
database, the Worker writes it, and a Worker deploy does not read the Pages
config. Keeping them in step is the one piece of duplication in this setup.

### 2.6.2 Redeploy the site

Same as 2.5.3 - the binding only reaches the site on a new deployment.

### 2.6.3 Deploy the Worker

```bash
npx wrangler deploy --config workers/player-sync/wrangler.toml
```

The cron is set in that file: `12 9 * * *`, daily at 09:12 UTC.

### 2.6.4 Set the manual-refresh secret

```bash
openssl rand -hex 32   # generate one, or use your own
npx wrangler secret put REFRESH_SECRET --config workers/player-sync/wrangler.toml
```

### 2.6.5 Populate it

The cron will not fire until its next scheduled time, so run the first refresh
by hand:

```bash
curl -X POST https://player-sync.<your-subdomain>.workers.dev/refresh \
  -H "Authorization: Bearer $REFRESH_SECRET"
```

```json
{"ok":true,"trigger":"manual","generation":1,"received":11400,"stored":4400,"durationMs":3100}
```

`received` is what Sleeper sent; `stored` is what survived filtering to the
positions this app can roster - QB, RB, WR, TE, K, DEF, and the fullbacks that
normalise to RB. Sleeper's list also carries every individual defender, for the
IDP leagues it supports and this app does not; those are a little over half of
it and are dropped. Use the same call any time you want fresh injury statuses
without waiting for the cron.

### 2.6.6 Check it

```bash
curl -s -D - "https://texasperfect.win/api/players?limit=5" | head -20
```

`X-Players-Count`, `X-Players-Generation` and `X-Players-Refreshed-At` say which
generation you are being served and when it was built. A 503 means the binding
is missing; a 503 saying the cache is not populated means the Worker has not run
yet.

### 2.6.7 If something is not working

Check what each database actually contains - a schema applied to the wrong one
is the easiest mistake to make here, and it looks exactly like a missing
binding:

```bash
npx wrangler d1 execute fantasy-profiles --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
npx wrangler d1 execute fantasy-players --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

`fantasy-profiles` should list `profiles`. `fantasy-players` should list
`players` and `player_cache_meta`. Anything missing means that schema file has
not been applied to that database:

```bash
npx wrangler d1 execute fantasy-profiles --remote --file=./schema.sql
npx wrangler d1 execute fantasy-players  --remote --file=./schema-players.sql
```

Both files are `CREATE TABLE IF NOT EXISTS`, so re-running one is safe and will
not touch rows that are already there.

If an endpoint answers 503 instead, read the message - the two cases are
different and the response says which:

| Response | Meaning |
|---|---|
| `Player database is not bound to this deployment` | no `PLAYERS_DB` binding reached the running deployment |
| `Player cache has not been populated yet` | binding is fine; the sync Worker has not completed a run |
| `Profile sync is not configured on this deployment` | no `PROFILES_DB` binding reached the running deployment |
| `Schedule database is not bound to this deployment` | no `SCHEDULE_DB` binding reached the running deployment |
| `Schedule cache has not been populated yet` | binding is fine; the schedule Worker has not completed a run |
| `Schedule for YYYY is incomplete` (409) | the cached season has missing weeks, so byes are refused rather than guessed |

For the binding cases, check `wrangler.toml` first and redeploy - not the
dashboard. The dashboard mirrors that file and cannot be edited independently,
so a binding missing there is a binding missing from the file.


## Step 2.7: Enable the Schedule Cache (Optional)

Every visitor was fetching the same sixteen fixtures from ESPN, per week, for a
season fixed months in advance. This caches it, and derives each team's bye week
from it - replacing a table that was written into the source by hand and still
said 2024 two seasons later.

Skip it and the app fetches ESPN directly, as before. The one thing that changes
without it: lineup advice stops mentioning byes, because the alternative is a
hand-maintained list that goes wrong every August. A missed bye costs a note; a
wrong one benches a player who is playing.

A **third database**, separate from the other two: different upstream (ESPN, not
Sleeper), different cadence (weekly, not daily), and a `games` table inside
something called `fantasy-players` is the kind of misnaming that rots.

### 2.7.1 Create the database

```bash
npx wrangler d1 create fantasy-schedule
npx wrangler d1 execute fantasy-schedule --remote --file=./schema-schedule.sql
```

Put the `database_id` into **both** `wrangler.toml` and
`workers/schedule-sync/wrangler.toml`, uncommenting the `SCHEDULE_DB` block in
each. Two files because they are two deployments: the Pages Functions read this
database, the Worker writes it.

The binding resolves by `database_id`, not `database_name` - a correct name with
a wrong id is still no binding, and a Worker deployed that way starts fine and
fails at the first refresh with `No D1 binding named SCHEDULE_DB`. The
`wrangler deploy` output lists what actually got bound; check it there.

### 2.7.2 Redeploy the site

Bindings attach at deploy time. **Deployments -> latest -> Retry deployment.**

### 2.7.3 Deploy the Worker

```bash
npx wrangler deploy --config workers/schedule-sync/wrangler.toml
npx wrangler secret put REFRESH_SECRET --config workers/schedule-sync/wrangler.toml
```

Its own secret, separate from player-sync's. The cron is `47 8 * * 2` - Tuesdays
at 08:47 UTC, after Monday night football and any flex-scheduling announcements.

### 2.7.4 Populate it

```bash
curl -X POST https://schedule-sync.<your-subdomain>.workers.dev/refresh \
  -H "Authorization: Bearer $REFRESH_SECRET"
```

```json
{"ok":true,"trigger":"manual","season":2026,"generation":1,"weeks":18,"stored":272}
```

It fetches all 18 weeks and refuses to publish a season with any week missing -
a bye is a week with no game, so a season with holes would derive byes for teams
that are merely unaccounted for.

Add `?season=2027` to load a different season. Before about May the coming season
is not published and the refresh fails saying which weeks came back empty; that
is correct, not a bug.

### 2.7.5 Check it

```bash
curl -s "https://texasperfect.win/api/schedule/byes?season=2026"
curl -s -D - "https://texasperfect.win/api/schedule?season=2026&week=1" | head -20
```

The byes endpoint returns `{"BUF":12,"MIA":6,...}`, one entry per team. A 409
means the cached season has gaps and it is refusing to guess; the response names
the missing weeks.

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
✅ **Minimal server-side code**: Two Functions - profile sync in
`functions/api/profile/`, which stores a fixed, range-checked list of league
settings and nothing else, and a read-only player-cache query in
`functions/api/players.js`. Remove their bindings and both answer 503 while the
site carries on.
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