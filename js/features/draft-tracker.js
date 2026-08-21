// Enhanced Draft Tracker - Complete Sleeper Integration
// Add this to your existing app.js file

class DraftTracker {
    constructor(configManager) {
        this.configManager = configManager;
        this.sleeperAPI = new SleeperAPI();
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
        
        // Audio System
        this.audioEnabled = true;
        this.audioContext = null;
        this.sounds = {
            yourTurn: null,
            pickMade: null,
            warning: null,
            countdown: null
        };
        
        // Timer System
        this.pickTimer = null;
        this.pickDeadline = null;
        this.timerInterval = null;
        
        // Queue System
        this.draftQueue = [];
        this.queuedPlayers = new Set();
        
        // Draft Plan System
        this.draftPlan = {};
        this.planBackups = {};
        
        // Set up UI immediately in constructor
        this.setupDraftUI();
        this.setupKeyboardShortcuts();
        this.loadPlanFromStorage();
        
        // Initialize async components
        this.initializeDraftTracker();
    }

    async initializeDraftTracker() {
        console.log('🔄 DraftTracker: Starting async initialization...');
        
        // Load player database for AI analysis (async)
        await this.loadPlayerDatabase();
        this.initializeAudio();
        
        console.log('✅ DraftTracker: Full initialization complete');
    }

