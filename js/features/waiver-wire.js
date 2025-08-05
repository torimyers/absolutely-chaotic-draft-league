/**
 * Waiver Wire Manager - AI-Powered Add/Drop Recommendations
 * Helps users identify valuable pickups and players to drop
 */

class WaiverWireManager {
    constructor(configManager) {
        this.configManager = configManager;
        this.sleeperAPI = new SleeperAPI();
        this.currentWeek = null;
        this.trendingPlayers = null;
        this.rosterInfo = null;
        
        console.log('🔄 WaiverWireManager: Initializing waiver wire analysis...');
    }

    async initialize() {
        // Get current NFL week
        await this.loadCurrentWeek();
        
        // Set up UI elements
        this.setupWaiverWireUI();
        
        console.log('✅ WaiverWireManager: Initialization complete');
    }

    async loadCurrentWeek() {
        try {
            const nflState = await this.sleeperAPI.fetchAPI('/state/nfl');
            this.currentWeek = nflState.week;
            console.log(`📅 Current NFL Week: ${this.currentWeek}`);
        } catch (error) {
            console.error('❌ Error loading current week:', error);
            this.currentWeek = 1; // Default fallback
        }
    }

    setupWaiverWireUI() {
        // Find a good place to add waiver wire functionality
        // For now, we'll add it to the team management interface
        const teamPage = document.getElementById('my-team');
        if (!teamPage) return;

        // Add waiver wire section after existing content
        const existingInterface = teamPage.querySelector('#teamManagerInterface');
        if (existingInterface) {
            const waiverWireSection = document.createElement('div');
            waiverWireSection.id = 'waiverWireSection';
            waiverWireSection.innerHTML = `
                <div class="waiver-wire-container" style="margin-top: 2rem;">
                    <div class="section-header">
                        <h3>🔄 Waiver Wire Recommendations</h3>
                        <p>AI-powered add/drop suggestions based on trends and team needs</p>
                    </div>
                    
                    <div class="waiver-actions">
                        <button class="btn btn-primary" onclick="waiverWireManager.loadWaiverRecommendations()" id="loadWaiverBtn">
                            <span>🔍</span> Find Pickups
                        </button>
                        <button class="btn btn-secondary" onclick="waiverWireManager.analyzeDropCandidates()" id="analyzeDropsBtn">
                            <span>📉</span> Analyze Drops
                        </button>
                        <button class="btn btn-outline" onclick="waiverWireManager.showTrendingPlayers()" id="showTrendingBtn">
                            <span>📈</span> Trending Players
                        </button>
                    </div>
                    
                    <div id="waiverRecommendations" class="waiver-recommendations" style="display: none;">
                        <!-- Waiver recommendations will be populated here -->
                    </div>
                </div>
            `;
            
            existingInterface.appendChild(waiverWireSection);
        }
    }

    async loadWaiverRecommendations() {
        const loadBtn = document.getElementById('loadWaiverBtn');
        if (!loadBtn) return;

        loadBtn.disabled = true;
        loadBtn.innerHTML = '<span>⏳</span> Analyzing...';

        try {
            // Get trending adds and drops
            const [trendingAdds, trendingDrops] = await Promise.all([
                this.sleeperAPI.getTrendingPlayers('add', 24, 50),
                this.sleeperAPI.getTrendingPlayers('drop', 24, 25)
            ]);

            // Get all player data for analysis
            const allPlayers = await this.sleeperAPI.getAllPlayers();

            // Generate AI recommendations
            const recommendations = await this.generateWaiverRecommendations(
                trendingAdds, 
                trendingDrops, 
                allPlayers
            );

            this.displayWaiverRecommendations(recommendations);
            
            this.configManager.showNotification('🔍 Waiver wire analysis complete!', 'success');

        } catch (error) {
            console.error('❌ Error loading waiver recommendations:', error);
            this.configManager.showNotification(`❌ Error: ${error.message}`, 'error');
        } finally {
            loadBtn.disabled = false;
            loadBtn.innerHTML = '<span>🔍</span> Find Pickups';
        }
    }

    async generateWaiverRecommendations(trendingAdds, trendingDrops, allPlayers) {
        const scoringFormat = this.configManager.config.scoringFormat || 'Half PPR';
        const isPPR = scoringFormat.includes('PPR');
        
        const recommendations = [];

        // Analyze top trending adds
        for (let i = 0; i < Math.min(trendingAdds.length, 10); i++) {
            const trending = trendingAdds[i];
            const player = allPlayers[trending.player_id];
            
            if (!player) continue;

            const analysis = this.analyzeWaiverPickup(player, trending, isPPR);
            if (analysis.recommendation !== 'avoid') {
                recommendations.push({
                    type: 'pickup',
                    player: {
                        id: trending.player_id,
                        name: `${player.first_name} ${player.last_name}`,
                        position: player.position,
                        team: player.team,
                        injury_status: player.injury_status
                    },
                    priority: analysis.priority,
                    reasoning: analysis.reasoning,
                    addPercentage: trending.count,
                    scoringContext: scoringFormat,
                    confidence: analysis.confidence
                });
            }
        }

        // Sort by priority and confidence
        recommendations.sort((a, b) => {
            const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
            const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
            if (priorityDiff !== 0) return priorityDiff;
            return b.confidence - a.confidence;
        });

        return recommendations.slice(0, 8); // Top 8 recommendations
    }

