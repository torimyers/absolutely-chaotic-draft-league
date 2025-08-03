// Enhanced Draft Tracker - Complete Sleeper Integration
// Add this to your existing app.js file

class DraftTracker {
    constructor(configManager) {
        this.configManager = configManager;
        this.draftId = null;
        this.draftData = null;
        this.picks = [];
        this.isTracking = false;
        this.updateInterval = null;
        this.userRosterId = null;
        this.panicMode = false;
        
        // AI Analysis System
        this.playerDatabase = new Map();
        this.positionScarcity = {
            QB: { total: 0, drafted: 0 },
            RB: { total: 0, drafted: 0 },
            WR: { total: 0, drafted: 0 },
            TE: { total: 0, drafted: 0 },
            K: { total: 0, drafted: 0 },
            DEF: { total: 0, drafted: 0 }
        };
        
        this.initializeDraftTracker();
    }

    async initializeDraftTracker() {
        // Load player database for AI analysis
        await this.loadPlayerDatabase();
        this.setupDraftUI();
    }

    async loadPlayerDatabase() {
        try {
            // Fetch current NFL players from Sleeper
            const playersResponse = await fetch('https://api.sleeper.app/v1/players/nfl');
            const players = await playersResponse.json();
            
            // Process and store player data
            Object.entries(players).forEach(([playerId, player]) => {
                if (player.active && player.fantasy_positions) {
                    this.playerDatabase.set(playerId, {
                        id: playerId,
                        name: `${player.first_name} ${player.last_name}`,
                        position: player.fantasy_positions[0],
                        team: player.team,
                        age: player.age,
                        experience: player.years_exp,
                        // AI scoring factors
                        adp: player.search_rank || 999,
                        tier: this.calculatePlayerTier(player),
                        riskLevel: this.calculateRiskLevel(player)
                    });
                }
            });
            
            console.log(`📊 Loaded ${this.playerDatabase.size} players for AI analysis`);
            this.configManager.showNotification(`📊 Player database loaded: ${this.playerDatabase.size} players`, 'success');
            
        } catch (error) {
            console.error('Error loading player database:', error);
            this.configManager.showNotification('⚠️ Could not load player database. Draft analysis may be limited.', 'warning');
        }
    }

    calculatePlayerTier(player) {
        // Simple tier calculation based on search rank
        const rank = player.search_rank || 999;
        if (rank <= 36) return 'Elite';
        if (rank <= 72) return 'High';
        if (rank <= 120) return 'Mid';
        if (rank <= 180) return 'Deep';
        return 'Flyer';
    }

    calculateRiskLevel(player) {
        // Calculate risk based on age, injury history, etc.
        let risk = 0;
        if (player.age > 30) risk += 2;
        if (player.years_exp < 2) risk += 1;
        if (player.injury_status) risk += 3;
        
        if (risk >= 4) return 'High';
        if (risk >= 2) return 'Medium';
        return 'Low';
    }

