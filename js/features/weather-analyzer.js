/**
 * Weather Impact Analyzer
 *
 * Answers a question the rest of the app cannot: what will the conditions be at
 * each of this week's NFL games, and which of your players does that hurt?
 *
 * Two keyless public APIs are used, neither of which needs a signup:
 *   - ESPN's scoreboard endpoint, for the week's fixtures and venues. Sleeper
 *     exposes fantasy matchups but not the NFL schedule, and without the schedule
 *     an away game would be reported with the player's home stadium weather.
 *   - Open-Meteo, for the forecast at the venue's coordinates.
 *
 * If the schedule call fails the analyzer degrades to each team's home venue and
 * says so, rather than silently reporting the wrong stadium.
 */

class WeatherAnalyzer {
    constructor(configManager) {
        this.configManager = configManager;
        this.sleeperAPI = new SleeperAPI();
        this.currentWeek = null;
        this.lastAnalysis = null;

        this.SCHEDULE_API = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
        this.FORECAST_API = 'https://api.open-meteo.com/v1/forecast';

        // Open-Meteo publishes roughly 16 days ahead; past that there is nothing to show.
        this.FORECAST_HORIZON_DAYS = 16;

        console.log('🌦️ WeatherAnalyzer: Initializing weather impact analysis...');
    }

    async initialize() {
        await this.loadCurrentWeek();
        console.log('✅ WeatherAnalyzer: Initialization complete');
    }

    async loadCurrentWeek() {
        try {
            const nflState = await this.sleeperAPI.fetchAPI('/state/nfl');
            this.currentWeek = nflState.week || 1;
            this.seasonYear = nflState.season || new Date().getFullYear();
        } catch (error) {
            console.error('❌ Error loading current week:', error);
            this.currentWeek = 1;
            this.seasonYear = new Date().getFullYear();
        }
    }

    /**
     * Home venue for every NFL team, with the roof type that decides whether
     * weather can reach the field at all.
     * roof: 'open' | 'dome' | 'retractable'
     */
    getStadiums() {
        return {
            ARI: { name: 'State Farm Stadium', lat: 33.5276, lon: -112.2626, roof: 'retractable' },
            ATL: { name: 'Mercedes-Benz Stadium', lat: 33.7554, lon: -84.4008, roof: 'retractable' },
            BAL: { name: 'M&T Bank Stadium', lat: 39.2780, lon: -76.6227, roof: 'open' },
            BUF: { name: 'Highmark Stadium', lat: 42.7738, lon: -78.7870, roof: 'open' },
            CAR: { name: 'Bank of America Stadium', lat: 35.2258, lon: -80.8528, roof: 'open' },
            CHI: { name: 'Soldier Field', lat: 41.8623, lon: -87.6167, roof: 'open' },
            CIN: { name: 'Paycor Stadium', lat: 39.0955, lon: -84.5161, roof: 'open' },
            CLE: { name: 'Huntington Bank Field', lat: 41.5061, lon: -81.6995, roof: 'open' },
            DAL: { name: 'AT&T Stadium', lat: 32.7473, lon: -97.0945, roof: 'retractable' },
            DEN: { name: 'Empower Field at Mile High', lat: 39.7439, lon: -105.0201, roof: 'open' },
            DET: { name: 'Ford Field', lat: 42.3400, lon: -83.0456, roof: 'dome' },
            GB:  { name: 'Lambeau Field', lat: 44.5013, lon: -88.0622, roof: 'open' },
            HOU: { name: 'NRG Stadium', lat: 29.6847, lon: -95.4107, roof: 'retractable' },
            IND: { name: 'Lucas Oil Stadium', lat: 39.7601, lon: -86.1639, roof: 'retractable' },
            JAX: { name: 'EverBank Stadium', lat: 30.3239, lon: -81.6373, roof: 'open' },
            KC:  { name: 'GEHA Field at Arrowhead Stadium', lat: 39.0489, lon: -94.4839, roof: 'open' },
            LAC: { name: 'SoFi Stadium', lat: 33.9535, lon: -118.3392, roof: 'dome' },
            LAR: { name: 'SoFi Stadium', lat: 33.9535, lon: -118.3392, roof: 'dome' },
            LV:  { name: 'Allegiant Stadium', lat: 36.0909, lon: -115.1833, roof: 'dome' },
            MIA: { name: 'Hard Rock Stadium', lat: 25.9580, lon: -80.2389, roof: 'open' },
            MIN: { name: 'U.S. Bank Stadium', lat: 44.9737, lon: -93.2577, roof: 'dome' },
            NE:  { name: 'Gillette Stadium', lat: 42.0909, lon: -71.2643, roof: 'open' },
            NO:  { name: 'Caesars Superdome', lat: 29.9511, lon: -90.0812, roof: 'dome' },
            NYG: { name: 'MetLife Stadium', lat: 40.8135, lon: -74.0745, roof: 'open' },
            NYJ: { name: 'MetLife Stadium', lat: 40.8135, lon: -74.0745, roof: 'open' },
            PHI: { name: 'Lincoln Financial Field', lat: 39.9008, lon: -75.1675, roof: 'open' },
            PIT: { name: 'Acrisure Stadium', lat: 40.4468, lon: -80.0158, roof: 'open' },
            SEA: { name: 'Lumen Field', lat: 47.5952, lon: -122.3316, roof: 'open' },
            SF:  { name: "Levi's Stadium", lat: 37.4033, lon: -121.9694, roof: 'open' },
            TB:  { name: 'Raymond James Stadium', lat: 27.9759, lon: -82.5033, roof: 'open' },
            TEN: { name: 'Nissan Stadium', lat: 36.1665, lon: -86.7713, roof: 'open' },
            WAS: { name: 'Northwest Stadium', lat: 38.9077, lon: -76.8645, roof: 'open' }
        };
    }

