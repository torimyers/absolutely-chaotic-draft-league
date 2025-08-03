/**
 * Hot/Cold Streak Detection System for Fantasy Football Command Center
 * File: streak-analyzer.js
 * 
 * This system analyzes player performance trends over recent games to identify:
 * - Hot streaks (consistently outperforming expectations)
 * - Cold streaks (consistently underperforming expectations) 
 * - Neutral trends (normal variance)
 * 
 * Educational focus: Explains WHY streaks matter and what causes them
 */

class HotColdStreakAnalyzer {
    constructor() {
        this.streakThresholds = {
            hot: {
                minGames: 3,
                performanceRatio: 1.20, // 120% of projection
                consistency: 0.25 // Low standard deviation
            },
            cold: {
                minGames: 3,
                performanceRatio: 0.80, // 80% of projection
                consistency: 0.30 // Moderate standard deviation
            }
        };
        
        this.educationalContexts = {
            hot: [
                "Player may have increased role in offense",
                "Favorable recent matchups boosting confidence",
                "Improved health or conditioning",
                "Better team offensive performance",
                "Positive game script (leading = more opportunities)"
            ],
            cold: [
                "Possible minor injury affecting performance",
                "Tough recent defensive matchups",
                "Reduced role or snap count",
                "Team offensive struggles",
                "Negative game script (trailing = less opportunities)"
            ]
        };
    }

