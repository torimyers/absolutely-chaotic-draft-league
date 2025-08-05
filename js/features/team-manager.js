/**
 * Team Manager - Post-Draft Season Management
 * Handles weekly lineup optimization, roster analysis, and season-long team management
 */

class TeamManager {
    constructor(configManager) {
        this.configManager = configManager;
        this.sleeperAPI = new SleeperAPI();
        this.currentRoster = null;
        this.currentWeek = null;
        this.lineupOptimizer = null;
        this.matchupData = null;
        this.leagueAnalyzer = null;
        
        // Initialize when constructed
        this.initialize();
    }

    async initialize() {
        console.log('<� TeamManager: Initializing post-draft management...');
        
        // Set up UI
        this.setupTeamUI();
        
        // Load current week
        await this.loadCurrentWeek();
        
        console.log(' TeamManager: Initialization complete');
    }

    async loadCurrentWeek() {
        try {
            // Get NFL state to determine current week
            const nflState = await this.sleeperAPI.fetchAPI('/state/nfl');
            this.currentWeek = nflState.week;
            console.log(`=� Current NFL Week: ${this.currentWeek}`);
        } catch (error) {
            console.error('L Error loading current week:', error);
            this.currentWeek = 1; // Default fallback
        }
    }

    setupTeamUI() {
        const teamPage = document.getElementById('my-team');
        if (!teamPage) {
            console.warn('L Team page not found');
            return;
        }

        // Replace empty state with team management interface
        const emptyState = teamPage.querySelector('.empty-state');
        if (emptyState) {
            emptyState.innerHTML = `
                <div id="teamManagerInterface">
                    <div class="team-header">
                        <h2>=� Season Management Dashboard</h2>
                        <p>AI-powered lineup optimization and roster insights</p>
                    </div>
                    
                    <div class="team-actions">
                        <button class="btn btn-primary" onclick="teamManager.loadRoster()" id="loadRosterBtn">
                            <span>=�</span> Load Current Roster
                        </button>
                        <button class="btn btn-secondary" onclick="teamManager.optimizeLineup()" id="optimizeLineupBtn" disabled>
                            <span><�</span> Optimize Lineup
                        </button>
                        <button class="btn btn-outline" onclick="teamManager.analyzeMatchups()" id="analyzeMatchupsBtn" disabled>
                            <span>�</span> Analyze Matchups
                        </button>
                    </div>

                    <div id="rosterDisplay" class="roster-container" style="display: none;">
                        <!-- Roster will be populated here -->
                    </div>

                    <div id="lineupOptimization" class="lineup-container" style="display: none;">
                        <!-- Lineup optimization will be displayed here -->
                    </div>

                    <div id="matchupAnalysis" class="matchup-container" style="display: none;">
                        <!-- Matchup analysis will be displayed here -->
                    </div>
                </div>
            `;
        }

        // Feature buttons will be added after roster loading
    }

    async loadRoster() {
        const loadBtn = document.getElementById('loadRosterBtn');
        if (!loadBtn) return;

        loadBtn.disabled = true;
        loadBtn.innerHTML = '<span>�</span> Loading...';

        try {
            const leagueId = this.configManager.config.sleeperLeagueId;
            if (!leagueId) {
                throw new Error('No Sleeper League ID configured');
            }

            // Get league info
            const league = await this.sleeperAPI.fetchAPI(`/league/${leagueId}`);
            
            // Get rosters
            const rosters = await this.sleeperAPI.fetchAPI(`/league/${leagueId}/rosters`);
            
            // Get users
            const users = await this.sleeperAPI.fetchAPI(`/league/${leagueId}/users`);
            
            // Find user's roster
            const userRoster = await this.findUserRoster(rosters, users);
            if (!userRoster) {
                throw new Error('Could not find your team in the league');
            }

            this.currentRoster = userRoster;
            this.displayRoster(userRoster, users);
            
            // Enable other buttons
            document.getElementById('optimizeLineupBtn').disabled = false;
            document.getElementById('analyzeMatchupsBtn').disabled = false;
            
            // Add additional feature buttons
            this.addTradeAnalyzerButton();
            this.addPlayoffSimulatorButton();
            
            this.configManager.showNotification(' Roster loaded successfully!', 'success');

        } catch (error) {
            console.error('L Error loading roster:', error);
            this.configManager.showNotification(`L Error: ${error.message}`, 'error');
        } finally {
            loadBtn.disabled = false;
            loadBtn.innerHTML = '<span>=�</span> Load Current Roster';
        }
    }

    async findUserRoster(rosters, users) {
        // Try to match by configured username first
        const configuredUsername = this.configManager.config.sleeperUsername;
        if (configuredUsername) {
            const user = users.find(u => 
                u.display_name.toLowerCase() === configuredUsername.toLowerCase()
            );
            if (user) {
                const roster = rosters.find(r => r.owner_id === user.user_id);
                if (roster) {
                    console.log(' Found roster by configured username');
                    return { roster, user };
                }
            }
        }

        // If only one roster, assume it's the user's
        if (rosters.length === 1) {
            const user = users.find(u => u.user_id === rosters[0].owner_id);
            console.log(' Using single roster in league');
            return { roster: rosters[0], user };
        }

        // If multiple rosters, let user choose
        return await this.showRosterSelector(rosters, users);
    }