    async startDraftTracking() {
        const leagueId = this.configManager.config.sleeperLeagueId;
        if (!leagueId) {
            this.configManager.showNotification('❌ Please configure your Sleeper League ID first', 'error');
            return;
        }

        try {
            this.configManager.showNotification('🔍 Finding your draft...', 'info');
            
            // Get draft information
            const draftsResponse = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`);
            const drafts = await draftsResponse.json();
            
            if (!drafts || drafts.length === 0) {
                throw new Error('No drafts found for this league');
            }

            // Get the most recent draft
            this.draftId = drafts[0].draft_id;
            this.draftData = drafts[0];
            
            // Check draft status
            const draftStatus = this.draftData.status;
            const draftType = this.draftData.type;
            
            console.log('📋 Draft info:', {
                id: this.draftId,
                status: draftStatus,
                type: draftType,
                start_time: this.draftData.start_time
            });
            
            if (draftStatus === 'complete') {
                this.configManager.showNotification('✅ This draft is already complete!', 'warning');
                // Still load picks to show draft recap
            } else if (draftStatus === 'pre_draft') {
                const startTime = new Date(this.draftData.start_time);
                const now = new Date();
                const minutesUntilDraft = Math.round((startTime - now) / 60000);
                
                if (minutesUntilDraft > 60) {
                    this.configManager.showNotification(`⏰ Draft starts in ${Math.round(minutesUntilDraft / 60)} hours`, 'info');
                } else if (minutesUntilDraft > 0) {
                    this.configManager.showNotification(`⏰ Draft starts in ${minutesUntilDraft} minutes! Get ready!`, 'warning');
                } else {
                    this.configManager.showNotification('🚀 Draft should be starting soon!', 'info');
                }
            } else if (draftStatus === 'drafting') {
                this.configManager.showNotification('🔥 DRAFT IS LIVE! Starting real-time tracking...', 'success');
            }
            
            // Get user's roster ID
            await this.identifyUserRoster(leagueId);
            
            // Start tracking
            this.isTracking = true;
            this.updateDraftStatus();
            this.startPolling();
            
            // Update UI to show tracking is active
            const draftStatusElement = document.getElementById('draftStatus');
            if (draftStatusElement) {
                draftStatusElement.textContent = `Tracking ${draftType} draft - ${draftStatus}`;
                draftStatusElement.style.color = 'var(--success-color)';
            }
            
        } catch (error) {
            console.error('Error starting draft tracking:', error);
            this.configManager.showNotification(`❌ Could not start draft tracking: ${error.message}`, 'error');
        }
    }

    async identifyUserRoster(leagueId) {
        try {
            const rostersResponse = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
            const rosters = await rostersResponse.json();
            
            // Try to match with configured team name or user
            const configuredTeamName = this.configManager.config.teamName;
            
            if (configuredTeamName && window.sleeperUsers) {
                const user = window.sleeperUsers.find(u => 
                    u.display_name === configuredTeamName || 
                    u.username === configuredTeamName
                );
                
                if (user) {
                    const roster = rosters.find(r => r.owner_id === user.user_id);
                    if (roster) {
                        this.userRosterId = roster.roster_id;
                        console.log('🎯 Identified user roster:', this.userRosterId);
                        return;
                    }
                }
            }
            
            // If no match, we'll need manual selection during draft
            console.log('❓ Could not auto-identify user roster');
            
        } catch (error) {
            console.error('Error identifying user roster:', error);
        }
    }

    startPolling() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        
        // Poll every 3 seconds during active draft
        this.updateInterval = setInterval(() => {
            this.updateDraftStatus();
        }, 3000);
    }

    stopPolling() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.isTracking = false;
    }

    async updateDraftStatus() {
        if (!this.draftId) return;

        try {
            // Get current draft picks
            const picksResponse = await fetch(`https://api.sleeper.app/v1/draft/${this.draftId}/picks`);
            const currentPicks = await picksResponse.json();
            
            // Check for new picks
            const newPicks = currentPicks.slice(this.picks.length);
            
            if (newPicks.length > 0) {
                // Process new picks
                for (const pick of newPicks) {
                    await this.processPick(pick);
                }
                
                this.picks = currentPicks;
                this.updateDraftDisplay();
                this.checkUserTurn();
                this.updatePositionScarcity();
            }
            
        } catch (error) {
            console.error('Error updating draft status:', error);
        }
    }

    async processPick(pick) {
        const player = this.playerDatabase.get(pick.player_id);
        
        if (player) {
            // Generate AI analysis for this pick
            const analysis = this.generatePickAnalysis(pick, player);
            
            // Display pick with analysis
            this.displayPick(pick, player, analysis);
            
            // Update position tracking
            this.positionScarcity[player.position].drafted++;
            
            console.log(`📝 Pick ${pick.pick_no}: ${player.name} (${player.position}) - ${analysis.grade}`);
        }
    }

    generatePickAnalysis(pick, player) {
        const pickNumber = pick.pick_no;
        const expectedRange = this.getExpectedPickRange(player);
        const positionScarcity = this.calculateCurrentScarcity(player.position);
        
        // Determine pick grade
        let grade = 'Good Pick';
        let reasoning = [];
        let confidence = 75;
        
        // Value analysis
        if (pickNumber < expectedRange.early) {
            grade = 'Reach';
            reasoning.push(`Drafted ${expectedRange.early - pickNumber} picks early`);
            confidence -= 15;
        } else if (pickNumber > expectedRange.late) {
            grade = 'Great Value';
            reasoning.push(`Fell ${pickNumber - expectedRange.late} picks past ADP`);
            confidence += 20;
        } else {
            reasoning.push('Drafted within expected range');
        }
        
        // Position scarcity analysis
        if (positionScarcity.level === 'Critical') {
            reasoning.push(`${player.position} position is running thin`);
            confidence += 10;
        } else if (positionScarcity.level === 'Abundant') {
            reasoning.push(`Many ${player.position}s still available`);
            confidence -= 5;
        }
        
        // Player-specific factors
        if (player.tier === 'Elite') {
            reasoning.push('Elite tier player');
            confidence += 15;
        }
        
        if (player.riskLevel === 'High') {
            reasoning.push('Higher injury/performance risk');
            confidence -= 10;
        }
        
        // Educational insights
        const educationalTip = this.getEducationalTip(pick, player, grade);
        
        return {
            grade,
            reasoning,
            confidence: Math.max(10, Math.min(95, confidence)),
            educationalTip,
            positionScarcity: positionScarcity.level
        };
    }

