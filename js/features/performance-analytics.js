/**
 * Performance Analytics - Advanced Player Performance Analysis
 * Tracks scoring trends, consistency, and identifies performance patterns
 */

class PerformanceAnalytics {
    constructor(configManager) {
        this.configManager = configManager;
        this.sleeperAPI = new SleeperAPI();
        this.playerStats = PlayerStats.shared();
        this.currentWeek = null;
        this.playerPerformanceData = new Map();
        this.trendAnalyzer = null;
        
        console.log('📊 PerformanceAnalytics: Initializing performance tracking...');
    }

    async initialize() {
        // Get current NFL week
        await this.loadCurrentWeek();
        
        // Initialize trend analyzer
        this.trendAnalyzer = new TrendAnalyzer(this.configManager);
        
        // Set up UI
        this.setupAnalyticsUI();
        
        console.log('✅ PerformanceAnalytics: Initialization complete');
    }

    async loadCurrentWeek() {
        try {
            const nflState = await this.sleeperAPI.fetchAPI('/state/nfl');
            this.currentWeek = nflState.week;
            console.log(`📅 Current NFL Week: ${this.currentWeek}`);
        } catch (error) {
            console.error('❌ Error loading current week:', error);
            this.currentWeek = 1;
        }
    }

    setupAnalyticsUI() {
        // Add analytics section to AI Insights page
        const aiInsightsPage = document.getElementById('ai-insights');
        if (!aiInsightsPage) return;

        // Find the tab navigation and add our tab
        const tabNavigation = aiInsightsPage.querySelector('.tab-navigation');
        if (tabNavigation) {
            const analyticsTab = document.createElement('button');
            analyticsTab.className = 'tab-btn';
            analyticsTab.setAttribute('data-tab', 'performance-analytics');
            analyticsTab.innerHTML = '📊 Performance Analytics';
            analyticsTab.onclick = () => this.showAnalyticsTab();
            
            tabNavigation.appendChild(analyticsTab);
        }

        // Add tab content
        const tabsContainer = aiInsightsPage.querySelector('.ai-insights-tabs');
        if (tabsContainer) {
            const analyticsTabContent = document.createElement('div');
            analyticsTabContent.className = 'tab-content';
            analyticsTabContent.id = 'performance-analytics-tab';
            analyticsTabContent.innerHTML = `
                <div id="performance-analytics-container">
                    <div class="analytics-empty-state" id="analytics-empty-state">
                        <div class="icon">📊</div>
                        <h3>Performance Analytics</h3>
                        <p>
                            Analyze player performance trends, identify breakout candidates, 
                            and spot declining players with AI-powered pattern recognition.
                        </p>
                        <div class="analytics-actions">
                            <button class="btn btn-primary" onclick="performanceAnalytics.analyzeRosterPerformance()">
                                <span>🎯</span> Analyze My Roster
                            </button>
                            <button class="btn btn-secondary" onclick="performanceAnalytics.runTrendAnalysis()">
                                <span>📈</span> Find Trending Players
                            </button>
                            <button class="btn btn-outline" onclick="performanceAnalytics.showPerformanceDemo()">
                                <span>🎮</span> See Demo Analysis
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            tabsContainer.appendChild(analyticsTabContent);
        }
    }

    showAnalyticsTab() {
        // Hide other tabs and show analytics tab
        const allTabs = document.querySelectorAll('.tab-content');
        const allTabBtns = document.querySelectorAll('.tab-btn');
        
        allTabs.forEach(tab => tab.classList.remove('active'));
        allTabBtns.forEach(btn => btn.classList.remove('active'));
        
        document.getElementById('performance-analytics-tab').classList.add('active');
        document.querySelector('[data-tab="performance-analytics"]').classList.add('active');
    }

    async analyzeRosterPerformance() {
        const analyzeBtn = document.querySelector('button[onclick="performanceAnalytics.analyzeRosterPerformance()"]');
        if (!analyzeBtn) return;

        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<span>⏳</span> Analyzing...';

        try {
            // Check if user has loaded their roster
            if (!window.teamManager || !window.teamManager.currentRoster) {
                throw new Error('Please load your roster in the My Team section first');
            }

            const roster = window.teamManager.currentRoster.roster;
            const allPlayers = await this.sleeperAPI.getAllPlayers();

            // Real game logs from Sleeper. Nothing below invents a score, so if
            // no games have been played the analysis says so instead.
            await this.playerStats.ensureLoaded({
                week: this.currentWeek,
                scoringFormat: this.configManager.config.scoringFormat || 'Half PPR',
                teams: this.configManager.config.leagueSize || 12,
                allPlayers
            });

            const performanceAnalysis = await this.analyzePlayersPerformance(
                [...(roster.starters || []), ...(roster.players || [])],
                allPlayers
            );

            this.displayRosterAnalysis(performanceAnalysis);

            if (performanceAnalysis.noData) {
                this.configManager.showNotification('📊 No games played yet - nothing to analyze', 'info');
            } else {
                this.configManager.showNotification('📊 Roster performance analysis complete!', 'success');
            }

        } catch (error) {
            console.error('❌ Error analyzing roster:', error);
            this.configManager.showNotification(`❌ Error: ${error.message}`, 'error');
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = '<span>🎯</span> Analyze My Roster';
        }
    }

    async runTrendAnalysis() {
        const trendBtn = document.querySelector('button[onclick="performanceAnalytics.runTrendAnalysis()"]');
        if (!trendBtn) return;

        trendBtn.disabled = true;
        trendBtn.innerHTML = '<span>⏳</span> Finding Trends...';

        try {
            // Get trending players data
            const [trendingAdds, trendingDrops] = await Promise.all([
                this.sleeperAPI.getTrendingPlayers('add', 24, 100),
                this.sleeperAPI.getTrendingPlayers('drop', 24, 50)
            ]);

            const allPlayers = await this.sleeperAPI.getAllPlayers();

            // Trend catalysts are drawn from real team production
            await this.playerStats.ensureLoaded({
                week: this.currentWeek,
                scoringFormat: this.configManager.config.scoringFormat || 'Half PPR',
                teams: this.configManager.config.leagueSize || 12,
                allPlayers
            });

            const trendAnalysis = await this.trendAnalyzer.analyzeTrends(
                trendingAdds,
                trendingDrops,
                allPlayers
            );

            this.displayTrendAnalysis(trendAnalysis);
            
            this.configManager.showNotification('📈 Trend analysis complete!', 'success');

        } catch (error) {
            console.error('❌ Error analyzing trends:', error);
            this.configManager.showNotification(`❌ Error: ${error.message}`, 'error');
        } finally {
            trendBtn.disabled = false;
            trendBtn.innerHTML = '<span>📈</span> Find Trending Players';
        }
    }

    async analyzePlayersPerformance(playerIds, allPlayers) {
        const analysis = {
            highPerformers: [],
            consistentPlayers: [],
            concerningTrends: [],
            breakoutCandidates: [],
            overallSummary: {},
            noData: false,
            source: this.playerStats.describeSource()
        };

        // Weekly game logs only exist once games have been played. Before Week 2
        // there is nothing to average, and saying so beats printing numbers that
        // were never scored.
        if (!this.playerStats.weeks.length) {
            analysis.noData = true;
            analysis.reason = this.playerStats.hasData()
                ? `No games played yet this season - ${this.playerStats.describeSource()} are available, but weekly performance needs completed games.`
                : 'No published stats for this season yet.';
            analysis.overallSummary = {
                totalPlayers: 0,
                averageTeamPoints: null,
                highPerformerCount: 0,
                concerningPlayerCount: 0,
                breakoutCandidateCount: 0,
                rosterHealthScore: null
            };
            return analysis;
        }

        const positionBaselines = this.computePositionBaselines(allPlayers);

        let totalPlayers = 0;
        let totalPoints = 0;
        const seen = new Set();

        for (const playerId of playerIds) {
            if (seen.has(playerId)) continue; // starters are also in players
            seen.add(playerId);

            const player = allPlayers[playerId];
            if (!player) continue;

            const playerAnalysis = this.analyzePlayerPerformance(player, positionBaselines);
            if (!playerAnalysis) continue;

            totalPlayers++;
            totalPoints += playerAnalysis.averagePoints;

            if (playerAnalysis.performanceRating >= 85) {
                analysis.highPerformers.push(playerAnalysis);
            }

            if (playerAnalysis.consistencyScore >= 80) {
                analysis.consistentPlayers.push(playerAnalysis);
            }

            if (playerAnalysis.trendDirection === 'declining' || playerAnalysis.concernLevel === 'high') {
                analysis.concerningTrends.push(playerAnalysis);
            }

            if (playerAnalysis.breakoutPotential >= 70) {
                analysis.breakoutCandidates.push(playerAnalysis);
            }
        }

        if (totalPlayers === 0) {
            analysis.noData = true;
            analysis.reason = 'None of your rostered players have recorded a game in the weeks loaded.';
        }

        analysis.overallSummary = {
            totalPlayers,
            averageTeamPoints: totalPlayers > 0 ? (totalPoints / totalPlayers).toFixed(1) : null,
            highPerformerCount: analysis.highPerformers.length,
            concerningPlayerCount: analysis.concerningTrends.length,
            breakoutCandidateCount: analysis.breakoutCandidates.length,
            rosterHealthScore: totalPlayers > 0 ? this.calculateRosterHealth(analysis, totalPlayers) : null,
            weeksAnalyzed: this.playerStats.weeks.map(w => w.week)
        };

        return analysis;
    }

    /**
     * What an average starter at each position actually scores per game, taken
     * from the same weeks being analyzed. This replaces a hardcoded table of
     * "QB: 18, RB: 14" guesses, so a low-scoring season lowers the bar for
     * everyone rather than making the whole league look like it underperformed.
     */
    computePositionBaselines(allPlayers) {
        const perGame = {};

        const totals = new Map();
        this.playerStats.weeks.forEach(entry => {
            entry.points.forEach((points, playerId) => {
                const record = totals.get(playerId) || { points: 0, games: 0 };
                record.points += points;
                record.games += 1;
                totals.set(playerId, record);
            });
        });

        totals.forEach((record, playerId) => {
            const position = allPlayers[playerId]?.position;
            if (!position || record.games < 2) return;
            (perGame[position] = perGame[position] || []).push(record.points / record.games);
        });

        const teams = this.configManager.config.leagueSize || 12;
        const baselines = {};

        Object.entries(perGame).forEach(([position, averages]) => {
            averages.sort((a, b) => b - a);
            const starters = averages.slice(0, PlayerStats.replacementRank(position, teams));
            if (!starters.length) return;
            const mean = starters.reduce((sum, avg) => sum + avg, 0) / starters.length;
            if (mean > 0) baselines[position] = mean;
        });

        return baselines;
    }

    analyzePlayerPerformance(player, positionBaselines) {
        const weeklyScores = this.playerStats.weeklyFor(player.player_id);

        // A player with no stat line did not play. Recording that as a zero
        // would drag his average down for weeks he was never active in.
        if (weeklyScores.length === 0) return null;

        const performanceData = this.summarizePerformance(player, weeklyScores, positionBaselines);

        return {
            player: {
                name: `${player.first_name} ${player.last_name}`,
                position: player.position,
                team: player.team,
                id: player.player_id
            },
            ...performanceData
        };
    }

    /**
     * Turns a real set of weekly scores into the metrics the cards display.
     * Every number here traces back to points the player actually scored.
     */
    summarizePerformance(player, weeklyScores, positionBaselines) {
        const points = weeklyScores.map(game => game.points);
        const totalPoints = points.reduce((sum, p) => sum + p, 0);
        const averagePoints = totalPoints / points.length;

        const recentGames = weeklyScores.slice(-3);
        const recentAverage = recentGames.reduce((sum, game) => sum + game.points, 0) / recentGames.length;

        // Consistency is the inverse of week-to-week spread, expressed relative
        // to the player's own average so a 20-point scorer is not marked erratic
        // for the same swing that would be huge on a 5-point scorer.
        const variance = points.reduce((sum, p) => sum + Math.pow(p - averagePoints, 2), 0) / points.length;
        const standardDeviation = Math.sqrt(variance);
        const coefficient = averagePoints > 0 ? standardDeviation / averagePoints : 1;
        const consistencyScore = Math.max(0, Math.min(100, 100 - coefficient * 100));

        // Two or three games is not a trend.
        let trendDirection = 'stable';
        if (weeklyScores.length >= 4) {
            const split = Math.floor(weeklyScores.length / 2);
            const mean = list => list.reduce((sum, game) => sum + game.points, 0) / list.length;
            const firstHalfAvg = mean(weeklyScores.slice(0, split));
            const secondHalfAvg = mean(weeklyScores.slice(split));

            if (firstHalfAvg > 0) {
                if (secondHalfAvg > firstHalfAvg * 1.15) trendDirection = 'improving';
                else if (secondHalfAvg < firstHalfAvg * 0.85) trendDirection = 'declining';
            }
        }

        // 100 means scoring half again what an average starter at the position
        // does; an average starter lands around 67.
        const baseline = positionBaselines[player.position];
        const performanceRating = baseline
            ? Math.min(100, Math.max(0, (averagePoints / (baseline * 1.5)) * 100))
            : null;

        const breakoutPotential = this.calculateBreakoutPotential(
            player, averagePoints, trendDirection, recentAverage
        );

        const concernLevel = this.calculateConcernLevel(
            player, trendDirection, consistencyScore, performanceRating
        );

        return {
            averagePoints: parseFloat(averagePoints.toFixed(1)),
            totalPoints: parseFloat(totalPoints.toFixed(1)),
            gamesPlayed: weeklyScores.length,
            recentForm: parseFloat(recentAverage.toFixed(1)),
            consistencyScore: Math.round(consistencyScore),
            performanceRating: performanceRating === null ? null : Math.round(performanceRating),
            positionBaseline: baseline ? parseFloat(baseline.toFixed(1)) : null,
            trendDirection,
            breakoutPotential: Math.round(breakoutPotential),
            concernLevel,
            weeklyScores,
            insights: this.generateInsights(player, {
                averagePoints, trendDirection, consistencyScore, performanceRating, weeklyScores
            }),
            recommendations: this.generateRecommendations(player, {
                trendDirection, breakoutPotential, concernLevel
            })
        };
    }

    calculateBreakoutPotential(player, averagePoints, trendDirection, recentForm) {
        let potential = 50; // Base potential
        
        // Young players have higher potential
        if (player.years_exp <= 2) potential += 20;
        else if (player.years_exp <= 4) potential += 10;
        
        // Improving trend increases potential
        if (trendDirection === 'improving') potential += 25;
        else if (trendDirection === 'declining') potential -= 20;
        
        // Recent form boost
        if (recentForm > averagePoints * 1.2) potential += 15;
        
        // Position-specific adjustments
        if (['RB', 'WR'].includes(player.position)) potential += 5;
        
        return Math.min(100, Math.max(0, potential));
    }

    calculateConcernLevel(player, trendDirection, consistencyScore, performanceRating) {
        if (player.injury_status && ['out', 'ir', 'pup', 'sus'].includes(player.injury_status.toLowerCase())) return 'high';
        if (trendDirection === 'declining' && typeof performanceRating === 'number' && performanceRating < 70) return 'high';
        if (trendDirection === 'declining' || consistencyScore < 50) return 'medium';
        if (player.injury_status) return 'medium';
        return 'low';
    }

    generateInsights(player, stats) {
        const insights = [];
        const games = stats.weeklyScores ? stats.weeklyScores.length : 0;

        if (typeof stats.performanceRating !== 'number') {
            insights.push('No position baseline available to rate this against');
        } else if (stats.performanceRating >= 90) {
            insights.push('Elite performer exceeding expectations');
        } else if (stats.performanceRating <= 60) {
            insights.push('Underperforming relative to position average');
        }

        if (games > 0 && games < 4) {
            insights.push(`Only ${games} game${games === 1 ? '' : 's'} played - treat these numbers as provisional`);
        }

        if (stats.trendDirection === 'improving') {
            insights.push('Positive momentum in recent weeks');
        } else if (stats.trendDirection === 'declining') {
            insights.push('Concerning downward trend');
        }
        
        if (stats.consistencyScore >= 80) {
            insights.push('Reliable weekly contributor');
        } else if (stats.consistencyScore <= 50) {
            insights.push('High variance week-to-week');
        }
        
        return insights;
    }

    generateRecommendations(player, analysis) {
        const recommendations = [];
        
        if (analysis.trendDirection === 'improving' && analysis.breakoutPotential >= 70) {
            recommendations.push('Hold or buy - showing breakout signs');
        } else if (analysis.concernLevel === 'high') {
            recommendations.push('Consider selling before value drops further');
        } else if (analysis.trendDirection === 'declining') {
            recommendations.push('Monitor closely for continued decline');
        } else {
            recommendations.push('Maintain current roster status');
        }
        
        return recommendations;
    }

    calculateRosterHealth(analysis, totalPlayers) {
        const total = totalPlayers;
        if (!total) return null;
        
        const highPerformerRatio = analysis.highPerformers.length / total;
        const concernRatio = analysis.concerningTrends.length / total;
        
        let score = 50;
        score += highPerformerRatio * 40;
        score -= concernRatio * 30;
        
        return Math.min(100, Math.max(0, Math.round(score)));
    }

    displayRosterAnalysis(analysis) {
        const container = document.getElementById('performance-analytics-container');
        if (!container) return;

        // Kept so the export button has something to write out.
        this.lastAnalysis = analysis;

        // Preseason, or a roster whose players have not taken a snap. There is
        // nothing to average, so say that rather than filling the page in.
        if (analysis.noData) {
            container.innerHTML = `
                <div class="analytics-empty-state">
                    <div class="icon">📊</div>
                    <h3>No performance data yet</h3>
                    <p>${analysis.reason || 'No games have been played yet this season.'}</p>
                    <p class="analytics-source-note">
                        Weekly scoring, consistency and trend all need completed games.
                        They will fill in automatically once Week 1 is in the books.
                    </p>
                    <div class="analytics-actions">
                        <button class="btn btn-secondary" onclick="performanceAnalytics.runTrendAnalysis()">
                            <span>📈</span> Find Trending Players
                        </button>
                        <button class="btn btn-outline" onclick="performanceAnalytics.showPerformanceDemo()">
                            <span>🎮</span> See Sample Analysis
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        const summary = analysis.overallSummary;
        const weeks = summary.weeksAnalyzed || [];

        container.innerHTML = `
            <div class="analytics-header">
                <h3>📊 Roster Performance Analysis</h3>
                ${typeof summary.rosterHealthScore === 'number' ? `
                    <div class="roster-health-score">
                        <span class="score-label">Roster Health Score:</span>
                        <span class="score-value ${this.getHealthScoreClass(summary.rosterHealthScore)}">
                            ${summary.rosterHealthScore}/100
                        </span>
                    </div>
                ` : ''}
            </div>

            ${analysis.isDemo ? `
                <div class="analytics-source-note demo-banner">
                    🎮 Sample data - these players and scores are illustrative, not your roster.
                </div>
            ` : weeks.length ? `
                <div class="analytics-source-note">
                    Based on real Sleeper scoring for week${weeks.length === 1 ? '' : 's'}
                    ${weeks.length === 1 ? weeks[0] : `${weeks[0]}-${weeks[weeks.length - 1]}`}.
                </div>
            ` : ''}

            <div class="analytics-summary">
                <div class="summary-stats">
                    <div class="stat-item">
                        <span class="stat-number">${summary.totalPlayers}</span>
                        <span class="stat-label">Players With Games</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number">${summary.averageTeamPoints ?? '-'}</span>
                        <span class="stat-label">Avg Points/Player</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number">${summary.highPerformerCount}</span>
                        <span class="stat-label">High Performers</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number">${summary.concerningPlayerCount}</span>
                        <span class="stat-label">Concerning Players</span>
                    </div>
                </div>
            </div>

            ${analysis.highPerformers.length > 0 ? `
                <div class="performance-section">
                    <h4>🌟 High Performers</h4>
                    <div class="performance-grid">
                        ${analysis.highPerformers.map(player => this.renderPlayerCard(player, 'high-performer')).join('')}
                    </div>
                </div>
            ` : ''}

            ${analysis.breakoutCandidates.length > 0 ? `
                <div class="performance-section">
                    <h4>🚀 Breakout Candidates</h4>
                    <div class="performance-grid">
                        ${analysis.breakoutCandidates.map(player => this.renderPlayerCard(player, 'breakout')).join('')}
                    </div>
                </div>
            ` : ''}

            ${analysis.concerningTrends.length > 0 ? `
                <div class="performance-section">
                    <h4>⚠️ Concerning Trends</h4>
                    <div class="performance-grid">
                        ${analysis.concerningTrends.map(player => this.renderPlayerCard(player, 'concerning')).join('')}
                    </div>
                </div>
            ` : ''}

            <div class="analytics-actions">
                <button class="btn btn-secondary" onclick="performanceAnalytics.runTrendAnalysis()">
                    <span>📈</span> Find Market Trends
                </button>
                <button class="btn btn-outline" onclick="performanceAnalytics.exportAnalysis()">
                    <span>📄</span> Export Analysis
                </button>
            </div>
        `;
    }

    renderPlayerCard(playerAnalysis, cardType) {
        const getTrendIcon = (direction) => {
            switch (direction) {
                case 'improving': return '📈';
                case 'declining': return '📉';
                default: return '➡️';
            }
        };

        const getConcernColor = (level) => {
            switch (level) {
                case 'high': return '#ef4444';
                case 'medium': return '#fbbf24';
                default: return '#22c55e';
            }
        };

        return `
            <div class="player-performance-card ${cardType}">
                <div class="player-header">
                    <div class="player-name">${playerAnalysis.player.name}</div>
                    <div class="player-details">${playerAnalysis.player.position} - ${playerAnalysis.player.team}</div>
                </div>
                
                <div class="performance-metrics">
                    <div class="metric">
                        <span class="metric-label">Avg Points:</span>
                        <span class="metric-value">${playerAnalysis.averagePoints}${
                            playerAnalysis.gamesPlayed ? ` <small>(${playerAnalysis.gamesPlayed} gm)</small>` : ''
                        }</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Recent Form:</span>
                        <span class="metric-value">${playerAnalysis.recentForm}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Consistency:</span>
                        <span class="metric-value">${playerAnalysis.consistencyScore}%</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Trend:</span>
                        <span class="metric-value">${getTrendIcon(playerAnalysis.trendDirection)} ${playerAnalysis.trendDirection}</span>
                    </div>
                </div>

                <div class="performance-insights">
                    <strong>📝 Insights:</strong>
                    <ul>
                        ${playerAnalysis.insights.map(insight => `<li>${insight}</li>`).join('')}
                    </ul>
                </div>

                <div class="performance-recommendations">
                    <strong>💡 Recommendations:</strong>
                    <ul>
                        ${playerAnalysis.recommendations.map(rec => `<li>${rec}</li>`).join('')}
                    </ul>
                </div>
            </div>
        `;
    }

    getHealthScoreClass(score) {
        if (score >= 80) return 'score-excellent';
        if (score >= 65) return 'score-good';
        if (score >= 50) return 'score-average';
        return 'score-poor';
    }

    displayTrendAnalysis(trendAnalysis) {
        const container = document.getElementById('performance-analytics-container');
        if (!container) return;

        container.innerHTML = `
            <div class="analytics-header">
                <h3>📈 Market Trend Analysis</h3>
                <div class="market-sentiment">
                    <div class="sentiment-header">
                        <h4>Market Sentiment</h4>
                    </div>
                    <div class="sentiment-grid">
                        <div class="sentiment-item">
                            <span class="sentiment-label">Overall</span>
                            <span class="sentiment-value sentiment-${trendAnalysis.marketSentiment.overall}">
                                ${trendAnalysis.marketSentiment.overall.toUpperCase()}
                            </span>
                        </div>
                        ${Object.entries(trendAnalysis.marketSentiment.byPosition).map(([pos, sentiment]) => `
                            <div class="sentiment-item">
                                <span class="sentiment-label">${pos}</span>
                                <span class="sentiment-value sentiment-${sentiment}">
                                    ${sentiment.toUpperCase()}
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            ${trendAnalysis.breakoutCandidates.length > 0 ? `
                <div class="trend-section">
                    <h4>🚀 Breakout Candidates</h4>
                    <div class="trend-grid">
                        ${trendAnalysis.breakoutCandidates.map(candidate => `
                            <div class="trend-card breakout">
                                <div class="trend-header">
                                    <div>
                                        <div class="player-name">${candidate.player.name}</div>
                                        <div class="player-details">${candidate.player.position} - ${candidate.player.team}</div>
                                    </div>
                                    <div class="trend-confidence confidence-${this.getConfidenceLevel(candidate.confidence)}">
                                        ${candidate.confidence}%
                                    </div>
                                </div>
                                
                                <div class="trend-metrics">
                                    <div class="metric">
                                        <span class="metric-label">Breakout Score:</span>
                                        <span class="metric-value">${candidate.breakoutScore}/100</span>
                                    </div>
                                    <div class="metric">
                                        <span class="metric-label">Add Count:</span>
                                        <span class="metric-value">${candidate.trendData.addCount.toLocaleString()}</span>
                                    </div>
                                    <div class="metric">
                                        <span class="metric-label">Timeframe:</span>
                                        <span class="metric-value">${candidate.timeframe}</span>
                                    </div>
                                </div>

                                <div class="trend-catalysts">
                                    <strong>🔥 Catalysts:</strong>
                                    <ul>
                                        ${candidate.catalysts.slice(0, 3).map(catalyst => `<li>${catalyst}</li>`).join('')}
                                    </ul>
                                </div>

                                ${candidate.riskFactors.length > 0 ? `
                                    <div class="trend-risks">
                                        <strong>⚠️ Risk Factors:</strong>
                                        <ul>
                                            ${candidate.riskFactors.slice(0, 2).map(risk => `<li>${risk}</li>`).join('')}
                                        </ul>
                                    </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            ${trendAnalysis.decliningPlayers.length > 0 ? `
                <div class="trend-section">
                    <h4>📉 Declining Players</h4>
                    <div class="trend-grid">
                        ${trendAnalysis.decliningPlayers.map(declining => `
                            <div class="trend-card declining">
                                <div class="trend-header">
                                    <div>
                                        <div class="player-name">${declining.player.name}</div>
                                        <div class="player-details">${declining.player.position} - ${declining.player.team}</div>
                                    </div>
                                    <div class="trend-severity severity-${declining.severity}">
                                        ${declining.severity.toUpperCase()}
                                    </div>
                                </div>
                                
                                <div class="trend-metrics">
                                    <div class="metric">
                                        <span class="metric-label">Decline Score:</span>
                                        <span class="metric-value">${declining.declineScore}/100</span>
                                    </div>
                                    <div class="metric">
                                        <span class="metric-label">Drop Count:</span>
                                        <span class="metric-value">${declining.trendData.dropCount.toLocaleString()}</span>
                                    </div>
                                </div>

                                <div class="trend-concerns">
                                    <strong>⚠️ Concerns:</strong>
                                    <ul>
                                        ${declining.concerns.slice(0, 3).map(concern => `<li>${concern}</li>`).join('')}
                                    </ul>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            ${trendAnalysis.emergingTrends.length > 0 ? `
                <div class="trend-section">
                    <h4>🔍 Emerging Market Trends</h4>
                    <div class="emerging-trends">
                        ${trendAnalysis.emergingTrends.map(trend => `
                            <div class="emerging-trend-item">
                                <div class="trend-type">${trend.type.replace('_', ' ').toUpperCase()}</div>
                                <div class="trend-description">${trend.description}</div>
                                <div class="trend-implication"><strong>Implication:</strong> ${trend.implication}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            ${trendAnalysis.recommendations.length > 0 ? `
                <div class="recommendations-panel">
                    <h4>💡 Actionable Recommendations</h4>
                    ${trendAnalysis.recommendations.map(rec => `
                        <div class="recommendation-item priority-${rec.priority}">
                            <div class="recommendation-content">
                                <div class="recommendation-action">
                                    ${rec.player ? `${rec.player}: ` : ''}${rec.action}
                                </div>
                                <div class="recommendation-reasoning">${rec.reasoning}</div>
                            </div>
                            <div class="recommendation-priority priority-${rec.priority}">
                                ${rec.priority}
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <div class="analytics-actions">
                <button class="btn btn-secondary" onclick="performanceAnalytics.analyzeRosterPerformance()">
                    <span>🎯</span> Analyze My Roster
                </button>
                <button class="btn btn-outline" onclick="performanceAnalytics.exportAnalysis()">
                    <span>📄</span> Export Analysis
                </button>
            </div>
        `;
    }

    getConfidenceLevel(confidence) {
        if (confidence >= 80) return 'high';
        if (confidence >= 60) return 'medium';
        return 'low';
    }

    async showPerformanceDemo() {
        // Sample data, flagged as such on the page so it cannot be mistaken for
        // a real analysis of the user's roster.
        const demoAnalysis = this.generateDemoAnalysis();
        this.displayRosterAnalysis(demoAnalysis);

        this.configManager.showNotification('🎮 Sample analysis loaded - connect your roster for real data', 'info');
    }

    generateDemoAnalysis() {
        // Hand-written illustrative figures. Never mixed with real analysis:
        // isDemo drives a banner and blocks export.
        return {
            isDemo: true,
            highPerformers: [
                {
                    player: { name: 'Ja\'Marr Chase', position: 'WR', team: 'CIN' },
                    averagePoints: 18.5,
                    recentForm: 21.2,
                    consistencyScore: 78,
                    performanceRating: 92,
                    trendDirection: 'improving',
                    breakoutPotential: 85,
                    concernLevel: 'low',
                    insights: ['Elite performer exceeding expectations', 'Positive momentum in recent weeks'],
                    recommendations: ['Hold or buy - showing breakout signs']
                }
            ],
            breakoutCandidates: [
                {
                    player: { name: 'Jayden Reed', position: 'WR', team: 'GB' },
                    averagePoints: 12.1,
                    recentForm: 16.8,
                    consistencyScore: 65,
                    performanceRating: 82,
                    trendDirection: 'improving',
                    breakoutPotential: 78,
                    concernLevel: 'low',
                    insights: ['Positive momentum in recent weeks', 'Increasing target share'],
                    recommendations: ['Hold or buy - showing breakout signs']
                }
            ],
            concerningTrends: [],
            consistentPlayers: [],
            overallSummary: {
                totalPlayers: 15,
                averageTeamPoints: '13.2',
                highPerformerCount: 1,
                concerningPlayerCount: 0,
                breakoutCandidateCount: 1,
                rosterHealthScore: 82
            }
        };
    }

    async exportAnalysis() {
        if (!this.lastAnalysis || this.lastAnalysis.noData) {
            this.configManager.showNotification('❌ Run an analysis first, then export it', 'error');
            return;
        }

        if (this.lastAnalysis.isDemo) {
            this.configManager.showNotification('❌ That is sample data - analyze your roster first', 'error');
            return;
        }

        try {
            const csv = this.buildAnalysisCsv(this.lastAnalysis);
            const week = this.currentWeek || 1;
            const teamName = (this.configManager.config.teamName || 'my-team')
                .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

            this.downloadFile(`${teamName}-performance-week-${week}.csv`, csv, 'text/csv;charset=utf-8;');

            this.configManager.showNotification('📄 Analysis exported as CSV', 'success');
        } catch (error) {
            console.error('❌ Error exporting analysis:', error);
            this.configManager.showNotification(`❌ Export failed: ${error.message}`, 'error');
        }
    }

    buildAnalysisCsv(analysis) {
        const summary = analysis.overallSummary || {};

        // Every player the analysis produced, tagged with the bucket it landed in.
        const buckets = [
            ['High performer', analysis.highPerformers],
            ['Breakout candidate', analysis.breakoutCandidates],
            ['Concerning trend', analysis.concerningTrends],
            ['Consistent', analysis.consistentPlayers]
        ];

        const rows = [];
        buckets.forEach(([label, players]) => {
            (players || []).forEach(p => {
                rows.push([
                    label,
                    p.player?.name || '',
                    p.player?.position || '',
                    p.player?.team || '',
                    p.averagePoints,
                    p.recentForm,
                    p.consistencyScore,
                    p.performanceRating,
                    p.trendDirection,
                    p.breakoutPotential,
                    p.concernLevel,
                    (p.insights || []).join('; '),
                    (p.recommendations || []).join('; ')
                ]);
            });
        });

        const header = [
            'Category', 'Player', 'Position', 'Team', 'Avg Points', 'Recent Form',
            'Consistency', 'Performance Rating', 'Trend', 'Breakout Potential',
            'Concern Level', 'Insights', 'Recommendations'
        ];

        const meta = [
            ['Fantasy Football Command Center - Performance Analysis'],
            ['Generated', new Date().toISOString()],
            ['League', this.configManager.config.leagueName || ''],
            ['Team', this.configManager.config.teamName || ''],
            ['Week', this.currentWeek || ''],
            ['Scoring', this.configManager.config.scoringFormat || ''],
            ['Data source', analysis.source || ''],
            ['Weeks analyzed', (summary.weeksAnalyzed || []).join(' ')],
            [],
            ['Roster health score', summary.rosterHealthScore],
            ['Players analyzed', summary.totalPlayers],
            ['Average team points', summary.averageTeamPoints],
            ['High performers', summary.highPerformerCount],
            ['Breakout candidates', summary.breakoutCandidateCount],
            ['Concerning players', summary.concerningPlayerCount],
            []
        ];

        return [...meta, header, ...rows].map(row => row.map(this.escapeCsv).join(',')).join('\r\n');
    }

    escapeCsv(value) {
        if (value === null || value === undefined) return '';
        const str = String(value);
        return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    }

    downloadFile(filename, contents, mimeType) {
        const blob = new Blob([contents], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Revoke on the next tick so the download has already started.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PerformanceAnalytics;
}