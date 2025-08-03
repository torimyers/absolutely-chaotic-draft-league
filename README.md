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
- **Hot/cold streak analysis** with performance trends
- **Weather impact predictions** (coming soon)
- **Matchup advantages** with win probability
- **Trade recommendations** based on team needs

### 🔗 Sleeper Integration
- **Auto-import league settings** with one click
- **Team auto-detection** using your username
- **Live roster syncing** during the season
- **Trade and waiver tracking** across your league

## 🛠️ Tech Stack

- **Frontend**: Vanilla JavaScript with modern ES6+
- **Styling**: Custom CSS with CSS Grid and Flexbox
- **API**: Sleeper Fantasy Football API
- **Hosting**: Cloudflare Pages
- **PWA**: Installable with offline support

## 📦 Quick Start

### Option 1: Use the Live App
Visit [https://texasperfect.win](https://texasperfect.win) to use the hosted version.

### Option 2: Self-Host

1. **Clone the repository**
   ```bash
   git clone https://github.com/torimyers/absolutely-chaotic-draft-league.git
   cd absolutely-chaotic-draft-league
   ```

2. **No build process needed!** This is a static site. Simply:
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

- **No server-side storage** - All data stays in your browser
- **Secure API calls** - Direct to Sleeper's HTTPS endpoints
- **No tracking** - No analytics or user tracking
- **Open source** - Audit the code yourself

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Sleeper](https://sleeper.app) for their fantastic API
- The fantasy football community for inspiration
- All contributors who help improve this tool

## 🐛 Known Issues

- Panic Mode audio alerts require user interaction to enable (browser limitation)
- Some older browsers may not support all features
- Draft tracker requires stable internet connection

## 🚧 Roadmap

- [ ] Weather impact analysis for game day
- [ ] Trade analyzer with fair value calculations
- [ ] Waiver wire priority predictions
- [ ] Dynasty league support
- [ ] Keeper league tools
- [ ] Mobile app (React Native)

## 💬 Support

- **Issues**: [GitHub Issues](https://github.com/torimyers/absolutely-chaotic-draft-league/issues)
- **Discussions**: [GitHub Discussions](https://github.com/torimyers/absolutely-chaotic-draft-league/discussions)

---

**Made with ❤️ for the fantasy football community**

*Not affiliated with Sleeper. This is an independent project that uses their public API.*