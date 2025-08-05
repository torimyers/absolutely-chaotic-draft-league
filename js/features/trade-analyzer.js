/**
 * Trade Analyzer - Advanced Trade Value Calculator and Suggestions
 * Provides comprehensive trade analysis, value calculations, and proposal generation
 */

class TradeAnalyzer {
    constructor(configManager) {
        this.configManager = configManager;
        this.sleeperAPI = new SleeperAPI();
        this.currentWeek = null;
        this.playerValues = new Map();
        this.positionScarcity = {};
        this.leagueContext = null;
        
        console.log('💱 TradeAnalyzer: Initializing trade value calculator...');
    }

    async initialize() {
        // Load current NFL week and basic data
        await this.loadCurrentWeek();
        await this.calculatePositionScarcity();
        
        console.log('✅ TradeAnalyzer: Initialization complete');
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

    async calculatePositionScarcity() {
        try {
            const allPlayers = await this.sleeperAPI.getAllPlayers();
            const activePlayers = Object.values(allPlayers).filter(player => 
                player.active && !player.injury_status?.includes('IR')
            );

            // Calculate position scarcity multipliers
            this.positionScarcity = {
                QB: this.calculateScarcityMultiplier(activePlayers, 'QB', 32), // ~32 starting QBs
                RB: this.calculateScarcityMultiplier(activePlayers, 'RB', 64), // ~64 relevant RBs
                WR: this.calculateScarcityMultiplier(activePlayers, 'WR', 96), // ~96 relevant WRs
                TE: this.calculateScarcityMultiplier(activePlayers, 'TE', 32), // ~32 relevant TEs
                K: this.calculateScarcityMultiplier(activePlayers, 'K', 32),
                DEF: this.calculateScarcityMultiplier(activePlayers, 'DEF', 32)
            };

            console.log('📊 Position scarcity calculated:', this.positionScarcity);
        } catch (error) {
            console.error('❌ Error calculating position scarcity:', error);
            // Default scarcity values
            this.positionScarcity = { QB: 1.0, RB: 1.3, WR: 1.1, TE: 1.4, K: 0.8, DEF: 0.9 };
        }
    }

    calculateScarcityMultiplier(players, position, relevantCount) {
        const positionPlayers = players.filter(p => p.position === position);
        const scarcityRatio = relevantCount / Math.max(positionPlayers.length, 1);
        
        // Convert to multiplier (more scarcity = higher multiplier)
        return Math.max(0.8, Math.min(1.5, 1 + (scarcityRatio - 0.5)));
    }

    async analyzeTradeProposal(yourPlayers, theirPlayers, leagueData = null) {
        try {
            // Load league context if provided
            if (leagueData) {
                this.leagueContext = leagueData;
            }

            // Calculate player values
            const yourPlayerValues = await Promise.all(
                yourPlayers.map(player => this.calculatePlayerValue(player))
            );
            const theirPlayerValues = await Promise.all(
                theirPlayers.map(player => this.calculatePlayerValue(player))
            );

            // Calculate total values
            const yourTotalValue = yourPlayerValues.reduce((sum, pv) => sum + pv.totalValue, 0);
            const theirTotalValue = theirPlayerValues.reduce((sum, pv) => sum + pv.totalValue, 0);

            // Analyze trade impact
            const tradeImpact = await this.analyzeTradeImpact(yourPlayers, theirPlayers);

            // Generate recommendation
            const recommendation = this.generateTradeRecommendation(
                yourTotalValue, theirTotalValue, tradeImpact
            );

            return {
                yourPlayers: yourPlayerValues,
                theirPlayers: theirPlayerValues,
                yourTotalValue: Math.round(yourTotalValue),
                theirTotalValue: Math.round(theirTotalValue),
                valueDifference: Math.round(theirTotalValue - yourTotalValue),
                fairnessRating: this.calculateFairnessRating(yourTotalValue, theirTotalValue),
                tradeImpact,
                recommendation,
                analysis: this.generateTradeAnalysis(yourPlayerValues, theirPlayerValues, tradeImpact)
            };

        } catch (error) {
            console.error('❌ Error analyzing trade proposal:', error);
            throw error;
        }
    }

    async calculatePlayerValue(player) {
        try {
            const scoringFormat = this.configManager.config.scoringFormat || 'Half PPR';
            const isPPR = scoringFormat.includes('PPR');
            const isSuperflex = scoringFormat.includes('Super Flex');

            let baseValue = 50; // Base value out of 100
            
            // Position-based base values
            const positionBaseValues = {
                QB: isSuperflex ? 65 : 55,
                RB: isPPR ? 70 : 75,
                WR: isPPR ? 75 : 65,
                TE: isPPR ? 60 : 50,
                K: 35,
                DEF: 40
            };

            baseValue = positionBaseValues[player.position] || 50;

            // Age adjustment
            const age = this.calculatePlayerAge(player);
            if (age <= 25) baseValue += 10; // Prime/ascending
            else if (age <= 28) baseValue += 5; // Prime
            else if (age >= 32) baseValue -= 15; // Declining
            else if (age >= 30) baseValue -= 5; // Potential decline

            // Experience adjustment
            if (player.years_exp <= 2) {
                baseValue += 8; // Rookie/sophomore upside
            } else if (player.years_exp >= 10) {
                baseValue -= 8; // Veteran concern
            }

            // Injury adjustment
            baseValue -= this.getInjuryPenalty(player);

            // Position scarcity adjustment
            const scarcityMultiplier = this.positionScarcity[player.position] || 1.0;
            baseValue *= scarcityMultiplier;

            // Season performance trend (simulated - would use real stats)
            const performanceTrend = this.simulatePerformanceTrend(player);
            baseValue += performanceTrend;

            // Team context (opportunity)
            const teamContext = this.evaluateTeamContext(player);
            baseValue += teamContext;

            // Market demand simulation
            const marketDemand = this.simulateMarketDemand(player);
            baseValue += marketDemand;

            const totalValue = Math.max(5, Math.min(100, baseValue));

            return {
                player,
                baseValue: Math.round(baseValue),
                totalValue: Math.round(totalValue),
                breakdown: {
                    position: positionBaseValues[player.position],
                    age: this.getAgeAdjustment(age),
                    experience: this.getExperienceAdjustment(player.years_exp),
                    injury: -this.getInjuryPenalty(player),
                    scarcity: Math.round((scarcityMultiplier - 1) * 50),
                    performance: performanceTrend,
                    opportunity: teamContext,
                    market: marketDemand
                },
                tier: this.getPlayerTier(totalValue),
                confidence: this.getValueConfidence(player)
            };

        } catch (error) {
            console.error('❌ Error calculating player value:', error);
            return {
                player,
                totalValue: 50,
                tier: 'Unknown',
                confidence: 'Low'
            };
        }
    }

    calculatePlayerAge(player) {
        if (!player.birth_date) return 27; // Default age
        const birthYear = new Date(player.birth_date).getFullYear();
        return new Date().getFullYear() - birthYear;
    }

    getAgeAdjustment(age) {
        if (age <= 25) return 10;
        if (age <= 28) return 5;
        if (age >= 32) return -15;
        if (age >= 30) return -5;
        return 0;
    }

    getExperienceAdjustment(years) {
        if (years <= 2) return 8;
        if (years >= 10) return -8;
        return 0;
    }

    getInjuryPenalty(player) {
        if (!player.injury_status) return 0;
        
        const status = player.injury_status.toLowerCase();
        if (status.includes('out')) return 25;
        if (status.includes('doubtful')) return 15;
        if (status.includes('questionable')) return 8;
        if (status.includes('probable')) return 3;
        return 0;
    }

    simulatePerformanceTrend(player) {
        // Simulate recent performance trend (would use real stats in production)
        const trends = [-10, -5, 0, 5, 10];
        const weights = [0.1, 0.2, 0.4, 0.2, 0.1]; // Normal distribution
        
        let trend = 0;
        for (let i = 0; i < trends.length; i++) {
            if (Math.random() < weights[i]) {
                trend = trends[i];
                break;
            }
        }
        
        return trend;
    }

    evaluateTeamContext(player) {
        // Simulate team opportunity context
        const teamFactors = ['offense_rank', 'target_share', 'snap_percentage'];
        let contextScore = 0;
        
        // Simulate positive/negative team context
        if (Math.random() > 0.5) {
            contextScore = Math.random() * 10 - 5; // -5 to +5
        }
        
        return Math.round(contextScore);
    }

    simulateMarketDemand(player) {
        // Simulate market demand based on position and performance
        const position = player.position;
        let demand = 0;
        
        if (['RB', 'WR'].includes(position)) {
            demand = Math.random() * 8 - 4; // High volatility positions
        } else if (position === 'TE') {
            demand = Math.random() * 6 - 3; // Medium volatility
        } else {
            demand = Math.random() * 4 - 2; // Lower volatility
        }
        
        return Math.round(demand);
    }

    getPlayerTier(value) {
        if (value >= 85) return 'Elite';
        if (value >= 75) return 'High-End';
        if (value >= 65) return 'Solid';
        if (value >= 55) return 'Serviceable';
        if (value >= 45) return 'Depth';
        return 'Replacement';
    }

    getValueConfidence(player) {
        // Confidence based on data availability and player factors
        let confidence = 80; // Base confidence
        
        if (!player.birth_date) confidence -= 10;
        if (player.injury_status) confidence -= 15;
        if (player.years_exp <= 1) confidence -= 10; // Rookie uncertainty
        
        if (confidence >= 80) return 'High';
        if (confidence >= 60) return 'Medium';
        return 'Low';
    }

    async analyzeTradeImpact(yourPlayers, theirPlayers) {
        const impact = {
            positionalImpact: {},
            rosterBalance: 'neutral',
            immediateImpact: 'neutral',
            futureImpact: 'neutral',
            riskAssessment: 'medium'
        };

        // Analyze positional impact
        const yourPositions = yourPlayers.map(p => p.position);
        const theirPositions = theirPlayers.map(p => p.position);

        ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
            const yourCount = yourPositions.filter(p => p === pos).length;
            const theirCount = theirPositions.filter(p => p === pos).length;
            const netChange = theirCount - yourCount;

            if (netChange !== 0) {
                impact.positionalImpact[pos] = {
                    change: netChange,
                    impact: netChange > 0 ? 'gain' : 'loss',
                    significance: Math.abs(netChange) > 1 ? 'high' : 'moderate'
                };
            }
        });