    /**
     * Analyze a player's recent performance for streak patterns
     * @param {Array} gameLog - Array of recent games with actual vs projected points
     * @param {Object} playerInfo - Player metadata (name, position, team)
     * @returns {Object} Streak analysis with educational context
     */
    analyzePlayerStreak(gameLog, playerInfo) {
        if (!gameLog || gameLog.length < 2) {
            return this.createNeutralResult(playerInfo, "Insufficient data");
        }

        // Calculate performance metrics
        const performanceData = this.calculatePerformanceMetrics(gameLog);
        
        // Determine streak type
        const streakType = this.determineStreakType(performanceData, gameLog.length);
        
        // Generate educational context
        const educationalContext = this.generateEducationalContext(streakType, performanceData, playerInfo);
        
        // Calculate confidence level
        const confidence = this.calculateConfidence(streakType, performanceData, gameLog.length);

        return {
            player: playerInfo.name,
            position: playerInfo.position,
            team: playerInfo.team,
            streakType: streakType,
            gamesAnalyzed: gameLog.length,
            avgPerformanceRatio: performanceData.avgRatio,
            consistency: performanceData.consistency,
            confidence: confidence,
            educationalContext: educationalContext,
            visualData: this.createVisualData(gameLog),
            actionableAdvice: this.generateActionableAdvice(streakType, playerInfo),
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Calculate key performance metrics from game log
     */
    calculatePerformanceMetrics(gameLog) {
        // Calculate performance ratios (actual / projected)
        const performanceRatios = gameLog.map(game => {
            if (!game.projectedPoints || game.projectedPoints === 0) {
                return 1.0; // Neutral if no projection available
            }
            return game.actualPoints / game.projectedPoints;
        });

        // Calculate average performance ratio
        const avgRatio = performanceRatios.reduce((sum, ratio) => sum + ratio, 0) / performanceRatios.length;

        // Calculate consistency (standard deviation)
        const variance = performanceRatios.reduce((sum, ratio) => {
            return sum + Math.pow(ratio - avgRatio, 2);
        }, 0) / performanceRatios.length;
        
        const consistency = Math.sqrt(variance);

        // Calculate trend (is performance improving or declining?)
        const trend = this.calculateTrend(performanceRatios);

        return {
            avgRatio,
            consistency,
            trend,
            ratios: performanceRatios
        };
    }

    /**
     * Calculate trend direction (improving/declining/stable)
     */
    calculateTrend(ratios) {
        if (ratios.length < 3) return 'stable';
        
        const firstHalf = ratios.slice(0, Math.floor(ratios.length / 2));
        const secondHalf = ratios.slice(Math.floor(ratios.length / 2));
        
        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        
        const difference = secondAvg - firstAvg;
        
        if (difference > 0.15) return 'improving';
        if (difference < -0.15) return 'declining';
        return 'stable';
    }

    /**
     * Determine streak type based on performance metrics
     */
    determineStreakType(performanceData, gameCount) {
        const { avgRatio, consistency } = performanceData;
        const { hot, cold } = this.streakThresholds;

        // Hot streak: High performance with consistency
        if (gameCount >= hot.minGames && 
            avgRatio >= hot.performanceRatio && 
            consistency <= hot.consistency) {
            return 'hot';
        }

        // Cold streak: Low performance 
        if (gameCount >= cold.minGames && 
            avgRatio <= cold.performanceRatio) {
            return 'cold';
        }

        // Check for emerging trends
        if (gameCount >= 2) {
            if (avgRatio >= 1.15 && performanceData.trend === 'improving') {
                return 'heating_up';
            }
            if (avgRatio <= 0.85 && performanceData.trend === 'declining') {
                return 'cooling_down';
            }
        }

        return 'neutral';
    }

    /**
     * Generate educational context explaining the streak
     */
    generateEducationalContext(streakType, performanceData, playerInfo) {
        const contexts = {
            hot: {
                title: "🔥 Hot Streak Detected",
                explanation: `${playerInfo.name} is significantly outperforming projections with consistent results. This suggests underlying positive factors.`,
                whyItMatters: "Hot streaks often indicate improved usage, easier matchups, or better team performance. They can persist for several more weeks.",
                considerations: this.educationalContexts.hot,
                fantasyImpact: "Consider starting with confidence or targeting in trades while value may still be reasonable."
            },
            cold: {
                title: "🧊 Cold Streak Identified", 
                explanation: `${playerInfo.name} has been consistently underperforming expectations. This pattern suggests addressable issues.`,
                whyItMatters: "Cold streaks often have identifiable causes. Understanding the reason helps predict if it will continue or reverse.",
                considerations: this.educationalContexts.cold,
                fantasyImpact: "Consider benching temporarily, but don't panic-trade at lowest value. Look for buy-low opportunities."
            },
            heating_up: {
                title: "📈 Heating Up",
                explanation: `${playerInfo.name} shows improving performance trends. This could be the start of a hot streak.`,
                whyItMatters: "Early trend identification allows you to capitalize before others notice the pattern.",
                considerations: ["Performance trending upward", "May break out soon", "Good buy-low candidate"],
                fantasyImpact: "Monitor closely for continued improvement. Consider acquiring before hot streak is obvious."
            },
            cooling_down: {
                title: "📉 Cooling Down", 
                explanation: `${playerInfo.name} shows declining performance trends. Early warning of potential cold streak.`,
                whyItMatters: "Catching declining trends early allows you to sell high or adjust lineup expectations.",
                considerations: ["Performance trending downward", "May enter cold streak", "Consider selling high"],
                fantasyImpact: "Monitor for continued decline. Consider trading while value is still strong."
            },
            neutral: {
                title: "📊 Normal Variance",
                explanation: `${playerInfo.name} is performing within normal expected ranges with typical week-to-week variance.`,
                whyItMatters: "Normal variance is healthy. Not every player needs to be in a streak to be valuable.",
                considerations: ["Consistent with projections", "No significant trend", "Reliable option"],
                fantasyImpact: "Start with confidence based on matchup and projections. No streak adjustments needed."
            }
        };

        return contexts[streakType] || contexts.neutral;
    }

    /**
     * Calculate confidence level in the streak analysis
     */
    calculateConfidence(streakType, performanceData, gameCount) {
        let baseConfidence = 50;

        // More games = higher confidence
        baseConfidence += Math.min(gameCount * 8, 30); // Up to +30 for games

        // Stronger performance ratios = higher confidence
        if (streakType === 'hot') {
            const excessPerformance = (performanceData.avgRatio - 1.2) * 100;
            baseConfidence += Math.min(excessPerformance, 15);
        } else if (streakType === 'cold') {
            const underPerformance = (0.8 - performanceData.avgRatio) * 100;
            baseConfidence += Math.min(underPerformance, 15);
        }

        // Better consistency = higher confidence
        const consistencyBonus = Math.max(0, (0.3 - performanceData.consistency) * 50);
        baseConfidence += Math.min(consistencyBonus, 10);

        // Trend alignment increases confidence
        if ((streakType === 'hot' && performanceData.trend === 'improving') ||
            (streakType === 'cold' && performanceData.trend === 'declining')) {
            baseConfidence += 5;
        }

        return Math.min(Math.round(baseConfidence), 95); // Cap at 95%
    }

    /**
     * Create visual data for streak display
     */
    createVisualData(gameLog) {
        return gameLog.map((game, index) => ({
            week: game.week || index + 1,
            actual: game.actualPoints,
            projected: game.projectedPoints,
            ratio: game.projectedPoints ? game.actualPoints / game.projectedPoints : 1,
            performance: game.projectedPoints ? 
                (game.actualPoints >= game.projectedPoints * 1.1 ? 'above' :
                 game.actualPoints <= game.projectedPoints * 0.9 ? 'below' : 'neutral') : 'neutral'
        }));
    }

    /**
     * Generate actionable fantasy advice
     */
    generateActionableAdvice(streakType, playerInfo) {
        const advice = {
            hot: [
                `Start ${playerInfo.name} with confidence in favorable matchups`,
                "Consider trading for complementary pieces while value is reasonable",
                "Monitor for signs the streak may be ending",
                "Don't overpay in trades - hot streaks can end suddenly"
            ],
            cold: [
                `Consider benching ${playerInfo.name} in tough matchups`,
                "Look for underlying causes (injury, usage, matchups)",
                "Don't panic-trade at lowest value",
                "Monitor for signs of improvement"
            ],
            heating_up: [
                `Watch ${playerInfo.name} closely for continued improvement`,
                "Good time to acquire via trade before value peaks",
                "Consider starting if you need ceiling plays",
                "Add to watch list for waiver wire priority"
            ],
            cooling_down: [
                `Monitor ${playerInfo.name} for continued decline`,
                "Consider trading while value is still strong", 
                "Have backup options ready",
                "Don't ignore the warning signs"
            ],
            neutral: [
                `Start ${playerInfo.name} based on normal projections`,
                "No streak adjustments needed to rankings",
                "Good baseline option for consistent production",
                "Focus analysis on matchup and usage trends"
            ]
        };

        return advice[streakType] || advice.neutral;
    }

    /**
     * Create neutral result for insufficient data
     */
    createNeutralResult(playerInfo, reason) {
        return {
            player: playerInfo.name,
            position: playerInfo.position,
            team: playerInfo.team,
            streakType: 'neutral',
            gamesAnalyzed: 0,
            confidence: 0,
            educationalContext: {
                title: "📊 Insufficient Data",
                explanation: reason,
                whyItMatters: "Need at least 2-3 games to identify meaningful patterns.",
                fantasyImpact: "Use standard projections and rankings."
            },
            visualData: [],
            actionableAdvice: ["Wait for more game data to identify trends"],
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Batch analyze multiple players
     */
    analyzeMultiplePlayers(playersData) {
        return playersData.map(playerData => {
            return this.analyzePlayerStreak(playerData.gameLog, playerData.playerInfo);
        });
    }

    /**
     * Get streak summary for display
     */
    getStreakSummary(analysis) {
        const emoji = {
            hot: '🔥',
            cold: '🧊', 
            heating_up: '📈',
            cooling_down: '📉',
            neutral: '📊'
        };

        return {
            emoji: emoji[analysis.streakType],
            title: analysis.educationalContext.title,
            confidence: analysis.confidence,
            games: analysis.gamesAnalyzed,
            advice: analysis.actionableAdvice[0] // First piece of advice
        };
    }
}

// UI Manager for displaying streak analysis
class StreakAnalysisUI {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.analyzer = new HotColdStreakAnalyzer();
    }

    /**
     * Render streak analysis for multiple players
     */
    renderStreakAnalysis(playersData) {
        if (!this.container) {
            console.error('Streak analysis container not found');
            return;
        }

        const analyses = this.analyzer.analyzeMultiplePlayers(playersData);
        
        this.container.innerHTML = `
            <div class="streak-analysis-header">
                <h2>🔥 Hot/Cold Streak Analysis</h2>
                <p class="streak-subtitle">AI-powered performance trend analysis with educational insights</p>
            </div>
            <div class="streak-analysis-grid">
                ${analyses.map(analysis => this.createStreakCard(analysis)).join('')}
            </div>
            <div class="streak-educational-section">
                ${this.createEducationalSection()}
            </div>
        `;

        // Add event listeners for interactive elements
        this.addEventListeners();
    }

    /**
     * Create individual streak card
     */
    createStreakCard(analysis) {
        const summary = this.analyzer.getStreakSummary(analysis);
        
        return `
            <div class="streak-card ${analysis.streakType}" data-player="${analysis.player}">
                <div class="streak-header">
                    <div class="player-info">
                        <h3>${analysis.player}</h3>
                        <div class="player-meta">
                            <span class="position-badge">${analysis.position}</span>
                            <span class="team-name">${analysis.team}</span>
                        </div>
                    </div>
                    <div class="streak-indicator ${analysis.streakType}">
                        <span class="streak-emoji">${summary.emoji}</span>
                        <span class="streak-label">${analysis.streakType.replace('_', ' ').toUpperCase()}</span>
                    </div>
                </div>

                <div class="performance-metrics">
                    <div class="metric">
                        <span class="metric-value">${(analysis.avgPerformanceRatio * 100).toFixed(0)}%</span>
                        <span class="metric-label">vs Projection</span>
                    </div>
                    <div class="metric">
                        <span class="metric-value">${analysis.confidence}%</span>
                        <span class="metric-label">Confidence</span>
                    </div>
                    <div class="metric">
                        <span class="metric-value">${analysis.gamesAnalyzed}</span>
                        <span class="metric-label">Games</span>
                    </div>
                </div>

                <div class="game-performance">
                    <h4>Recent Performance</h4>
                    <div class="games-grid">
                        ${analysis.visualData.map(game => this.createGameBar(game)).join('')}
                    </div>
                </div>

                <div class="educational-content">
                    <div class="educational-summary">
                        <h4>${analysis.educationalContext.title}</h4>
                        <p>${analysis.educationalContext.explanation}</p>
                    </div>
                    
                    <div class="fantasy-impact">
                        <h5>💡 Fantasy Impact</h5>
                        <p>${analysis.educationalContext.fantasyImpact}</p>
                    </div>

                    <div class="actionable-advice">
                        <h5>🎯 Actionable Advice</h5>
                        <ul>
                            ${analysis.actionableAdvice.slice(0, 2).map(advice => `<li>${advice}</li>`).join('')}
                        </ul>
                    </div>
                </div>

                <button class="btn btn-outline expand-details" data-player="${analysis.player}">
                    View Detailed Analysis
                </button>
            </div>
        `;
    }

    /**
     * Create game performance bar
     */
    createGameBar(game) {
        const height = Math.max(20, Math.min(80, game.ratio * 40));
        return `
            <div class="game-bar ${game.performance}" 
                 style="height: ${height}px"
                 data-week="${game.week}"
                 data-actual="${game.actual}"
                 data-projected="${game.projected}"
                 title="Week ${game.week}: ${game.actual} pts (${game.projected} proj)">
            </div>
        `;
    }

    /**
     * Create educational section
     */
    createEducationalSection() {
        return `
            <div class="educational-panel">
                <h3>📚 Understanding Hot/Cold Streaks</h3>
                <div class="educational-grid">
                    <div class="educational-item">
                        <h4>🤔 What Are Streaks?</h4>
                        <p>Sustained periods where players consistently outperform (hot) or underperform (cold) expectations. Not just random variance - they often indicate real changes.</p>
                    </div>
                    <div class="educational-item">
                        <h4>🎯 Why They Matter</h4>
                        <p>Streaks have predictive value and often continue for several weeks. They can indicate usage changes, health factors, or matchup luck.</p>
                    </div>
                    <div class="educational-item">
                        <h4>💡 How to Use</h4>
                        <p>Don't overreact to small samples. Dig deeper into underlying causes. Buy low on cold streaks, sell carefully on hot streaks.</p>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Add event listeners for interactive elements
     */
    addEventListeners() {
        // Expand details buttons
        document.querySelectorAll('.expand-details').forEach(button => {
            button.addEventListener('click', (e) => {
                const playerName = e.target.dataset.player;
                this.showDetailedAnalysis(playerName);
            });
        });

        // Game bar hover tooltips
        document.querySelectorAll('.game-bar').forEach(bar => {
            bar.addEventListener('mouseenter', (e) => {
                this.showGameTooltip(e);
            });
            
            bar.addEventListener('mouseleave', (e) => {
                this.hideGameTooltip(e);
            });
        });
    }

    /**
     * Show detailed analysis modal
     */
    showDetailedAnalysis(playerName) {
        // This would open a detailed modal with more in-depth analysis
        console.log(`Showing detailed analysis for ${playerName}`);
        
        // For now, show a notification
        if (window.eventManager) {
            window.eventManager.showNotification(
                `🔍 Detailed analysis for ${playerName} coming soon! This will include target share trends, snap counts, and matchup analysis.`,
                'info',
                5000
            );
        }
    }

    /**
     * Show game tooltip on hover
     */
    showGameTooltip(e) {
        const tooltip = document.createElement('div');
        tooltip.className = 'game-tooltip';
        tooltip.innerHTML = `
            <strong>Week ${e.target.dataset.week}</strong><br>
            Actual: ${e.target.dataset.actual} pts<br>
            Projected: ${e.target.dataset.projected} pts
        `;
        
        document.body.appendChild(tooltip);
        
        const rect = e.target.getBoundingClientRect();
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.top = `${rect.top - 10}px`;
    }

    /**
     * Hide game tooltip
     */
    hideGameTooltip(e) {
        const tooltip = document.querySelector('.game-tooltip');
        if (tooltip) {
            tooltip.remove();
        }
    }
}

// Demo data for testing
class StreakAnalysisDemo {
    static getSampleData() {
        return [
            {
                playerInfo: { name: "Bijan Robinson", position: "RB", team: "ATL" },
                gameLog: [
                    { week: 1, actualPoints: 18.5, projectedPoints: 15.2 },
                    { week: 2, actualPoints: 22.1, projectedPoints: 16.8 },
                    { week: 3, actualPoints: 19.7, projectedPoints: 15.5 },
                    { week: 4, actualPoints: 24.3, projectedPoints: 17.1 }
                ]
            },
            {
                playerInfo: { name: "Calvin Ridley", position: "WR", team: "TEN" },
                gameLog: [
                    { week: 1, actualPoints: 8.2, projectedPoints: 14.5 },
                    { week: 2, actualPoints: 6.7, projectedPoints: 13.8 },
                    { week: 3, actualPoints: 9.1, projectedPoints: 14.2 },
                    { week: 4, actualPoints: 7.8, projectedPoints: 15.1 }
                ]
            },
            {
                playerInfo: { name: "Josh Allen", position: "QB", team: "BUF" },
                gameLog: [
                    { week: 1, actualPoints: 24.8, projectedPoints: 22.1 },
                    { week: 2, actualPoints: 18.2, projectedPoints: 21.5 },
                    { week: 3, actualPoints: 23.7, projectedPoints: 22.8 },
                    { week: 4, actualPoints: 21.9, projectedPoints: 23.2 }
                ]
            }
        ];
    }

    static initialize() {
        const ui = new StreakAnalysisUI('streak-analysis-container');
        const sampleData = this.getSampleData();
        ui.renderStreakAnalysis(sampleData);
    }
}

// Export classes for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { 
        HotColdStreakAnalyzer, 
        StreakAnalysisUI,
        StreakAnalysisDemo 
    };
}