    /** Venues used for international and neutral-site fixtures. */
    getNeutralVenues() {
        return {
            'Tottenham Hotspur Stadium': { lat: 51.6043, lon: -0.0665, roof: 'open' },
            'Wembley Stadium': { lat: 51.5560, lon: -0.2795, roof: 'retractable' },
            'Allianz Arena': { lat: 48.2188, lon: 11.6247, roof: 'open' },
            'Deutsche Bank Park': { lat: 50.0685, lon: 8.6455, roof: 'retractable' },
            'Estadio Azteca': { lat: 19.3029, lon: -99.1505, roof: 'open' },
            'Arena Corinthians': { lat: -23.5453, lon: -46.4742, roof: 'open' },
            'Santiago Bernabeu Stadium': { lat: 40.4531, lon: -3.6883, roof: 'retractable' },
            'Croke Park': { lat: 53.3607, lon: -6.2512, roof: 'open' }
        };
    }

    // ======================
    // DATA FETCHING
    // ======================

    async fetchSchedule(week, season) {
        const url = `${this.SCHEDULE_API}?week=${week}&seasontype=2&dates=${season}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Schedule request failed (${response.status})`);
        }

        const data = await response.json();
        return (data.events || []).map(event => this.parseScheduleEvent(event)).filter(Boolean);
    }

    parseScheduleEvent(event) {
        const competition = (event.competitions || [])[0];
        if (!competition) return null;

        const competitors = competition.competitors || [];
        const home = competitors.find(c => c.homeAway === 'home');
        const away = competitors.find(c => c.homeAway === 'away');
        if (!home || !away) return null;

        const venue = competition.venue || {};

        return {
            id: event.id,
            kickoff: event.date || competition.date,
            homeTeam: this.normalizeTeam(home.team?.abbreviation),
            awayTeam: this.normalizeTeam(away.team?.abbreviation),
            homeName: home.team?.displayName || '',
            awayName: away.team?.displayName || '',
            venueName: venue.fullName || '',
            venueCity: venue.address?.city || '',
            venueIndoor: venue.indoor === true
        };
    }

    /** ESPN and Sleeper disagree on a handful of abbreviations. */
    normalizeTeam(abbr) {
        if (!abbr) return null;
        const map = { WSH: 'WAS', LA: 'LAR', JAC: 'JAX', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
        const upper = abbr.toUpperCase();
        return map[upper] || upper;
    }

    /**
     * Resolves the physical location of a fixture. Prefers the venue ESPN names,
     * falling back to the home team's stadium.
     */
    resolveLocation(game) {
        const stadiums = this.getStadiums();
        const neutral = this.getNeutralVenues();
        const homeStadium = stadiums[game.homeTeam];

        // Neutral-site game: the named venue is not the home team's own stadium.
        if (game.venueName && (!homeStadium || homeStadium.name !== game.venueName)) {
            const known = neutral[game.venueName];
            if (known) {
                return { ...known, name: game.venueName, neutralSite: true };
            }
            if (homeStadium) {
                return { ...homeStadium, name: game.venueName, approximate: true };
            }
            return null;
        }

        return homeStadium ? { ...homeStadium } : null;
    }

    /**
     * One Open-Meteo request covers every venue - the API accepts comma-separated
     * coordinate lists and returns results in the order they were given.
     */
    async fetchForecasts(locations) {
        if (!locations.length) return [];

        const params = new URLSearchParams({
            latitude: locations.map(l => l.lat.toFixed(4)).join(','),
            longitude: locations.map(l => l.lon.toFixed(4)).join(','),
            hourly: 'temperature_2m,apparent_temperature,precipitation,precipitation_probability,snowfall,wind_speed_10m,wind_gusts_10m,weather_code',
            temperature_unit: 'fahrenheit',
            wind_speed_unit: 'mph',
            precipitation_unit: 'inch',
            timezone: 'UTC',
            forecast_days: String(this.FORECAST_HORIZON_DAYS)
        });

        const response = await fetch(`${this.FORECAST_API}?${params}`);
        if (!response.ok) {
            throw new Error(`Forecast request failed (${response.status})`);
        }

        const data = await response.json();
        // A single location returns an object; several return an array.
        return Array.isArray(data) ? data : [data];
    }

    /** Pulls the forecast hour closest to kickoff out of an Open-Meteo response. */
    extractKickoffConditions(forecast, kickoffISO) {
        const hourly = forecast && forecast.hourly;
        if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length) return null;

        const kickoff = new Date(kickoffISO).getTime();
        if (Number.isNaN(kickoff)) return null;

        let bestIndex = -1;
        let bestDelta = Infinity;

        hourly.time.forEach((stamp, index) => {
            // Open-Meteo omits the zone designator when timezone=UTC.
            const t = new Date(stamp.endsWith('Z') ? stamp : `${stamp}Z`).getTime();
            const delta = Math.abs(t - kickoff);
            if (delta < bestDelta) {
                bestDelta = delta;
                bestIndex = index;
            }
        });

        // More than 90 minutes away means kickoff falls outside the forecast window.
        if (bestIndex === -1 || bestDelta > 90 * 60 * 1000) return null;

        const at = key => (Array.isArray(hourly[key]) ? hourly[key][bestIndex] : null);

        return {
            temperature: at('temperature_2m'),
            feelsLike: at('apparent_temperature'),
            precipitation: at('precipitation'),
            precipitationChance: at('precipitation_probability'),
            snowfall: at('snowfall'),
            windSpeed: at('wind_speed_10m'),
            windGusts: at('wind_gusts_10m'),
            weatherCode: at('weather_code')
        };
    }

    // ======================
    // IMPACT MODEL
    // ======================

    /**
     * Turns raw conditions into a severity rating, the factors behind it and a
     * per-position read, because wind and rain do not hit every position alike.
     */
    analyzeConditions(conditions, location, game) {
        const indoors = location && (location.roof === 'dome' || game.venueIndoor);

        if (indoors) {
            return {
                severity: 'none',
                headline: 'Indoors - no weather impact',
                factors: [],
                positionImpact: {},
                explanation: `${location.name} is a fixed-roof venue, so conditions outside never reach the field. Play your players on their merits.`
            };
        }

        if (!conditions) {
            return {
                severity: 'unknown',
                headline: 'Forecast not available yet',
                factors: [],
                positionImpact: {},
                explanation: 'Kickoff is beyond the 16-day forecast window. Check back closer to game day.'
            };
        }

        const factors = [];
        let score = 0;

        const wind = conditions.windSpeed || 0;
        const gusts = conditions.windGusts || 0;
        const temp = conditions.temperature;
        const precip = conditions.precipitation || 0;
        const precipChance = conditions.precipitationChance || 0;
        const snow = conditions.snowfall || 0;

        // Wind is the single biggest lever on fantasy scoring - it degrades the
        // deep passing game and field goals well before it affects anything else.
        if (wind >= 20 || gusts >= 30) {
            score += 3;
            factors.push({
                icon: '💨',
                label: 'High wind',
                detail: `${Math.round(wind)} mph sustained, gusting to ${Math.round(gusts)} mph. Deep passing and long field goals become unreliable.`
            });
        } else if (wind >= 15 || gusts >= 22) {
            score += 2;
            factors.push({
                icon: '💨',
                label: 'Breezy',
                detail: `${Math.round(wind)} mph sustained, gusting to ${Math.round(gusts)} mph. Expect a shorter passing game.`
            });
        } else if (wind >= 10) {
            score += 1;
            factors.push({
                icon: '💨',
                label: 'Light wind',
                detail: `${Math.round(wind)} mph. Enough to matter on 50-yard field goals, little else.`
            });
        }

        if (snow > 0.2) {
            score += 3;
            factors.push({
                icon: '❄️',
                label: 'Snow',
                detail: `${snow.toFixed(1)} in expected around kickoff. Footing and ball security both suffer; games skew heavily to the run.`
            });
        } else if (precip >= 0.1 || precipChance >= 70) {
            score += 2;
            factors.push({
                icon: '🌧️',
                label: 'Rain',
                detail: `${precipChance}% chance, ${precip.toFixed(2)} in expected. Handling errors rise and passing volume usually drops.`
            });
        } else if (precipChance >= 40) {
            score += 1;
            factors.push({
                icon: '🌦️',
                label: 'Possible showers',
                detail: `${precipChance}% chance of precipitation. Worth monitoring but rarely decisive.`
            });
        }

        if (temp !== null && temp !== undefined) {
            if (temp <= 20) {
                score += 2;
                factors.push({
                    icon: '🥶',
                    label: 'Bitter cold',
                    detail: `${Math.round(temp)}°F (feels like ${Math.round(conditions.feelsLike)}°F). Kicking distance shortens and ball handling gets harder.`
                });
            } else if (temp <= 32) {
                score += 1;
                factors.push({
                    icon: '🌡️',
                    label: 'Freezing',
                    detail: `${Math.round(temp)}°F. A modest drag on scoring, most visible on kickers.`
                });
            } else if (temp >= 90) {
                score += 1;
                factors.push({
                    icon: '🥵',
                    label: 'Extreme heat',
                    detail: `${Math.round(temp)}°F. Expect heavier rotations and more fatigue late.`
                });
            }
        }

        const severity = score >= 5 ? 'high' : score >= 3 ? 'moderate' : score >= 1 ? 'low' : 'none';

        return {
            severity,
            headline: this.describeSeverity(severity),
            factors,
            positionImpact: this.getPositionImpact(severity, wind, gusts, precip, snow, precipChance),
            explanation: this.explainSeverity(severity, factors)
        };
    }

    describeSeverity(severity) {
        return {
            high: 'Significant weather impact',
            moderate: 'Moderate weather impact',
            low: 'Minor weather impact',
            none: 'Clean conditions'
        }[severity] || 'Unknown';
    }

    /**
     * Weather does not move every position the same way. Passing games and
     * kickers absorb most of the damage; run-heavy scripts can help a back.
     */
    getPositionImpact(severity, wind, gusts, precip, snow, precipChance) {
        if (severity === 'none') return {};

        const windy = wind >= 15 || gusts >= 22;
        const wet = precip >= 0.1 || snow > 0.2 || precipChance >= 70;

        const impact = {};

        if (windy || wet) {
            impact.QB = { direction: 'negative', note: 'Deep attempts and completion rate both fall' };
            impact.WR = { direction: 'negative', note: 'Downfield routes lose value; possession receivers hold up better' };
            impact.TE = { direction: 'slight-negative', note: 'Short targets survive better than outside receivers' };
            impact.RB = { direction: 'positive', note: 'Game scripts tilt toward the run, lifting carries' };
            impact.DEF = { direction: 'positive', note: 'Turnovers and stalled drives get more likely' };
        }

        if (wind >= 15 || snow > 0.2) {
            impact.K = { direction: 'negative', note: 'Long field goals become genuinely unreliable' };
        } else if (severity !== 'none') {
            impact.K = { direction: 'slight-negative', note: 'Marginal loss of range' };
        }

        return impact;
    }

    explainSeverity(severity, factors) {
        if (severity === 'none') {
            return 'Nothing in the forecast that should change your lineup. Start your best players.';
        }
        if (severity === 'low') {
            return 'Conditions are worth noting but should not override a clear talent gap. Only use this as a tiebreaker between close options.';
        }
        if (severity === 'moderate') {
            return 'Enough to matter at the margins. If you are choosing between two similar players, favour the one in better conditions - and be wary of a kicker or a deep-threat receiver here.';
        }
        return 'This is a genuine lineup consideration. Passing games historically underperform in these conditions while the run game holds up, so weigh a bench option carefully before starting a boom-bust receiver or a kicker.';
    }

    // ======================
    // ORCHESTRATION
    // ======================

    async loadWeatherAnalysis() {
        const button = document.getElementById('loadWeatherBtn');
        if (button) {
            button.disabled = true;
            button.innerHTML = '<span>⏳</span> Checking forecasts...';
        }

        try {
            if (!this.currentWeek) await this.loadCurrentWeek();

            let games = [];
            let scheduleFailed = false;

            try {
                games = await this.fetchSchedule(this.currentWeek, this.seasonYear);
            } catch (error) {
                console.warn('⚠️ Schedule unavailable, falling back to home venues:', error);
                scheduleFailed = true;
            }

            if (!games.length && !scheduleFailed) {
                this.renderEmptyState(`No games scheduled for week ${this.currentWeek}.`);
                return;
            }

            if (scheduleFailed) {
                this.renderScheduleFallback();
                return;
            }

            // Only geolocatable, outdoor games need a forecast call.
            const located = games.map(game => ({ game, location: this.resolveLocation(game) }));
            const needsForecast = located.filter(entry =>
                entry.location && entry.location.roof !== 'dome' && !entry.game.venueIndoor
            );

            let forecasts = [];
            if (needsForecast.length) {
                forecasts = await this.fetchForecasts(needsForecast.map(e => e.location));
            }

            const forecastByGame = new Map();
            needsForecast.forEach((entry, index) => {
                forecastByGame.set(entry.game.id, forecasts[index]);
            });

            const rosterTeams = await this.getRosterTeams();

            const analysed = located.map(({ game, location }) => {
                const forecast = forecastByGame.get(game.id);
                const conditions = forecast ? this.extractKickoffConditions(forecast, game.kickoff) : null;
                const analysis = this.analyzeConditions(conditions, location, game);

                return {
                    game,
                    location,
                    conditions,
                    analysis,
                    myPlayers: rosterTeams.byTeam[game.homeTeam] || rosterTeams.byTeam[game.awayTeam]
                        ? [...(rosterTeams.byTeam[game.homeTeam] || []), ...(rosterTeams.byTeam[game.awayTeam] || [])]
                        : []
                };
            });

            // Worst conditions first, but always float games with your players up.
            const order = { high: 0, moderate: 1, low: 2, unknown: 3, none: 4 };
            analysed.sort((a, b) => {
                if (a.myPlayers.length !== b.myPlayers.length) {
                    return b.myPlayers.length - a.myPlayers.length;
                }
                return order[a.analysis.severity] - order[b.analysis.severity];
            });

            this.lastAnalysis = analysed;
            this.renderAnalysis(analysed, rosterTeams.available);

            const notable = analysed.filter(a => a.analysis.severity === 'high' || a.analysis.severity === 'moderate').length;
            this.configManager.showNotification(
                notable
                    ? `🌦️ Week ${this.currentWeek}: ${notable} game${notable === 1 ? '' : 's'} with meaningful weather`
                    : `🌦️ Week ${this.currentWeek}: no significant weather anywhere`,
                'success'
            );

        } catch (error) {
            console.error('❌ Error loading weather analysis:', error);
            this.renderEmptyState(`Could not load weather: ${error.message}`);
            this.configManager.showNotification(`❌ Weather unavailable: ${error.message}`, 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = '<span>🌦️</span> Check This Week\'s Weather';
            }
        }
    }

    /** Maps the user's rostered players onto NFL teams, when a roster is loaded. */
    async getRosterTeams() {
        const byTeam = {};

        if (!window.teamManager || !window.teamManager.currentRoster) {
            return { byTeam, available: false };
        }

        try {
            const roster = window.teamManager.currentRoster.roster;
            const allPlayers = await this.sleeperAPI.getAllPlayers();

            (roster.players || []).forEach(id => {
                const player = allPlayers[id];
                if (!player || !player.team) return;
                const team = this.normalizeTeam(player.team);
                if (!byTeam[team]) byTeam[team] = [];
                byTeam[team].push({
                    name: `${player.first_name} ${player.last_name}`,
                    position: player.position,
                    starter: (roster.starters || []).includes(id)
                });
            });

            return { byTeam, available: true };
        } catch (error) {
            console.warn('⚠️ Could not map roster to teams:', error);
            return { byTeam, available: false };
        }
    }

    // ======================
    // RENDERING
    // ======================

    getContainer() {
        return document.getElementById('weather-analysis-container');
    }

    renderEmptyState(message) {
        const container = this.getContainer();
        if (!container) return;

        container.innerHTML = `
            <div class="card">
                <div class="empty-state">
                    <div class="icon">🌦️</div>
                    <h3>Weather Impact</h3>
                    <p>${message}</p>
                    <button class="btn btn-primary" data-action="load-weather" id="loadWeatherBtn" style="margin-top: 15px;">
                        <span>🌦️</span> Check This Week's Weather
                    </button>
                </div>
            </div>
        `;
    }

    renderScheduleFallback() {
        const container = this.getContainer();
        if (!container) return;

        const stadiums = this.getStadiums();
        const outdoor = Object.entries(stadiums)
            .filter(([, s]) => s.roof !== 'dome')
            .sort((a, b) => a[0].localeCompare(b[0]));

        container.innerHTML = `
            <div class="card">
                <div class="section-header">
                    <h3>🌦️ Weather Impact</h3>
                    <p>
                        The NFL schedule could not be reached, so this week's venues are unknown.
                        Listed below are the outdoor stadiums where weather can affect play - a team
                        playing away from home will be at their opponent's venue instead.
                    </p>
                </div>
                <div class="weather-venue-grid">
                    ${outdoor.map(([abbr, s]) => `
                        <div class="weather-venue">
                            <strong>${abbr}</strong>
                            <span>${s.name}</span>
                            <span class="venue-roof">${s.roof === 'retractable' ? 'Retractable roof' : 'Open air'}</span>
                        </div>
                    `).join('')}
                </div>
                <button class="btn btn-primary" data-action="load-weather" id="loadWeatherBtn" style="margin-top: 15px;">
                    <span>🔄</span> Try again
                </button>
            </div>
        `;
    }

    renderAnalysis(analysed, rosterAvailable) {
        const container = this.getContainer();
        if (!container) return;

        container.innerHTML = `
            <div class="weather-header">
                <div>
                    <h3>🌦️ Week ${this.currentWeek} Weather Impact</h3>
                    <p>Forecast conditions at kickoff for all ${analysed.length} games, worst first</p>
                </div>
                <button class="btn btn-outline" data-action="load-weather" id="loadWeatherBtn">
                    <span>🔄</span> Refresh
                </button>
            </div>

            ${rosterAvailable ? '' : `
                <div class="weather-notice">
                    💡 Load your roster in <strong>My Team</strong> and this will also flag which of
                    your own players are in each game.
                </div>
            `}

            <div class="weather-games-grid">
                ${analysed.map(entry => this.renderGameCard(entry)).join('')}
            </div>

            <div class="weather-education">
                <h4>💡 How to use this</h4>
                <p>
                    Weather is a tiebreaker, not a trump card. A high-end starter in bad conditions
                    still usually outscores a mediocre one in a dome. Where it genuinely decides
                    lineups is at kicker, on deep-threat receivers, and when two options are
                    otherwise close. Wind matters more than rain, and sustained wind above 20 mph is
                    the single clearest signal on this page.
                </p>
            </div>
        `;
    }

    renderGameCard(entry) {
        const { game, location, conditions, analysis, myPlayers } = entry;
        const kickoff = this.formatKickoff(game.kickoff);

        return `
            <div class="weather-game severity-${analysis.severity}">
                <div class="weather-game-header">
                    <div class="weather-matchup">
                        <strong>${game.awayTeam} @ ${game.homeTeam}</strong>
                        <span class="weather-kickoff">${kickoff}</span>
                    </div>
                    <span class="weather-badge severity-${analysis.severity}">${analysis.headline}</span>
                </div>

                <div class="weather-venue-line">
                    📍 ${location ? location.name : (game.venueName || 'Venue unknown')}
                    ${location && location.neutralSite ? ' <em>(neutral site)</em>' : ''}
                    ${location && location.approximate ? ' <em>(approximate location)</em>' : ''}
                </div>

                ${conditions ? `
                    <div class="weather-conditions">
                        <div class="weather-stat">
                            <span class="weather-stat-value">${Math.round(conditions.temperature)}°F</span>
                            <span class="weather-stat-label">Temp</span>
                        </div>
                        <div class="weather-stat">
                            <span class="weather-stat-value">${Math.round(conditions.windSpeed)} mph</span>
                            <span class="weather-stat-label">Wind</span>
                        </div>
                        <div class="weather-stat">
                            <span class="weather-stat-value">${conditions.precipitationChance}%</span>
                            <span class="weather-stat-label">Precip</span>
                        </div>
                        <div class="weather-stat">
                            <span class="weather-stat-value">${Math.round(conditions.windGusts)} mph</span>
                            <span class="weather-stat-label">Gusts</span>
                        </div>
                    </div>
                ` : ''}

                ${analysis.factors.length ? `
                    <ul class="weather-factors">
                        ${analysis.factors.map(f => `
                            <li><span class="factor-icon">${f.icon}</span> <strong>${f.label}:</strong> ${f.detail}</li>
                        `).join('')}
                    </ul>
                ` : ''}

                <p class="weather-explanation">${analysis.explanation}</p>

                ${Object.keys(analysis.positionImpact).length ? `
                    <div class="weather-positions">
                        ${Object.entries(analysis.positionImpact).map(([pos, impact]) => `
                            <div class="weather-position ${impact.direction}">
                                <strong>${pos}</strong>
                                <span>${impact.note}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                ${myPlayers.length ? `
                    <div class="weather-my-players">
                        <strong>Your players in this game:</strong>
                        ${myPlayers.map(p => `
                            <span class="weather-player ${p.starter ? 'is-starter' : ''}">
                                ${p.name} (${p.position})${p.starter ? ' ·  starting' : ''}
                            </span>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    formatKickoff(iso) {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return 'Time TBD';
        return date.toLocaleString(undefined, {
            weekday: 'short', hour: 'numeric', minute: '2-digit'
        });
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WeatherAnalyzer;
}