    analyzeWaiverPickup(player, trending, isPPR) {
        const reasons = [];
        let priority = 'medium';
        let confidence = 60;
        let recommendation = 'consider';

        // Position-specific analysis
        const positionAnalysis = this.getPositionAnalysis(player.position, isPPR);
        confidence += positionAnalysis.adjustment;
        if (positionAnalysis.reasoning) {
            reasons.push(positionAnalysis.reasoning);
        }

        // Trending momentum analysis
        if (trending.count > 1000) {
            priority = 'high';
            confidence += 15;
            reasons.push(`Highly popular pickup (${trending.count.toLocaleString()} adds in 24h)`);
        } else if (trending.count > 500) {
            confidence += 10;
            reasons.push(`Strong pickup momentum (${trending.count.toLocaleString()} adds in 24h)`);
        } else if (trending.count > 100) {
            confidence += 5;
            reasons.push(`Growing interest (${trending.count.toLocaleString()} adds in 24h)`);
        }

        // Injury concerns
        if (player.injury_status) {
            const status = player.injury_status.toLowerCase();
            if (status === 'out') {
                recommendation = 'avoid';
                confidence = 20;
                reasons.push('Currently ruled OUT - avoid until healthy');
                return { recommendation, priority: 'low', reasoning: reasons.join('. '), confidence };
            } else if (status === 'doubtful') {
                confidence -= 20;
                priority = 'low';
                reasons.push('DOUBTFUL status creates uncertainty');
            } else if (status === 'questionable') {
                confidence -= 10;
                reasons.push('QUESTIONABLE - monitor injury reports');
            }
        }

        // Team context analysis
        const teamAnalysis = this.getTeamContextAnalysis(player.team);
        confidence += teamAnalysis.adjustment;
        if (teamAnalysis.reasoning) {
            reasons.push(teamAnalysis.reasoning);
        }

        // PPR-specific insights for skill positions
        if (isPPR && ['RB', 'WR', 'TE'].includes(player.position)) {
            const pprInsight = this.getPPRWaiverInsight(player);
            confidence += pprInsight.adjustment;
            if (pprInsight.reasoning) {
                reasons.push(pprInsight.reasoning);
            }
        }

        // Final priority adjustment based on confidence
        if (confidence >= 80) {
            priority = 'high';
        } else if (confidence <= 40) {
            priority = 'low';
        }

        return {
            recommendation,
            priority,
            reasoning: reasons.join('. '),
            confidence: Math.min(Math.max(confidence, 15), 95)
        };
    }

    getPositionAnalysis(position, isPPR) {
        const positionInsights = {
            'QB': {
                adjustment: 5,
                reasoning: 'Streaming QB based on matchups can provide weekly upside'
            },
            'RB': {
                adjustment: 10,
                reasoning: 'RB scarcity makes any potential starter valuable'
            },
            'WR': {
                adjustment: isPPR ? 8 : 5,
                reasoning: isPPR ? 'WR depth important in PPR scoring' : 'WR depth provides injury insurance'
            },
            'TE': {
                adjustment: isPPR ? 12 : 8,
                reasoning: isPPR ? 'TE streaming crucial in PPR formats' : 'TE position has limited reliable options'
            },
            'K': {
                adjustment: -5,
                reasoning: 'Kickers highly unpredictable - stream based on matchups only'
            },
            'DEF': {
                adjustment: 0,
                reasoning: 'Stream defenses based on weekly matchups and opponent turnovers'
            }
        };

        return positionInsights[position] || { adjustment: 0, reasoning: '' };
    }

    getTeamContextAnalysis(team) {
        // Placeholder team analysis - would be more sophisticated with real data
        const teamContexts = [
            { adjustment: 8, reasoning: 'High-powered offense creates multiple scoring opportunities' },
            { adjustment: 5, reasoning: 'Solid offensive line provides stable foundation' },
            { adjustment: -3, reasoning: 'Struggling offense limits overall ceiling' },
            { adjustment: 3, reasoning: 'Improving offensive coordinator could unlock potential' },
            { adjustment: 0, reasoning: 'Average offensive situation with standard expectations' }
        ];

        // Return random context for demo (would be data-driven in production)
        return teamContexts[Math.floor(Math.random() * teamContexts.length)];
    }