    getExpectedPickRange(player) {
        const adp = player.adp;
        return {
            early: Math.max(1, adp - 12),
            late: Math.min(300, adp + 12)
        };
    }

    calculateCurrentScarcity(position) {
        const drafted = this.positionScarcity[position].drafted;
        const remaining = this.getRemainingStarters(position) - drafted;
        
        let level = 'Normal';
        if (remaining <= 3) level = 'Critical';
        else if (remaining <= 8) level = 'Scarce';
        else if (remaining >= 20) level = 'Abundant';
        
        return { level, remaining };
    }

    getRemainingStarters(position) {
        // Estimate starter-quality players by position
        const starterCounts = {
            QB: 15,    // ~12 + backups
            RB: 30,    // ~24 + handcuffs
            WR: 36,    // ~30 + depth
            TE: 15,    // ~12 + backups
            K: 12,     // One per team
            DEF: 12    // One per team
        };
        return starterCounts[position] || 12;
    }

    getEducationalTip(pick, player, grade) {
        const tips = {
            'Reach': [
                `Reaching for players can work if you love the talent, but consider opportunity cost - who else was available?`,
                `Early picks should prioritize safety and high floors over upside in most cases.`,
                `If this is your favorite player, the reach might be worth it for team building confidence.`
            ],
            'Great Value': [
                `Value picks like this are how you win leagues - accumulating talent that falls past ADP.`,
                `When a player falls, ask WHY - is it injury concerns, age, or just draft flow?`,
                `Banking value early allows you to take more risks in later rounds.`
            ],
            'Good Pick': [
                `Solid, consensus pick that fills a need without major positional reaches.`,
                `Safe picks in early rounds help establish a strong foundation for your team.`,
                `This pick likely fits most draft strategy philosophies.`
            ]
        };
        
        const tipsList = tips[grade] || tips['Good Pick'];
        return tipsList[Math.floor(Math.random() * tipsList.length)];
    }

    checkUserTurn() {
        if (!this.userRosterId || !this.draftData) return;
        
        // Check if it's user's turn based on draft order and current pick
        const totalPicks = this.picks.length;
        const currentRound = Math.floor(totalPicks / this.draftData.settings.teams) + 1;
        const pickInRound = (totalPicks % this.draftData.settings.teams) + 1;
        
        // Sleeper draft orders can be complex, but we'll estimate
        const isUsersTurn = this.estimateIfUsersTurn(currentRound, pickInRound);
        
        if (isUsersTurn && !this.panicMode) {
            this.activatePanicMode();
        } else if (!isUsersTurn && this.panicMode) {
            this.deactivatePanicMode();
        }
    }

    estimateIfUsersTurn(round, pickInRound) {
        // This is a simplified estimation - real implementation would need draft order
        // For now, we'll trigger panic mode periodically for demo
        return (this.picks.length + 1) % 12 === (this.userRosterId || 1);
    }

    activatePanicMode() {
        this.panicMode = true;
        
        // Generate emergency recommendations
        const recommendations = this.generatePanicRecommendations();
        
        // Update UI with panic mode
        this.displayPanicMode(recommendations);
        
        // Urgent notification
        this.configManager.showNotification('🚨 YOUR TURN! Panic Mode activated with emergency picks', 'warning');
        
        // Flash the page title
        this.flashPageTitle();
    }

    deactivatePanicMode() {
        this.panicMode = false;
        this.clearPanicMode();
    }

    generatePanicRecommendations() {
        // Get best available players by position
        const availablePlayers = Array.from(this.playerDatabase.values())
            .filter(player => !this.picks.some(pick => pick.player_id === player.id))
            .sort((a, b) => a.adp - b.adp)
            .slice(0, 50); // Top 50 available
        
        // Generate top 3 recommendations with different strategies
        const recommendations = [
            {
                player: availablePlayers[0],
                strategy: 'Best Available',
                reasoning: 'Highest ranked player still available',
                confidence: 90
            },
            {
                player: availablePlayers.find(p => p.position === 'RB') || availablePlayers[1],
                strategy: 'Position Need',
                reasoning: 'RB scarcity makes this valuable',
                confidence: 80
            },
            {
                player: availablePlayers.find(p => p.tier === 'Elite') || availablePlayers[2],
                strategy: 'Elite Talent',
                reasoning: 'Last chance at elite tier player',
                confidence: 85
            }
        ];
        
        return recommendations.filter(r => r.player);
    }

