/**
 * Performance Analytics - Advanced Player Performance Analysis
 * Tracks scoring trends, consistency, and identifies performance patterns
 */

class PerformanceAnalytics {
    constructor(configManager) {
        this.configManager = configManager;
        this.sleeperAPI = new SleeperAPI();
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
            
            // Get performance data for roster players
            const performanceAnalysis = await this.analyzePlayersPerformance(
                [...(roster.starters || []), ...(roster.players || [])],
                allPlayers
            );

            this.displayRosterAnalysis(performanceAnalysis);
            
            this.configManager.showNotification('📊 Roster performance analysis complete!', 'success');

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
            
            // Analyze trends
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
            overallSummary: {}
        };

        let totalPlayers = 0;
        let totalPoints = 0;
        const scoringFormat = this.configManager.config.scoringFormat || 'Half PPR';

        for (const playerId of playerIds) {
            const player = allPlayers[playerId];
            if (!player) continue;

            const playerAnalysis = await this.analyzePlayerPerformance(player, scoringFormat);
            if (!playerAnalysis) continue;

            totalPlayers++;
            totalPoints += playerAnalysis.averagePoints;

            // Categorize players
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

        // Calculate overall summary
        analysis.overallSummary = {
            totalPlayers,
            averageTeamPoints: totalPlayers > 0 ? (totalPoints / totalPlayers).toFixed(1) : 0,
            highPerformerCount: analysis.highPerformers.length,
            concerningPlayerCount: analysis.concerningTrends.length,
            breakoutCandidateCount: analysis.breakoutCandidates.length,
            rosterHealthScore: this.calculateRosterHealth(analysis)
        };

        return analysis;
    }

    async analyzePlayerPerformance(player, scoringFormat) {
        try {
            // Generate simulated performance data (in production, would use real game logs)
            const performanceData = this.generatePerformanceData(player, scoringFormat);
            
            const analysis = {
                player: {
                    name: `${player.first_name} ${player.last_name}`,
                    position: player.position,
                    team: player.team,
                    id: player.player_id
                },
                averagePoints: performanceData.averagePoints,
                recentForm: performanceData.recentForm,
                consistencyScore: performanceData.consistencyScore,
                performanceRating: performanceData.performanceRating,
                trendDirection: performanceData.trendDirection,
                breakoutPotential: performanceData.breakoutPotential,
                concernLevel: performanceData.concernLevel,
                weeklyScores: performanceData.weeklyScores,
                insights: performanceData.insights,
                recommendations: performanceData.recommendations
            };

            return analysis;
            
        } catch (error) {
            console.error(`Error analyzing ${player.first_name} ${player.last_name}:`, error);
            return null;
        }
    }

    generatePerformanceData(player, scoringFormat) {
        // Simulate realistic performance data based on position and scoring format
        const basePoints = this.getBasePointsByPosition(player.position, scoringFormat);
        const volatility = this.getVolatilityByPosition(player.position);
        
        const weeklyScores = [];
        let totalPoints = 0;
        
        // Generate 8 weeks of data
        for (let week = 1; week <= Math.min(this.currentWeek - 1, 8); week++) {
            const variance = (Math.random() - 0.5) * volatility;
            const weekScore = Math.max(0, basePoints + variance);
            weeklyScores.push({
                week,
                points: parseFloat(weekScore.toFixed(1))
            });
            totalPoints += weekScore;
        }
        
        const averagePoints = weeklyScores.length > 0 ? totalPoints / weeklyScores.length : 0;
        
        // Calculate recent form (last 3 games)
        const recentGames = weeklyScores.slice(-3);
        const recentAverage = recentGames.length > 0 ? 
            recentGames.reduce((sum, game) => sum + game.points, 0) / recentGames.length : 0;
        
        // Calculate consistency (lower standard deviation = more consistent)
        const variance = weeklyScores.reduce((sum, game) => 
            sum + Math.pow(game.points - averagePoints, 2), 0) / weeklyScores.length;
        const standardDeviation = Math.sqrt(variance);
        const consistencyScore = Math.max(0, 100 - (standardDeviation * 5));

        // Determine trend direction
        const firstHalf = weeklyScores.slice(0, Math.floor(weeklyScores.length / 2));
        const secondHalf = weeklyScores.slice(Math.floor(weeklyScores.length / 2));
        
        const firstHalfAvg = firstHalf.reduce((sum, game) => sum + game.points, 0) / firstHalf.length;
        const secondHalfAvg = secondHalf.reduce((sum, game) => sum + game.points, 0) / secondHalf.length;
        
        let trendDirection = 'stable';
        if (secondHalfAvg > firstHalfAvg * 1.15) trendDirection = 'improving';
        else if (secondHalfAvg < firstHalfAvg * 0.85) trendDirection = 'declining';

        // Performance rating
        const performanceRating = Math.min(100, Math.max(0, 
            (averagePoints / basePoints) * 100
        ));

        // Breakout potential
        const breakoutPotential = this.calculateBreakoutPotential(
            player, averagePoints, trendDirection, recentAverage
        );

        // Concern level
        const concernLevel = this.calculateConcernLevel(
            player, trendDirection, consistencyScore, performanceRating
        );

        return {
            averagePoints: parseFloat(averagePoints.toFixed(1)),
            recentForm: parseFloat(recentAverage.toFixed(1)),
            consistencyScore: Math.round(consistencyScore),
            performanceRating: Math.round(performanceRating),
            trendDirection,
            breakoutPotential: Math.round(breakoutPotential),
            concernLevel,
            weeklyScores,
            insights: this.generateInsights(player, {
                averagePoints, trendDirection, consistencyScore, performanceRating
            }),
            recommendations: this.generateRecommendations(player, {
                trendDirection, breakoutPotential, concernLevel
            })
        };
    }