    getPPRWaiverInsight(player) {
        // Estimate reception potential for PPR value
        const pprInsights = {
            'RB': {
                highCatchingThreshold: 40,
                adjustment: 8,
                reasoning: 'Pass-catching upside adds significant PPR value'
            },
            'WR': {
                highCatchingThreshold: 60,
                adjustment: 6,
                reasoning: 'Target volume creates consistent PPR floor'
            },
            'TE': {
                highCatchingThreshold: 30,
                adjustment: 10,
                reasoning: 'TE reception volume highly valuable in PPR'
            }
        };

        const insight = pprInsights[player.position];
        if (!insight) return { adjustment: 0, reasoning: '' };

        // Simplified logic - would use actual target data in production
        return {
            adjustment: insight.adjustment,
            reasoning: insight.reasoning
        };
    }

    displayWaiverRecommendations(recommendations) {
        const container = document.getElementById('waiverRecommendations');
        if (!container) return;

        container.innerHTML = `
            <div class="recommendations-header">
                <h4>🎯 Top Waiver Wire Pickups (Week ${this.currentWeek})</h4>
                <p>AI-ranked recommendations with detailed analysis</p>
            </div>
            
            <div class="waiver-grid">
                ${recommendations.map(rec => `
                    <div class="waiver-card priority-${rec.priority}">
                        <div class="waiver-header">
                            <div class="player-info">
                                <div class="player-name">${rec.player.name}</div>
                                <div class="player-details">${rec.player.position} - ${rec.player.team}</div>
                                ${rec.player.injury_status ? `<div class="injury-tag">${rec.player.injury_status}</div>` : ''}
                            </div>
                            <div class="priority-badge ${rec.priority}">
                                ${rec.priority.toUpperCase()}
                            </div>
                        </div>
                        
                        <div class="waiver-stats">
                            <div class="stat">
                                <span class="stat-label">Adds (24h):</span>
                                <span class="stat-value">${rec.addPercentage.toLocaleString()}</span>
                            </div>
                            <div class="stat">
                                <span class="stat-label">Confidence:</span>
                                <span class="stat-value">${rec.confidence}%</span>
                            </div>
                            <div class="stat">
                                <span class="stat-label">Format:</span>
                                <span class="stat-value">${rec.scoringContext}</span>
                            </div>
                        </div>
                        
                        <div class="waiver-reasoning">
                            <strong>📝 Analysis:</strong> ${rec.reasoning}
                        </div>
                        
                        <div class="waiver-actions">
                            <button class="btn btn-sm btn-outline" onclick="waiverWireManager.getPlayerDetails('${rec.player.id}')">
                                📊 View Stats
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        container.style.display = 'block';
    }

    async analyzeDropCandidates() {
        this.configManager.showNotification('📉 Drop candidate analysis coming soon!', 'info');
        
        // Placeholder for drop analysis
        // Would analyze user's roster for underperforming players
        console.log('Drop candidate analysis would analyze current roster performance');
    }

    async showTrendingPlayers() {
        const showBtn = document.getElementById('showTrendingBtn');
        if (!showBtn) return;

        showBtn.disabled = true;
        showBtn.innerHTML = '<span>⏳</span> Loading...';

        try {
            const trending = await this.sleeperAPI.getTrendingPlayers('add', 24, 20);
            const allPlayers = await this.sleeperAPI.getAllPlayers();
            
            this.displayTrendingPlayers(trending, allPlayers);
            
        } catch (error) {
            console.error('❌ Error loading trending players:', error);
            this.configManager.showNotification(`❌ Error: ${error.message}`, 'error');
        } finally {
            showBtn.disabled = false;
            showBtn.innerHTML = '<span>📈</span> Trending Players';
        }
    }

    displayTrendingPlayers(trending, allPlayers) {
        const container = document.getElementById('waiverRecommendations');
        if (!container) return;

        container.innerHTML = `
            <div class="trending-header">
                <h4>📈 Most Added Players (Last 24 Hours)</h4>
                <p>See what other managers are picking up</p>
            </div>
            
            <div class="trending-grid">
                ${trending.slice(0, 15).map((trend, index) => {
                    const player = allPlayers[trend.player_id];
                    if (!player) return '';
                    
                    return `
                        <div class="trending-item">
                            <div class="trending-rank">#${index + 1}</div>
                            <div class="trending-player">
                                <div class="player-name">${player.first_name} ${player.last_name}</div>
                                <div class="player-details">${player.position} - ${player.team}</div>
                            </div>
                            <div class="trending-count">
                                ${trend.count.toLocaleString()} adds
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        container.style.display = 'block';
    }

    async getPlayerDetails(playerId) {
        // Placeholder for detailed player view
        this.configManager.showNotification('📊 Detailed player stats coming soon!', 'info');
        console.log(`Would show detailed stats for player: ${playerId}`);
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WaiverWireManager;
}