    flashPageTitle() {
        const originalTitle = document.title;
        let flashCount = 0;
        
        const flashInterval = setInterval(() => {
            document.title = flashCount % 2 === 0 ? '🚨 YOUR TURN!' : originalTitle;
            flashCount++;
            
            if (flashCount >= 10) {
                clearInterval(flashInterval);
                document.title = originalTitle;
            }
        }, 500);
    }

    setupDraftUI() {
        // This will be called to enhance the existing draft page
        const draftPage = document.getElementById('live-draft');
        if (!draftPage) return;
        
        // Add draft tracking controls
        const trackingHTML = `
            <div class="draft-tracker-controls" style="margin-bottom: 20px;">
                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title">🔥 Live Draft Tracker</h3>
                        <div class="draft-status" id="draftStatus">Ready to Track</div>
                    </div>
                    <div style="display: flex; gap: 15px; margin-bottom: 15px;">
                        <button class="btn btn-primary" data-action="start-draft-tracking" id="startDraftBtn">
                            <span>🚀</span> Start Draft Tracking
                        </button>
                        <button class="btn btn-secondary" data-action="stop-draft-tracking" id="stopDraftBtn" disabled>
                            <span>⏹️</span> Stop Tracking
                        </button>
                        <button class="btn btn-warning" data-action="activate-panic-mode" id="panicBtn">
                            <span>🚨</span> Test Panic Mode
                        </button>
                    </div>
                    <div class="draft-info" id="draftInfo" style="display: none;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px;">
                            <div class="metric-card">
                                <div class="metric-value" id="totalPicks">0</div>
                                <div class="metric-label">Total Picks</div>
                            </div>
                            <div class="metric-card">
                                <div class="metric-value" id="currentRound">1</div>
                                <div class="metric-label">Round</div>
                            </div>
                            <div class="metric-card">
                                <div class="metric-value" id="yourPicks">0</div>
                                <div class="metric-label">Your Picks</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Panic Mode Panel -->
            <div class="panic-mode-panel" id="panicModePanel" style="display: none;">
                <div class="card" style="border: 3px solid var(--warning-color); background: rgba(243, 156, 18, 0.1);">
                    <div class="card-header">
                        <h3 class="card-title" style="color: var(--warning-color);">🚨 PANIC MODE - YOUR TURN!</h3>
                        <div class="countdown" id="panicCountdown">Time running out!</div>
                    </div>
                    <div id="panicRecommendations">
                        <p>Loading emergency recommendations...</p>
                    </div>
                </div>
            </div>

            <!-- Draft Feed -->
            <div class="draft-feed-container">
                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title">📊 Live Draft Feed with AI Analysis</h3>
                    </div>
                    <div class="draft-feed" id="draftFeed">
                        <div class="empty-state">
                            <div class="icon">⏳</div>
                            <h3>Ready for Draft</h3>
                            <p>Start draft tracking to see live picks with AI analysis and educational insights!</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Position Scarcity Tracker -->
            <div class="position-tracker" id="positionTracker" style="display: none;">
                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title">🎯 Position Scarcity Tracker</h3>
                    </div>
                    <div class="scarcity-grid" id="scarcityGrid">
                        <!-- Will be populated by JavaScript -->
                    </div>
                </div>
            </div>
        `;
        
        // Replace empty state with tracking interface
        const emptyState = draftPage.querySelector('.empty-state');
        if (emptyState) {
            emptyState.parentElement.innerHTML = trackingHTML;
        }
    }

    updateDraftDisplay() {
        // Update draft info metrics
        const totalPicks = this.picks.length;
        const currentRound = Math.floor(totalPicks / (this.draftData?.settings?.teams || 12)) + 1;
        
        document.getElementById('totalPicks').textContent = totalPicks;
        document.getElementById('currentRound').textContent = currentRound;
        document.getElementById('draftInfo').style.display = 'block';
        
        // Update draft status
        const statusElement = document.getElementById('draftStatus');
        if (statusElement) {
            statusElement.textContent = this.isTracking ? 
                `Tracking - ${totalPicks} picks made` : 'Not tracking';
            statusElement.style.color = this.isTracking ? 'var(--success-color)' : 'var(--text-secondary)';
        }
        
        // Update position scarcity
        this.updatePositionScarcityDisplay();
    }

