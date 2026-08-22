# 🏈 Fantasy Football Command Center

An AI-powered fantasy football draft assistant with real-time Sleeper integration and educational insights. Built to help you dominate your draft while learning the "why" behind every decision.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Sleeper API](https://img.shields.io/badge/Sleeper-API-orange.svg)
![Cloudflare](https://img.shields.io/badge/Hosted%20on-Cloudflare-orange.svg)

## 🚀 Features

### 🔥 Live Draft Tracking
- **Real-time pick monitoring** - Updates every 3 seconds during your draft
- **AI-powered pick analysis** - Grades every pick (Reach/Good/Great Value)
- **Position scarcity tracking** - Know when positions are running thin
- **Educational insights** - Learn why each pick matters

### 🚨 Panic Mode
- **Automatic activation** when it's your turn
- **Top 3 emergency recommendations** with confidence scores
- **Visual and audio alerts** so you never miss your pick
- **One-click suggestions** based on best available players

### 📚 Fantasy Academy
- **25+ educational modules** covering fantasy concepts
- **Interactive learning** with real examples
- **Progress tracking** to measure your improvement
- **Beginner to expert** content progression

### 🤖 AI Insights
- **Hot/cold streak analysis** with performance trends and a full game-by-game breakdown
- **Weather impact analysis** - forecast conditions at kickoff for every game, and what they do to each position
- **Season predictions** - playoff and championship odds for every team from 5,000 simulated seasons, plus breakout candidates
- **Matchup advantages** with win probability
- **Trade recommendations** based on team needs

### 🔄 In-Season Management
- **Waiver wire pickups** ranked from league-wide add trends and your roster needs
- **Drop candidate analysis** scoring who you can safely cut, and why
- **Lineup optimization** and weekly matchup analysis
- **Performance analytics** with CSV export

### 🔗 Sleeper Integration
- **Auto-import league settings** with one click — including scoring format and
  roster format, read separately from your league's own settings
- **Team auto-detection** using your username
- **Live roster syncing** during the season
- **Trade and waiver tracking** across your league

### 📐 Where the numbers come from
Every rating, ranking and trend on the site is computed from real Sleeper data —
season projections before Week 1, actual scoring once games are played — in your
league's scoring format. Nothing is invented to fill a gap:

- **Player value** is production measured against replacement level at that
  position for your league size and roster format, so the same roster scores the
  same every time.
- **Performance analytics** reads real weekly game logs. Before Week 1 there are
  none, so it says so rather than showing numbers.
- **Team context** in waiver and trade notes is each offense's real fantasy
  output, ranked league-wide.
- **Market demand** in trade values is Sleeper's own add/drop traffic.

Where data genuinely isn't available, a surface reports "not rated" or lowers its
stated confidence. Sample data is only shown behind an explicit "See Sample
Analysis" button, and is banner-labelled on the page.

## 🛠️ Tech Stack

- **Tests**: Playwright driving the real app under `wrangler pages dev` (`npm test`)
- **Frontend**: Vanilla JavaScript with modern ES6+
- **Styling**: Custom CSS with CSS Grid and Flexbox
- **APIs**: Sleeper (league, rosters, players), Open-Meteo (weather), ESPN (NFL schedule) - all keyless, no signup required
- **Hosting**: Cloudflare Pages
- **Backend** (both optional): Cloudflare Pages Functions + D1. One database, two uses - cross-device league settings, and a cached copy of Sleeper's player list refreshed daily by a Worker on a Cron Trigger
- **PWA**: Installable with offline support
- **Caching**: Three layers for the player database - the D1 table, IndexedDB in the browser, and an in-memory map per page

## 📦 Quick Start

### Option 1: Use the Live App
Visit [https://texasperfect.win](https://texasperfect.win) to use the hosted version.

### Option 2: Self-Host

1. **Clone the repository**
   ```bash
   git clone https://github.com/torimyers/absolutely-chaotic-draft-league.git
   cd absolutely-chaotic-draft-league
   ```

2. **No build process needed!** This is a static site - `npm install` is only
   needed to run the tests. Simply:
   - Open `index.html` in a browser, or
   - Use a local server: `python -m http.server 8000`
   - Visit `http://localhost:8000`

3. **Configure your league**
   - Click the ⚙️ button
   - Enter your Sleeper League ID
   - Enter your Sleeper username (optional for auto-team detection)
   - Click "Auto-Fill from Sleeper"

## 🎮 How to Use

### Pre-Draft Setup
1. **Configure Your League**
   - Enter your Sleeper League ID
   - Add your username for automatic team detection
   - Click "Auto-Fill" to import all league settings

2. **Test Draft Features**
   - Navigate to "Live Draft" page
   - Click "Test Panic Mode" to see emergency recommendations
   - Review the AI analysis explanations

### During Your Draft
1. **Start Draft Tracking**
   - Go to "Live Draft" page
   - Click "Start Draft Tracking"
   - Keep the tab open during your draft

2. **When It's Your Turn**
   - Panic Mode activates automatically
   - Review the top 3 recommendations
   - Each suggestion includes confidence score and reasoning
   - Click to select or make your own choice

3. **Learn As You Draft**
   - Every pick includes educational insights
   - Understand concepts like value picks, reaches, and position scarcity
   - Build knowledge for future drafts

## 🔧 Configuration

### Environment Variables
Configure these in the `index.html` meta tags or via the UI:

```html
<meta name="SLEEPER_LEAGUE_ID" content="your-league-id">
<meta name="FANTASY_LEAGUE_NAME" content="Your League Name">
<meta name="FANTASY_TEAM_NAME" content="Your Team Name">
```

### Customization
- **Theme Colors**: Modify CSS variables in `/css/core/variables.css`
- **Draft Logic**: Adjust AI weights in `/js/features/draft-tracker.js`
- **Learning Content**: Add modules in `/js/core/learning-manager.js`

## 📱 Progressive Web App

The app is fully installable on mobile devices:
1. Visit the site on your phone
2. Click "Add to Home Screen"
3. Use it like a native app with offline support

## 🔒 Privacy & Security

- **Local by default** - With sync switched off (the default) nothing leaves your
  browser, and the app is a purely static site
- **Optional cross-device sync** - If you turn it on, your league settings only
  are copied to a small database on the site's own Cloudflare deployment. See
  [Cross-device sync](#-cross-device-sync) for exactly what is stored and the
  security trade-off it makes
- **Your draft plan is never uploaded** - Sync carries league settings only. The
  draft plan and learning progress stay in the browser; use Save Backup to move
  those
- **The player cache holds nothing about you** - The site keeps a server-side
  copy of Sleeper's public NFL player list so every visitor is not re-downloading
  5 MB of it. It is the same list for everyone and contains no user data. Your
  own copy of it lives in IndexedDB, which "clear site data" removes
- **Secure API calls** - Direct HTTPS to Sleeper, Open-Meteo and ESPN. No credentials or personal data are sent to any of them; requests carry only a league ID, a week number or a pair of coordinates
- **No tracking** - No analytics or user tracking
- **Open source** - Audit the code yourself

## 🔄 Cross-device sync

Setting your league up on a laptop and then again on a phone is a chore, so the
configuration panel can link your setup to your Sleeper account and carry it
between devices.

**How to use it:** open ⚙️ → *Sync Across Devices* → type your Sleeper username →
*Turn On Sync*. On your other device, do the same and it pulls the setup down.

**Read this before turning it on.** This is deliberately not a password-protected
account:

- Anyone who knows your Sleeper username can read or overwrite the synced setup.
- It is defensible only because of *what* is stored: league ID, team name, league
  size, scoring and roster format, draft slot, theme - all of which your league
  mates can already see on Sleeper.
- Your draft plan and learning progress are **never** uploaded.
- Profiles are keyed on Sleeper's stable `user_id`, resolved server-side, so a
  renamed or recycled username cannot hand your profile to someone else.
- The server stores only a fixed list of known settings, each range-checked, so
  the endpoint cannot be used as a general-purpose data store.

**With sync off, none of this applies** - the app behaves exactly as it always
has, everything stays in `localStorage`, and the sync endpoints are never called.

Self-hosters get the local-only behaviour for free: without a D1 binding the sync
endpoints answer `503` and the app carries on using local storage. See
[DEPLOYMENT.md](DEPLOYMENT.md) to enable it.

## 🧪 Tests

End-to-end tests drive the real app in a headless browser, served by
`wrangler pages dev` so the Pages Functions, the D1 binding and the routing
rules all take part.

```bash
npm install
npx playwright install chromium   # one-off
npm test
```

Nothing reaches the network. Sleeper, ESPN and Open-Meteo are intercepted in the
browser, and the Functions' own Sleeper calls go to a stub over the test-only
`SLEEPER_API_BASE` binding, so a run behaves the same on a laptop, in CI and
offline. D1 state goes to a throwaway directory and is deleted afterwards.

```bash
npm test -- sync          # only suites matching "sync"
npm test -- --headed      # watch it happen in a real window
npm test -- --verbose     # include wrangler's own output
```

If Chromium is already on the machine, `CHROMIUM_EXECUTABLE=/path/to/chrome`
skips the Playwright download.

| Suite | What it pins down |
|---|---|
| `persistence` | The league setup survives a refresh, and a returning user is never re-prompted |
| `profile-api` | The sync endpoints: account verification, the field whitelist, write ordering, malformed input, routing |
| `startup-resilience` | One feature failing to start cannot take the event handling or the other features with it |
| `api-shapes` | A malformed Sleeper response degrades a feature instead of breaking it |

Each suite is written against a bug that actually shipped, and each one fails if
you revert the fix for it.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Run `npm test` and make sure it is green
4. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
5. Push to the branch (`git push origin feature/AmazingFeature`)
6. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Sleeper](https://sleeper.app) for their fantastic API
- [Open-Meteo](https://open-meteo.com) for free, keyless weather forecasts
- ESPN for their public NFL scoreboard endpoint
- The fantasy football community for inspiration
- All contributors who help improve this tool

## 🐛 Known Issues

- Panic Mode audio alerts require user interaction to enable (browser limitation)
- Some older browsers may not support all features
- Draft tracker requires stable internet connection
- Weather forecasts only extend ~16 days ahead, so late-season games show conditions closer to kickoff
- Playoff odds assume each team's scoring average holds; early in the season the sample is small and the numbers move a lot week to week

## 🚧 Roadmap

- [x] Weather impact analysis for game day
- [x] Trade analyzer with fair value calculations
- [x] Waiver wire priority predictions
- [x] Playoff and championship odds
- [x] Cross-device sync of league settings
- [ ] Dynasty league support
- [ ] Keeper league tools
- [ ] Mobile app (React Native)

## 💬 Support

- **Issues**: [GitHub Issues](https://github.com/torimyers/absolutely-chaotic-draft-league/issues)
- **Discussions**: [GitHub Discussions](https://github.com/torimyers/absolutely-chaotic-draft-league/discussions)

---

**Made with ❤️ for the fantasy football community**

*Not affiliated with Sleeper, Open-Meteo or ESPN. This is an independent project that uses their public APIs.*