        // Assess overall roster balance
        const totalPositionalChanges = Object.values(impact.positionalImpact).length;
        if (totalPositionalChanges <= 1) {
            impact.rosterBalance = 'maintained';
        } else if (totalPositionalChanges >= 3) {
            impact.rosterBalance = 'significant_change';
        }

        // Risk assessment based on injury history and age
        const yourAvgAge = yourPlayers.reduce((sum, p) => sum + this.calculatePlayerAge(p), 0) / yourPlayers.length;
        const theirAvgAge = theirPlayers.reduce((sum, p) => sum + this.calculatePlayerAge(p), 0) / theirPlayers.length;
        
        const injuredPlayers = [...yourPlayers, ...theirPlayers].filter(p => p.injury_status);
        
        if (theirAvgAge > yourAvgAge + 3 || injuredPlayers.length > 1) {
            impact.riskAssessment = 'high';
        } else if (theirAvgAge < yourAvgAge - 2 && injuredPlayers.length === 0) {
            impact.riskAssessment = 'low';
        }

        return impact;
    }

    calculateFairnessRating(yourValue, theirValue) {
        const difference = Math.abs(yourValue - theirValue);
        const avgValue = (yourValue + theirValue) / 2;
        const percentageDiff = (difference / avgValue) * 100;

        if (percentageDiff <= 5) return 'Very Fair';
        if (percentageDiff <= 10) return 'Fair';
        if (percentageDiff <= 20) return 'Slightly Unfair';
        if (percentageDiff <= 35) return 'Unfair';
        return 'Very Unfair';
    }

    generateTradeRecommendation(yourValue, theirValue, impact) {
        const valueDiff = theirValue - yourValue;
        const percentDiff = (Math.abs(valueDiff) / Math.max(yourValue, theirValue)) * 100;

        let recommendation = 'neutral';
        let reasoning = '';

        if (valueDiff > 10 && percentDiff > 15) {
            recommendation = 'accept';
            reasoning = 'Strong value gain with favorable trade terms';
        } else if (valueDiff > 5 && percentDiff > 8) {
            recommendation = 'consider';
            reasoning = 'Moderate value gain worth considering';
        } else if (valueDiff < -10 && percentDiff > 15) {
            recommendation = 'reject';
            reasoning = 'Significant value loss - unfavorable terms';
        } else if (valueDiff < -5 && percentDiff > 8) {
            recommendation = 'counter';
            reasoning = 'Close but slightly unfavorable - try to negotiate';
        } else {
            recommendation = 'fair';
            reasoning = 'Values are relatively balanced';
        }

        // Adjust for roster impact
        if (impact.riskAssessment === 'high') {
            if (recommendation === 'accept') recommendation = 'consider';
            reasoning += '. High risk due to age/injury concerns';
        } else if (impact.riskAssessment === 'low') {
            if (recommendation === 'consider') recommendation = 'accept';
            reasoning += '. Low risk with good upside potential';
        }

        return { recommendation, reasoning };
    }

    generateTradeAnalysis(yourPlayers, theirPlayers, impact) {
        const analysis = [];

        // Value comparison
        const yourTotal = yourPlayers.reduce((sum, p) => sum + p.totalValue, 0);
        const theirTotal = theirPlayers.reduce((sum, p) => sum + p.totalValue, 0);
        
        analysis.push({
            category: 'Value Analysis',
            description: `You're ${yourTotal > theirTotal ? 'giving up' : 'gaining'} approximately ${Math.abs(yourTotal - theirTotal)} points of value in this trade.`
        });

        // Positional analysis
        Object.entries(impact.positionalImpact).forEach(([position, data]) => {
            analysis.push({
                category: 'Positional Impact',
                description: `${data.impact === 'gain' ? 'Gaining' : 'Losing'} ${Math.abs(data.change)} ${position} player${Math.abs(data.change) > 1 ? 's' : ''} - ${data.significance} impact on roster balance.`
            });
        });

        // Risk analysis
        analysis.push({
            category: 'Risk Assessment',
            description: `This trade carries ${impact.riskAssessment} risk based on player ages, injury histories, and performance trends.`
        });

        return analysis;
    }

    async generateTradeProposals(userTeam, leagueData, targetNeeds = []) {
        try {
            if (!window.leagueAnalyzer) {
                throw new Error('League analyzer not available');
            }

            // Get league analysis for trade targets
            const leagueAnalysis = await window.leagueAnalyzer.analyzeLeagueStandings();
            const tradeTargets = leagueAnalysis.tradeTargets;

            const proposals = [];

            for (const target of tradeTargets.slice(0, 3)) {
                // Generate specific trade proposals for this target
                const targetProposals = await this.generateSpecificTradeProposals(
                    userTeam, target, leagueData
                );
                proposals.push(...targetProposals);
            }

            // Sort by value and fairness
            return proposals
                .sort((a, b) => (b.valueDifference + b.fairnessScore) - (a.valueDifference + a.fairnessScore))
                .slice(0, 5);

        } catch (error) {
            console.error('❌ Error generating trade proposals:', error);
            return [];
        }
    }

    async generateSpecificTradeProposals(userTeam, target, leagueData) {
        // This would generate specific 1-for-1, 2-for-1, etc. trade proposals
        // For now, return a sample proposal structure
        return [{
            targetTeam: target.team,
            yourPlayers: [], // Would be populated with actual players
            theirPlayers: [], // Would be populated with actual players
            tradeType: '1-for-1',
            reasoning: target.reasoning,
            valueDifference: 0,
            fairnessScore: 0.8,
            confidence: 'Medium'
        }];
    }

    async displayTradeAnalyzer() {
        const container = document.createElement('div');
        container.className = 'trade-analyzer-container';
        container.innerHTML = `
            <div class="trade-analyzer-header">
                <h3>💱 Trade Value Calculator</h3>
                <p>Analyze trade proposals and get AI-powered recommendations</p>
            </div>

            <div class="trade-analyzer-tabs">
                <div class="tab-navigation">
                    <button class="tab-btn active" data-tab="calculator">
                        🧮 Trade Calculator
                    </button>
                    <button class="tab-btn" data-tab="proposals">
                        💡 Trade Proposals
                    </button>
                    <button class="tab-btn" data-tab="market">
                        📊 Player Values
                    </button>
                </div>

                <!-- Trade Calculator Tab -->
                <div class="tab-content active" id="calculator-tab">
                    <div class="trade-builder">
                        <div class="trade-sides">
                            <div class="trade-side your-side">
                                <h4>Your Players</h4>
                                <div class="player-selection" id="yourPlayers">
                                    <div class="add-player-btn" onclick="window.tradeAnalyzer.addPlayerToTrade('your')">
                                        + Add Player
                                    </div>
                                </div>
                                <div class="side-total" id="yourTotal">Total Value: 0</div>
                            </div>
                            
                            <div class="trade-arrow">⇄</div>
                            
                            <div class="trade-side their-side">
                                <h4>Their Players</h4>
                                <div class="player-selection" id="theirPlayers">
                                    <div class="add-player-btn" onclick="window.tradeAnalyzer.addPlayerToTrade('their')">
                                        + Add Player
                                    </div>
                                </div>
                                <div class="side-total" id="theirTotal">Total Value: 0</div>
                            </div>
                        </div>
                        
                        <div class="analyze-trade-section">
                            <button class="btn btn-primary" onclick="window.tradeAnalyzer.analyzeTrade()">
                                📊 Analyze Trade
                            </button>
                        </div>
                    </div>
                    
                    <div class="trade-results" id="tradeResults" style="display: none;">
                        <!-- Results will be populated here -->
                    </div>
                </div>

                <!-- Trade Proposals Tab -->
                <div class="tab-content" id="proposals-tab">
                    <div class="proposals-header">
                        <h4>💡 AI-Generated Trade Proposals</h4>
                        <p>Based on your team needs and league analysis</p>
                        <button class="btn btn-primary" onclick="window.tradeAnalyzer.generateProposals()">
                            ✨ Generate New Proposals
                        </button>
                    </div>
                    <div class="proposals-list" id="proposalsList">
                        <div class="empty-state">
                            <div class="icon">💡</div>
                            <p>Click "Generate New Proposals" to see AI-powered trade suggestions based on your team's needs and league dynamics.</p>
                        </div>
                    </div>
                </div>

                <!-- Player Values Tab -->
                <div class="tab-content" id="market-tab">
                    <div class="market-header">
                        <h4>📊 Player Trade Values</h4>
                        <p>Current market values for trade evaluation</p>
                        <div class="market-filters">
                            <select id="positionFilter">
                                <option value="all">All Positions</option>
                                <option value="QB">Quarterbacks</option>
                                <option value="RB">Running Backs</option>
                                <option value="WR">Wide Receivers</option>
                                <option value="TE">Tight Ends</option>
                            </select>
                            <button class="btn btn-secondary" onclick="window.tradeAnalyzer.loadPlayerValues()">
                                🔄 Refresh Values
                            </button>
                        </div>
                    </div>
                    <div class="player-values-list" id="playerValuesList">
                        <div class="loading-state">
                            <div class="icon">⏳</div>
                            <p>Click "Refresh Values" to load current player trade values</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add tab switching functionality
        container.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.getAttribute('data-tab');
                
                // Update active tab button
                container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Update active tab content
                container.querySelectorAll('.tab-content').forEach(content => {
                    content.classList.remove('active');
                });
                container.querySelector(`#${tabId}-tab`).classList.add('active');
            });
        });

        return container;
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TradeAnalyzer;
}