    async loadPlayerDatabase() {
        try {
            // Routed through SleeperAPI rather than a bare fetch so this shares the
            // cache and in-flight request with every other feature. This is the
            // ~5 MB player dump, and several managers ask for it at startup.
            const players = await this.sleeperAPI.getAllPlayers();

            // Process and store player data
            Object.entries(players).forEach(([playerId, player]) => {
                // Better filtering for fantasy-relevant players
                if (player.active && 
                    player.fantasy_positions && 
                    player.fantasy_positions.length > 0 &&
                    player.team && // Must have a team
                    player.first_name && 
                    player.last_name &&
                    // Filter out players with very high search ranks (likely not draftable)
                    (player.search_rank == null || player.search_rank < 500)) {
                    
                    this.playerDatabase.set(playerId, {
                        id: playerId,
                        name: `${player.first_name} ${player.last_name}`.trim(),
                        position: player.fantasy_positions[0],
                        team: player.team,
                        age: player.age,
                        years_exp: player.years_exp, // Use consistent field name for rookie detection
                        experience: player.years_exp, // Keep for backward compatibility
                        // College information
                        college: player.college || null,
                        // Rookie detection - Sleeper typically considers 0-1 years as rookies
                        rookie: player.years_exp === 0 || player.years_exp === null,
                        // Player status information
                        active: player.active,
                        injuryStatus: player.injury_status || null,
                        injuryDesignation: player.injury_designation || null,
                        injury_status: player.injury_status || null, // Alternative field name
                        // AI scoring factors - use better ADP logic
                        adp: this.calculateADP(player),
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

    calculateADP(player) {
        // ADP calculation logic adjusted for PPR scoring
        const searchRank = player.search_rank;
        
        // If no search rank, assign very high ADP (undraftable)
        if (!searchRank) return 999;
        
        // Straight from search rank, deliberately without jitter.
        //
        // This previously added Math.random() scaled by rank band - up to 36 places
        // for a player ranked in the 60s. Candidates are sorted by ADP and cut to
        // the top 50, so the noise decided both the order of the recommendations
        // and who appeared at all, and it was redrawn on every page load. Reloading
        // mid-draft produced different advice for an identical board.
        if (searchRank > 200) return 999; // Likely not draftable

        const baseADP = searchRank;
        
        // Apply PPR adjustment to ADP
        return this.applyPPRADPAdjustment(player, baseADP);
    }

    applyPPRADPAdjustment(player, baseADP) {
        // Adjust ADP based on PPR scoring format
        const scoringFormat = this.configManager.config.scoringFormat || 'Half PPR';
        
        if (scoringFormat === 'Standard') {
            return baseADP; // No PPR adjustments needed
        }
        
        const pprImpact = scoringFormat === 'PPR' ? 1.0 : 0.5; // Full PPR or Half PPR
        const position = player.fantasy_positions?.[0] || player.position;
        
        switch (position) {
            case 'WR':
                // WRs generally move up 2-8 ADP spots in PPR
                if (baseADP <= 50) {
                    return Math.max(1, baseADP - (6 * pprImpact)); // Top WRs benefit most
                } else if (baseADP <= 100) {
                    return Math.max(1, baseADP - (4 * pprImpact)); // Mid WRs get moderate boost
                }
                return Math.max(1, baseADP - (2 * pprImpact)); // All WRs get small boost
                
            case 'RB':
                // Pass-catching RBs move up, pure runners stay similar
                if (baseADP <= 30) {
                    return Math.max(1, baseADP - (4 * pprImpact)); // Elite RBs likely catch passes
                } else if (baseADP <= 60) {
                    return Math.max(1, baseADP - (2 * pprImpact)); // Some receiving potential
                }
                return baseADP; // Later RBs likely pure runners
                
            case 'TE':
                // TEs get modest PPR boost
                if (baseADP <= 25) {
                    return Math.max(1, baseADP - (3 * pprImpact)); // Elite TEs
                } else if (baseADP <= 50) {
                    return Math.max(1, baseADP - (2 * pprImpact)); // Good TEs
                }
                return Math.max(1, baseADP - (1 * pprImpact)); // All TEs get small boost
                
            default:
                return baseADP; // QB, K, DEF not affected by PPR
        }
    }

    calculatePlayerTier(player) {
        // Tier calculation based on search rank, adjusted for PPR scoring
        let rank = player.search_rank || 999;
        
        // Apply PPR adjustments to ranking
        rank = this.applyPPRRankingAdjustment(player, rank);
        
        if (rank <= 36) return 'Elite';
        if (rank <= 72) return 'High';
        if (rank <= 120) return 'Mid';
        if (rank <= 180) return 'Deep';
        return 'Flyer';
    }

    applyPPRRankingAdjustment(player, baseRank) {
        // Adjust player ranking based on PPR scoring format
        const scoringFormat = this.configManager.config.scoringFormat || 'Half PPR';
        
        if (scoringFormat === 'Standard') {
            return baseRank; // No PPR adjustments needed
        }
        
        const pprBoost = scoringFormat === 'PPR' ? 1.0 : 0.5; // Full PPR or Half PPR
        const position = player.fantasy_positions?.[0] || player.position;
        
        switch (position) {
            case 'WR':
                // Reception-heavy WRs move up in rankings
                if (baseRank <= 50) {
                    return Math.max(1, baseRank - (8 * pprBoost)); // Top WRs get bigger boost
                } else if (baseRank <= 100) {
                    return Math.max(1, baseRank - (4 * pprBoost)); // Mid-tier WRs get moderate boost
                }
                return Math.max(1, baseRank - (2 * pprBoost)); // All WRs get small boost
                
            case 'RB':
                // Pass-catching RBs get boost, pure runners stay same
                if (baseRank <= 30) {
                    return Math.max(1, baseRank - (6 * pprBoost)); // Elite RBs likely pass-catchers
                } else if (baseRank <= 60) {
                    return Math.max(1, baseRank - (3 * pprBoost)); // Some receiving upside
                }
                return baseRank; // Later RBs likely pure runners
                
            case 'TE':
                // All TEs benefit somewhat from PPR
                if (baseRank <= 20) {
                    return Math.max(1, baseRank - (3 * pprBoost)); // Elite TEs
                } else if (baseRank <= 40) {
                    return Math.max(1, baseRank - (2 * pprBoost)); // Solid TEs
                }
                return Math.max(1, baseRank - (1 * pprBoost)); // All TEs get small boost
                
            default:
                return baseRank; // QB, K, DEF not affected by PPR
        }
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
        let leagueId = this.configManager.config.sleeperLeagueId;
        const draftId = this.configManager.config.sleeperDraftId;
        const isMockDraft = this.configManager.config.isMockDraft;
        
        console.log('🔍 Starting draft tracking with:', {
            leagueId,
            draftId,
            isMockDraft
        });
        
        // Clean up league ID if it contains URL
        if (leagueId && leagueId.includes('http')) {
            console.warn('⚠️ League ID contains URL, clearing it');
            leagueId = null;
            this.configManager.config.sleeperLeagueId = null;
        }
        
        if (!leagueId && !draftId) {
            this.configManager.showNotification('❌ Please configure your Sleeper League ID first', 'error');
            return;
        }

        try {
            this.configManager.showNotification('🔍 Finding your draft...', 'info');
            
            // For mock drafts, use the draft ID directly
            if (isMockDraft && draftId) {
                console.log('📋 Using mock draft ID directly:', draftId);
                
                // Get draft info directly
                const draftResponse = await fetch(`https://api.sleeper.app/v1/draft/${draftId}`);
                const draftData = await draftResponse.json();
                
                if (!draftResponse.ok) {
                    throw new Error('Draft not found');
                }
                
                this.draftId = draftId;
                this.draftData = draftData;
                
                console.log('📋 Mock draft data:', {
                    status: draftData.status,
                    type: draftData.type,
                    sport: draftData.sport
                });
                
            } else {
                // Regular league - get drafts from league
                const draftsResponse = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`);
                const drafts = await draftsResponse.json();
                
                if (!drafts || drafts.length === 0) {
                    throw new Error('No drafts found for this league');
                }

                // Get the most recent draft
                this.draftId = drafts[0].draft_id;
                this.draftData = drafts[0];
            }
            
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
            
            // Get user's roster ID (skip for mock drafts without league)
            if (leagueId && !isMockDraft) {
                await this.identifyUserRoster(leagueId);
            } else if (isMockDraft || draftId) {
                console.log('🎯 Mock draft or direct draft - skipping roster identification');
                this.configManager.showNotification('🎯 Mock draft - using manual pick detection', 'info');
            }
            
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
            // Fetch both rosters and users
            const [rostersResponse, usersResponse] = await Promise.all([
                fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
                fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`)
            ]);
            
            const rosters = await rostersResponse.json();
            const users = await usersResponse.json();
            
            // Store users for later use
            window.sleeperUsers = users;
            window.sleeperRosters = rosters;
            
            // Try to match with configured team name or display name
            const configuredTeamName = this.configManager.config.teamName;
            const configuredDisplayName = this.configManager.config.sleeperUsername;
            
            console.log('🔍 Looking for user roster with:', {
                teamName: configuredTeamName,
                displayName: configuredDisplayName
            });
            
            // First try to match by display name (most reliable)
            if (configuredDisplayName) {
                const user = users.find(u => 
                    u.display_name && u.display_name.toLowerCase() === configuredDisplayName.toLowerCase()
                );
                
                if (user) {
                    const roster = rosters.find(r => r.owner_id === user.user_id);
                    if (roster) {
                        this.userRosterId = roster.roster_id;
                        console.log('🎯 Identified user roster by display name:', {
                            rosterId: this.userRosterId,
                            displayName: user.display_name
                        });
                        this.configManager.showNotification(`✅ Found your roster: ${user.display_name}`, 'success');
                        return;
                    }
                }
            }
            
            // Then try to match by team name
            if (configuredTeamName) {
                const user = users.find(u => {
                    // Check if team name matches display name
                    if (u.display_name && u.display_name.toLowerCase() === configuredTeamName.toLowerCase()) {
                        return true;
                    }
                    // Check if team name matches metadata team name
                    if (u.metadata?.team_name && u.metadata.team_name.toLowerCase() === configuredTeamName.toLowerCase()) {
                        return true;
                    }
                    return false;
                });
                
                if (user) {
                    const roster = rosters.find(r => r.owner_id === user.user_id);
                    if (roster) {
                        this.userRosterId = roster.roster_id;
                        console.log('🎯 Identified user roster by team name:', {
                            rosterId: this.userRosterId,
                            teamName: configuredTeamName
                        });
                        this.configManager.showNotification(`✅ Found your roster: ${configuredTeamName}`, 'success');
                        return;
                    }
                }
            }
            
            // If no match, show available options
            console.log('❓ Could not auto-identify user roster');
            console.log('Available teams:', users.map(u => ({
                display_name: u.display_name,
                team_name: u.metadata?.team_name,
                user_id: u.user_id
            })));
            
            this.configManager.showNotification(
                '❓ Could not auto-identify your roster. Panic Mode will still work when it\'s your turn!', 
                'info'
            );
            
        } catch (error) {
            console.error('Error identifying user roster:', error);
            this.configManager.showNotification('⚠️ Could not identify roster, but tracking will continue', 'warning');
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

        // Browsers throttle background timers hard - a 3 second poll becomes about
        // one a minute once the tab is hidden. Since the draft itself happens in
        // Sleeper, this tab is hidden exactly when picks are landing, so catch up
        // the moment it is looked at again.
        if (!this.visibilityHandler) {
            this.visibilityHandler = () => {
                if (!document.hidden && this.isTracking) {
                    this.pendingUIUpdate = false;
                    this.updateDraftStatus();
                }
            };
            document.addEventListener('visibilitychange', this.visibilityHandler);
        }
    }

    /**
     * Manual catch-up. Background throttling means the feed can lag by up to a
     * minute however carefully the polling is written, so leave the user a way to
     * force it rather than making them wonder whether it is stuck.
     */
    async refreshDraftNow() {
        const button = document.getElementById('refreshDraftBtn');

        if (!this.draftId) {
            this.configManager.showNotification('Start draft tracking first', 'warning');
            return;
        }

        if (button) {
            button.disabled = true;
            button.innerHTML = '<span>⏳</span> Refreshing...';
        }

        try {
            const before = this.picks.length;
            await this.updateDraftStatus();
            const added = this.picks.length - before;

            this.markFeedUpdated();
            this.configManager.showNotification(
                added > 0
                    ? `${added} new pick${added === 1 ? '' : 's'} loaded`
                    : 'Already up to date',
                added > 0 ? 'success' : 'info'
            );
        } catch (error) {
            console.error('❌ Error refreshing draft:', error);
            this.configManager.showNotification(`Refresh failed: ${error.message}`, 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = '<span>🔄</span> Refresh';
            }
        }
    }

    stopPolling() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }

        this.isTracking = false;
    }

    async updateDraftStatus() {
        if (!this.draftId) return;

        try {
            // Get draft data for turn info
            const draftResponse = await fetch(`https://api.sleeper.app/v1/draft/${this.draftId}`);
            const draftData = await draftResponse.json();
            
            // Get current draft picks
            const picksResponse = await fetch(`https://api.sleeper.app/v1/draft/${this.draftId}/picks`);
            const currentPicks = await picksResponse.json();
            
            // Check if it's user's turn
            const wasUserTurn = this.isUserTurn;
            this.draftData = draftData;
            
            // Determine current picker
            const currentPickSlot = this.picks.length;
            const currentPicker = draftData.draft_order?.[currentPickSlot];
            this.isUserTurn = currentPicker === this.userRosterId;
            
            // Handle turn changes
            if (!wasUserTurn && this.isUserTurn) {
                // It's now the user's turn!
                this.handleUserTurn();
            } else if (wasUserTurn && !this.isUserTurn) {
                // User's turn ended
                this.clearPickTimer();
            }
            
            // Check for new picks
            const newPicks = currentPicks.slice(this.picks.length);
            
            if (newPicks.length > 0) {
                console.log(`📥 Processing ${newPicks.length} new picks`);
                
                // Play pick sound for each new pick
                if (this.audioEnabled && newPicks.length === 1) {
                    this.playSound('pickMade');
                }
                
                // Batch process new picks for better performance
                const pickPromises = newPicks.map(pick => this.processPick(pick));
                await Promise.all(pickPromises);
                
                // Update state
                this.picks = currentPicks;
                
                // Batch UI updates to avoid too many DOM manipulations
                this.batchUIUpdates();
                
                // Remove drafted players from queue
                this.updateQueueForDraftedPlayers();
            }
            
        } catch (error) {
            console.error('Error updating draft status:', error);
        }
    }

    batchUIUpdates() {
        // requestAnimationFrame does not fire in a hidden tab, and you draft in
        // Sleeper with this tab in the background - so the batched updates never
        // ran, and because the guard had already been set every later call
        // early-returned too. Apply directly when hidden.
        if (document.hidden) {
            this.applyUIUpdates();
            return;
        }

        if (this.pendingUIUpdate) return;

        this.pendingUIUpdate = true;
        requestAnimationFrame(() => {
            this.applyUIUpdates();
            this.pendingUIUpdate = false;
        });
    }

    applyUIUpdates() {
        this.updateDraftDisplay();
        this.checkUserTurn();
        this.updatePositionScarcityDisplay();
    }

    async processPick(pick) {
        const player = this.playerDatabase.get(pick.player_id);

        // The player database is filtered to roughly the top 500 by search rank and
        // requires an NFL team, which excludes most defenses, kickers and deep
        // bench picks. Those picks were counted but never drawn, so the feed just
        // skipped a pick number with no explanation. Draw what is known instead.
        if (!player) {
            this.displayUnknownPick(pick);
            console.warn(`Pick ${pick.pick_no}: player ${pick.player_id} not in filtered database`);
            return;
        }

        if (player) {
            // Generate AI analysis for this pick
            const analysis = this.generatePickAnalysis(pick, player);
            
            // Display pick with analysis
            this.displayPick(pick, player, analysis);
            
            // Update position tracking  
            const normalizedPosition = this.normalizePosition(player.position);
            if (!this.positionScarcity[normalizedPosition]) {
                this.positionScarcity[normalizedPosition] = { total: 0, drafted: 0 };
            }
            this.positionScarcity[normalizedPosition].drafted++;
            
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
        // Normalize position name
        const normalizedPosition = this.normalizePosition(position);
        
        // Initialize if missing
        if (!this.positionScarcity[normalizedPosition]) {
            this.positionScarcity[normalizedPosition] = { total: 0, drafted: 0 };
        }
        
        const drafted = this.positionScarcity[normalizedPosition].drafted;
        const remaining = this.getRemainingStarters(normalizedPosition) - drafted;
        
        let level = 'Normal';
        if (remaining <= 3) level = 'Critical';
        else if (remaining <= 8) level = 'Scarce';
        else if (remaining >= 20) level = 'Abundant';
        
        return { level, remaining };
    }

    normalizePosition(position) {
        // Handle different position formats from Sleeper API
        const positionMap = {
            'QB': 'QB',
            'RB': 'RB', 
            'WR': 'WR',
            'TE': 'TE',
            'K': 'K',
            'DEF': 'DEF',
            'DST': 'DEF', // Defense/Special Teams
            'D/ST': 'DEF',
            'FLEX': 'FLEX' // Some APIs use FLEX
        };
        
        return positionMap[position] || position || 'UNKNOWN';
    }

    guessPlayerPosition(playerName) {
        // Comprehensive position guessing for common fantasy players
        // This helps with mock drafts where player database might be incomplete
        
        const positionGuesses = {
            // Top QBs
            'QB': [
                'Josh Allen', 'Lamar Jackson', 'Patrick Mahomes', 'Joe Burrow', 'Jalen Hurts',
                'Justin Herbert', 'Dak Prescott', 'Tua Tagovailoa', 'Trevor Lawrence', 'Anthony Richardson',
                'Kyler Murray', 'Russell Wilson', 'Aaron Rodgers', 'Kirk Cousins', 'Geno Smith',
                'Bo Nix', 'Caleb Williams', 'Jayden Daniels', 'Drake Maye', 'J.J. McCarthy',
                'Brock Purdy', 'Jordan Love', 'C.J. Stroud', 'Deshaun Watson', 'Daniel Jones'
            ],
            
            // Top RBs
            'RB': [
                'Christian McCaffrey', 'Saquon Barkley', 'Derrick Henry', 'Josh Jacobs', 'Jonathan Taylor',
                'Alvin Kamara', 'Nick Chubb', 'Austin Ekeler', 'Tony Pollard', 'Joe Mixon',
                'Kenneth Walker III', 'Breece Hall', 'Bijan Robinson', 'Jahmyr Gibbs', 'De\'Von Achane',
                'James Cook', 'Rachaad White', 'Isiah Pacheco', 'Aaron Jones', 'Rhamondre Stevenson',
                'Najee Harris', 'D\'Andre Swift', 'Ezekiel Elliott', 'Miles Sanders', 'David Montgomery',
                'Javonte Williams', 'Travis Etienne', 'Cam Akers', 'Dameon Pierce', 'Alexander Mattison',
                'Gus Edwards', 'Rico Dowdle', 'Chuba Hubbard', 'Jerome Ford', 'Justice Hill'
            ],
            
            // Top WRs
            'WR': [
                'Tyreek Hill', 'Davante Adams', 'Cooper Kupp', 'Stefon Diggs', 'A.J. Brown',
                'Ja\'Marr Chase', 'Justin Jefferson', 'CeeDee Lamb', 'Amon-Ra St. Brown', 'DK Metcalf',
                'Mike Evans', 'Calvin Ridley', 'Chris Godwin', 'Jaylen Waddle', 'Tee Higgins',
                'DeVonta Smith', 'Terry McLaurin', 'DJ Moore', 'Keenan Allen', 'Amari Cooper',
                'Courtland Sutton', 'Michael Pittman Jr.', 'Brandon Aiyuk', 'Diontae Johnson', 'Tyler Lockett',
                'Jerry Jeudy', 'Marquise Goodwin', 'George Pickens', 'Christian Kirk', 'Gabe Davis',
                'Rashee Rice', 'Rome Odunze', 'Marvin Harrison Jr.', 'Malik Nabers', 'Drake London',
                'Chris Olave', 'Garrett Wilson', 'Jayden Reed', 'Tank Dell', 'Jordan Addison'
            ],
            
            // Top TEs
            'TE': [
                'Travis Kelce', 'Mark Andrews', 'T.J. Hockenson', 'George Kittle', 'Evan Engram',
                'Dallas Goedert', 'Kyle Pitts', 'David Njoku', 'Jake Ferguson', 'Sam LaPorta',
                'Trey McBride', 'Cole Kmet', 'Pat Freiermuth', 'Tyler Higbee', 'Hunter Henry',
                'Dalton Kincaid', 'Isaiah Likely', 'Brock Bowers', 'Cade Otton', 'Tucker Kraft'
            ],
            
            // Kickers
            'K': [
                'Justin Tucker', 'Harrison Butker', 'Tyler Bass', 'Younghoe Koo', 'Daniel Carlson',
                'Brandon McManus', 'Jake Elliott', 'Chris Boswell', 'Jason Sanders', 'Wil Lutz',
                'Graham Gano', 'Matt Gay', 'Cairo Santos', 'Joey Slye', 'Jason Myers'
            ],
            
            // Team Defenses (common team names)
            'DEF': [
                '49ers', 'Ravens', 'Bills', 'Cowboys', 'Steelers', 'Patriots', 'Chiefs', 'Dolphins',
                'Browns', 'Jets', 'Eagles', 'Saints', 'Chargers', 'Rams', 'Packers', 'Titans',
                'San Francisco', 'Baltimore', 'Buffalo', 'Dallas', 'Pittsburgh', 'New England',
                'Kansas City', 'Miami', 'Cleveland', 'New York', 'Philadelphia', 'New Orleans',
                'Los Angeles', 'Green Bay', 'Tennessee', 'Indianapolis', 'Jacksonville', 'Houston',
                'Denver', 'Las Vegas', 'Minnesota', 'Detroit', 'Chicago', 'Tampa Bay', 'Atlanta',
                'Carolina', 'Washington', 'Arizona', 'Seattle'
            ]
        };
        
        // Check each position
        for (const [position, players] of Object.entries(positionGuesses)) {
            if (players.some(player => player.toLowerCase() === playerName.toLowerCase())) {
                return position;
            }
        }
        
        // If no exact match, try partial matching for team defenses
        if (positionGuesses.DEF.some(team => 
            playerName.toLowerCase().includes(team.toLowerCase()) || 
            team.toLowerCase().includes(playerName.toLowerCase())
        )) {
            return 'DEF';
        }
        
        return null; // Could not guess position
    }

    isPlayerDraftable(player, currentRound) {
        // Comprehensive filtering for panic mode recommendations
        
        // 1. Must be active player
        if (!player.active) {
            console.log(`🚫 Filtering out ${player.name} - not active`);
            return false;
        }

        // 2. Must have a valid NFL team (filters out unsigned players)
        if (!player.team || player.team === 'FA' || player.team === null) {
            console.log(`🚫 Filtering out ${player.name} - no team (FA/unsigned)`);
            return false;
        }

        // 3. Check injury status - be very careful with injured players
        if (player.injuryStatus) {
            const injuryDesignation = player.injuryDesignation?.toLowerCase();
            
            // Never recommend players on IR, PUP, or suspended
            if (['ir', 'pup', 'susp', 'cov'].includes(injuryDesignation)) {
                console.log(`🚫 Filtering out ${player.name} - serious injury/status: ${injuryDesignation}`);
                return false;
            }
            
            // Be cautious with Doubtful players early in draft
            if (injuryDesignation === 'doubtful' && currentRound <= 8) {
                console.log(`🚫 Filtering out ${player.name} - doubtful status too risky for round ${currentRound}`);
                return false;
            }
            
            // Questionable players are risky but acceptable with warning
            if (injuryDesignation === 'questionable') {
                console.log(`⚠️ ${player.name} is questionable - will include with risk warning`);
            }
        }

        // 4. Filter out extremely low-value players (likely practice squad/deep bench)
        if (player.adp > 300 && currentRound <= 12) {
            console.log(`🚫 Filtering out ${player.name} - ADP too low (${player.adp}) for round ${currentRound}`);
            return false;
        }

        // 5. Filter out players with no fantasy relevance (very low search rank)
        if (!player.adp || player.adp > 400) {
            console.log(`🚫 Filtering out ${player.name} - no fantasy relevance (ADP: ${player.adp || 'N/A'})`);
            return false;
        }

        // 6. Age-based filtering for very late career players (unless early round value)
        if (player.age && player.age > 35 && player.adp > 150) {
            console.log(`🚫 Filtering out ${player.name} - too old (${player.age}) with low value`);
            return false;
        }

        return true; // Player is draftable
    }

    getRemainingStarters(position) {
        // Estimate starter-quality players by position
        const starterCounts = {
            QB: 15,     // ~12 + backups
            RB: 30,     // ~24 + handcuffs  
            WR: 36,     // ~30 + depth
            TE: 15,     // ~12 + backups
            K: 12,      // One per team
            DEF: 12,    // One per team
            FLEX: 20,   // Flex eligible players
            UNKNOWN: 10 // Fallback
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

    async activatePanicMode() {
        console.log('🚨 Activating Panic Mode!');
        this.panicMode = true;
        
        try {
            // Show loading state first
            this.displayPanicModeLoading();
            
            // Pull fresh draft data to get latest picks (with timeout)
            console.log('🔄 Refreshing draft data...');
            await this.refreshDraftData();
            console.log('✅ Draft data refresh completed');
            
            // Make sure we have player data
            if (this.playerDatabase.size === 0) {
                console.log('⚠️ No player database, loading sample data for panic mode');
                this.loadSamplePlayerDatabase();
            }
            console.log(`📊 Player database size: ${this.playerDatabase.size}`);
            
            // Generate emergency recommendations with fresh data
            console.log('🤖 Generating panic recommendations...');
            const result = this.generatePanicRecommendations();
            const { recommendations, usingDemoData } = result;
            console.log('📋 Generated fresh recommendations:', recommendations.length, 'players');
            
            // Validate recommendations
            if (!recommendations || recommendations.length === 0) {
                console.warn('⚠️ No recommendations generated, using fallback');
                const fallbackRecommendations = this.getFallbackRecommendations();
                this.displayPanicMode(fallbackRecommendations, false); // fallback is not demo data
            } else {
                // Update UI with panic mode
                this.displayPanicMode(recommendations, usingDemoData);
            }
            
            // Urgent notification
            this.configManager.showNotification('🚨 PANIC MODE! Emergency recommendations ready', 'warning');
            
            // Flash the page title
            this.flashPageTitle();
            
        } catch (error) {
            console.error('❌ Error in panic mode activation:', error);
            this.configManager.showNotification('❌ Panic mode error - using fallback recommendations', 'error');
            
            // Show fallback recommendations
            const fallbackRecommendations = this.getFallbackRecommendations();
            this.displayPanicMode(fallbackRecommendations, false); // fallback is not demo data
        }
    }

    getFallbackRecommendations() {
        // Emergency fallback recommendations using real players from database
        console.log('🆘 Using emergency fallback recommendations with real players');
        
        const recommendations = [];
        
        // Get all undrafted players
        const availablePlayers = Array.from(this.playerDatabase.values())
            .filter(player => !this.isPlayerDrafted(player.id))
            .sort((a, b) => a.adp - b.adp);
        
        // Best available RB
        const bestRB = availablePlayers.find(p => p.position === 'RB');
        if (bestRB) {
            recommendations.push({
                player: bestRB,
                strategy: `🚨 ${bestRB.name} (RB)`,
                reasoning: `${bestRB.name} is the highest-ranked RB still available (ADP: ${bestRB.adp}). Running backs are scarce!`,
                confidence: 85
            });
        }
        
        // Best available WR
        const bestWR = availablePlayers.find(p => p.position === 'WR');
        if (bestWR) {
            recommendations.push({
                player: bestWR,
                strategy: `🚨 ${bestWR.name} (WR)`,
                reasoning: `${bestWR.name} is the highest-ranked WR still available (ADP: ${bestWR.adp}). Wide receivers offer consistent points.`,
                confidence: 80
            });
        }
        
        // Best overall player by ADP
        const bestOverall = availablePlayers[0];
        if (bestOverall && !recommendations.some(r => r.player.id === bestOverall.id)) {
            recommendations.push({
                player: bestOverall,
                strategy: `🚨 ${bestOverall.name} (${bestOverall.position})`,
                reasoning: `${bestOverall.name} has the best ADP (${bestOverall.adp}) among available players. Take the value!`,
                confidence: 90
            });
        }
        
        // If we still don't have enough, add best QB or TE
        if (recommendations.length < 3) {
            const bestQB = availablePlayers.find(p => p.position === 'QB');
            const bestTE = availablePlayers.find(p => p.position === 'TE');
            
            if (bestQB && !recommendations.some(r => r.player.id === bestQB.id)) {
                recommendations.push({
                    player: bestQB,
                    strategy: `🚨 ${bestQB.name} (QB)`,
                    reasoning: `${bestQB.name} is the top QB available (ADP: ${bestQB.adp}). Secure your quarterback position.`,
                    confidence: 75
                });
            } else if (bestTE && !recommendations.some(r => r.player.id === bestTE.id)) {
                recommendations.push({
                    player: bestTE,
                    strategy: `🚨 ${bestTE.name} (TE)`,
                    reasoning: `${bestTE.name} is the top TE available (ADP: ${bestTE.adp}). Elite tight ends are rare.`,
                    confidence: 75
                });
            }
        }
        
        console.log('🆘 Generated fallback recommendations:', recommendations.map(r => r.player.name));
        
        return recommendations.slice(0, 3);
    }

    async refreshDraftData() {
        if (!this.draftId) {
            console.log('⚠️ No draft ID available for refresh');
            return;
        }
        
        try {
            console.log('🔄 Refreshing draft data for panic mode...');
            
            // Get the absolute latest picks with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
            
            const picksResponse = await fetch(`https://api.sleeper.app/v1/draft/${this.draftId}/picks`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (!picksResponse.ok) {
                throw new Error(`HTTP ${picksResponse.status}: ${picksResponse.statusText}`);
            }
            
            const latestPicks = await picksResponse.json();
            
            // Update our picks array with the latest data
            this.picks = latestPicks;
            
            console.log(`📊 Refreshed: ${latestPicks.length} total picks in draft`);
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('❌ Draft data refresh timed out after 5 seconds');
            } else {
                console.error('❌ Error refreshing draft data:', error);
            }
            // Continue with existing data if refresh fails
        }
    }

    displayPanicModeLoading() {
        console.log('📱 Displaying panic mode loading...');
        
        const panicPanel = document.getElementById('panicModePanel');
        const recommendationsElement = document.getElementById('panicRecommendations');
        
        console.log('🔍 Panic panel found:', !!panicPanel);
        console.log('🔍 Recommendations element found:', !!recommendationsElement);
        
        if (!panicPanel) {
            console.error('❌ panicModePanel element not found in DOM');
            this.configManager.showNotification('❌ Panic mode UI error - panel not found', 'error');
            return;
        }
        
        if (!recommendationsElement) {
            console.error('❌ panicRecommendations element not found in DOM');
            this.configManager.showNotification('❌ Panic mode UI error - recommendations element not found', 'error');
            return;
        }
        
        panicPanel.style.display = 'block';
        
        recommendationsElement.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <div style="font-size: 2em; margin-bottom: 10px;">⏳</div>
                <h4 style="color: var(--warning-color);">Loading Fresh Recommendations...</h4>
                <p style="color: var(--text-secondary);">Pulling latest draft data and analyzing best available players...</p>
            </div>
        `;
        
        console.log('✅ Panic mode loading display completed');
    }

    loadSamplePlayerDatabase() {
        // Load sample players into database for demo/test purposes
        const samplePlayers = this.getSamplePlayers();
        samplePlayers.forEach(player => {
            this.playerDatabase.set(player.id, player);
        });
        console.log('📊 Loaded sample player database for panic mode');
    }

    deactivatePanicMode() {
        this.panicMode = false;
        this.clearPanicMode();
    }

    generatePanicRecommendations() {
        const currentRound = Math.floor(this.picks.length / (this.draftData?.settings?.teams || 12)) + 1;
        const pickNumber = this.picks.length + 1;
        
        // Check scoring format for panic mode accuracy
        if (!this.configManager.config.scoringFormat) {
            console.warn('⚠️ No scoring format set - panic recommendations using Half PPR default');
        }
        
        console.log(`🎯 Generating panic recommendations for pick ${pickNumber}, round ${currentRound}`);
        
        // Check draft plan first
        const planData = this.getCurrentRoundPlan();
        const planTargets = planData.targets.filter(p => !this.isPlayerDrafted(p.id));
        const planBackups = planData.backups.filter(p => !this.isPlayerDrafted(p.id));
        
        // Analyze current roster composition
        const myRoster = this.analyzeMyRoster();
        console.log('📊 My current roster:', myRoster);
        
        // Get best available players by position
        console.log(`📊 Total picks made: ${this.picks.length}`);
        console.log(`🎯 Sample drafted player IDs:`, this.picks.slice(0, 5).map(p => `${p.player_id} (${typeof p.player_id})`));
        
        const allPlayers = Array.from(this.playerDatabase.values());
        console.log(`📊 Total players in database: ${allPlayers.length}`);
        
        // Filter out drafted players with enhanced logging
        const undraftedPlayers = allPlayers.filter(player => {
            const isDrafted = this.isPlayerDrafted(player.id);
            return !isDrafted;
        });
        console.log(`📊 Undrafted players: ${undraftedPlayers.length}`);
        
        // Apply draftability filter  
        let availablePlayers = undraftedPlayers
            .filter(player => this.isPlayerDraftable(player, currentRound))
            .sort((a, b) => a.adp - b.adp)
            .slice(0, 50); // Top 50 available
            
        console.log(`📊 Draftable players after filtering: ${availablePlayers.length}`);
        
        // Filter out positions we don't need (based on roster analysis)
        availablePlayers = this.filterByRosterNeeds(availablePlayers, myRoster);
        
        // Track if we're using demo data
        let usingDemoData = false;
        
        // If no players available (demo mode or error), use sample data
        if (availablePlayers.length === 0) {
            console.log('🎮 No player data available, using demo recommendations');
            availablePlayers = this.getSamplePlayers();
            usingDemoData = true;
            
            // Alert user that we're using demo data
            this.configManager.showNotification(
                '⚠️ Using demo player data - recommendations may be limited. Connect to Sleeper for full player database.', 
                'warning', 
                8000
            );
        }
        
        // Calculate position scarcity for better recommendations
        const positionScarcity = {};
        ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
            const scarcity = this.calculateCurrentScarcity(pos);
            positionScarcity[pos] = scarcity;
        });
        
        // Ranking, tiering and run detection live in PickAdvisor. The three
        // strategies here used to be "your plan", "best available" and "your
        // plan's backup", which meant two of the three slots just echoed what
        // you had written before the draft. The advisor reports the board and
        // the plan as separate opinions and states the gap between them.
        const advisor = this.pickAdvisor || (this.pickAdvisor = new PickAdvisor(this.configManager));

        const validRecommendations = advisor.recommend({
            availablePlayers,
            picks: this.picks,
            planTargets,
            planBackups,
            roster: myRoster,
            teams: this.draftData?.settings?.teams || this.configManager.config.leagueSize || 12,
            scoringFormat: this.configManager.config.scoringFormat || 'Half PPR',
            playerLookup: pick => this.playerDatabase.get(pick.player_id)
                || (pick.metadata ? { position: this.normalizePosition(pick.metadata.position) } : null)
        });

        console.log(`✅ Final recommendations (${validRecommendations.length}):`,
            validRecommendations.map(r => `${r.player.name} - ${r.strategy}`)
        );

        // Return recommendations with metadata about data source
        return {
            recommendations: validRecommendations,
            usingDemoData: usingDemoData
        };
    }

    analyzeMyRoster() {
        console.log('🔍 Analyzing roster with userRosterId:', this.userRosterId);
        console.log('📊 Total picks in draft:', this.picks.length);
        console.log('📊 Player database size:', this.playerDatabase.size);
        
        // If we can't identify user roster, make educated guesses based on draft position
        if (!this.userRosterId) {
            console.log('⚠️ No userRosterId, using estimation');
            return this.estimateRosterFromDraftPosition();
        }
        
        // Debug: Log all picks to see the data structure
        console.log('🔍 Sample pick structure:', this.picks[0]);
        
        // Count positions drafted by user - try multiple possible field names
        const myPicks = this.picks.filter(pick => {
            const isMyPick = pick.roster_id === this.userRosterId || 
                            pick.picked_by === this.userRosterId ||
                            pick.drafted_by === this.userRosterId ||
                            pick.user_id === this.userRosterId;
            
            if (isMyPick) {
                console.log('✅ Found my pick:', pick);
            }
            return isMyPick;
        });
        
        console.log(`📋 Found ${myPicks.length} picks for user roster ${this.userRosterId}`);
        
        const rosterCount = {
            QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0
        };
        
        myPicks.forEach((pick, index) => {
            // Try to find player in database
            let player = this.playerDatabase.get(pick.player_id);
            
            // If not found, try converting ID to string (sometimes IDs are numbers vs strings)
            if (!player && pick.player_id) {
                player = this.playerDatabase.get(pick.player_id.toString()) || 
                         this.playerDatabase.get(parseInt(pick.player_id));
            }
            
            console.log(`🔍 Pick ${index + 1}:`, {
                player_id: pick.player_id,
                player_found: !!player,
                player_name: player?.name,
                player_position: player?.position,
                metadata: pick.metadata // Check if position is here
            });
            
            let position = null;
            
            if (player && player.position) {
                position = player.position;
            } else if (pick.metadata && pick.metadata.position) {
                // Sometimes position is in metadata
                position = pick.metadata.position;
                console.log('🔍 Using position from metadata:', position);
            } else if (pick.position) {
                // Sometimes position is directly on pick
                position = pick.position;
                console.log('🔍 Using position from pick:', position);
            } else {
                console.warn('⚠️ Could not determine position for pick:', pick);
                // For mock drafts, let's make reasonable guesses based on pick metadata or draft order
                if (pick.metadata && pick.metadata.first_name && pick.metadata.last_name) {
                    const playerName = `${pick.metadata.first_name} ${pick.metadata.last_name}`;
                    console.log('🔍 Trying to guess position for:', playerName);
                    
                    position = this.guessPlayerPosition(playerName);
                    if (position) {
                        console.log('🎯 Guessed position for:', playerName, '→', position);
                    }
                }
            }
            
            if (position) {
                const pos = this.normalizePosition(position);
                if (rosterCount[pos] !== undefined) {
                    rosterCount[pos]++;
                    const playerName = player?.name || 
                                     (pick.metadata ? `${pick.metadata.first_name} ${pick.metadata.last_name}` : 'Unknown');
                    console.log(`📊 Added ${playerName} (${pos}) - now have ${rosterCount[pos]}`);
                }
            }
        });
        
        console.log('📊 Final roster count:', rosterCount);
        
        return {
            counts: rosterCount,
            totalPicks: myPicks.length,
            myPicks: myPicks
        };
    }

    estimateRosterFromDraftPosition() {
        // For demo/mock drafts, estimate based on typical draft patterns
        const totalTeams = this.draftData?.settings?.teams || 12;
        const totalPicks = this.picks.length;
        const currentRound = Math.floor(totalPicks / totalTeams) + 1;
        
        // Estimate typical roster composition by round
        const estimatedCounts = {
            QB: Math.min(currentRound >= 6 ? 1 : 0, 2), // QB usually drafted round 6+
            RB: Math.min(Math.floor(currentRound * 0.4), 3), // Heavy RB early
            WR: Math.min(Math.floor(currentRound * 0.4), 3), // Heavy WR early  
            TE: Math.min(currentRound >= 4 ? 1 : 0, 2), // TE round 4+
            K: 0, // Kickers very late
            DEF: 0 // Defense very late
        };
        
        return {
            counts: estimatedCounts,
            totalPicks: Math.floor(totalPicks / totalTeams),
            isEstimated: true
        };
    }

    filterByRosterNeeds(availablePlayers, myRoster) {
        const { counts } = myRoster;
        const currentRound = Math.floor(this.picks.length / (this.draftData?.settings?.teams || 12)) + 1;
        
        console.log('🔍 Filtering by roster needs:', {
            currentRound,
            myRosterCounts: counts,
            availablePlayerCount: availablePlayers.length
        });
        
        const filtered = availablePlayers.filter(player => {
            const pos = this.normalizePosition(player.position);
            
            // Position limits based on typical fantasy rosters - MUCH more permissive
            const maxNeeds = {
                QB: currentRound <= 6 ? 3 : 3, // Allow QB recommendations until you have 3
                RB: 5, // Can always use RBs
                WR: 5, // Can always use WRs  
                TE: currentRound <= 6 ? 3 : 3, // Allow TE recommendations until you have 3
                K: currentRound <= 12 ? 0 : 2, // Only draft K very late (rounds 13+)
                DEF: currentRound <= 11 ? 0 : 2 // Only draft DEF very late (rounds 12+)
            };
            
            const currentCount = counts[pos] || 0;
            const maxForPosition = maxNeeds[pos] || 1;
            
            // Don't recommend if we already have enough of this position
            if (currentCount >= maxForPosition) {
                console.log(`🚫 Skipping ${player.name} (${pos}) - already have ${currentCount}/${maxForPosition} (round ${currentRound})`);
                return false;
            }
            
            console.log(`✅ Including ${player.name} (${pos}) - have ${currentCount}/${maxForPosition}`);
            return true;
        });
        
        console.log(`🔍 After roster filtering: ${filtered.length} players remaining`);
        const positionCounts = {};
        filtered.forEach(p => {
            positionCounts[p.position] = (positionCounts[p.position] || 0) + 1;
        });
        console.log('🔍 Filtered players by position:', positionCounts);
        
        return filtered;
    }

    getSamplePlayers() {
        // Sample player data for demo/panic mode when real data isn't available
        return [
            {
                id: 'demo1',
                name: 'Saquon Barkley',
                position: 'RB',
                team: 'PHI',
                tier: 'Elite',
                adp: 8,
                riskLevel: 'Medium',
                age: 27,
                years_exp: 6,
                college: 'Penn State'
            },
            {
                id: 'demo2', 
                name: 'Davante Adams',
                position: 'WR',
                team: 'LV',
                tier: 'High',
                adp: 12,
                riskLevel: 'Low',
                age: 31,
                years_exp: 11,
                college: 'Fresno State'
            },
            {
                id: 'demo3',
                name: 'Travis Kelce',
                position: 'TE',
                team: 'KC',
                tier: 'Elite',
                adp: 15,
                riskLevel: 'Low',
                age: 34,
                years_exp: 12,
                college: 'Cincinnati'
            },
            {
                id: 'demo4',
                name: 'Derrick Henry',
                position: 'RB',
                team: 'BAL',
                tier: 'High',
                adp: 18,
                riskLevel: 'Medium'
            },
            {
                id: 'demo5',
                name: 'Mike Evans',
                position: 'WR',
                team: 'TB',
                tier: 'High',
                adp: 22,
                riskLevel: 'Low'
            },
            {
                id: 'demo6',
                name: 'Josh Allen',
                position: 'QB',
                team: 'BUF',
                tier: 'Elite',
                adp: 25,
                riskLevel: 'Low'
            },
            {
                id: 'demo7',
                name: 'Lamar Jackson',
                position: 'QB',
                team: 'BAL',
                tier: 'Elite',
                adp: 28,
                riskLevel: 'Medium'
            },
            {
                id: 'demo8',
                name: 'Mark Andrews',
                position: 'TE',
                team: 'BAL',
                tier: 'High',
                adp: 35,
                riskLevel: 'Medium'
            },
            {
                id: 'demo9',
                name: 'Justin Tucker',
                position: 'K',
                team: 'BAL',
                tier: 'High',
                adp: 180,
                riskLevel: 'Low'
            },
            {
                id: 'demo10',
                name: 'San Francisco 49ers',
                position: 'DEF',
                team: 'SF',
                tier: 'High',
                adp: 185,
                riskLevel: 'Low',
                age: null,
                years_exp: null,
                college: null
            },
            // Add some rookie players for testing
            {
                id: 'demo15',
                name: 'Caleb Williams',
                position: 'QB',
                team: 'CHI',
                tier: 'High',
                adp: 45,
                riskLevel: 'High',
                age: 22,
                years_exp: 0,
                college: 'USC',
                rookie: true
            },
            {
                id: 'demo16',
                name: 'Jayden Daniels',
                position: 'QB',
                team: 'WAS',
                tier: 'Medium',
                adp: 65,
                riskLevel: 'High',
                age: 23,
                years_exp: 0,
                college: 'LSU',
                rookie: true
            },
            {
                id: 'demo17',
                name: 'Marvin Harrison Jr.',
                position: 'WR',
                team: 'ARI',
                tier: 'High',
                adp: 35,
                riskLevel: 'Medium',
                age: 22,
                years_exp: 0,
                college: 'Ohio State',
                rookie: true
            },
            {
                id: 'demo18',
                name: 'Malik Nabers',
                position: 'WR',
                team: 'NYG',
                tier: 'Medium',
                adp: 55,
                riskLevel: 'Medium',
                age: 21,
                years_exp: 0,
                college: 'LSU',
                rookie: true
            }
        ];
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
        console.log('🔧 DraftTracker: Setting up draft UI...');
        const draftPage = document.getElementById('live-draft');
        if (!draftPage) {
            console.warn('❌ DraftTracker: live-draft page not found');
            return;
        }
        
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
                        <button class="btn btn-warning btn-tooltip" data-action="activate-panic-mode" id="panicBtn" 
                                data-tooltip="Emergency draft help when you're on the clock - instant AI recommendations with explanations">
                            <span>🚨</span> Panic Mode
                        </button>
                        <button class="btn btn-secondary btn-tooltip" onclick="draftTracker.toggleDraftPlan()" 
                                data-tooltip="Pre-draft planning tool with round-by-round targets and educational insights">
                            <span>📋</span> Draft Plan
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

            <!-- Timer Display -->
            <div id="pickTimer" style="display: none; margin-bottom: 20px;">
                <!-- Timer content will be inserted here -->
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

            <!-- Queue Panel -->
            <div class="queue-panel" id="queuePanel" style="display: none;">
                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title">📋 Draft Queue</h3>
                        <button class="btn btn-sm" onclick="draftTracker.toggleQueuePanel()">✕</button>
                    </div>
                    <div id="draftQueue">
                        <div class="empty-queue">No players queued</div>
                    </div>
                </div>
            </div>

            <!-- Draft Plan Panel - Now positioned at bottom -->
            <div class="draft-plan-panel collapsed" id="draftPlanPanel">
                <div class="card-header" style="cursor: pointer;" onclick="draftTracker.toggleDraftPlan()">
                    <h3 class="card-title">📋 Draft Plan Builder</h3>
                    <span class="expand-indicator" id="expandIndicator">▼</span>
                </div>
                <div class="plan-actions" style="padding: 1rem; border-bottom: 1px solid var(--border-color);">
                    <button class="btn btn-primary btn-sm" onclick="draftTracker.generateSmartPlan()">
                        <span>🤖</span> Generate AI Plan
                    </button>
                    <div class="export-dropdown">
                        <button class="btn btn-secondary btn-sm dropdown-toggle" onclick="draftTracker.toggleExportMenu()">
                            <span>💾</span> Export
                        </button>
                        <div class="export-menu" id="exportMenu" style="display: none;">
                            <button onclick="draftTracker.exportAsText()">📄 Text File</button>
                            <button onclick="draftTracker.exportAsPrintable()">🖨️ Printable</button>
                            <button onclick="draftTracker.exportAsImage()">📷 Image</button>
                            <button onclick="draftTracker.copyToClipboard()">📋 Copy</button>
                            <button onclick="draftTracker.savePlan()">📁 JSON</button>
                        </div>
                    </div>
                    <button class="btn btn-outline btn-sm" onclick="draftTracker.loadPlan()">
                        <span>📂</span> Load Plan
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="draftTracker.clearPlan()">
                        <span>🗑️</span> Clear
                    </button>
                </div>
                <div class="draft-plan-content" id="draftPlanContent">
                    <!-- Plan content will be inserted here -->
                </div>
            </div>

            <!-- Draft Feed -->
            <div class="draft-feed-container">
                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title">📊 Live Draft Feed with AI Analysis</h3>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span id="draftFeedUpdated" style="font-size: 0.8em; color: var(--text-secondary);"></span>
                            <button class="btn btn-sm btn-outline" data-action="refresh-draft" id="refreshDraftBtn">
                                <span>🔄</span> Refresh
                            </button>
                        </div>
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
            console.log('✅ DraftTracker: Found empty state, replacing with draft interface');
            emptyState.parentElement.innerHTML = trackingHTML;
            console.log('✅ DraftTracker: Draft UI setup complete!');
        } else {
            console.warn('❌ DraftTracker: Empty state not found, cannot set up draft interface');
            // Try alternative approach - append to the draft page directly
            const cardContainer = draftPage.querySelector('.card');
            if (cardContainer) {
                console.log('📝 DraftTracker: Trying alternative approach - replacing card content');
                cardContainer.innerHTML = trackingHTML;
                console.log('✅ DraftTracker: Draft UI setup complete (alternative approach)!');
            }
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

    /**
     * Minimal feed entry for a pick whose player is not in the filtered database -
     * a defense, a kicker, or anyone outside the top few hundred by search rank.
     * Sleeper's pick metadata carries enough to name them.
     */
    displayUnknownPick(pick) {
        const feedElement = document.getElementById('draftFeed');
        if (!feedElement) return;

        this.clearFeedEmptyState(feedElement);

        const meta = pick.metadata || {};
        const name = [meta.first_name, meta.last_name].filter(Boolean).join(' ')
            || meta.team
            || `Player ${pick.player_id}`;
        const position = meta.position || 'N/A';
        const team = meta.team || 'FA';

        const pickElement = document.createElement('div');
        pickElement.className = 'draft-pick-analysis';
        pickElement.innerHTML = `
            <div class="pick-item" style="border-left: 4px solid var(--border-color); margin-bottom: 15px; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                <div class="pick-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div class="pick-number" style="font-weight: bold; color: var(--accent-color);">Pick ${pick.pick_no}</div>
                    <div style="font-size: 0.8em; color: var(--text-secondary);">No AI analysis</div>
                </div>
                <div class="pick-player">
                    <strong style="color: var(--text-primary);">${name}</strong>
                    <span style="color: var(--text-secondary);">(${position} - ${team})</span>
                </div>
            </div>
        `;

        feedElement.insertBefore(pickElement, feedElement.firstChild);
        this.markFeedUpdated();
    }

    /** Removes the "Ready for Draft" placeholder once real picks arrive. */
    clearFeedEmptyState(feedElement) {
        const placeholder = feedElement.querySelector('.empty-state');
        if (placeholder) placeholder.remove();
    }

    /** Timestamps the feed so a stale view is obvious at a glance. */
    markFeedUpdated() {
        const stamp = document.getElementById('draftFeedUpdated');
        if (stamp) {
            stamp.textContent = `Updated ${new Date().toLocaleTimeString()}`;
        }
    }

    displayPick(pick, player, analysis) {
        const feedElement = document.getElementById('draftFeed');
        if (!feedElement) return;

        // Keyed off the placeholder itself rather than this.picks.length, which is
        // not assigned until after the whole batch is processed - so the old check
        // never fired and "Ready for Draft" stayed sitting under the live picks.
        this.clearFeedEmptyState(feedElement);
        this.markFeedUpdated();

        // Use DocumentFragment for better performance
        const fragment = document.createDocumentFragment();
        const pickElement = document.createElement('div');
        pickElement.className = 'draft-pick-analysis';
        
        // Build the pick display with better performance
        const gradeClass = analysis.grade.toLowerCase().replace(' ', '-');
        const gradeColor = this.getGradeColor(analysis.grade);
        
        pickElement.innerHTML = `
            <div class="pick-item" style="border-left: 4px solid ${gradeColor}; margin-bottom: 15px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                <div class="pick-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div class="pick-number" style="font-weight: bold; color: var(--accent-color);">Pick ${pick.pick_no}</div>
                    <div class="pick-grade ${gradeClass}" style="padding: 4px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold;">${analysis.grade}</div>
                    <div class="confidence-badge" style="font-size: 0.8em; color: var(--text-secondary);">AI: ${analysis.confidence}%</div>
                </div>
                <div class="pick-player" style="margin-bottom: 8px;">
                    <strong style="color: var(--text-primary);">${player.name}</strong> 
                    <span style="color: var(--text-secondary);">(${player.position} - ${player.team})</span>
                </div>
                <div class="pick-analysis">
                    <div class="analysis-reasoning" style="font-size: 0.9em; color: var(--text-secondary); margin-bottom: 6px;">
                        ${analysis.reasoning.map(reason => `• ${reason}`).join('<br>')}
                    </div>
                    <div class="learning-tip" style="background: rgba(69, 183, 209, 0.1); padding: 8px; border-radius: 4px; font-size: 0.85em;">
                        💡 <strong>Learn:</strong> ${analysis.educationalTip}
                    </div>
                </div>
            </div>
        `;
        
        fragment.appendChild(pickElement);
        
        // Insert at top for most recent picks
        feedElement.insertBefore(fragment, feedElement.firstChild);
        
        // Limit to last 8 picks for better performance
        while (feedElement.children.length > 8) {
            feedElement.removeChild(feedElement.lastChild);
        }
        
        // Add a subtle animation for new picks
        pickElement.style.opacity = '0';
        pickElement.style.transform = 'translateY(-10px)';
        requestAnimationFrame(() => {
            pickElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            pickElement.style.opacity = '1';
            pickElement.style.transform = 'translateY(0)';
        });
    }

    displayPanicMode(recommendations, usingDemoData = false) {
        console.log('📱 Displaying panic mode with recommendations:', recommendations?.length || 0, 'Demo data:', usingDemoData);
        
        const panicPanel = document.getElementById('panicModePanel');
        const recommendationsElement = document.getElementById('panicRecommendations');
        
        console.log('🔍 Elements found - panel:', !!panicPanel, 'recommendations:', !!recommendationsElement);
        
        if (!panicPanel || !recommendationsElement) {
            console.error('❌ Panic mode DOM elements not found');
            this.configManager.showNotification('❌ Panic mode UI not available', 'error');
            return;
        }
        
        if (!recommendations || recommendations.length === 0) {
            console.warn('⚠️ No recommendations provided to displayPanicMode');
            recommendations = this.getFallbackRecommendations();
        }
        
        panicPanel.style.display = 'block';
        console.log('✅ Panic panel shown');
        
        const recommendationsHTML = `
            <h4 style="color: var(--warning-color); margin-bottom: 15px;">🚨 Emergency Recommendations</h4>
            ${usingDemoData ? `
                <div style="background: rgba(255, 165, 0, 0.1); border: 1px solid orange; border-radius: 6px; padding: 10px; margin-bottom: 15px; text-align: center;">
                    <div style="color: orange; font-weight: bold; margin-bottom: 5px;">⚠️ LIMITED DATA MODE</div>
                    <div style="font-size: 0.85em; color: var(--text-secondary);">
                        Using sample players only. Connect to Sleeper for full player database and better recommendations.
                    </div>
                </div>
            ` : ''}
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
            const drafted = this.positionScarcity[pos]?.drafted || 0;
            
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

    // ======================
    // AUDIO SYSTEM
    // ======================

    initializeAudio() {
        try {
            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create simple tones for different alerts
            this.sounds.yourTurn = this.createTone(800, 0.3, 0.2); // High pitched alert
            this.sounds.pickMade = this.createTone(400, 0.1, 0.1); // Low confirmation
            this.sounds.warning = this.createTone(600, 0.2, 0.15); // Mid warning
            this.sounds.countdown = this.createTone(1000, 0.1, 0.05); // Quick tick
            
            console.log('🔊 Audio system initialized');
        } catch (error) {
            console.warn('⚠️ Could not initialize audio:', error);
            this.audioEnabled = false;
        }
    }

    createTone(frequency, duration, volume) {
        return () => {
            if (!this.audioEnabled || !this.audioContext) return;
            
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            oscillator.frequency.value = frequency;
            gainNode.gain.value = volume;
            
            oscillator.start();
            oscillator.stop(this.audioContext.currentTime + duration);
        };
    }

    playSound(soundName) {
        if (this.sounds[soundName]) {
            this.sounds[soundName]();
        }
    }

    // ======================
    // TIMER SYSTEM
    // ======================

    startPickTimer(seconds = 90) {
        this.clearPickTimer();
        
        this.pickDeadline = Date.now() + (seconds * 1000);
        this.updateTimerDisplay();
        
        this.timerInterval = setInterval(() => {
            const remaining = Math.ceil((this.pickDeadline - Date.now()) / 1000);
            
            if (remaining <= 0) {
                this.clearPickTimer();
                this.handleTimerExpired();
            } else {
                this.updateTimerDisplay();
                
                // Warning sounds
                if (remaining === 30) {
                    this.playSound('warning');
                    this.configManager.showNotification('⏰ 30 seconds remaining!', 'warning');
                } else if (remaining === 15) {
                    this.playSound('warning');
                    this.configManager.showNotification('⚠️ 15 seconds remaining!', 'error');
                } else if (remaining <= 5) {
                    this.playSound('countdown');
                }
            }
        }, 1000);
    }

    clearPickTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.pickDeadline = null;
        this.updateTimerDisplay();
    }

    updateTimerDisplay() {
        const timerElement = document.getElementById('pickTimer');
        if (!timerElement) return;
        
        if (!this.pickDeadline) {
            timerElement.style.display = 'none';
            return;
        }
        
        const remaining = Math.max(0, Math.ceil((this.pickDeadline - Date.now()) / 1000));
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        
        timerElement.style.display = 'block';
        timerElement.innerHTML = `
            <div class="timer-display ${remaining <= 15 ? 'timer-critical' : remaining <= 30 ? 'timer-warning' : ''}">
                <span class="timer-label">Time Remaining:</span>
                <span class="timer-value">${minutes}:${seconds.toString().padStart(2, '0')}</span>
            </div>
        `;
    }

    handleTimerExpired() {
        this.playSound('warning');
        this.configManager.showNotification('⏰ TIME EXPIRED! Auto-picking from queue...', 'error');
        
        // Auto-pick from queue if available
        if (this.draftQueue.length > 0) {
            const autoPick = this.draftQueue[0];
            this.configManager.showNotification(`🤖 Auto-picked: ${autoPick.name}`, 'warning');
            // In real implementation, would send pick to Sleeper
        }
    }

    // ======================
    // QUEUE SYSTEM
    // ======================

    addToQueue(player) {
        if (this.queuedPlayers.has(player.id)) return;
        
        this.draftQueue.push(player);
        this.queuedPlayers.add(player.id);
        this.updateQueueDisplay();
        
        this.configManager.showNotification(`➕ Added ${player.name} to queue`, 'success');
    }

    removeFromQueue(playerId) {
        this.draftQueue = this.draftQueue.filter(p => p.id !== playerId);
        this.queuedPlayers.delete(playerId);
        this.updateQueueDisplay();
    }

    moveInQueue(playerId, direction) {
        const index = this.draftQueue.findIndex(p => p.id === playerId);
        if (index === -1) return;
        
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= this.draftQueue.length) return;
        
        // Swap positions
        [this.draftQueue[index], this.draftQueue[newIndex]] = 
        [this.draftQueue[newIndex], this.draftQueue[index]];
        
        this.updateQueueDisplay();
    }

    updateQueueDisplay() {
        const queueElement = document.getElementById('draftQueue');
        if (!queueElement) return;
        
        if (this.draftQueue.length === 0) {
            queueElement.innerHTML = '<div class="empty-queue">No players queued</div>';
            return;
        }
        
        queueElement.innerHTML = this.draftQueue.map((player, index) => `
            <div class="queue-item" data-player-id="${player.id}">
                <span class="queue-rank">${index + 1}</span>
                <span class="queue-player">${player.name} - ${player.position}</span>
                <div class="queue-actions">
                    <button onclick="draftTracker.moveInQueue('${player.id}', 'up')" ${index === 0 ? 'disabled' : ''}>↑</button>
                    <button onclick="draftTracker.moveInQueue('${player.id}', 'down')" ${index === this.draftQueue.length - 1 ? 'disabled' : ''}>↓</button>
                    <button onclick="draftTracker.removeFromQueue('${player.id}')">✕</button>
                </div>
            </div>
        `).join('');
    }

    // ======================
    // KEYBOARD SHORTCUTS
    // ======================

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger in input fields
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            // Number keys 1-5 for quick picks in panic mode
            if (this.panicMode && e.key >= '1' && e.key <= '5') {
                const index = parseInt(e.key) - 1;
                const recommendations = document.querySelectorAll('.panic-recommendation');
                if (recommendations[index]) {
                    this.configManager.showNotification(`Selected recommendation #${e.key}`, 'success');
                    // In real implementation, would make the pick
                }
                return;
            }
            
            switch(e.key.toLowerCase()) {
                case 'q':
                    // Toggle queue panel
                    this.toggleQueuePanel();
                    break;
                case 'p':
                    // Toggle panic mode
                    if (this.panicMode) {
                        this.deactivatePanicMode();
                    } else {
                        this.activatePanicMode();
                    }
                    break;
                case 'a':
                    // Toggle audio
                    this.audioEnabled = !this.audioEnabled;
                    this.configManager.showNotification(
                        this.audioEnabled ? '🔊 Audio enabled' : '🔇 Audio disabled', 
                        'info'
                    );
                    break;
                case 't':
                    // Test timer (for demo)
                    if (e.shiftKey) {
                        this.startPickTimer(30);
                        this.configManager.showNotification('⏱️ Test timer started (30s)', 'info');
                    }
                    break;
            }
        });
        
        console.log('⌨️ Draft keyboard shortcuts active: 1-5 (panic picks), Q (queue), P (panic mode), A (audio)');
    }

    toggleQueuePanel() {
        const queuePanel = document.getElementById('queuePanel');
        if (queuePanel) {
            queuePanel.style.display = queuePanel.style.display === 'none' ? 'block' : 'none';
        }
    }

    handleUserTurn() {
        // Play alert sound
        this.playSound('yourTurn');
        
        // Show notifications
        this.configManager.showNotification('🎯 IT\'S YOUR TURN TO PICK!', 'warning', 10000);
        
        // Flash page title
        this.flashPageTitle();
        
        // Start pick timer (90 seconds default)
        this.startPickTimer(90);
        
        // Auto-activate panic mode if enabled
        if (this.configManager.config.autoPanicMode) {
            setTimeout(() => {
                if (this.isUserTurn) {
                    this.activatePanicMode();
                }
            }, 5000); // Give 5 seconds before auto-panic
        }
    }

    updateQueueForDraftedPlayers() {
        // Remove any drafted players from queue
        const draftedIds = new Set(this.picks.map(p => p.player_id));
        
        this.draftQueue = this.draftQueue.filter(player => {
            if (draftedIds.has(player.id)) {
                console.log(`🗑️ Removing drafted player from queue: ${player.name}`);
                this.queuedPlayers.delete(player.id);
                return false;
            }
            return true;
        });
        
        this.updateQueueDisplay();
    }

    checkUserTurn() {
        // This method is called during batch updates
        if (this.isUserTurn && !document.getElementById('panicModePanel').style.display !== 'none') {
            // Show visual indicator that it's user's turn
            const draftStatus = document.getElementById('draftStatus');
            if (draftStatus) {
                draftStatus.innerHTML = '<span style="color: var(--warning-color); font-weight: bold;">🎯 YOUR TURN!</span>';
            }
        }
    }

    // ======================
    // DRAFT PLAN SYSTEM
    // ======================

    toggleDraftPlan() {
        const planPanel = document.getElementById('draftPlanPanel');
        const expandIndicator = document.getElementById('expandIndicator');
        
        if (planPanel) {
            const isCollapsed = planPanel.classList.contains('collapsed');
            
            if (isCollapsed) {
                // Expand panel
                planPanel.classList.remove('collapsed');
                planPanel.classList.add('expanded');
                expandIndicator.textContent = '▲';
                this.displayDraftPlan();
            } else {
                // Collapse panel
                planPanel.classList.remove('expanded');
                planPanel.classList.add('collapsed');
                expandIndicator.textContent = '▼';
            }
        }
    }

    addModalEscapeHandler() {
        if (this.escapeHandler) return; // Already exists
        
        this.escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.toggleDraftPlan();
            }
        };
        
        document.addEventListener('keydown', this.escapeHandler);
    }

    removeModalEscapeHandler() {
        if (this.escapeHandler) {
            document.removeEventListener('keydown', this.escapeHandler);
            this.escapeHandler = null;
        }
    }

    handleModalBackdropClick(event) {
        // Close modal when clicking on backdrop (not the panel itself)
        if (event.target === event.currentTarget) {
            this.toggleDraftPlan();
        }
    }

    displayDraftPlan() {
        const contentElement = document.getElementById('draftPlanContent');
        if (!contentElement) return;

        const totalRounds = 15; // Standard draft
        const teamCount = this.draftData?.settings?.teams || 12;
        const draftPosition = this.configManager.config.draftPosition || 1;

        let html = '<div class="draft-plan-grid">';
        
        for (let round = 1; round <= totalRounds; round++) {
            // Calculate pick number (snake draft)
            let pickInRound = round % 2 === 1 ? draftPosition : teamCount - draftPosition + 1;
            let overallPick = (round - 1) * teamCount + pickInRound;
            
            const targets = this.draftPlan[round] || [];
            const backups = this.planBackups[round] || [];
            
            html += `
                <div class="round-plan ${this.picks.length >= overallPick ? 'round-completed' : ''}">
                    <div class="round-header">
                        <span class="round-number">Round ${round}</span>
                        <span class="pick-number">Pick ${overallPick}</span>
                    </div>
                    <div class="round-targets">
                        <div class="target-section">
                            <h4>Primary Targets:</h4>
                            <div class="target-list" data-round="${round}" data-type="primary">
                                ${targets && targets.length > 0 ? targets.map((player, idx) => `
                                    <div class="target-player ${this.isPlayerDrafted(player.id) ? 'drafted' : ''}" 
                                         data-player-id="${player.id}">
                                        <span class="target-rank">${idx + 1}</span>
                                        <span class="target-name">${player.name} - ${player.position}</span>
                                        <button onclick="draftTracker.removeFromPlan(${round}, 'primary', '${player.id}')">✕</button>
                                    </div>
                                `).join('') : '<div class="empty-targets">Click to add targets</div>'}
                            </div>
                        </div>
                        <div class="backup-section">
                            <h4>Backup Options:</h4>
                            <div class="target-list" data-round="${round}" data-type="backup">
                                ${backups && backups.length > 0 ? backups.map((player, idx) => `
                                    <div class="target-player ${this.isPlayerDrafted(player.id) ? 'drafted' : ''}" 
                                         data-player-id="${player.id}">
                                        <span class="target-rank">B${idx + 1}</span>
                                        <span class="target-name">${player.name} - ${player.position}</span>
                                        <button onclick="draftTracker.removeFromPlan(${round}, 'backup', '${player.id}')">✕</button>
                                    </div>
                                `).join('') : '<div class="empty-targets">Click to add backups</div>'}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        html += '</div>';
        contentElement.innerHTML = html;

        // Add click handlers for empty slots
        console.log('🔍 Setting up click handlers for empty targets...');
        const emptyTargets = contentElement.querySelectorAll('.empty-targets');
        console.log(`📊 Found ${emptyTargets.length} empty target elements`);
        
        emptyTargets.forEach((el, index) => {
            console.log(`📝 Setting up handler ${index + 1}:`, el.textContent.trim());
            el.addEventListener('click', (e) => {
                const parent = e.target.closest('.target-list');
                if (!parent) {
                    console.error('❌ Could not find target-list parent');
                    return;
                }
                const round = parseInt(parent.dataset.round);
                const type = parent.dataset.type;
                console.log(`🎯 Opening player selector for Round ${round}, Type: ${type}`);
                this.showPlayerSelector(round, type);
            });
        });
    }

    isPlayerDrafted(playerId) {
        // Robust player ID checking with type coercion
        return this.picks.some(pick => {
            return pick.player_id === playerId || 
                   pick.player_id === String(playerId) || 
                   pick.player_id === parseInt(playerId) ||
                   String(pick.player_id) === String(playerId);
        });
    }

    findPlayerById(playerId) {
        // Search through all available player sources
        
        // 1. Check the player database (populated from Sleeper)
        if (this.playerDatabase && this.playerDatabase.has(playerId)) {
            return this.playerDatabase.get(playerId);
        }
        
        // 2. Check sample players (demo data)
        const samplePlayers = this.getSamplePlayers();
        const samplePlayer = samplePlayers.find(p => p.id === playerId);
        if (samplePlayer) {
            return samplePlayer;
        }
        
        // 3. Check existing draft plan entries
        for (let round = 1; round <= 15; round++) {
            if (this.draftPlan[round]) {
                const found = this.draftPlan[round].find(p => p.id === playerId);
                if (found) return found;
            }
            if (this.planBackups[round]) {
                const found = this.planBackups[round].find(p => p.id === playerId);
                if (found) return found;
            }
        }
        
        console.warn(`⚠️ Player with ID ${playerId} not found in any data source`);
        return null;
    }

    removeFromPlan(round, type, playerId) {
        const list = type === 'primary' ? this.draftPlan : this.planBackups;
        if (list[round]) {
            list[round] = list[round].filter(p => p.id !== playerId);
        }
        this.displayDraftPlan();
        this.savePlanToStorage();
    }

    showPlayerSelector(round, type) {
        console.log(`🎯 showPlayerSelector called: Round ${round}, Type ${type}`);
        console.log(`📊 Player database size: ${this.playerDatabase.size}`);
        
        // Get available players
        const availablePlayers = Array.from(this.playerDatabase.values())
            .filter(player => !this.isPlayerDrafted(player.id))
            .sort((a, b) => a.adp - b.adp)
            .slice(0, 200); // Top 200 available
            
        console.log(`📊 Available players for selection: ${availablePlayers.length}`);

        // Create modal for player selection
        const modal = document.createElement('div');
        modal.className = 'player-selector-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Select ${type === 'primary' ? 'Target' : 'Backup'} for Round ${round}</h3>
                    <button onclick="this.closest('.player-selector-modal').remove()">✕</button>
                </div>
                <div class="modal-search">
                    <input type="text" id="playerSearch" placeholder="Search players..." 
                           onkeyup="draftTracker.filterPlayerList(this.value)">
                </div>
                <div class="modal-players" id="playerList">
                    ${availablePlayers.map(player => `
                        <div class="selectable-player" data-player-id="${player.id}">
                            <span class="player-info">${this.formatPlayerInfo(player)}</span>
                            <button onclick="draftTracker.addToPlan(${round}, '${type}', '${player.id}')">
                                Add
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    }

    filterPlayerList(searchTerm) {
        const players = document.querySelectorAll('.selectable-player');
        const term = searchTerm.toLowerCase();

        players.forEach(playerEl => {
            const playerInfo = playerEl.querySelector('.player-info').textContent.toLowerCase();
            playerEl.style.display = playerInfo.includes(term) ? 'flex' : 'none';
        });
    }

    addToPlan(round, type, playerIdOrJson) {
        try {
            console.log(`📝 Adding to plan: Round ${round}, Type ${type}`);
            console.log(`📊 Player data:`, playerIdOrJson);
            
            let player;
            
            // Handle both player ID and JSON for backward compatibility
            if (typeof playerIdOrJson === 'string' && playerIdOrJson.startsWith('{')) {
                // Legacy JSON format
                player = JSON.parse(playerIdOrJson);
            } else {
                // New player ID format
                const playerId = playerIdOrJson;
                player = this.findPlayerById(playerId);
                
                if (!player) {
                    throw new Error(`Player with ID ${playerId} not found`);
                }
            }
            
            console.log(`✅ Found player:`, player.name, player.position);
            
            const list = type === 'primary' ? this.draftPlan : this.planBackups;
            
            if (!list[round]) {
                list[round] = [];
            }
            
            // Avoid duplicates
            if (!list[round].some(p => p.id === player.id)) {
                list[round].push(player);
                console.log(`✅ Added ${player.name} to ${type} list for round ${round}`);
            } else {
                console.log(`⚠️ Player ${player.name} already in ${type} list for round ${round}`);
            }

            // Close modal
            const modal = document.querySelector('.player-selector-modal');
            if (modal) {
                modal.remove();
                console.log(`✅ Modal closed`);
            } else {
                console.warn(`⚠️ Could not find modal to close`);
            }
            
            // Refresh display
            this.displayDraftPlan();
            this.savePlanToStorage();
            
            this.configManager.showNotification(`✅ Added ${player.name} to Round ${round} ${type} targets`, 'success');
            
        } catch (error) {
            console.error('❌ Error adding player to plan:', error);
            this.configManager.showNotification(`❌ Error adding player to plan: ${error.message}`, 'error');
        }
    }

    generateSmartPlan() {
        // Validate scoring format first - critical for accurate player values
        const scoringFormat = this.configManager.config.scoringFormat || 'Half PPR';
        if (!this.configManager.config.scoringFormat) {
            this.configManager.showNotification(
                '⚠️ SCORING FORMAT NOT SET! Using Half PPR default. Please verify your league\'s scoring in Configuration for accurate player rankings!', 
                'warning', 
                10000
            );
        }
        
        this.configManager.showNotification('🤖 Generating AI-optimized draft plan...', 'info');
        
        const teamCount = this.draftData?.settings?.teams || 12;
        const draftPosition = this.configManager.config.draftPosition || 1;
        
        // Clear existing plan
        this.draftPlan = {};
        this.planBackups = {};
        
        // Get all players sorted by ADP - be more inclusive for QB/TE/K/DEF
        const allPlayers = Array.from(this.playerDatabase.values())
            .filter(p => {
                // Include players with good ADP
                if (p.adp && p.adp < 200) return true;
                
                // Also include QB/TE/K/DEF even with high/missing ADP
                if (['QB', 'TE', 'K', 'DEF'].includes(p.position)) {
                    // Assign reasonable ADP if missing
                    if (!p.adp || p.adp > 500) {
                        // Deterministic midpoints. These values are written back onto
                        // the shared player database, so randomising them here left
                        // every QB, TE, K and DEF with a different ADP each time a
                        // plan was generated - and the live recommendations sort on
                        // that same field.
                        const defaultADP = {
                            'QB': 100,
                            'TE': 115,
                            'K': 190,
                            'DEF': 200
                        };
                        p.adp = defaultADP[p.position];
                    }
                    return true;
                }
                
                return false;
            })
            .sort((a, b) => a.adp - b.adp);
        
        // Debug: Check available players by position
        const positionCounts = {};
        allPlayers.forEach(p => {
            positionCounts[p.position] = (positionCounts[p.position] || 0) + 1;
        });
        console.log('📊 Available players by position (ADP < 200):', positionCounts);
        
        // Debug: Show sample players for each position
        ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach(pos => {
            const players = allPlayers.filter(p => p.position === pos).slice(0, 3);
            console.log(`${pos} samples:`, players.map(p => `${p.name} (ADP: ${p.adp})`));
        });
        
        // Track drafted positions to ensure balance
        const draftedPositions = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
        
        // Generate targets for each round
        for (let round = 1; round <= 15; round++) {
            // Calculate pick range for this round
            let pickInRound = round % 2 === 1 ? draftPosition : teamCount - draftPosition + 1;
            let overallPick = (round - 1) * teamCount + pickInRound;
            
            // Find players likely available at this pick (ADP within range)
            // Use wider ranges for later rounds to ensure K/DEF coverage
            let minADP = overallPick - 15;
            let maxADP = overallPick + 15;
            
            if (round >= 13) {
                // Very wide range for K/DEF rounds
                minADP = overallPick - 50;
                maxADP = overallPick + 50;
            } else if (round >= 8) {
                // Wider range for QB/TE rounds
                minADP = overallPick - 25;
                maxADP = overallPick + 25;
            }
            
            const candidates = allPlayers.filter(p => 
                p.adp >= minADP && p.adp <= maxADP && !this.isPlayerDrafted(p.id)
            );
            
            // Smart position targeting with roster balance consideration
            let positionPriorities = this.getPositionPrioritiesForRound(round, scoringFormat);
            
            // Adjust priorities based on roster needs
            positionPriorities = this.adjustPrioritiesForRosterBalance(positionPriorities, draftedPositions, round);
            
            // Debug round-by-round
            console.log(`Round ${round} (Pick ${overallPick}):`, {
                originalPriorities: this.getPositionPrioritiesForRound(round, scoringFormat),
                adjustedPriorities: positionPriorities,
                draftedSoFar: {...draftedPositions},
                candidatesFound: candidates.length
            });
            
            // Select primary targets and backups
            this.draftPlan[round] = [];
            this.planBackups[round] = [];
            
            positionPriorities.forEach(position => {
                const positionPlayers = candidates.filter(p => p.position === position);
                
                // Debug: Show what players are found for each position
                if (positionPlayers.length > 0) {
                    console.log(`  ${position}: Found ${positionPlayers.length} players:`, 
                        positionPlayers.slice(0, 3).map(p => `${p.name} (${p.adp})`));
                    
                    const targets = positionPlayers.slice(0, 2);
                    const backups = positionPlayers.slice(2, 4);
                    
                    this.draftPlan[round].push(...targets);
                    this.planBackups[round].push(...backups);
                } else {
                    console.log(`  ${position}: No players found in ADP range ${minADP}-${maxADP}`);
                    
                    // Force include critical positions even if outside ADP range
                    if (['QB', 'TE', 'K', 'DEF'].includes(position) && round >= 7) {
                        const allPositionPlayers = allPlayers.filter(p => 
                            p.position === position && !this.isPlayerDrafted(p.id)
                        );
                        
                        if (allPositionPlayers.length > 0) {
                            console.log(`  ${position}: FORCE ADDING best available:`, allPositionPlayers[0].name);
                            this.draftPlan[round].push(allPositionPlayers[0]);
                        }
                    }
                }
            });
            
            // Limit to reasonable number
            this.draftPlan[round] = this.draftPlan[round].slice(0, 4);
            this.planBackups[round] = this.planBackups[round].slice(0, 4);
            
            // Update drafted positions count (assuming we take the first target)
            if (this.draftPlan[round].length > 0) {
                const topPick = this.draftPlan[round][0];
                draftedPositions[topPick.position] = (draftedPositions[topPick.position] || 0) + 1;
            }
        }
        
        // Debug: Log players that might not be in Sleeper
        this.validateDraftPlanPlayers();
        
        // Log final roster balance
        console.log('📊 Draft plan roster balance:', draftedPositions);
        
        this.displayDraftPlan();
        this.savePlanToStorage();
        
        // Show roster balance in notification
        const rosterSummary = `QB: ${draftedPositions.QB || 0}, RB: ${draftedPositions.RB || 0}, WR: ${draftedPositions.WR || 0}, TE: ${draftedPositions.TE || 0}, K: ${draftedPositions.K || 0}, DEF: ${draftedPositions.DEF || 0}`;
        this.configManager.showNotification(`✅ Balanced draft plan generated! ${rosterSummary}`, 'success');
    }

    validateDraftPlanPlayers() {
        // Check if draft plan players can be found in Sleeper by searching for them
        console.log('🔍 Validating draft plan players against Sleeper database...');
        
        const allPlanPlayers = [];
        Object.values(this.draftPlan).forEach(roundPlayers => {
            allPlanPlayers.push(...roundPlayers);
        });
        
        const problematicPlayers = [];
        allPlanPlayers.forEach(player => {
            // Try to find this player in our loaded Sleeper database
            const found = Array.from(this.playerDatabase.values()).find(p => 
                p.name.toLowerCase() === player.name.toLowerCase() ||
                p.name.toLowerCase().includes(player.name.toLowerCase()) ||
                player.name.toLowerCase().includes(p.name.toLowerCase())
            );
            
            if (!found) {
                problematicPlayers.push(player.name);
            }
        });
        
        if (problematicPlayers.length > 0) {
            console.warn('⚠️ Draft plan players not found in Sleeper database:', problematicPlayers);
            console.log('💡 These players might need manual verification or have name/ID mismatches');
            
            // Show user-friendly warning
            this.configManager.showNotification(
                `⚠️ ${problematicPlayers.length} draft plan players may not be available in Sleeper. Check console for details.`, 
                'warning', 
                8000
            );
        } else {
            console.log('✅ All draft plan players validated against Sleeper database');
        }
    }

    getPositionPrioritiesForRound(round, scoringFormat) {
        // Balanced position prioritization ensuring all roster spots are covered
        const priorities = {
            1: ['RB', 'WR'],                    // Premium skill positions
            2: ['WR', 'RB'],                    // Complement round 1
            3: ['RB', 'WR', 'TE'],             // Value or elite TE
            4: ['WR', 'RB', 'QB'],             // Continue skill positions, consider QB
            5: ['QB', 'RB', 'WR'],             // QB priority increases
            6: ['RB', 'WR', 'TE', 'QB'],       // Depth at skill positions
            7: ['QB', 'TE', 'RB', 'WR'],       // Must address QB/TE soon
            8: ['TE', 'QB', 'RB', 'WR'],       // Last chance for decent QB/TE
            9: ['RB', 'WR', 'QB', 'TE'],       // Depth and remaining needs
            10: ['QB', 'RB', 'WR', 'TE'],      // Final QB window
            11: ['RB', 'WR', 'TE'],            // Skill position depth
            12: ['RB', 'WR'],                  // Final skill position picks
            13: ['K', 'RB', 'WR'],             // Kicker or one more skill player
            14: ['DEF', 'K', 'RB'],            // Defense priority
            15: ['K', 'DEF', 'RB']             // Complete roster
        };
        
        // Adjust for PPR formats
        if (scoringFormat.includes('PPR')) {
            // Prioritize WR more in PPR
            Object.keys(priorities).forEach(r => {
                const idx = priorities[r].indexOf('WR');
                if (idx > 0) {
                    priorities[r].splice(idx, 1);
                    priorities[r].unshift('WR');
                }
            });
        }
        
        return priorities[round] || ['RB', 'WR'];
    }

    adjustPrioritiesForRosterBalance(priorities, draftedPositions, round) {
        // Ensure roster balance by adjusting priorities based on needs
        const adjustedPriorities = [...priorities];
        
        // Critical roster requirements
        const rosterNeeds = {
            QB: { min: 1, ideal: 1, critical: round >= 8 && draftedPositions.QB === 0 },
            TE: { min: 1, ideal: 1, critical: round >= 9 && draftedPositions.TE === 0 },
            K: { min: 1, ideal: 1, critical: round >= 13 && draftedPositions.K === 0 },
            DEF: { min: 1, ideal: 1, critical: round >= 14 && draftedPositions.DEF === 0 }
        };
        
        // Force critical positions to the front
        Object.keys(rosterNeeds).forEach(position => {
            const need = rosterNeeds[position];
            if (need.critical) {
                // Remove from current position and add to front
                const index = adjustedPriorities.indexOf(position);
                if (index > -1) {
                    adjustedPriorities.splice(index, 1);
                }
                adjustedPriorities.unshift(position);
            }
        });
        
        // Boost priority for positions we haven't drafted yet
        if (round >= 5 && draftedPositions.QB === 0 && !adjustedPriorities.includes('QB')) {
            adjustedPriorities.splice(1, 0, 'QB'); // High priority for QB after round 5
        }
        
        if (round >= 7 && draftedPositions.TE === 0 && !adjustedPriorities.includes('TE')) {
            adjustedPriorities.splice(1, 0, 'TE'); // High priority for TE after round 7
        }
        
        // Don't over-draft positions
        const maxPositions = { QB: 2, TE: 2, K: 1, DEF: 1, RB: 6, WR: 6 };
        const filteredPriorities = adjustedPriorities.filter(position => {
            return (draftedPositions[position] || 0) < (maxPositions[position] || 99);
        });
        
        return filteredPriorities.length > 0 ? filteredPriorities : ['RB', 'WR']; // Fallback
    }

    getRoundStrategy(round, scoringFormat) {
        // Educational insights for each round
        const strategies = {
            1: {
                focus: "Elite RB/WR Foundation",
                reasoning: "Early rounds are about securing weekly points and consistency. RBs offer the highest floor and ceiling combination, while elite WRs provide consistent targets in high-volume offenses.",
                tips: ["Target workhorse RBs who handle most carries/catches (300+ total opportunities)", "Look for WRs who get 140+ passes thrown their way per season", "Avoid QBs/TEs unless they're elite Hall of Fame level talents"]
            },
            2: {
                focus: "Complement Round 1 Pick",
                reasoning: "Balance your foundation. If you went RB in Round 1, consider a WR1 here. The talent drop-off is steeper at RB, so doubling up can be viable.",
                tips: ["RB-RB can work if elite options available", "Target WRs in pass-heavy offenses", "Position scarcity becomes important"]
            },
            3: {
                focus: "Best Player Available",
                reasoning: "This is often where value emerges. Players with WR1/RB1 upside can fall due to perceived risk or injury concerns.",
                tips: ["Don't reach for needs - take value", "Consider breakout candidates", "Elite TEs start becoming viable"]
            },
            4: {
                focus: "Address Roster Construction",
                reasoning: "Time to think about roster balance. If you're 2 RBs deep, pivot to WR. If you need RB depth before the position gets thin, act now.",
                tips: ["QB becomes viable if elite tier remains", "Don't ignore positional depth", "Target players with weekly upside"]
            },
            5: {
                focus: "Positional Depth or Value",
                reasoning: "Middle rounds are about accumulating players who can contribute immediately or have significant upside. Depth at RB/WR is crucial.",
                tips: ["Backup RBs to your starters gain value (injury insurance)", "Target slot receivers who get lots of short passes", "Consider QB if you haven't addressed it"]
            },
            6: {
                focus: "Skill Position Depth",
                reasoning: "Continue building RB/WR depth. Injuries are inevitable, and having quality backups or flex options is essential for season-long success.",
                tips: ["Target players in good offensive systems", "Look for red zone threats", "Elite TEs still viable here"]
            },
            7: {
                focus: "QB or Continued Depth",
                reasoning: "If you haven't taken a QB yet, the value starts to diminish quickly after this round. Otherwise, continue adding skill position depth.",
                tips: ["Don't wait too long on QB", "Target players with defined roles", "Consider team schedules and bye weeks"]
            },
            8: {
                focus: "Address Remaining Needs",
                reasoning: "Time to fill any glaring holes in your roster. If you need a QB or TE, address it soon before the talent drops significantly.",
                tips: ["TE becomes a need if not addressed", "Target players with touchdown upside", "Consider playoff schedules"]
            },
            9: {
                focus: "Upside and Depth",
                reasoning: "Later rounds are about finding players with breakout potential and ensuring you have bye-week coverage at key positions.",
                tips: ["Target young players in good situations", "Backup RBs become very valuable (injury insurance)", "Look for backups to injury-prone starters"]
            },
            10: {
                focus: "QB if Not Addressed",
                reasoning: "If you haven't taken a QB, you're in dangerous territory. The streaming options become less reliable, and you may be forced into poor matchups.",
                tips: ["Don't wait past this round for QB", "Target high-volume passing offenses", "Consider QB injury history"]
            },
            11: {
                focus: "Lottery Tickets",
                reasoning: "These picks are about finding league-winners on waivers. Target rookies, players returning from injury, or those in new situations.",
                tips: ["Prioritize upside over floor", "Target players with clear paths to targets", "Consider dynasty/keeper value"]
            },
            12: {
                focus: "Final Skill Positions",
                reasoning: "Last chance for meaningful RB/WR depth. After this, you're looking at DST, K, and deep sleepers.",
                tips: ["Target players you'd actually start", "Consider backup RBs to opponents' starters (trade leverage)", "Look for schedule advantages"]
            },
            13: {
                focus: "Kicker or Deep Sleeper",
                reasoning: "Many wait until the last two picks for K/DST, but taking a reliable kicker here allows one more lottery ticket in the final rounds.",
                tips: ["Target kickers in high-scoring offenses", "Consider kickers with dome/warm weather advantages", "Or take one more upside player"]
            },
            14: {
                focus: "Defense or Final Lottery",
                reasoning: "DST is largely matchup-dependent, but some units offer safer floors. Otherwise, take your last shot at a breakout player.",
                tips: ["Target defenses with good early-season schedules", "Consider units with strong pass rush", "Or go for maximum upside player"]
            },
            15: {
                focus: "Complete Your Roster",
                reasoning: "Fill your final need (K/DST) or take the highest upside player available. This pick rarely makes or breaks your season.",
                tips: ["Don't overthink this pick", "Consider a handcuff you missed", "Trust your instincts on sleepers"]
            }
        };

        // Adjust for PPR
        if (scoringFormat.includes('PPR')) {
            // Add PPR-specific insights
            ['1', '2', '3'].forEach(r => {
                if (strategies[r]) {
                    strategies[r].pprNote = "PPR Format: Receiving-heavy players gain extra value due to point-per-reception scoring.";
                }
            });
        }

        return strategies[round] || {
            focus: "Best Player Available",
            reasoning: "Take the most talented player remaining who fills a roster need.",
            tips: ["Trust your rankings", "Consider your league's tendencies"]
        };
    }

    formatPlayerInfo(player) {
        // Enhanced player information display for export functionality
        let info = `${player.name} - ${player.position} (${player.team})`;
        
        // Add ADP if available
        if (player.adp) {
            info += ` - ADP: ${player.adp}`;
        }
        
        // Add tier information if available
        if (player.tier) {
            info += ` - ${player.tier} Tier`;
        }
        
        // Enhanced rookie detection and college info
        const isRookie = player.years_exp === 0 || 
                         player.years_exp === null || 
                         player.rookie === true || 
                         player.isRookie === true ||
                         player.experience === 0 ||
                         player.experience === null;
        if (isRookie) {
            info += ` - 🌟 ROOKIE`;
            // Add college for rookies
            if (player.college) {
                info += ` (${player.college})`;
            }
        }
        
        // Add risk level if available
        if (player.riskLevel) {
            const riskEmoji = {
                'Low': '🟢',
                'Medium': '🟡', 
                'High': '🔴'
            };
            info += ` - ${riskEmoji[player.riskLevel] || '⚪'} ${player.riskLevel} Risk`;
        }
        
        // Add age if available (useful for dynasty leagues) - but not for rookies since we already showed it
        if (player.age && player.age > 0 && !isRookie) {
            info += ` - Age: ${player.age}`;
        }
        
        // Add college for non-rookies if available (less common but useful for some players)
        if (!isRookie && player.college) {
            info += ` - ${player.college}`;
        }
        
        // Add injury status if available
        if (player.injury_status && player.injury_status !== 'Healthy') {
            info += ` - ⚠️ ${player.injury_status}`;
        }
        
        return info;
    }

    getInjuryRecommendation(player, round) {
        // Provide specific guidance for injured players
        if (!player.injury_status && !player.injuryStatus && !player.injuryDesignation) {
            return null; // No injury status
        }
        
        const injuryStatus = (player.injury_status || player.injuryStatus || player.injuryDesignation || '').toLowerCase();
        
        const recommendations = {
            'questionable': {
                early: `⚠️ RISKY in Round ${round}: Questionable players can be valuable if they fall, but have a backup plan ready`,
                late: `💡 GREAT VALUE: Questionable designation often causes artificial ADP drop - monitor injury reports`,
                general: `🎯 Draft Strategy: Move to backup list or draft one round later than planned`
            },
            'doubtful': {
                early: `🚫 AVOID in Round ${round}: Doubtful players are unlikely to play - too risky for early rounds`,
                late: `⚠️ LOTTERY TICKET: Only if you have roster depth and can afford the risk`,
                general: `📋 Alternative needed: Have 2-3 healthy players ready at this position`
            },
            'out': {
                early: `🛑 DO NOT DRAFT: Player ruled out for this week`,
                late: `🛑 DO NOT DRAFT: Player ruled out for this week`,
                general: `⏭️ Skip completely: Look for healthy alternatives with similar profiles`
            }
        };
        
        const roundType = round <= 6 ? 'early' : 'late';
        const rec = recommendations[injuryStatus];
        
        if (rec) {
            return {
                specific: rec[roundType],
                general: rec.general,
                severity: injuryStatus
            };
        }
        
        return null;
    }

    getPlayerInsight(player, round) {
        // Generate educational insights for specific players
        const insights = [];
        
        // Add injury-specific insights first
        const injuryRec = this.getInjuryRecommendation(player, round);
        if (injuryRec) {
            insights.push(injuryRec.specific);
            if (round <= 8) { // Show general advice for earlier rounds
                insights.push(injuryRec.general);
            }
        }
        
        // ADP-based insights
        if (player.adp && round) {
            const expectedPick = Math.floor(this.picks.length / (this.draftData?.settings?.teams || 12)) + 1;
            const adpRound = Math.ceil(player.adp / (this.draftData?.settings?.teams || 12));
            
            if (adpRound < round) {
                insights.push(`📈 EARLY: Usually goes in Round ${adpRound} (ADP ${player.adp})`);
            } else if (adpRound > round) {
                insights.push(`📉 VALUE: Typically drafted in Round ${adpRound} (ADP ${player.adp})`);
            }
        }
        
        // Position-specific insights
        const positionInsights = {
            'QB': [
                "🎯 Target QBs whose teams throw a lot (400+ pass attempts per season)",
                "⚡ Running QBs offer higher floors due to rushing yards (safer weekly scores)",
                "📊 QB scoring is more predictable than other positions"
            ],
            'RB': [
                "🏃 Workhorse RBs who get most carries/catches (300+ total opportunities) are gold",
                "🎯 Target RBs behind good offensive lines and in high-scoring systems",
                "⚠️ RBs get injured most - backup RBs (injury insurance) matter"
            ],
            'WR': [
                "📡 How many passes are thrown to a player matters more than raw talent",
                "🎯 Slot receivers (who catch short passes) benefit most in PPR formats",
                "⚡ Players who get passes near the goal line score more touchdowns"
            ],
            'TE': [
                "📈 Elite TEs offer positional advantage over picking up random TEs weekly",
                "🎯 Target TEs who get 80+ passes thrown their way per season",
                "⚠️ TE is the most unpredictable position weekly (boom or bust)"
            ],
            'K': [
                "🏟️ Indoor stadium kickers and warm-weather teams preferred (no weather issues)",
                "📊 High-scoring offenses create more field goal opportunities",
                "⚡ Leg strength matters for long field goals (50+ yards)"
            ],
            'DEF': [
                "📅 Early season schedule is most important (who they play first 4 weeks)",
                "🛡️ Pass rush creates sacks and turnovers (more fantasy points)",
                "🏠 Home field advantage matters for defenses (crowd noise helps)"
            ]
        };
        
        const posInsights = positionInsights[player.position] || [];
        if (posInsights.length > 0) {
            insights.push(posInsights[Math.floor(Math.random() * posInsights.length)]);
        }
        
        // PPR-specific insights
        const pprInsight = this.getPPRSpecificInsight(player);
        if (pprInsight) {
            insights.push(pprInsight);
        }
        
        // Risk level insights
        if (player.riskLevel === 'High') {
            insights.push("⚠️ HIGH RISK: Consider injury history and situation changes");
        } else if (player.riskLevel === 'Low') {
            insights.push("✅ SAFE PICK: Consistent performer with proven track record");
        }
        
        return insights;
    }

    getPPRSpecificInsight(player) {
        // Generate PPR-specific insights based on scoring format
        const scoringFormat = this.configManager.config.scoringFormat || 'Half PPR';
        
        if (scoringFormat === 'Standard') {
            return null; // No PPR insights for standard scoring
        }
        
        const position = player.position;
        const pprType = scoringFormat === 'PPR' ? 'Full PPR' : 'Half PPR';
        
        const insights = {
            'WR': [
                `📈 ${pprType} BOOST: WRs get significant value from receptions - target high-volume pass catchers`,
                `🎯 ${pprType} GOLD: Slot receivers and possession players gain extra fantasy points per catch`,
                `📊 ${pprType} EDGE: WRs in pass-heavy offenses become more valuable than in standard scoring`
            ],
            'RB': [
                `📈 ${pprType} BOOST: Pass-catching RBs gain significant value - look for receiving work`,
                `🎯 ${pprType} PREMIUM: Third-down backs and pass-catching specialists move up draft boards`,
                `📊 ${pprType} STRATEGY: RBs who catch 40+ passes per year are league winners`
            ],
            'TE': [
                `📈 ${pprType} BOOST: All TEs benefit from reception points - moderate value increase`,
                `🎯 ${pprType} SAFETY: High-target TEs provide more consistent weekly floors`,
                `📊 ${pprType} VALUE: Target-heavy TEs become more reliable than TD-dependent options`
            ]
        };
        
        const positionInsights = insights[position];
        if (positionInsights && positionInsights.length > 0) {
            return positionInsights[Math.floor(Math.random() * positionInsights.length)];
        }
        
        return null;
    }

    savePlan() {
        const planData = {
            draftPlan: this.draftPlan,
            planBackups: this.planBackups,
            created: new Date().toISOString(),
            leagueId: this.configManager.config.sleeperLeagueId
        };
        
        const blob = new Blob([JSON.stringify(planData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `draft-plan-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        
        this.configManager.showNotification('💾 Draft plan saved!', 'success');
    }

    loadPlan() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const planData = JSON.parse(e.target.result);
                        this.draftPlan = planData.draftPlan || {};
                        this.planBackups = planData.planBackups || {};
                        this.displayDraftPlan();
                        this.configManager.showNotification('📂 Draft plan loaded!', 'success');
                    } catch (error) {
                        this.configManager.showNotification('❌ Error loading plan file', 'error');
                    }
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }

    clearPlan() {
        if (confirm('Clear all draft plan data?')) {
            this.draftPlan = {};
            this.planBackups = {};
            this.displayDraftPlan();
            localStorage.removeItem('draftPlan');
            this.configManager.showNotification('🗑️ Draft plan cleared', 'info');
        }
    }

    savePlanToStorage() {
        localStorage.setItem('draftPlan', JSON.stringify({
            draftPlan: this.draftPlan,
            planBackups: this.planBackups
        }));
    }

    loadPlanFromStorage() {
        const saved = localStorage.getItem('draftPlan');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.draftPlan = data.draftPlan || {};
                this.planBackups = data.planBackups || {};
            } catch (error) {
                console.error('Error loading saved plan:', error);
            }
        }
    }

    // Helper to get current round recommendations from plan
    getCurrentRoundPlan() {
        const currentRound = Math.floor(this.picks.length / (this.draftData?.settings?.teams || 12)) + 1;
        return {
            targets: this.draftPlan[currentRound] || [],
            backups: this.planBackups[currentRound] || []
        };
    }

    // ======================
    // USER-FRIENDLY EXPORTS
    // ======================

    toggleExportMenu() {
        const menu = document.getElementById('exportMenu');
        if (menu) {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        }
    }

    exportAsText() {
        const content = this.generateTextPlan();
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `draft-plan-${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        
        this.configManager.showNotification('📄 Text plan exported!', 'success');
        this.toggleExportMenu();
    }

    generateTextPlan() {
        const teamCount = this.draftData?.settings?.teams || 12;
        const draftPosition = this.configManager.config.draftPosition || 1;
        const leagueName = this.configManager.config.leagueName || 'My League';
        
        let content = `🏈 FANTASY DRAFT PLAN\n`;
        content += `======================\n\n`;
        content += `League: ${leagueName}\n`;
        content += `Draft Position: ${draftPosition} of ${teamCount}\n`;
        content += `Format: ${this.configManager.config.scoringFormat || 'Half PPR'}\n`;
        content += `Generated: ${new Date().toLocaleDateString()}\n\n`;
        
        // Add scoring format warning
        content += `🚨 IMPORTANT: VERIFY YOUR SCORING FORMAT!\n`;
        content += `${'='.repeat(40)}\n`;
        content += `Current Setting: ${this.configManager.config.scoringFormat || 'Half PPR'}\n`;
        content += `⚠️  All player rankings and recommendations are calculated\n`;
        content += `    based on your scoring format. Wrong format = Wrong picks!\n`;
        content += `📝 Common formats: Standard, Half PPR, Full PPR\n`;
        content += `⚙️  Update in Configuration if incorrect.\n\n`;
        
        // Add explanatory context for all player information
        content += this.generatePlayerInfoGlossary();
        
        // Add detailed PPR mechanics explanation
        content += this.generatePPRMechanicsExplanation();
        
        // Add position strategy overview
        content += this.generatePositionStrategyOverview();
        
        for (let round = 1; round <= 15; round++) {
            const pickInRound = round % 2 === 1 ? draftPosition : teamCount - draftPosition + 1;
            const overallPick = (round - 1) * teamCount + pickInRound;
            const targets = this.draftPlan[round] || [];
            const backups = this.planBackups[round] || [];
            const strategy = this.getRoundStrategy(round, this.configManager.config.scoringFormat);
            
            content += `ROUND ${round} (Pick ${overallPick}):\n`;
            content += `${'-'.repeat(25)}\n`;
            
            // Add round strategy
            content += `🎯 STRATEGY: ${strategy.focus}\n`;
            content += `💡 WHY: ${strategy.reasoning}\n`;
            if (strategy.pprNote) {
                content += `📊 ${strategy.pprNote}\n`;
            }
            content += `\n`;
            
            if (targets.length > 0) {
                content += `PRIMARY TARGETS:\n`;
                targets.forEach((player, idx) => {
                    const status = this.isPlayerDrafted(player.id) ? ' [DRAFTED]' : '';
                    const insights = this.getPlayerInsight(player, round);
                    content += `  ${idx + 1}. ${this.formatPlayerInfo(player)}${status}\n`;
                    insights.forEach(insight => {
                        content += `     ${insight}\n`;
                    });
                });
                content += `\n`;
            }
            
            if (backups.length > 0) {
                content += `BACKUP OPTIONS:\n`;
                backups.forEach((player, idx) => {
                    const status = this.isPlayerDrafted(player.id) ? ' [DRAFTED]' : '';
                    const insights = this.getPlayerInsight(player, round);
                    content += `  B${idx + 1}. ${this.formatPlayerInfo(player)}${status}\n`;
                    if (insights.length > 0) {
                        content += `     ${insights[0]}\n`; // Just one insight for backups to keep it clean
                    }
                });
                content += `\n`;
            }
            
            // Add strategy tips
            if (strategy.tips && strategy.tips.length > 0) {
                content += `📝 TIPS:\n`;
                strategy.tips.forEach(tip => {
                    content += `  • ${tip}\n`;
                });
                content += `\n`;
            }
            
            if (targets.length === 0 && backups.length === 0) {
                content += `  No targets set for this round\n`;
                content += `📝 STRATEGY TIPS:\n`;
                strategy.tips.forEach(tip => {
                    content += `  • ${tip}\n`;
                });
                content += `\n`;
            }
        }
        
        content += `\n📋 DRAFT STRATEGY NOTES:\n`;
        content += `========================\n`;
        content += `• This plan is based on ADP and position scarcity\n`;
        content += `• Adjust based on how the draft unfolds\n`;
        content += `• Don't be afraid to take value when it falls\n`;
        content += `• Consider your league's tendencies\n`;
        content += `• Remember: Plan is a guide, not gospel!\n\n`;
        content += `Generated by Fantasy Football Command Center\n`;
        
        return content;
    }

    exportAsPrintable() {
        const content = this.generatePrintableHTML();
        const printWindow = window.open('', '_blank');
        printWindow.document.write(content);
        printWindow.document.close();
        printWindow.focus();
        
        // Auto-print after a brief delay
        setTimeout(() => {
            printWindow.print();
        }, 500);
        
        this.configManager.showNotification('🖨️ Opening printable version...', 'success');
        this.toggleExportMenu();
    }

    generatePrintableHTML() {
        const teamCount = this.draftData?.settings?.teams || 12;
        const draftPosition = this.configManager.config.draftPosition || 1;
        const leagueName = this.configManager.config.leagueName || 'My League';
        
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Draft Plan - ${leagueName}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; color: #333; line-height: 1.4; }
                .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 15px; }
                .round { margin-bottom: 30px; break-inside: avoid; }
                .round-header { background: #f0f0f0; padding: 8px 12px; font-weight: bold; border-left: 4px solid #4ecdc4; }
                .strategy { background: #f8f9fa; padding: 10px; margin: 10px 0; border-radius: 5px; border-left: 3px solid #007bff; }
                .strategy-focus { font-weight: bold; color: #007bff; margin-bottom: 5px; }
                .strategy-reasoning { font-style: italic; margin-bottom: 5px; }
                .strategy-tips { margin-top: 8px; }
                .strategy-tips ul { margin: 5px 0; padding-left: 20px; }
                .targets, .backups { margin: 10px 0; }
                .targets h4, .backups h4 { margin: 5px 0; color: #666; font-size: 14px; }
                .player-list { margin-left: 15px; }
                .player { margin: 5px 0; font-size: 13px; }
                .player-insights { margin-left: 20px; font-size: 11px; color: #666; font-style: italic; }
                .drafted { text-decoration: line-through; color: #999; }
                .notes { margin-top: 30px; padding: 15px; background: #f9f9f9; border-radius: 5px; }
                @media print { body { margin: 0; } .round { page-break-inside: avoid; } }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🏈 ${leagueName} - Draft Plan</h1>
                <p>Position: ${draftPosition} of ${teamCount} | Format: ${this.configManager.config.scoringFormat || 'Half PPR'} | ${new Date().toLocaleDateString()}</p>
            </div>
            
            <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 15px; margin: 15px 0;">
                <h3 style="color: #856404; margin-top: 0;">🚨 VERIFY YOUR SCORING FORMAT!</h3>
                <p style="margin-bottom: 5px;"><strong>Current Setting:</strong> ${this.configManager.config.scoringFormat || 'Half PPR'}</p>
                <p style="margin-bottom: 5px;">⚠️ All player rankings adjust based on your scoring format.</p>
                <p style="margin-bottom: 0;"><strong>Wrong format = Wrong draft picks!</strong> Update in Configuration if needed.</p>
            </div>
            
            <div class="notes">
                <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${this.generatePlayerInfoGlossary()}</pre>
            </div>
            
            <div class="notes">
                <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${this.generatePPRMechanicsExplanation()}</pre>
            </div>
            
            <div class="notes">
                <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${this.generatePositionStrategyOverview()}</pre>
            </div>
        `;
        
        for (let round = 1; round <= 15; round++) {
            const pickInRound = round % 2 === 1 ? draftPosition : teamCount - draftPosition + 1;
            const overallPick = (round - 1) * teamCount + pickInRound;
            const targets = this.draftPlan[round] || [];
            const backups = this.planBackups[round] || [];
            const strategy = this.getRoundStrategy(round, this.configManager.config.scoringFormat);
            
            html += `
                <div class="round">
                    <div class="round-header">Round ${round} - Pick ${overallPick}</div>
                    
                    <div class="strategy">
                        <div class="strategy-focus">🎯 STRATEGY: ${strategy.focus}</div>
                        <div class="strategy-reasoning">💡 WHY: ${strategy.reasoning}</div>
                        ${strategy.pprNote ? `<div style="color: #007bff;">📊 ${strategy.pprNote}</div>` : ''}
                        ${strategy.tips && strategy.tips.length > 0 ? `
                            <div class="strategy-tips">
                                <strong>📝 TIPS:</strong>
                                <ul>
                                    ${strategy.tips.map(tip => `<li>${tip}</li>`).join('')}
                                </ul>
                            </div>
                        ` : ''}
                    </div>
            `;
            
            if (targets.length > 0) {
                html += `<div class="targets"><h4>PRIMARY TARGETS:</h4><div class="player-list">`;
                targets.forEach((player, idx) => {
                    const draftedClass = this.isPlayerDrafted(player.id) ? 'drafted' : '';
                    const insights = this.getPlayerInsight(player, round);
                    html += `<div class="player ${draftedClass}">${idx + 1}. ${this.formatPlayerInfo(player)}`;
                    if (insights.length > 0) {
                        html += `<div class="player-insights">${insights.join(' • ')}</div>`;
                    }
                    html += `</div>`;
                });
                html += `</div></div>`;
            }
            
            if (backups.length > 0) {
                html += `<div class="backups"><h4>BACKUP OPTIONS:</h4><div class="player-list">`;
                backups.forEach((player, idx) => {
                    const draftedClass = this.isPlayerDrafted(player.id) ? 'drafted' : '';
                    const insights = this.getPlayerInsight(player, round);
                    html += `<div class="player ${draftedClass}">B${idx + 1}. ${this.formatPlayerInfo(player)}`;
                    if (insights.length > 0) {
                        html += `<div class="player-insights">${insights[0]}</div>`; // Just one insight for backups
                    }
                    html += `</div>`;
                });
                html += `</div></div>`;
            }
            
            if (targets.length === 0 && backups.length === 0) {
                html += `<div style="color: #666; font-style: italic; margin-left: 15px;">No targets set for this round</div>`;
            }
            
            html += `</div>`;
        }
        
        html += `
            <div class="notes">
                <h3>📋 Draft Strategy Notes:</h3>
                <ul>
                    <li>This plan includes educational insights explaining WHY each position/player is valuable</li>
                    <li>Strategies are tailored to your scoring format and draft position</li>
                    <li>Adjust based on how the draft unfolds - plan is a guide, not gospel!</li>
                    <li>Consider your league's tendencies and take value when it falls</li>
                    <li>Use insights to understand the reasoning behind each recommendation</li>
                </ul>
                <p><em>Generated by Fantasy Football Command Center - Your Educational Fantasy Assistant</em></p>
            </div>
        </body>
        </html>
        `;
        
        return html;
    }

    async exportAsImage() {
        try {
            // Create a canvas-based image export with educational insights
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Set larger canvas size to accommodate educational content
            canvas.width = 900;
            canvas.height = 1600;
            
            // White background
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Header
            ctx.fillStyle = '#333333';
            ctx.font = 'bold 24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('🏈 Draft Plan with Educational Insights', canvas.width / 2, 40);
            
            ctx.font = '16px Arial';
            const leagueName = this.configManager.config.leagueName || 'My League';
            const draftPosition = this.configManager.config.draftPosition || 1;
            const teamCount = this.draftData?.settings?.teams || 12;
            ctx.fillText(`${leagueName} | Position ${draftPosition}/${teamCount}`, canvas.width / 2, 70);
            
            // Draw plan content with educational insights
            let yPosition = 110;
            ctx.textAlign = 'left';
            
            for (let round = 1; round <= 6; round++) { // First 6 rounds to fit with insights
                const targets = this.draftPlan[round] || [];
                const pickInRound = round % 2 === 1 ? draftPosition : teamCount - draftPosition + 1;
                const overallPick = (round - 1) * teamCount + pickInRound;
                const strategy = this.getRoundStrategy(round, this.configManager.config.scoringFormat);
                
                // Round header
                ctx.fillStyle = '#4ecdc4';
                ctx.fillRect(20, yPosition - 20, canvas.width - 40, 25);
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 14px Arial';
                ctx.fillText(`Round ${round} - Pick ${overallPick}`, 30, yPosition - 5);
                
                yPosition += 25;
                
                // Strategy insight
                ctx.fillStyle = '#007bff';
                ctx.font = 'bold 12px Arial';
                ctx.fillText(`🎯 STRATEGY: ${strategy.focus}`, 30, yPosition);
                yPosition += 20;
                
                // Strategy reasoning (wrapped text)
                ctx.fillStyle = '#666666';
                ctx.font = '11px Arial';
                const reasoningWords = strategy.reasoning.split(' ');
                let line = '';
                const maxWidth = canvas.width - 60;
                
                for (let i = 0; i < reasoningWords.length; i++) {
                    const testLine = line + reasoningWords[i] + ' ';
                    const metrics = ctx.measureText(testLine);
                    if (metrics.width > maxWidth && i > 0) {
                        ctx.fillText(`💡 ${line}`, 30, yPosition);
                        line = reasoningWords[i] + ' ';
                        yPosition += 15;
                    } else {
                        line = testLine;
                    }
                }
                ctx.fillText(`💡 ${line}`, 30, yPosition);
                yPosition += 20;
                
                // Targets with insights
                ctx.fillStyle = '#333333';
                ctx.font = '12px Arial';
                if (targets.length > 0) {
                    ctx.fillText('PRIMARY TARGETS:', 30, yPosition);
                    yPosition += 18;
                    
                    targets.slice(0, 2).forEach((player, idx) => {
                        const status = this.isPlayerDrafted(player.id) ? ' [DRAFTED]' : '';
                        ctx.fillText(`${idx + 1}. ${this.formatPlayerInfo(player)}${status}`, 40, yPosition);
                        yPosition += 15;
                        
                        // Add one insight per player
                        const insights = this.getPlayerInsight(player, round);
                        if (insights.length > 0) {
                            ctx.fillStyle = '#666666';
                            ctx.font = '10px Arial';
                            ctx.fillText(`   ${insights[0]}`, 40, yPosition);
                            ctx.fillStyle = '#333333';
                            ctx.font = '12px Arial';
                            yPosition += 15;
                        }
                    });
                } else {
                    ctx.fillStyle = '#999999';
                    ctx.fillText('No targets set for this round', 30, yPosition);
                    yPosition += 18;
                    
                    // Show strategy tips when no targets
                    if (strategy.tips && strategy.tips.length > 0) {
                        ctx.fillStyle = '#666666';
                        ctx.font = '10px Arial';
                        strategy.tips.slice(0, 2).forEach(tip => {
                            ctx.fillText(`• ${tip}`, 30, yPosition);
                            yPosition += 12;
                        });
                    }
                }
                
                yPosition += 25;
            }
            
            // Add footer with educational note
            ctx.fillStyle = '#007bff';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Generated by Fantasy Football Command Center', canvas.width / 2, yPosition + 20);
            ctx.font = '11px Arial';
            ctx.fillText('Educational insights included to help you understand the WHY behind each pick', canvas.width / 2, yPosition + 40);
            
            // Convert to blob and download
            canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `draft-plan-with-insights-${new Date().toISOString().split('T')[0]}.png`;
                a.click();
                
                this.configManager.showNotification('📷 Educational draft plan image exported!', 'success');
            });
            
        } catch (error) {
            console.error('Error creating image:', error);
            this.configManager.showNotification('❌ Error creating image. Try text export instead.', 'error');
        }
        
        this.toggleExportMenu();
    }

    async copyToClipboard() {
        try {
            const content = this.generateClipboardText();
            await navigator.clipboard.writeText(content);
            this.configManager.showNotification('📋 Plan copied to clipboard!', 'success');
        } catch (error) {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = this.generateClipboardText();
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            this.configManager.showNotification('📋 Plan copied to clipboard!', 'success');
        }
        
        this.toggleExportMenu();
    }

    generateClipboardText() {
        const teamCount = this.draftData?.settings?.teams || 12;
        const draftPosition = this.configManager.config.draftPosition || 1;
        
        let content = `🏈 DRAFT PLAN - ${this.configManager.config.leagueName || 'My League'}\n`;
        content += `Position ${draftPosition}/${teamCount} | ${new Date().toLocaleDateString()}\n\n`;
        
        for (let round = 1; round <= 10; round++) { // First 10 rounds for sharing
            const pickInRound = round % 2 === 1 ? draftPosition : teamCount - draftPosition + 1;
            const overallPick = (round - 1) * teamCount + pickInRound;
            const targets = this.draftPlan[round] || [];
            
            content += `R${round} (${overallPick}): `;
            
            if (targets.length > 0) {
                const targetNames = targets.slice(0, 2).map(p => {
                    const status = this.isPlayerDrafted(p.id) ? ' ❌' : '';
                    return `${p.name}${status}`;
                });
                content += targetNames.join(', ');
            } else {
                content += 'TBD';
            }
            
            content += `\n`;
        }
        
        content += `\n📱 Created with Fantasy Football Command Center`;
        
        return content;
    }

    generatePlayerInfoGlossary() {
        let glossary = `📖 PLAYER INFORMATION GUIDE\n`;
        glossary += `${'='.repeat(32)}\n\n`;
        
        glossary += `🏷️ PLAYER DATA EXPLAINED:\n\n`;
        
        glossary += `📊 ADP (Average Draft Position):\n`;
        glossary += `   • Where this player is typically drafted across all fantasy leagues\n`;
        glossary += `   • Lower ADP = Earlier pick (ADP 12 = picked around 12th overall)\n`;
        glossary += `   • Use to identify "value picks" when available later than ADP\n\n`;
        
        glossary += `🏆 PLAYER TIERS:\n`;
        glossary += `   • Elite: Championship-level performers, top 5-10 at position\n`;
        glossary += `   • High: Consistent weekly starters, top 15-20 at position\n`;
        glossary += `   • Medium: Solid contributors, potentially good value picks\n\n`;
        
        glossary += `🌟 ROOKIE STATUS:\n`;
        glossary += `   • First-year NFL players (college listed in parentheses)\n`;
        glossary += `   • Higher risk due to NFL adjustment period\n`;
        glossary += `   • Often offer best long-term upside for dynasty leagues\n\n`;
        
        glossary += `⚠️ RISK LEVELS:\n`;
        glossary += `   • 🟢 Low Risk: Reliable, consistent performers\n`;
        glossary += `   • 🟡 Medium Risk: Some injury/performance concerns\n`;
        glossary += `   • 🔴 High Risk: Injury prone, inconsistent, or unproven\n\n`;
        
        glossary += `🏥 INJURY STATUS GUIDE:\n`;
        glossary += `   • ⚠️ QUESTIONABLE: 50/50 chance to play - often clears by game time\n`;
        glossary += `   • 🚫 DOUBTFUL: Unlikely to play - avoid in early rounds\n`;
        glossary += `   • 🛑 OUT: Will not play this week\n`;
        glossary += `   • 📋 IR/PUP: Long-term injured reserve - avoid completely\n`;
        glossary += `   • 💡 STRATEGY: Questionable players often fall in ADP = value!\n`;
        glossary += `   • 🎯 TIP: Have backup plans ready if questionable players can't go\n\n`;
        
        glossary += `🎂 AGE & COLLEGE:\n`;
        glossary += `   • Age helps assess career stage and dynasty value\n`;
        glossary += `   • College info provides context for rookie evaluations\n\n`;
        
        glossary += `⚙️ CRITICAL: SCORING FORMAT MATTERS!\n`;
        glossary += `   • 🚨 ALL player values adjust based on your league's scoring\n`;
        glossary += `   • 📊 PPR vs Standard changes ADP by 2-8 spots per player\n`;
        glossary += `   • 🎯 WRs/Pass-catching RBs gain value in PPR formats\n`;
        glossary += `   • ⚠️ VERIFY your scoring format in configuration!\n`;
        glossary += `   • 💡 Wrong scoring = Wrong draft recommendations\n\n`;
        
        return glossary;
    }

    generatePPRMechanicsExplanation() {
        const scoringFormat = this.configManager.config.scoringFormat || 'Half PPR';
        
        let explanation = `🔥 PPR SCORING ADJUSTMENTS EXPLAINED\n`;
        explanation += `${'='.repeat(38)}\n\n`;
        
        explanation += `📊 YOUR LEAGUE FORMAT: ${scoringFormat}\n\n`;
        
        explanation += `🎯 HOW PLAYER VALUES CHANGE:\n\n`;
        
        explanation += `1. 📊 PPR-ADJUSTED PLAYER RANKINGS\n`;
        explanation += `${'-'.repeat(32)}\n`;
        explanation += `• WRs move up 2-8 ADP spots in PPR formats (more receptions = higher value)\n`;
        explanation += `• Pass-catching RBs move up 2-6 spots (CMC, Kamara type players get boost)\n`;
        explanation += `• TEs get 1-3 spot boost (moderate PPR benefit)\n`;
        explanation += `• QBs, K, DEF unchanged (no receptions)\n\n`;
        
        explanation += `2. 🎯 PPR-SPECIFIC PLAYER INSIGHTS\n`;
        explanation += `${'-'.repeat(30)}\n`;
        explanation += `Players now get custom insights based on your ${scoringFormat} format:\n\n`;
        
        explanation += `📡 WR Examples:\n`;
        explanation += `• "📈 ${scoringFormat} BOOST: WRs get significant value from receptions"\n`;
        explanation += `• "🎯 ${scoringFormat} GOLD: Slot receivers gain extra fantasy points per catch"\n\n`;
        
        explanation += `🏃 RB Examples:\n`;
        explanation += `• "📈 ${scoringFormat} BOOST: Pass-catching RBs gain significant value"\n`;
        explanation += `• "🎯 ${scoringFormat} PREMIUM: Third-down backs move up draft boards"\n\n`;
        
        explanation += `🎪 TE Examples:\n`;
        explanation += `• "📈 ${scoringFormat} BOOST: All TEs benefit from reception points"\n`;
        explanation += `• "🎯 ${scoringFormat} SAFETY: High-target TEs provide consistent floors"\n\n`;
        
        explanation += `3. 📈 ADJUSTED PLAYER TIERS\n`;
        explanation += `${'-'.repeat(25)}\n`;
        explanation += `• Reception-heavy players move up tiers (High → Elite)\n`;
        explanation += `• Pure runners stay in their tier (no receiving boost)\n`;
        explanation += `• Better reflects true ${scoringFormat} value\n\n`;
        
        explanation += `4. 🎛️ DYNAMIC SCORING ADJUSTMENTS\n`;
        explanation += `${'-'.repeat(30)}\n`;
        explanation += `• Half PPR: 50% of full PPR impact on rankings\n`;
        explanation += `• Full PPR: 100% impact on rankings\n`;
        explanation += `• Standard: No adjustments (pure rushing/receiving yards)\n\n`;
        
        explanation += `🔍 REAL EXAMPLES FOR ${scoringFormat}:\n`;
        explanation += `${'-'.repeat(30)}\n`;
        
        if (scoringFormat.includes('PPR')) {
            const boost = scoringFormat === 'PPR' ? 'full' : 'half';
            explanation += `• Davante Adams (high-target WR): Moves up ~${boost === 'full' ? '6' : '3'} ADP spots\n`;
            explanation += `• Christian McCaffrey (pass-catching RB): Moves up ~${boost === 'full' ? '4' : '2'} ADP spots\n`;
            explanation += `• Travis Kelce (target-heavy TE): Moves up ~${boost === 'full' ? '3' : '2'} ADP spots\n`;
            explanation += `• Derrick Henry (pure runner): Stays same ADP (no receiving boost)\n`;
            explanation += `• Cooper Kupp (slot receiver): Gets major ${scoringFormat} boost\n`;
            explanation += `• Austin Ekeler (3rd-down back): Significant ${scoringFormat} value increase\n\n`;
        } else {
            explanation += `• All players maintain standard ADP rankings\n`;
            explanation += `• No reception bonuses applied to player values\n`;
            explanation += `• Pure rushing/receiving yardage focus\n\n`;
        }
        
        explanation += `⚡ REAL IMPACT:\n`;
        explanation += `${'-'.repeat(13)}\n`;
        explanation += `Reception-heavy players now get properly boosted in rankings, tiers,\n`;
        explanation += `and draft recommendations - making the system much more accurate for\n`;
        explanation += `your ${scoringFormat} scoring format!\n\n`;
        
        explanation += `🎯 The draft plan now truly accounts for PPR at every level:\n`;
        explanation += `• Individual player values ✓\n`;
        explanation += `• Tier calculations ✓\n`;
        explanation += `• Specific player insights ✓\n`;
        explanation += `• Draft recommendations ✓\n\n`;
        
        return explanation;
    }

    generatePositionStrategyOverview() {
        const scoringFormat = this.configManager.config.scoringFormat || 'Half PPR';
        
        let overview = `📋 POSITION DRAFT STRATEGY OVERVIEW\n`;
        overview += `${'='.repeat(40)}\n\n`;
        
        overview += `🎯 OPTIMAL DRAFT ORDER & REASONING:\n\n`;
        
        // Early Rounds (1-3)
        overview += `EARLY ROUNDS (1-3): Elite Skill Positions\n`;
        overview += `${'-'.repeat(35)}\n`;
        overview += `🏆 PRIORITY: RB1, WR1, RB2/WR2\n`;
        overview += `💡 WHY: Secure elite talent at scarce positions. The drop-off between\n`;
        overview += `   elite and mid-tier RBs/WRs is dramatic. Lock in your foundation.\n`;
        if (scoringFormat === 'PPR') {
            overview += `📊 PPR NOTE: WRs get slight boost due to reception points.\n`;
        } else if (scoringFormat === 'Standard') {
            overview += `📊 STANDARD NOTE: RBs more valuable without reception points.\n`;
        }
        overview += `\n`;
        
        // Mid Rounds (4-7)
        overview += `MID ROUNDS (4-7): Flex Depth & QB\n`;
        overview += `${'-'.repeat(30)}\n`;
        overview += `🎯 PRIORITY: RB3, WR3, QB1, TE1\n`;
        overview += `💡 WHY: Build depth at flex positions. Target your QB1 if elite\n`;
        overview += `   options remain. Consider top-tier TEs if available.\n`;
        overview += `📈 VALUE: Look for players falling past ADP - injury concerns\n`;
        overview += `   or team changes can create opportunities.\n`;
        overview += `\n`;
        
        // Late Rounds (8-12)
        overview += `LATE ROUNDS (8-12): Fill Roster & Upside\n`;
        overview += `${'-'.repeat(33)}\n`;
        overview += `🎯 PRIORITY: Bench depth, handcuffs, QB2 (if needed)\n`;
        overview += `💡 WHY: Complete your starting lineup and add players with\n`;
        overview += `   breakout potential. Target rookie RBs and WRs in good situations.\n`;
        overview += `🔄 HANDCUFFS: Consider backups to your RBs, especially if they\n`;
        overview += `   have injury history or heavy workloads.\n`;
        overview += `\n`;
        
        // Final Rounds (13-15)
        overview += `FINAL ROUNDS (13-15): Kicker, Defense & Lottery Tickets\n`;
        overview += `${'-'.repeat(48)}\n`;
        overview += `🎯 PRIORITY: K, DEF, high-upside flyers\n`;
        overview += `💡 WHY: Draft K/DEF late - they're unpredictable and replaceable.\n`;
        overview += `   Use remaining picks on players with breakout potential.\n`;
        overview += `🎲 UPSIDE PLAYS: Rookie WRs, handcuff RBs, players returning\n`;
        overview += `   from injury, or those in new offensive systems.\n`;
        overview += `\n`;
        
        // Position-Specific Notes
        overview += `📊 POSITION-SPECIFIC STRATEGY:\n`;
        overview += `${'-'.repeat(30)}\n`;
        overview += `🏃 RB: Target workhorse backs early. Avoid timeshares unless elite.\n`;
        overview += `   Look for goal-line carries and passing work.\n`;
        overview += `📡 WR: In PPR, target high-volume receivers. Look for red-zone targets\n`;
        overview += `   and players in pass-heavy offenses.\n`;
        overview += `🎯 QB: One elite QB or wait and stream. Avoid mid-round QBs.\n`;
        overview += `   Target dual-threat QBs for rushing upside.\n`;
        overview += `🎪 TE: Either draft elite early (Kelce, Andrews) or wait very late.\n`;
        overview += `   The middle tiers are unpredictable and frustrating.\n\n`;
        
        return overview;
    }

    // Test method to verify draft plan functionality
    testDraftPlanFunctionality() {
        console.log('🧪 Testing draft plan functionality...');
        
        // Test data
        const testPlayer = {
            id: 'test123',
            name: 'Test Player',
            position: 'RB',
            adp: 25,
            team: 'TST'
        };
        
        console.log('1️⃣ Testing addToPlan...');
        try {
            // Simulate adding to plan without modal
            const list = this.draftPlan;
            if (!list[1]) list[1] = [];
            list[1].push(testPlayer);
            
            console.log('2️⃣ Current draft plan:', this.draftPlan);
            console.log('3️⃣ Testing displayDraftPlan...');
            this.displayDraftPlan();
            
            console.log('4️⃣ Testing removeFromPlan...');
            setTimeout(() => {
                this.removeFromPlan(1, 'primary', 'test123');
                console.log('5️⃣ Plan after removal:', this.draftPlan);
            }, 2000);
            
        } catch (error) {
            console.error('❌ Test failed:', error);
        }
        
        console.log('✅ Test completed - check console and UI');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DraftTracker;
}