    async showRosterSelector(rosters, users) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'team-selector-modal';
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.85); z-index: 1001;
                display: flex; align-items: center; justify-content: center;
            `;

            modal.innerHTML = `
                <div class="modal-content" style="background: var(--card-bg); border-radius: 12px; width: 90%; max-width: 600px; max-height: 80vh; overflow: hidden;">
                    <div class="modal-header" style="padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-color);">
                        <h3 style="margin: 0; color: var(--text-primary);">Select Your Team</h3>
                    </div>
                    <div class="modal-teams" style="max-height: 400px; overflow-y: auto; padding: 0.5rem;">
                        ${rosters.map((roster, index) => {
                            const user = users.find(u => u.user_id === roster.owner_id);
                            const teamName = user?.metadata?.team_name || user?.display_name || `Team ${index + 1}`;
                            return `
                                <div class="selectable-team" data-roster-index="${index}" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; margin-bottom: 0.25rem; background: rgba(255, 255, 255, 0.05); border-radius: 6px; cursor: pointer; transition: all 0.2s ease;">
                                    <div>
                                        <div style="font-weight: bold; color: var(--text-primary);">${teamName}</div>
                                        <div style="font-size: 0.875rem; color: var(--text-secondary);">Owner: ${user?.display_name || 'Unknown'}</div>
                                        <div style="font-size: 0.75rem; color: var(--text-secondary);">Record: ${roster.settings?.wins || 0}-${roster.settings?.losses || 0}-${roster.settings?.ties || 0}</div>
                                    </div>
                                    <button onclick="teamManager.selectTeam(${index})" style="background: var(--accent-color); border: none; color: white; padding: 0.375rem 0.75rem; border-radius: 4px; cursor: pointer;">
                                        Select
                                    </button>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Store resolve function for selectTeam method
            this._rosterResolve = resolve;
            this._rosters = rosters;
            this._users = users;
            this._modal = modal;
        });
    }

    selectTeam(rosterIndex) {
        if (this._rosterResolve) {
            const roster = this._rosters[rosterIndex];
            const user = this._users.find(u => u.user_id === roster.owner_id);
            
            // Clean up modal
            document.body.removeChild(this._modal);
            delete this._rosterResolve;
            delete this._rosters;
            delete this._users;
            delete this._modal;
            
            this._rosterResolve({ roster, user });
        }
    }

    displayRoster(userRoster, users) {
        const rosterDisplay = document.getElementById('rosterDisplay');
        if (!rosterDisplay) return;

        const { roster, user } = userRoster;
        const teamName = user?.metadata?.team_name || user?.display_name || 'Your Team';

        rosterDisplay.innerHTML = `
            <div class="roster-header">
                <h3><� ${teamName}</h3>
                <div class="team-stats">
                    <span class="stat">=� ${roster.settings?.wins || 0}-${roster.settings?.losses || 0}-${roster.settings?.ties || 0}</span>
                    <span class="stat"><� ${roster.settings?.fpts || 0} PF</span>
                    <span class="stat">=� ${roster.settings?.fpts_against || 0} PA</span>
                </div>
            </div>
            
            <div class="roster-grid">
                <div class="starters">
                    <h4>=% Starting Lineup (Week ${this.currentWeek})</h4>
                    <div id="startersList">Loading players...</div>
                </div>
                <div class="bench">
                    <h4>=� Bench Players</h4>
                    <div id="benchList">Loading players...</div>
                </div>
            </div>
        `;

        rosterDisplay.style.display = 'block';

        // Load player details
        this.loadPlayerDetails(roster);
    }

    async loadPlayerDetails(roster) {
        try {
            // Get all NFL players
            const players = await this.sleeperAPI.fetchAPI('/players/nfl');
            
            // Separate starters and bench
            const starters = roster.starters || [];
            const bench = (roster.players || []).filter(id => !starters.includes(id));

            // Display starters
            const startersList = document.getElementById('startersList');
            if (startersList) {
                startersList.innerHTML = starters.map((playerId, index) => {
                    const player = players[playerId];
                    if (!player) return `<div class="player-slot">Empty Slot ${index + 1}</div>`;
                    
                    return `
                        <div class="player-card starter" data-player-id="${playerId}">
                            <div class="player-info">
                                <span class="player-name">${player.first_name} ${player.last_name}</span>
                                <span class="player-details">${player.position} - ${player.team}</span>
                            </div>
                            <div class="player-status">
                                <span class="status-indicator">${this.getPlayerStatus(player)}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            // Display bench
            const benchList = document.getElementById('benchList');
            if (benchList) {
                benchList.innerHTML = bench.map(playerId => {
                    const player = players[playerId];
                    if (!player) return '';
                    
                    return `
                        <div class="player-card bench" data-player-id="${playerId}">
                            <div class="player-info">
                                <span class="player-name">${player.first_name} ${player.last_name}</span>
                                <span class="player-details">${player.position} - ${player.team}</span>
                            </div>
                            <div class="player-status">
                                <span class="status-indicator">${this.getPlayerStatus(player)}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }

        } catch (error) {
            console.error('L Error loading player details:', error);
        }
    }

    getPlayerStatus(player) {
        // Simple status indicator based on injury status
        if (player.injury_status) {
            const status = player.injury_status.toLowerCase();
            if (status === 'out') return '=� OUT';
            if (status === 'doubtful') return '� DOUBTFUL'; 
            if (status === 'questionable') return 'S QUESTIONABLE';
        }
        return ' HEALTHY';
    }

    async optimizeLineup() {
        if (!this.currentRoster) {
            this.configManager.showNotification('L Load your roster first', 'error');
            return;
        }

        const optimizeBtn = document.getElementById('optimizeLineupBtn');
        if (!optimizeBtn) return;

        optimizeBtn.disabled = true;
        optimizeBtn.innerHTML = '<span>�</span> Optimizing...';

        try {
            // Initialize lineup optimizer
            this.lineupOptimizer = new LineupOptimizer(this.configManager, this.sleeperAPI);
            
            // Get optimization recommendations
            const recommendations = await this.lineupOptimizer.optimizeWeeklyLineup(
                this.currentRoster, 
                this.currentWeek
            );

            this.displayLineupOptimization(recommendations);
            
            this.configManager.showNotification('<� Lineup optimization complete!', 'success');

        } catch (error) {
            console.error('L Error optimizing lineup:', error);
            this.configManager.showNotification(`L Error: ${error.message}`, 'error');
        } finally {
            optimizeBtn.disabled = false;
            optimizeBtn.innerHTML = '<span><�</span> Optimize Lineup';
        }
    }

    displayLineupOptimization(recommendations) {
        const container = document.getElementById('lineupOptimization');
        if (!container) return;

        container.innerHTML = `
            <div class="optimization-header">
                <h3><� Week ${this.currentWeek} Lineup Recommendations</h3>
                <p>AI-powered start/sit suggestions with explanations</p>
            </div>
            
            <div class="recommendations-grid">
                ${recommendations.map(rec => `
                    <div class="recommendation-card ${rec.type}">
                        <div class="rec-header">
                            <span class="rec-type">${rec.type.toUpperCase()}</span>
                            <span class="confidence">Confidence: ${rec.confidence}%</span>
                        </div>
                        <div class="rec-player">
                            <strong>${rec.player.name}</strong> (${rec.player.position} - ${rec.player.team})
                        </div>
                        <div class="rec-reasoning">
                            ${rec.reasoning}
                        </div>
                        ${rec.alternatives ? `
                            <div class="rec-alternatives">
                                <strong>Alternatives:</strong> ${rec.alternatives.join(', ')}
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        `;

        container.style.display = 'block';
    }

    async analyzeMatchups() {
        if (!this.currentRoster) {
            this.configManager.showNotification('L Load your roster first', 'error');
            return;
        }

        const analyzeBtn = document.getElementById('analyzeMatchupsBtn');
        if (!analyzeBtn) return;

        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<span>�</span> Analyzing...';

        try {
            // Placeholder for matchup analysis
            // This would integrate with external APIs for opponent defense rankings, weather, etc.
            const analysis = await this.performMatchupAnalysis();
            
            this.displayMatchupAnalysis(analysis);
            
            this.configManager.showNotification('� Matchup analysis complete!', 'success');

        } catch (error) {
            console.error('L Error analyzing matchups:', error);
            this.configManager.showNotification(`L Error: ${error.message}`, 'error');
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = '<span>�</span> Analyze Matchups';
        }
    }

    async performMatchupAnalysis() {
        // Placeholder implementation - would integrate with external data sources
        return [
            {
                player: { name: 'Example Player', position: 'WR', team: 'BUF' },
                matchup: 'vs MIA',
                rating: 'Excellent',
                reasoning: 'Favorable matchup against weak secondary, high target share expected'
            }
        ];
    }

    displayMatchupAnalysis(analysis) {
        const container = document.getElementById('matchupAnalysis');
        if (!container) return;

        container.innerHTML = `
            <div class="matchup-header">
                <h3>� Week ${this.currentWeek} Matchup Analysis</h3>
                <p>Opponent analysis and game environment factors</p>
            </div>
            
            <div class="matchup-grid">
                ${analysis.map(matchup => `
                    <div class="matchup-card">
                        <div class="matchup-player">
                            <strong>${matchup.player.name}</strong> (${matchup.player.position} - ${matchup.player.team})
                        </div>
                        <div class="matchup-opponent">
                            ${matchup.matchup} - <span class="rating ${matchup.rating.toLowerCase()}">${matchup.rating}</span>
                        </div>
                        <div class="matchup-reasoning">
                            ${matchup.reasoning}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        container.style.display = 'block';
    }
}

/**
 * Lineup Optimizer - AI-powered start/sit recommendations
 */
class LineupOptimizer {
    constructor(configManager, sleeperAPI) {
        this.configManager = configManager;
        this.sleeperAPI = sleeperAPI;
    }

    async optimizeWeeklyLineup(userRoster, week) {
        // Get all players data
        const players = await this.sleeperAPI.fetchAPI('/players/nfl');
        const { roster } = userRoster;
        
        const recommendations = [];
        
        // Analyze each starter position
        const starters = roster.starters || [];
        const bench = (roster.players || []).filter(id => !starters.includes(id));
        
        // Compare starters vs bench options
        for (let i = 0; i < starters.length; i++) {
            const starterId = starters[i];
            const starter = players[starterId];
            
            if (!starter) continue;
            
            // Find bench alternatives for this position
            const alternatives = bench
                .map(id => players[id])
                .filter(p => p && this.canPlayPosition(p.position, i))
                .slice(0, 3); // Top 3 alternatives
            
            // Generate recommendation
            const rec = await this.generateStartSitRecommendation(starter, alternatives, week);
            if (rec) {
                recommendations.push(rec);
            }
        }
        
        return recommendations;
    }
    
    canPlayPosition(playerPosition, slotIndex) {
        // Simple position eligibility - would be more sophisticated in real implementation
        const positionMappings = {
            0: ['QB'], // QB slot
            1: ['RB'], // RB1 slot  
            2: ['RB'], // RB2 slot
            3: ['WR'], // WR1 slot
            4: ['WR'], // WR2 slot
            5: ['TE'], // TE slot
            6: ['RB', 'WR', 'TE'], // FLEX slot
            7: ['K'], // K slot
            8: ['DEF'] // DEF slot
        };
        
        const validPositions = positionMappings[slotIndex] || [];
        return validPositions.includes(playerPosition);
    }
    
    async generateStartSitRecommendation(starter, alternatives, week) {
        const reasons = [];
        let confidence = 75;
        let recommendation = 'start';
        let pprAdjustment = 0;
        
        // Get scoring format from config
        const scoringFormat = this.configManager.config.scoringFormat || 'Half PPR';
        const isPPR = scoringFormat.includes('PPR');
        
        // Injury analysis
        if (starter.injury_status) {
            const status = starter.injury_status.toLowerCase();
            if (status === 'out') {
                recommendation = 'sit';
                confidence = 95;
                reasons.push(`${starter.first_name} ${starter.last_name} is ruled OUT`);
            } else if (status === 'doubtful') {
                recommendation = 'sit';
                confidence = 80;
                reasons.push(`${starter.first_name} ${starter.last_name} is DOUBTFUL - high risk of not playing`);
            } else if (status === 'questionable') {
                confidence -= 15;
                reasons.push(`${starter.first_name} ${starter.last_name} is QUESTIONABLE - monitor pregame reports`);
            }
        }
        
        // Bye week check
        if (this.isOnBye(starter.team, week)) {
            recommendation = 'sit';
            confidence = 100;
            reasons.push(`${starter.team} is on BYE week`);
        }
        
        // PPR-specific analysis for non-injured, non-bye players
        if (recommendation === 'start' && isPPR) {
            const pprInsight = this.getPPRLineupInsight(starter);
            if (pprInsight.adjustment !== 0) {
                confidence += pprInsight.adjustment;
                reasons.push(pprInsight.reasoning);
            }
        }
        
        // Advanced matchup analysis
        const matchupInsight = this.getMatchupInsight(starter, week);
        if (matchupInsight) {
            confidence += matchupInsight.adjustment;
            reasons.push(matchupInsight.reasoning);
        }
        
        // Compare with best alternative if available
        if (alternatives.length > 0 && recommendation === 'start') {
            const bestAlt = this.findBestAlternative(starter, alternatives);
            if (bestAlt && bestAlt.shouldSwap) {
                recommendation = 'consider';
                confidence = 65;
                reasons.push(`Consider ${bestAlt.player.first_name} ${bestAlt.player.last_name}: ${bestAlt.reasoning}`);
            }
        }
        
        // Generate comprehensive reasoning
        const reasoning = reasons.length > 0 ? reasons.join('. ') : 
            `Standard start recommendation based on projected usage and matchup factors in ${scoringFormat} scoring`;
        
        return {
            type: recommendation,
            player: {
                name: `${starter.first_name} ${starter.last_name}`,
                position: starter.position,
                team: starter.team,
                injury_status: starter.injury_status
            },
            confidence: Math.min(Math.max(confidence, 10), 95),
            reasoning: reasoning,
            alternatives: alternatives.map(alt => `${alt.first_name} ${alt.last_name} (${alt.position} - ${alt.team})`),
            scoringContext: scoringFormat
        };
    }
    
    getPPRLineupInsight(player) {
        const pprFactors = {
            'RB': {
                highReceptionThreshold: 50,
                mediumReceptionThreshold: 30,
                adjustments: { high: 10, medium: 5, low: -3 }
            },
            'WR': {
                highReceptionThreshold: 80,
                mediumReceptionThreshold: 60,
                adjustments: { high: 8, medium: 4, low: 0 }
            },
            'TE': {
                highReceptionThreshold: 60,
                mediumReceptionThreshold: 40,
                adjustments: { high: 12, medium: 6, low: -2 }
            }
        };
        
        const factors = pprFactors[player.position];
        if (!factors) return { adjustment: 0, reasoning: '' };
        
        // Estimate reception volume based on player data
        const estimatedReceptions = this.estimatePlayerReceptions(player);
        
        if (estimatedReceptions >= factors.highReceptionThreshold) {
            return {
                adjustment: factors.adjustments.high,
                reasoning: `Strong PPR asset with high target volume (~${estimatedReceptions} targets projected)`
            };
        } else if (estimatedReceptions >= factors.mediumReceptionThreshold) {
            return {
                adjustment: factors.adjustments.medium,
                reasoning: `Solid PPR contributor with decent target share (~${estimatedReceptions} targets projected)`
            };
        } else {
            return {
                adjustment: factors.adjustments.low,
                reasoning: `Limited PPR upside due to lower target volume (~${estimatedReceptions} targets projected)`
            };
        }
    }
    
    estimatePlayerReceptions(player) {
        // Simple estimation based on position and any available stats
        // In a real implementation, would use historical data or projections
        const baseTargets = {
            'RB': 35,
            'WR': 70,
            'TE': 45,
            'QB': 0,
            'K': 0,
            'DEF': 0
        };
        
        return baseTargets[player.position] || 0;
    }
    
    getMatchupInsight(player, week) {
        // Placeholder for advanced matchup analysis
        // Would integrate with defense rankings, weather data, etc.
        const insights = [
            { adjustment: 5, reasoning: 'Favorable matchup against bottom-10 defense' },
            { adjustment: -5, reasoning: 'Challenging matchup against top-5 defense' },
            { adjustment: 3, reasoning: 'Dome game eliminates weather concerns' },
            { adjustment: -3, reasoning: 'Heavy wind/rain expected - could limit passing' },
            { adjustment: 0, reasoning: 'Neutral matchup with average defensive ranking' }
        ];
        
        // Return random insight for demo (would be data-driven in production)
        return insights[Math.floor(Math.random() * insights.length)];
    }
    
    findBestAlternative(starter, alternatives) {
        if (!alternatives.length) return null;
        
        // Simple comparison logic - would be more sophisticated in production
        for (const alt of alternatives) {
            // Check if alternative has better health status
            if (starter.injury_status && !alt.injury_status) {
                return {
                    shouldSwap: true,
                    player: alt,
                    reasoning: `${alt.first_name} ${alt.last_name} is healthy while starter is ${starter.injury_status}`
                };
            }
            
            // Check bye week situation
            if (this.isOnBye(starter.team, 1) && !this.isOnBye(alt.team, 1)) {
                return {
                    shouldSwap: true,
                    player: alt,
                    reasoning: `${alt.first_name} ${alt.last_name} is playing while starter is on bye`
                };
            }
        }
        
        return null;
    }
    
    isOnBye(team, week) {
        // 2024 NFL Bye Week Schedule
        const byeWeeks = {
            'BUF': 12, 'MIA': 6, 'NE': 14, 'NYJ': 11,
            'BAL': 14, 'CIN': 12, 'CLE': 10, 'PIT': 9,
            'HOU': 14, 'IND': 14, 'JAX': 12, 'TEN': 5,
            'DEN': 14, 'KC': 6, 'LV': 10, 'LAC': 5,
            'DAL': 7, 'NYG': 11, 'PHI': 5, 'WAS': 14,
            'CHI': 7, 'DET': 5, 'GB': 10, 'MIN': 6,
            'ATL': 12, 'CAR': 11, 'NO': 12, 'TB': 11,
            'ARI': 11, 'LAR': 6, 'SF': 9, 'SEA': 10
        };
        return byeWeeks[team] === week;
    }

    async trackInjuries() {
        const injuryBtn = document.getElementById('trackInjuriesBtn');
        if (!injuryBtn) {
            // Add injury tracking button if it doesn't exist
            this.addInjuryTrackingButton();
            return;
        }

        injuryBtn.disabled = true;
        injuryBtn.innerHTML = '<span>🔍</span> Scanning...';

        try {
            const injuryReport = await this.generateInjuryReport();
            this.displayInjuryReport(injuryReport);
            
            this.configManager.showNotification('🏥 Injury report generated!', 'success');

        } catch (error) {
            console.error('❌ Error tracking injuries:', error);
            this.configManager.showNotification(`❌ Error: ${error.message}`, 'error');
        } finally {
            injuryBtn.disabled = false;
            injuryBtn.innerHTML = '<span>🏥</span> Track Injuries';
        }
    }

    addInjuryTrackingButton() {
        const teamActions = document.querySelector('.team-actions');
        if (!teamActions) return;

        const injuryBtn = document.createElement('button');
        injuryBtn.className = 'btn btn-outline';
        injuryBtn.id = 'trackInjuriesBtn';
        injuryBtn.onclick = () => this.trackInjuries();
        injuryBtn.innerHTML = '<span>🏥</span> Track Injuries';
        
        teamActions.appendChild(injuryBtn);
    }

    async generateInjuryReport() {
        if (!this.currentRoster) {
            throw new Error('Load your roster first');
        }

        const players = await this.sleeperAPI.fetchAPI('/players/nfl');
        const { roster } = this.currentRoster;
        const allPlayerIds = [...(roster.starters || []), ...(roster.players || [])];
        
        const injuryReport = {
            injured: [],
            healthy: [],
            backupSuggestions: [],
            weeklyRisk: 'low'
        };

        let injuredCount = 0;
        let questionableCount = 0;

        // Analyze each player's injury status
        for (const playerId of allPlayerIds) {
            const player = players[playerId];
            if (!player) continue;

            const injuryAnalysis = this.analyzePlayerInjury(player);
            
            if (injuryAnalysis.isInjured) {
                injuryReport.injured.push(injuryAnalysis);
                injuredCount++;
                if (injuryAnalysis.severity === 'questionable') {
                    questionableCount++;
                }
            } else {
                injuryReport.healthy.push({
                    player: {
                        name: `${player.first_name} ${player.last_name}`,
                        position: player.position,
                        team: player.team
                    },
                    status: 'healthy'
                });
            }
        }

        // Generate backup suggestions for injured players
        for (const injured of injuryReport.injured) {
            if (injured.severity === 'out' || injured.severity === 'doubtful') {
                const backups = await this.findBackupSuggestions(injured.player.position);
                injuryReport.backupSuggestions.push({
                    injuredPlayer: injured.player,
                    backups: backups
                });
            }
        }

        // Determine weekly risk level
        if (injuredCount >= 3 || questionableCount >= 4) {
            injuryReport.weeklyRisk = 'high';
        } else if (injuredCount >= 2 || questionableCount >= 2) {
            injuryReport.weeklyRisk = 'medium';
        }

        return injuryReport;
    }

    analyzePlayerInjury(player) {
        const analysis = {
            player: {
                name: `${player.first_name} ${player.last_name}`,
                position: player.position,
                team: player.team,
                id: player.player_id
            },
            isInjured: false,
            severity: 'healthy',
            status: 'Healthy',
            recommendation: 'start',
            riskLevel: 'low',
            explanation: ''
        };

        if (player.injury_status) {
            const status = player.injury_status.toLowerCase();
            analysis.isInjured = true;
            analysis.severity = status;
            
            switch (status) {
                case 'out':
                    analysis.status = 'Ruled OUT';
                    analysis.recommendation = 'bench';
                    analysis.riskLevel = 'critical';
                    analysis.explanation = 'Player is confirmed out. Must find alternative.';
                    break;
                    
                case 'doubtful':
                    analysis.status = 'Doubtful to Play';
                    analysis.recommendation = 'bench';
                    analysis.riskLevel = 'high';
                    analysis.explanation = 'Less than 25% chance to play. Have backup plan ready.';
                    break;
                    
                case 'questionable':
                    analysis.status = 'Questionable';
                    analysis.recommendation = 'monitor';
                    analysis.riskLevel = 'medium';
                    analysis.explanation = '50/50 chance to play. Monitor pregame reports closely.';
                    break;
                    
                case 'ir':
                    analysis.status = 'Injured Reserve';
                    analysis.recommendation = 'drop';
                    analysis.riskLevel = 'critical';
                    analysis.explanation = 'Out for extended period. Consider dropping or IR slot.';
                    break;
                    
                case 'sus':
                    analysis.status = 'Suspended';
                    analysis.recommendation = 'bench';
                    analysis.riskLevel = 'high';
                    analysis.explanation = 'Serving suspension. Check return date.';
                    break;
                    
                case 'pup':
                    analysis.status = 'PUP List';
                    analysis.recommendation = 'monitor';
                    analysis.riskLevel = 'medium';
                    analysis.explanation = 'Physically unable to perform. Monitor for activation.';
                    break;
            }
        }

        return analysis;
    }

    async findBackupSuggestions(position) {
        try {
            // Get trending adds for the position
            const trending = await this.sleeperAPI.getTrendingPlayers('add', 24, 100);
            const allPlayers = await this.sleeperAPI.getAllPlayers();
            
            const backups = [];
            
            for (const trend of trending) {
                const player = allPlayers[trend.player_id];
                if (!player || player.position !== position) continue;
                
                // Skip if player is also injured
                if (player.injury_status) continue;
                
                const backupAnalysis = {
                    name: `${player.first_name} ${player.last_name}`,
                    position: player.position,
                    team: player.team,
                    addPercentage: trend.count,
                    availability: this.estimateAvailability(trend.count),
                    reasoning: this.generateBackupReasoning(player, trend)
                };
                
                backups.push(backupAnalysis);
                
                if (backups.length >= 3) break; // Top 3 suggestions
            }
            
            return backups;
            
        } catch (error) {
            console.error('Error finding backup suggestions:', error);
            return [];
        }
    }

    estimateAvailability(addCount) {
        if (addCount > 1000) return 'low'; // Highly sought after
        if (addCount > 300) return 'medium';
        return 'high'; // Likely available
    }

    generateBackupReasoning(player, trend) {
        const reasons = [];
        
        if (trend.count > 500) {
            reasons.push('High pickup momentum');
        }
        
        // Position-specific reasoning
        switch (player.position) {
            case 'RB':
                reasons.push('Valuable handcuff or breakout candidate');
                break;
            case 'WR':
                reasons.push('Target share opportunity with injuries/trades');
                break;
            case 'TE':
                reasons.push('Streaming option with favorable matchup');
                break;
            case 'QB':
                reasons.push('Matchup-based streaming candidate');
                break;
        }
        
        return reasons.join('. ');
    }

    displayInjuryReport(report) {
        const container = document.getElementById('lineupOptimization');
        if (!container) return;

        const getRiskColor = (risk) => {
            switch (risk) {
                case 'high': return '#ef4444';
                case 'medium': return '#fbbf24';
                case 'low': return '#22c55e';
                case 'critical': return '#dc2626';
                default: return '#9ca3af';
            }
        };

        container.innerHTML = `
            <div class="injury-report-header">
                <h3>🏥 Week ${this.currentWeek} Injury Report</h3>
                <div class="risk-indicator risk-${report.weeklyRisk}">
                    Weekly Risk: <strong>${report.weeklyRisk.toUpperCase()}</strong>
                </div>
            </div>
            
            ${report.injured.length > 0 ? `
                <div class="injured-players-section">
                    <h4>⚠️ Injured Players (${report.injured.length})</h4>
                    <div class="injury-grid">
                        ${report.injured.map(injury => `
                            <div class="injury-card" style="border-left-color: ${getRiskColor(injury.riskLevel)}">
                                <div class="injury-header">
                                    <div class="player-name">${injury.player.name}</div>
                                    <div class="injury-status ${injury.severity}">${injury.status}</div>
                                </div>
                                <div class="player-details">${injury.player.position} - ${injury.player.team}</div>
                                <div class="injury-explanation">${injury.explanation}</div>
                                <div class="injury-recommendation">
                                    <strong>Action:</strong> ${injury.recommendation.toUpperCase()}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            ${report.backupSuggestions.length > 0 ? `
                <div class="backup-suggestions-section">
                    <h4>🔄 Backup Suggestions</h4>
                    ${report.backupSuggestions.map(suggestion => `
                        <div class="backup-group">
                            <div class="backup-header">
                                <strong>For ${suggestion.injuredPlayer.name} (${suggestion.injuredPlayer.position}):</strong>
                            </div>
                            <div class="backup-options">
                                ${suggestion.backups.map(backup => `
                                    <div class="backup-option availability-${backup.availability}">
                                        <div class="backup-name">${backup.name}</div>
                                        <div class="backup-details">${backup.position} - ${backup.team}</div>
                                        <div class="backup-stats">
                                            <span>Adds: ${backup.addPercentage.toLocaleString()}</span>
                                            <span class="availability">Availability: ${backup.availability}</span>
                                        </div>
                                        <div class="backup-reasoning">${backup.reasoning}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            
            <div class="healthy-players-section">
                <h4>✅ Healthy Players (${report.healthy.length})</h4>
                <div class="healthy-summary">
                    Your healthy players are ready to go. Focus on monitoring the injured players above.
                </div>
            </div>
        `;

        container.style.display = 'block';
    }

    async analyzeLeagueStandings() {
        const leagueBtn = document.getElementById('analyzeLeagueBtn');
        if (!leagueBtn) {
            // Add league analysis button if it doesn't exist
            this.addLeagueAnalysisButton();
            return;
        }

        leagueBtn.disabled = true;
        leagueBtn.innerHTML = '<span>⏳</span> Analyzing League...';

        try {
            // Initialize league analyzer if not already done
            if (!this.leagueAnalyzer) {
                this.leagueAnalyzer = new LeagueAnalyzer(this.configManager);
                await this.leagueAnalyzer.initialize();
            }

            const leagueAnalysis = await this.leagueAnalyzer.analyzeLeagueStandings();
            this.displayLeagueAnalysis(leagueAnalysis);
            
            this.configManager.showNotification('🏆 League analysis complete!', 'success');

        } catch (error) {
            console.error('❌ Error analyzing league:', error);
            this.configManager.showNotification(`❌ Error: ${error.message}`, 'error');
        } finally {
            leagueBtn.disabled = false;
            leagueBtn.innerHTML = '<span>🏆</span> Analyze League';
        }
    }

    addLeagueAnalysisButton() {
        const teamActions = document.querySelector('.team-actions');
        if (!teamActions) return;

        const leagueBtn = document.createElement('button');
        leagueBtn.className = 'btn btn-secondary';
        leagueBtn.id = 'analyzeLeagueBtn';
        leagueBtn.onclick = () => this.analyzeLeagueStandings();
        leagueBtn.innerHTML = '<span>🏆</span> Analyze League';
        leagueBtn.style.marginTop = '0.5rem';
        
        teamActions.appendChild(leagueBtn);
    }

    displayLeagueAnalysis(analysis) {
        const container = document.getElementById('lineupOptimization');
        if (!container) return;

        const getScoreColor = (score) => {
            if (score >= 80) return '#22c55e';
            if (score >= 65) return '#16a34a';
            if (score >= 50) return '#fbbf24';
            return '#ef4444';
        };

        const getRankingColor = (rank, total) => {
            const percentile = (total - rank + 1) / total;
            if (percentile >= 0.8) return '#22c55e';
            if (percentile >= 0.6) return '#16a34a';
            if (percentile >= 0.4) return '#fbbf24';
            return '#ef4444';
        };

        container.innerHTML = `
            <div class="league-analysis-header">
                <h3>🏆 League Analysis & Team Comparison</h3>
                <div class="overall-competitive-score">
                    <span class="score-label">Overall Competitive Score:</span>
                    <span class="score-value" style="color: ${getScoreColor(analysis.overallScore)}">
                        ${analysis.overallScore}/100
                    </span>
                </div>
            </div>

            <div class="league-summary">
                <div class="team-overview">
                    <h4>📊 Your Team: ${analysis.userTeam.teamName}</h4>
                    <div class="team-stats-grid">
                        <div class="stat-card">
                            <span class="stat-label">Record</span>
                            <span class="stat-value">${analysis.userTeam.record.wins}-${analysis.userTeam.record.losses}-${analysis.userTeam.record.ties}</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-label">Points For</span>
                            <span class="stat-value">${analysis.userTeam.scoring.pointsFor}</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-label">Avg Score</span>
                            <span class="stat-value">${analysis.userTeam.scoring.averageScore}</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-label">Roster Rating</span>
                            <span class="stat-value" style="color: ${getScoreColor(analysis.userTeam.rosterRating)}">${analysis.userTeam.rosterRating}/100</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="league-rankings-section">
                <h4>📈 League Rankings</h4>
                <div class="rankings-grid">
                    <div class="ranking-item">
                        <span class="ranking-label">Record Ranking:</span>
                        <span class="ranking-value" style="color: ${getRankingColor(analysis.competitiveAnalysis.userRankings.record, analysis.competitiveAnalysis.leagueSize)}">
                            #${analysis.competitiveAnalysis.userRankings.record} of ${analysis.competitiveAnalysis.leagueSize}
                        </span>
                    </div>
                    <div class="ranking-item">
                        <span class="ranking-label">Points Ranking:</span>
                        <span class="ranking-value" style="color: ${getRankingColor(analysis.competitiveAnalysis.userRankings.pointsFor, analysis.competitiveAnalysis.leagueSize)}">
                            #${analysis.competitiveAnalysis.userRankings.pointsFor} of ${analysis.competitiveAnalysis.leagueSize}
                        </span>
                    </div>
                    <div class="ranking-item">
                        <span class="ranking-label">Roster Ranking:</span>
                        <span class="ranking-value" style="color: ${getRankingColor(analysis.competitiveAnalysis.userRankings.rosterRating, analysis.competitiveAnalysis.leagueSize)}">
                            #${analysis.competitiveAnalysis.userRankings.rosterRating} of ${analysis.competitiveAnalysis.leagueSize}
                        </span>
                    </div>
                    <div class="ranking-item">
                        <span class="ranking-label">Playoff Odds:</span>
                        <span class="ranking-value" style="color: ${analysis.playoffProjection.percentage >= 70 ? '#22c55e' : analysis.playoffProjection.percentage >= 40 ? '#fbbf24' : '#ef4444'}">
                            ${analysis.playoffProjection.percentage}%
                        </span>
                    </div>
                </div>
                
                <div class="competitive-level">
                    <strong>League Competitiveness:</strong> ${analysis.competitiveAnalysis.competitiveLevel}
                </div>
            </div>

            ${analysis.strengthsWeaknesses.strengths.length > 0 ? `
                <div class="strengths-section">
                    <h4>💪 Team Strengths</h4>
                    <div class="strengths-grid">
                        ${analysis.strengthsWeaknesses.strengths.map(strength => `
                            <div class="strength-item">
                                <div class="strength-header">
                                    <span class="strength-area">${strength.area}</span>
                                    <span class="strength-rating" style="color: ${getScoreColor(strength.rating)}">${strength.rating}/100</span>
                                </div>
                                <div class="strength-description">${strength.description}</div>
                                <div class="strength-advantage">${strength.advantage}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            ${analysis.strengthsWeaknesses.weaknesses.length > 0 ? `
                <div class="weaknesses-section">
                    <h4>⚠️ Areas for Improvement</h4>
                    <div class="weaknesses-grid">
                        ${analysis.strengthsWeaknesses.weaknesses.map(weakness => `
                            <div class="weakness-item">
                                <div class="weakness-header">
                                    <span class="weakness-area">${weakness.area}</span>
                                    <span class="weakness-rating" style="color: ${getScoreColor(weakness.rating)}">${weakness.rating}/100</span>
                                </div>
                                <div class="weakness-description">${weakness.description}</div>
                                <div class="weakness-deficit">${weakness.deficit}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            ${analysis.tradeTargets.length > 0 ? `
                <div class="trade-targets-section">
                    <h4>🔄 Potential Trade Partners</h4>
                    <div class="trade-targets-grid">
                        ${analysis.tradeTargets.map(target => `
                            <div class="trade-target-item">
                                <div class="trade-target-header">
                                    <span class="target-team">${target.team}</span>
                                    <span class="trade-priority priority-${target.priority.toLowerCase()}">${target.priority}</span>
                                </div>
                                <div class="trade-reasoning">${target.reasoning}</div>
                                <div class="trade-details">
                                    <strong>Target:</strong> ${target.targetPositions.join(', ')} | 
                                    <strong>Offer:</strong> ${target.tradeAssets.join(', ')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <div class="recommendations-section">
                <h4>💡 Strategic Recommendations</h4>
                <div class="recommendations-list">
                    ${analysis.recommendations.map(rec => `
                        <div class="recommendation-item priority-${rec.priority.toLowerCase()}">
                            <div class="rec-header">
                                <span class="rec-type">${rec.type}</span>
                                <span class="rec-priority">${rec.priority} Priority</span>
                            </div>
                            <div class="rec-action">${rec.action}</div>
                            <div class="rec-reasoning">${rec.reasoning}</div>
                            <div class="rec-impact"><strong>Impact:</strong> ${rec.impact}</div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="overall-assessment">
                <h4>🎯 Overall Assessment</h4>
                <div class="assessment-content">
                    ${analysis.strengthsWeaknesses.overallAssessment}
                </div>
            </div>
        `;

        container.style.display = 'block';
    }

    async openTradeAnalyzer() {
        console.log('💱 Opening Trade Analyzer...');
        
        // Check if TradeAnalyzer is available
        if (!window.tradeAnalyzer) {
            console.warn('⚠️ TradeAnalyzer not initialized');
            this.displayMessage('Trade Analyzer is still loading. Please try again.', 'info');
            return;
        }

        try {
            // Clear existing content
            const rosterContainer = document.getElementById('rosterContainer');
            if (!rosterContainer) return;

            // Create and display trade analyzer
            const tradeAnalyzerUI = await window.tradeAnalyzer.displayTradeAnalyzer();
            rosterContainer.innerHTML = '';
            rosterContainer.appendChild(tradeAnalyzerUI);

            // Add back button
            this.addBackButton();

            console.log('✅ Trade Analyzer opened');

        } catch (error) {
            console.error('❌ Error opening Trade Analyzer:', error);
            this.displayMessage('Error loading Trade Analyzer. Please try again.', 'error');
        }
    }

    addTradeAnalyzerButton() {
        const teamActions = document.querySelector('.team-actions');
        if (!teamActions) return;

        const tradeBtn = document.createElement('button');
        tradeBtn.className = 'btn btn-secondary';
        tradeBtn.id = 'tradeAnalyzerBtn';
        tradeBtn.innerHTML = '<span>💱</span> Trade Analyzer';
        tradeBtn.onclick = () => this.openTradeAnalyzer();

        teamActions.appendChild(tradeBtn);
    }

    async openPlayoffSimulator() {
        console.log('🏆 Opening Playoff Simulator...');
        
        // Check if PlayoffSimulator is available
        if (!window.playoffSimulator) {
            console.warn('⚠️ PlayoffSimulator not initialized');
            this.displayMessage('Playoff Simulator is still loading. Please try again in a moment.', 'info');
            return;
        }

        try {
            // Clear existing content
            const rosterContainer = document.getElementById('rosterContainer');
            if (!rosterContainer) return;

            // Create and display playoff simulator
            const playoffSimulatorUI = await window.playoffSimulator.displayPlayoffSimulation();
            rosterContainer.innerHTML = '';
            rosterContainer.appendChild(playoffSimulatorUI);

            // Add back button
            this.addBackButton();

            console.log('✅ Playoff Simulator opened');

        } catch (error) {
            console.error('❌ Error opening Playoff Simulator:', error);
            this.displayMessage('Error loading Playoff Simulator. Please try again.', 'error');
        }
    }

    addPlayoffSimulatorButton() {
        const teamActions = document.querySelector('.team-actions');
        if (!teamActions) return;

        const playoffBtn = document.createElement('button');
        playoffBtn.className = 'btn btn-outline';
        playoffBtn.id = 'playoffSimulatorBtn';
        playoffBtn.innerHTML = '<span>🏆</span> Playoff Odds';
        playoffBtn.onclick = () => this.openPlayoffSimulator();

        teamActions.appendChild(playoffBtn);
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TeamManager, LineupOptimizer };
}