    displayPick(pick, player, analysis) {
        const feedElement = document.getElementById('draftFeed');
        if (!feedElement) return;
        
        // Clear empty state if this is first pick
        if (this.picks.length === 1) {
            feedElement.innerHTML = '';
        }
        
        const pickElement = document.createElement('div');
        pickElement.className = 'draft-pick-analysis';
        pickElement.innerHTML = `
            <div class="pick-item" style="border-left: 4px solid ${this.getGradeColor(analysis.grade)};">
                <div class="pick-header">
                    <div class="pick-number">Pick ${pick.pick_no}</div>
                    <div class="pick-grade ${analysis.grade.toLowerCase().replace(' ', '-')}">${analysis.grade}</div>
                    <div class="confidence-badge">AI: ${analysis.confidence}%</div>
                </div>
                <div class="pick-player">
                    <strong>${player.name}</strong> (${player.position} - ${player.team})
                </div>
                <div class="pick-analysis">
                    <div class="analysis-reasoning">
                        ${analysis.reasoning.map(reason => `• ${reason}`).join('<br>')}
                    </div>
                    <div class="learning-tip" style="margin-top: 8px;">
                        💡 <strong>Learn:</strong> ${analysis.educationalTip}
                    </div>
                </div>
            </div>
        `;
        
        // Insert at top for most recent picks
        feedElement.insertBefore(pickElement, feedElement.firstChild);
        
        // Limit to last 10 picks for performance
        while (feedElement.children.length > 10) {
            feedElement.removeChild(feedElement.lastChild);
        }
    }

    displayPanicMode(recommendations) {
        const panicPanel = document.getElementById('panicModePanel');
        const recommendationsElement = document.getElementById('panicRecommendations');
        
        if (!panicPanel || !recommendationsElement) return;
        
        panicPanel.style.display = 'block';
        
        const recommendationsHTML = `
            <h4 style="color: var(--warning-color); margin-bottom: 15px;">🚨 Emergency Recommendations</h4>
            <div class="panic-recommendations">
                ${recommendations.map((rec, index) => `
                    <div class="panic-rec" style="background: rgba(255, 255, 255, 0.05); padding: 12px; border-radius: 8px; margin-bottom: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <strong>${rec.player.name}</strong>
                            <span class="confidence-badge">AI: ${rec.confidence}%</span>
                        </div>
                        <div style="font-size: 0.9em; color: var(--text-secondary);">
                            ${rec.player.position} - ${rec.strategy}: ${rec.reasoning}
                        </div>
                    </div>
                `).join('')}
            </div>
            <div style="text-align: center; margin-top: 15px;">
                <button class="btn btn-warning" data-action="deactivate-panic-mode">
                    <span>✅</span> Pick Made - Exit Panic Mode
                </button>
            </div>
        `;
        
        recommendationsElement.innerHTML = recommendationsHTML;
    }

    clearPanicMode() {
        const panicPanel = document.getElementById('panicModePanel');
        if (panicPanel) {
            panicPanel.style.display = 'none';
        }
    }

    updatePositionScarcityDisplay() {
        const trackerElement = document.getElementById('positionTracker');
        const gridElement = document.getElementById('scarcityGrid');
        
        if (!trackerElement || !gridElement || this.picks.length === 0) return;
        
        trackerElement.style.display = 'block';
        
        const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
        
        gridElement.innerHTML = positions.map(pos => {
            const scarcity = this.calculateCurrentScarcity(pos);
            const drafted = this.positionScarcity[pos].drafted;
            
            return `
                <div class="scarcity-item" style="text-align: center; padding: 10px;">
                    <div class="position-name" style="font-weight: bold; margin-bottom: 5px;">${pos}</div>
                    <div class="drafted-count" style="font-size: 1.2em; margin-bottom: 3px;">${drafted}</div>
                    <div class="scarcity-level ${scarcity.level.toLowerCase()}" style="font-size: 0.8em; padding: 2px 6px; border-radius: 8px;">
                        ${scarcity.level}
                    </div>
                </div>
            `;
        }).join('');
    }

    getGradeColor(grade) {
        const colors = {
            'Great Value': 'var(--success-color)',
            'Good Pick': 'var(--primary-color)',
            'Reach': 'var(--warning-color)'
        };
        return colors[grade] || 'var(--accent-color)';
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DraftTracker;
}