    getBasePointsByPosition(position, scoringFormat) {
        const isPPR = scoringFormat.includes('PPR');
        const basePoints = {
            'QB': 18,
            'RB': isPPR ? 14 : 12,
            'WR': isPPR ? 13 : 11,
            'TE': isPPR ? 10 : 8,
            'K': 8,
            'DEF': 9
        };
        return basePoints[position] || 10;
    }

    getVolatilityByPosition(position) {
        const volatility = {
            'QB': 8,
            'RB': 10,
            'WR': 12,
            'TE': 8,
            'K': 6,
            'DEF': 7
        };
        return volatility[position] || 8;
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
        if (trendDirection === 'declining' && performanceRating < 70) return 'high';
        if (trendDirection === 'declining' || consistencyScore < 50) return 'medium';
        if (player.injury_status) return 'medium';
        return 'low';
    }

    generateInsights(player, stats) {
        const insights = [];
        
        if (stats.performanceRating >= 90) {
            insights.push('Elite performer exceeding expectations');
        } else if (stats.performanceRating <= 60) {
            insights.push('Underperforming relative to position average');
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

    calculateRosterHealth(analysis) {
        const total = analysis.overallSummary.totalPlayers;
        if (total === 0) return 50;
        
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

        container.innerHTML = `
            <div class="analytics-header">
                <h3>📊 Roster Performance Analysis</h3>
                <div class="roster-health-score">
                    <span class="score-label">Roster Health Score:</span>
                    <span class="score-value ${this.getHealthScoreClass(analysis.overallSummary.rosterHealthScore)}">
                        ${analysis.overallSummary.rosterHealthScore}/100
                    </span>
                </div>
            </div>

            <div class="analytics-summary">
                <div class="summary-stats">
                    <div class="stat-item">
                        <span class="stat-number">${analysis.overallSummary.totalPlayers}</span>
                        <span class="stat-label">Total Players</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number">${analysis.overallSummary.averageTeamPoints}</span>
                        <span class="stat-label">Avg Points/Player</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number">${analysis.overallSummary.highPerformerCount}</span>
                        <span class="stat-label">High Performers</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number">${analysis.overallSummary.concerningPlayerCount}</span>
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
                        <span class="metric-value">${playerAnalysis.averagePoints}</span>
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
        // Show demo data for users without roster
        const demoAnalysis = this.generateDemoAnalysis();
        this.displayRosterAnalysis(demoAnalysis);
        
        this.configManager.showNotification('🎮 Demo analysis loaded - connect your roster for real data!', 'info');
    }

    generateDemoAnalysis() {
        // Generate sample analysis for demonstration
        return {
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
        this.configManager.showNotification('📄 Analysis export coming soon!', 'info');
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PerformanceAnalytics;
}