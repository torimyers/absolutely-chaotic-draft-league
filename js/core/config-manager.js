class ConfigManager {
    constructor() {
        this.config = this.getDefaultConfig();
        this.isFirstTime = !localStorage.getItem('fantasyAppConfig');
        this.loadConfiguration();
    }

    getDefaultConfig() {
        return {
            // League Information
            leagueName: "",
            teamName: "",
            leagueSize: 12,
            scoringFormat: "Half PPR",
            // How the lineup is built, which is independent of how points are
            // scored. Super Flex leagues start a second quarterback, which moves
            // QB replacement level - it says nothing about receptions.
            rosterFormat: "Standard",
            draftPosition: 6,
            
            // Season Stats
            teamRecord: "0-0",
            totalPoints: 0,
            leagueRanking: 1,
            playoffOdds: 50,
            
            // App Settings
            sleeperLeagueId: "",
            sleeperDraftId: null,
            learningMode: "beginner",
            themeColor: "teal",

            // Status flags
            isConfigured: false,
            draftCompleted: false,
            isMockDraft: false
        };
    }

    /**
     * Works out what the user actually pasted into the league field. Sleeper
     * league IDs and draft IDs look identical on their own, so the only reliable
     * signal is the URL they came from.
     *
     * Returns { kind: 'league' | 'draft' | 'empty' | 'invalid', id }.
     */
    parseSleeperInput(raw) {
        const value = String(raw == null ? '' : raw).trim();

        if (!value) return { kind: 'empty', id: null };

        // https://sleeper.com/draft/nfl/1234567890
        const draftUrl = value.match(/draft\/(?:nfl\/)?(\d+)/i);
        if (draftUrl) return { kind: 'draft', id: draftUrl[1] };

        // https://sleeper.com/leagues/1234567890/team
        const leagueUrl = value.match(/leagues?\/(\d+)/i);
        if (leagueUrl) return { kind: 'league', id: leagueUrl[1] };

        // A bare ID is ambiguous; the field is labelled League ID, so treat it as one.
        const bare = value.match(/^(\d{6,})$/);
        if (bare) return { kind: 'league', id: bare[1] };

        return { kind: 'invalid', id: null };
    }

    /**
     * Forces sleeperLeagueId / sleeperDraftId / isMockDraft into a consistent
     * state. Only one of the two IDs may be set at a time.
     *
     * These flags used to be written when a mock draft URL was pasted and then
     * never cleared, so entering a real league afterwards left isMockDraft true
     * and the tracker kept polling the old mock draft, ignoring the league
     * entirely. This is called on load and on save so stale state cannot survive.
     */
    /**
     * Super Flex used to be an option in the Scoring Format dropdown, which put a
     * roster rule in a points-per-reception setting. A profile saved that way has
     * no usable scoring format at all, so move it to rosterFormat and fall back to
     * the default scoring. Runs on load and on save, so an old profile repairs
     * itself the first time it is opened.
     */
    normalizeFormats(config) {
        const scoring = String(config.scoringFormat || '').trim();
        const validScoring = ['Standard', 'Half PPR', 'PPR'];

        if (/super\s*flex/i.test(scoring) || /^2\s*qb$/i.test(scoring)) {
            config.rosterFormat = /^2\s*qb$/i.test(scoring) ? '2QB' : 'Super Flex';
            // The old value carried no scoring information to preserve.
            config.scoringFormat = 'Half PPR';
        } else if (!validScoring.includes(scoring)) {
            config.scoringFormat = 'Half PPR';
        }

        const validRoster = ['Standard', 'Super Flex', '2QB'];
        if (!validRoster.includes(config.rosterFormat)) {
            config.rosterFormat = 'Standard';
        }

        return config;
    }

    /**
     * Reads the starting lineup Sleeper publishes for the league. SUPER_FLEX is
     * an explicit slot; two required QB slots is the 2QB variant. Both let a
     * second quarterback start, which is what changes QB scarcity.
     */
    static detectRosterFormat(rosterPositions) {
        if (!Array.isArray(rosterPositions)) return 'Standard';

        const slots = rosterPositions.map(slot => String(slot).toUpperCase());
        if (slots.includes('SUPER_FLEX')) return 'Super Flex';
        if (slots.filter(slot => slot === 'QB').length >= 2) return '2QB';
        return 'Standard';
    }

    /** True when the league starts more than one quarterback. */
    startsTwoQuarterbacks(config = this.config) {
        return config.rosterFormat === 'Super Flex' || config.rosterFormat === '2QB';
    }

    normalizeSleeperTarget(config) {
        const leagueId = config.sleeperLeagueId ? String(config.sleeperLeagueId).trim() : '';
        const draftId = config.sleeperDraftId ? String(config.sleeperDraftId).trim() : '';

        // Legacy configs stored the draft ID in BOTH fields; that means mock draft.
        if (draftId && leagueId === draftId) {
            config.sleeperLeagueId = '';
            config.sleeperDraftId = draftId;
            config.isMockDraft = true;
            return config;
        }

        // A real league ID is the user's current intent - drop any stale mock state.
        if (leagueId) {
            config.sleeperLeagueId = leagueId;
            config.sleeperDraftId = null;
            config.isMockDraft = false;
            return config;
        }

        config.sleeperLeagueId = '';
        config.sleeperDraftId = draftId || null;
        config.isMockDraft = Boolean(draftId);
        return config;
    }

    async loadConfiguration() {
        // Try to load from localStorage first
        const saved = localStorage.getItem('fantasyAppConfig');

        // Which settings the user has actually saved. Meta tags must not
        // overwrite these - see loadFromEnvironment.
        let savedKeys = [];

        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                savedKeys = Object.keys(parsed);
                this.config = { ...this.config, ...parsed };
            } catch (e) {
                console.warn('Could not load saved configuration, using defaults');
            }
        }

        // Load from environment variables (meta tags), without clobbering the
        // saved profile.
        this.loadFromEnvironment(savedKeys);

        // Run after the environment pass so meta-supplied values are validated
        // too. Repairs profiles saved before the mock-draft flags were cleared
        // properly, and profiles that stored Super Flex as a scoring format.
        this.normalizeSleeperTarget(this.config);
        this.normalizeFormats(this.config);

        // Apply configuration to the app
        this.applyConfiguration();
        
        // Show config panel for first-time users or incomplete setups
        if (this.isFirstTime || !this.config.isConfigured || (!this.config.leagueName && !this.config.teamName)) {
            // Wait for EventManager to be ready
            setTimeout(() => {
                if (window.eventManager) {
                    window.eventManager.showConfiguration();
                } else {
                    // Fallback: show config panel directly
                    const configPanel = document.getElementById('configPanel');
                    if (configPanel) {
                        configPanel.classList.remove('hidden');
                    }
                }
            }, 1000);
        } else {
            // Belt and braces: the panel is a full-screen modal, so if anything
            // ever leaves it open, a returning user would be forced to re-enter
            // a league that is already saved.
            const configPanel = document.getElementById('configPanel');
            if (configPanel) {
                configPanel.classList.add('hidden');
            }
        }
    }

    /**
     * Applies the `<meta name="FANTASY_*">` tags. These are deploy-time defaults
     * for self-hosters, so a value the user has already saved always wins: the
     * tags ship with non-empty defaults (league size 12, Half PPR, teal, ...) and
     * used to be re-applied on every load, silently resetting a saved profile's
     * league size, scoring format, record, ranking and theme on every refresh.
     *
     * @param {string[]} savedKeys Config keys restored from localStorage.
     */
    loadFromEnvironment(savedKeys = []) {
        const alreadySaved = new Set(savedKeys);
        const envVars = {
            FANTASY_LEAGUE_NAME: 'leagueName',
            FANTASY_TEAM_NAME: 'teamName',
            FANTASY_LEAGUE_SIZE: 'leagueSize',
            FANTASY_SCORING_FORMAT: 'scoringFormat',
            FANTASY_ROSTER_FORMAT: 'rosterFormat',
            FANTASY_TEAM_RECORD: 'teamRecord',
            FANTASY_TOTAL_POINTS: 'totalPoints',
            FANTASY_LEAGUE_RANKING: 'leagueRanking',
            FANTASY_PLAYOFF_ODDS: 'playoffOdds',
            SLEEPER_LEAGUE_ID: 'sleeperLeagueId',
            FANTASY_LEARNING_MODE: 'learningMode',
            FANTASY_THEME_COLOR: 'themeColor'
        };

        Object.keys(envVars).forEach(envVar => {
            const configKey = envVars[envVar];

            // The user's own saved value takes precedence over the deploy default.
            if (alreadySaved.has(configKey)) return;

            const metaTag = document.querySelector(`meta[name="${envVar}"]`);
            if (metaTag && metaTag.content && metaTag.content.trim() !== '') {
                const value = metaTag.content;
                
                // Convert numeric values
                if (['leagueSize', 'totalPoints', 'leagueRanking', 'playoffOdds'].includes(configKey)) {
                    this.config[configKey] = parseInt(value);
                } else {
                    this.config[configKey] = value;
                }
                
                // Mark as configured if we have meaningful environment data
                if (configKey === 'leagueName' || configKey === 'teamName') {
                    this.config.isConfigured = true;
                }
            }
        });
    }

    async loadFromSleeper() {
        console.log('🔍 ConfigManager.loadFromSleeper() called');
        
        // Get league ID from form first
        const leagueIdInput = document.getElementById('sleeperLeagueId');
        let leagueId = leagueIdInput ? leagueIdInput.value.trim() : this.config.sleeperLeagueId;
        
        const parsed = this.parseSleeperInput(leagueId);

        if (parsed.kind === 'empty') {
            this.showNotification('❌ Please enter a Sleeper League ID first', 'error');
            return false;
        }

        if (parsed.kind === 'invalid') {
            this.showNotification('❌ That does not look like a Sleeper League ID or draft link. Paste the ID, or the URL from your league or draft page.', 'error');
            return false;
        }

        if (parsed.kind === 'draft') {
            const draftId = parsed.id;
            console.log('📋 Extracted draft ID:', draftId);

            this.config.sleeperDraftId = draftId;
            this.config.sleeperLeagueId = '';
            this.config.isMockDraft = true;

            // The pasted draft URL is deliberately left in the field. Writing the
            // bare ID back made it indistinguishable from a league ID, so saving
            // reclassified it as one and the draft target was lost.
            this.updateFormFields({
                leagueName: 'Mock Draft',
                teamName: 'My Mock Team',
                leagueSize: 12,
                scoringFormat: 'Half PPR'
            });

            this.showNotification('✅ Mock draft configured! Go to Live Draft page to start tracking.', 'success');
            this.config.isConfigured = true;
            return true;
        }

        // A real league: adopt the parsed ID and drop any leftover mock-draft target.
        leagueId = parsed.id;
        console.log('📋 League ID:', leagueId);

        this.config.sleeperLeagueId = leagueId;
        this.config.sleeperDraftId = null;
        this.config.isMockDraft = false;
        this.updateFormFields({ sleeperLeagueId: leagueId });
        
        // Save username from form before API call
        const usernameInput = document.getElementById('sleeperUserName');
        if (usernameInput && usernameInput.value.trim()) {
            this.config.sleeperUsername = usernameInput.value.trim();
            console.log('👤 Username:', this.config.sleeperUsername);
        }
        
        try {
            this.showNotification('🔗 Connecting to Sleeper to load your league data...', 'info');
            
            // Fetch league, rosters, and users data
            const [leagueResponse, rostersResponse, usersResponse] = await Promise.all([
                fetch(`https://api.sleeper.app/v1/league/${leagueId}`),
                fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
                fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`)
            ]);
            
            // Check if league exists
            if (!leagueResponse.ok) {
                // Sleeper league IDs and draft IDs are the same shape, so a bare ID
                // is genuinely ambiguous. Before giving up, see if it is a draft.
                const resolvedAsDraft = await this.tryResolveAsDraft(leagueId);
                if (resolvedAsDraft) return true;

                throw new Error(`League not found. Status: ${leagueResponse.status}`);
            }
            
            const leagueData = await leagueResponse.json();
            const rosters = rostersResponse.ok ? await rostersResponse.json() : [];
            const users = usersResponse.ok ? await usersResponse.json() : [];
            
            console.log('📊 Sleeper Data Received:', { 
                league: leagueData.name,
                rosters: rosters.length,
                users: users.length 
            });
            console.log('👥 User details:', users.map(u => ({
                display_name: u.display_name,
                username: u.username || '(none)',
                user_id: u.user_id
            })));
            
            // Check if this is a mock draft
            const isMockDraft = leagueData.status === 'drafting' && leagueData.settings?.type === 0;
            
            // Update basic league info
            this.config.leagueName = leagueData.name || (isMockDraft ? 'Mock Draft' : 'My Fantasy League');
            this.config.leagueSize = leagueData.total_rosters || leagueData.settings?.teams || 12;
            this.config.draftCompleted = leagueData.status === 'in_season' || leagueData.status === 'complete';
            
            // Determine scoring format - purely about points per reception
            const scoringSettings = leagueData.scoring_settings || leagueData.settings;
            if (scoringSettings) {
                if (scoringSettings.rec === 1 || scoringSettings.ppr === 1) {
                    this.config.scoringFormat = 'PPR';
                } else if (scoringSettings.rec === 0.5) {
                    this.config.scoringFormat = 'Half PPR';
                } else {
                    this.config.scoringFormat = 'Standard';
                }
            }

            // Determine roster format from the starting lineup Sleeper publishes
            this.config.rosterFormat = ConfigManager.detectRosterFormat(leagueData.roster_positions);
            
            // For mock drafts, we might not have rosters/users data
            if (isMockDraft) {
                console.log('🎯 Mock draft detected! Limited data available.');
                this.showNotification('📋 Mock draft detected! You can skip team selection and go straight to draft tracking.', 'info');
            }
            
            // Auto-fill basic league info
            this.updateFormFields({
                leagueName: this.config.leagueName,
                leagueSize: this.config.leagueSize,
                scoringFormat: this.config.scoringFormat,
                rosterFormat: this.config.rosterFormat
            });
            
            // Clear any previous team data
            this.clearTeamData();

            // Handle team selection
            if (rosters.length > 0 && users.length > 0) {
                // Try username matching first if username provided
                const sleeperUsername = this.config.sleeperUsername; // Use from config now
                
                if (sleeperUsername) {
                    console.log('Attempting to find team for username:', sleeperUsername);
                    console.log('Available users:', users.map(u => ({ 
                        username: u.username, 
                        display_name: u.display_name,
                        user_id: u.user_id 
                    })));
                    
                    const selectedTeam = this.findTeamByUsername(rosters, users, sleeperUsername);
                    if (selectedTeam) {
                        this.showNotification('✅ Found your team automatically!', 'success');
                        this.applyTeamData(selectedTeam);
                        return true;
                    } else {
                        // Show available display names to help user
                        const availableNames = users.map(u => u.display_name).filter(n => n).join(', ');
                        this.showNotification(`❌ Display name "${sleeperUsername}" not found. Available: ${availableNames}`, 'warning');
                    }
                }
                
                // Show team selection interface
                this.showTeamSelectionInterface(rosters, users);
            } else if (isMockDraft) {
                // Mock drafts might not have roster/user data yet
                this.showNotification('✅ Mock draft loaded! Skip to draft tracking - team will be assigned when draft starts.', 'success');
                // Auto-fill a generic team name for mock drafts
                this.updateFormFields({
                    teamName: 'Mock Team'
                });
            } else {
                this.showNotification('✅ League data loaded! No team data available - please fill manually.', 'success');
            }
            
            this.config.isConfigured = true;
            return true;
            
        } catch (error) {
            console.error('Sleeper API Error:', error);
            let errorMessage = '❌ Could not connect to Sleeper. ';
            
            if (error.message.includes('not found')) {
                errorMessage += 'Please check your League ID.';
            } else {
                errorMessage += 'Please try again or fill manually.';
            }
            
            this.showNotification(errorMessage, 'error');
            return false;
        }
    }

    /**
     * Last resort when an ID does not resolve as a league: check whether it is a
     * draft ID instead. A draft that belongs to a league is adopted as that
     * league so rosters and turn detection still work; a draft with no league is
     * a mock draft.
     */
    async tryResolveAsDraft(id) {
        // Adopting a draft's league re-enters loadFromSleeper. Remember what has
        // already been tried so a self-referential ID cannot loop.
        this._triedSleeperIds = this._triedSleeperIds || new Set();
        if (this._triedSleeperIds.has(String(id))) return false;
        this._triedSleeperIds.add(String(id));

        try {
            const response = await fetch(`https://api.sleeper.app/v1/draft/${id}`);
            if (!response.ok) return false;

            const draft = await response.json();
            if (!draft || !draft.draft_id) return false;

            if (draft.league_id) {
                console.log('📋 ID was a league draft; adopting league', draft.league_id);
                this.config.sleeperLeagueId = String(draft.league_id);
                this.config.sleeperDraftId = null;
                this.config.isMockDraft = false;
                this.updateFormFields({ sleeperLeagueId: this.config.sleeperLeagueId });
                this.showNotification('📋 That was a draft link - loading the league it belongs to...', 'info');
                return await this.loadFromSleeper();
            }

            console.log('📋 ID resolved as a mock draft:', draft.draft_id);
            this.config.sleeperDraftId = String(draft.draft_id);
            this.config.sleeperLeagueId = '';
            this.config.isMockDraft = true;
            this.config.isConfigured = true;

            this.updateFormFields({
                leagueName: 'Mock Draft',
                teamName: 'My Mock Team',
                leagueSize: (draft.settings && draft.settings.teams) || 12,
                scoringFormat: this.config.scoringFormat || 'Half PPR'
            });

            this.showNotification('✅ That ID is a mock draft, not a league. Configured - go to Live Draft to start tracking.', 'success');
            return true;

        } catch (error) {
            console.warn('Draft fallback failed:', error);
            return false;
        }
    }

    // Fixed findTeamByUsername method in ConfigManager
    findTeamByUsername(rosters, users, username) {
        const normalizedUsername = username.toLowerCase().trim();
        
        console.log('🔍 Looking for username/display name:', normalizedUsername);
        console.log('📋 Available users in league:', users.map(u => ({
            username: u.username,
            display_name: u.display_name,
            user_id: u.user_id
        })));
        
        // FIX: Since all usernames are undefined, search by display_name only
        const user = users.find(u => {
            // Primary match: display_name (since usernames are undefined)
            const displayMatch = u.display_name && u.display_name.toLowerCase().trim() === normalizedUsername;
            
            // Fallback match: username (if it exists)
            const usernameMatch = u.username && u.username.toLowerCase().trim() === normalizedUsername;
            
            if (displayMatch) {
                console.log('✅ Found by display name:', u.display_name);
                return true;
            }
            if (usernameMatch) {
                console.log('✅ Found by username:', u.username);
                return true;
            }
            return false;
        });
        
        if (!user) {
            console.log('❌ No user found with username/display name:', normalizedUsername);
            console.log('💡 Available display names:', users.map(u => u.display_name).join(', '));
            return null;
        }
        
        // Find roster for this user
        const roster = rosters.find(r => r.owner_id === user.user_id);
        if (!roster) {
            console.log('❌ No roster found for user:', user);
            return null;
        }
        
        console.log('🎯 Successfully matched team:', { 
            username: user.username, 
            display_name: user.display_name,
            team_name: user.metadata?.team_name,
            roster_id: roster.roster_id 
        });
        return { roster, user };
    }

    // Fixed showTeamSelectionInterface method for ConfigManager
    // Replace this method in your config-manager.js file

    showTeamSelectionInterface(rosters, users) {
        console.log('🔧 showTeamSelectionInterface called with:', { rosters: rosters.length, users: users.length });
        
        const statusDiv = document.getElementById('sleeperStatus');
        if (!statusDiv) {
            console.error('❌ Status div not found!');
            return;
        }
        
        // Store data globally first
        window.sleeperRosters = rosters;
        window.sleeperUsers = users;
        
        try {
            // Create team options with proper team name priority
            const teamsHtml = rosters.map((roster, index) => {
                // Find user by matching roster.owner_id to user.user_id
                const owner = users.find(u => u.user_id === roster.owner_id);
                const wins = roster.settings?.wins || 0;
                const losses = roster.settings?.losses || 0;
                const points = Math.round(roster.settings?.fpts || 0);
                const record = `${wins}-${losses}`;
                
                // FIXED: Proper team name priority
                let teamName = `Team ${index + 1}`; // Default fallback
                let ownerName = `User ${index + 1}`; // Default fallback
                
                if (owner) {
                    // Priority 1: Actual team name from metadata
                    if (owner.metadata?.team_name && owner.metadata.team_name.trim() !== '') {
                        teamName = owner.metadata.team_name;
                    } 
                    // Priority 2: Display name as team name
                    else if (owner.display_name && owner.display_name.trim() !== '') {
                        teamName = owner.display_name;
                    } 
                    // Priority 3: Username as team name
                    else if (owner.username && owner.username.trim() !== '') {
                        teamName = owner.username;
                    }
                    
                    // Owner name (separate from team name)
                    ownerName = owner.display_name || owner.username || 'Unknown Owner';
                }
                
                console.log(`Team ${index + 1}:`, { 
                    teamName, 
                    ownerName, 
                    record, 
                    points, 
                    roster_owner_id: roster.owner_id,
                    found_owner: !!owner,
                    owner_user_id: owner?.user_id,
                    team_metadata: owner?.metadata?.team_name
                });
                
                return `
                    <div class="team-option" data-action="select-sleeper-team" data-team-index="${index}">
                        <div class="team-header">
                            <div class="team-name">${teamName}</div>
                            <div class="team-username">Owner: ${ownerName}</div>
                        </div>
                        <div class="team-stats">
                            <span class="team-record">📊 ${record}</span>
                            <span class="team-points">🏆 ${points} pts</span>
                            <span class="team-rank">Waiver #${roster.settings?.waiver_position || index + 1}</span>
                        </div>
                    </div>
                `;
            }).join('');
            
            // Create the complete selection interface
            const selectionHtml = `
                <div class="team-selection">
                    <h4>🎯 Select Your Team</h4>
                    <p>Found ${rosters.length} teams in "${this.config.leagueName}". Click on your team:</p>
                    <div class="teams-grid">
                        ${teamsHtml}
                    </div>
                    <div class="selection-help">
                        <small>💡 Look for your team name or your name as the owner. Team names come from Sleeper metadata.</small>
                    </div>
                </div>
            `;
            
            // Update the status div
            statusDiv.innerHTML = selectionHtml;
            statusDiv.style.display = 'block';
            statusDiv.style.background = 'rgba(69, 183, 209, 0.1)';
            statusDiv.style.border = '1px solid var(--accent-color)';
            statusDiv.style.color = 'var(--accent-color)';
            statusDiv.style.borderRadius = '8px';
            statusDiv.style.padding = '15px';
            
            console.log('✅ Team selection interface created successfully');
            
        } catch (error) {
            console.error('❌ Error creating team selection interface:', error);
            statusDiv.innerHTML = `
                <div style="color: var(--danger-color);">
                    ❌ Error creating team selection. Please try again or fill manually.
                </div>
            `;
        }
    }
    // Fixed applyTeamData method for ConfigManager
    // Replace this method in your config-manager.js file

    applyTeamData(teamData) {
        const { roster, user } = teamData;
        
        // FIXED: Prioritize actual team name over user display name
        let teamName = '';
        
        // First priority: Team name from metadata (actual fantasy team name)
        if (user.metadata && user.metadata.team_name && user.metadata.team_name.trim() !== '') {
            teamName = user.metadata.team_name;
            console.log('🏆 Using team name from metadata:', teamName);
        }
        // Second priority: Display name (fallback)
        else if (user.display_name && user.display_name.trim() !== '') {
            teamName = user.display_name;
            console.log('👤 Using display name as team name:', teamName);
        }
        // Third priority: Username (last resort)
        else if (user.username && user.username.trim() !== '') {
            teamName = user.username;
            console.log('📝 Using username as team name:', teamName);
        }
        // Final fallback
        else {
            teamName = 'My Team';
            console.log('🔄 Using default team name');
        }
        
        // Update config with team data
        this.config.teamName = teamName;
        this.config.totalPoints = Math.round(roster.settings?.fpts || 0);
        
        const wins = roster.settings?.wins || 0;
        const losses = roster.settings?.losses || 0;
        const ties = roster.settings?.ties || 0;
        this.config.teamRecord = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
        
        // Calculate league ranking based on points
        const allRosters = window.sleeperRosters || [];
        const sortedRosters = [...allRosters].sort((a, b) => (b.settings?.fpts || 0) - (a.settings?.fpts || 0));
        const userRank = sortedRosters.findIndex(r => r.roster_id === roster.roster_id) + 1;
        this.config.leagueRanking = userRank;
        
        // Estimate playoff odds based on record and points
        const totalGames = wins + losses + ties;
        let winPercentage = totalGames > 0 ? wins / totalGames : 0.5;
        
        // Adjust based on league position
        if (userRank <= this.config.leagueSize / 2) {
            winPercentage = Math.min(0.95, winPercentage + 0.1);
        }
        
        this.config.playoffOdds = Math.min(95, Math.max(5, Math.round(winPercentage * 100)));
        
        // Update form fields
        this.updateFormFields({
            teamName: this.config.teamName
        });
        
        // Debug logging
        console.log('🎯 Team data applied:', {
            selectedTeamName: teamName,
            userDisplayName: user.display_name,
            userUsername: user.username,
            teamMetadata: user.metadata?.team_name,
            finalConfig: this.config.teamName
        });
        
        // Show confirmation
        const statusDiv = document.getElementById('sleeperStatus');
        if (statusDiv) {
            statusDiv.innerHTML = `
                <div class="team-confirmation">
                    <div class="confirmation-header">
                        ✅ <strong>Team Selected Successfully!</strong>
                    </div>
                    <div class="confirmation-details">
                        <div class="detail-row">
                            <span class="detail-label">Team:</span>
                            <span class="detail-value">${this.config.teamName}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Owner:</span>
                            <span class="detail-value">${user.display_name || user.username}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Record:</span>
                            <span class="detail-value">${this.config.teamRecord}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Points:</span>
                            <span class="detail-value">${this.config.totalPoints}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Rank:</span>
                            <span class="detail-value">#${this.config.leagueRanking} of ${this.config.leagueSize}</span>
                        </div>
                    </div>
                </div>
            `;
            statusDiv.style.background = 'rgba(46, 204, 113, 0.1)';
            statusDiv.style.border = '1px solid var(--success-color)';
            statusDiv.style.color = 'var(--success-color)';
        }
    }

    // Helper method to update form fields
    updateFormFields(fields) {
        Object.keys(fields).forEach(fieldName => {
            const element = document.getElementById(fieldName);
            if (element && fields[fieldName] !== undefined) {
                element.value = fields[fieldName];
            }
        });
    }

    // Clear team-specific data
    clearTeamData() {
        this.updateFormFields({
            teamName: ''
        });
        
        // Reset config values
        this.config.teamName = '';
        this.config.totalPoints = 0;
        this.config.teamRecord = '0-0';
        this.config.leagueRanking = 1;
        this.config.playoffOdds = 50;
        
        // Clear status
        const statusDiv = document.getElementById('sleeperStatus');
        if (statusDiv) {
            statusDiv.innerHTML = '';
            statusDiv.style.display = 'none';
        }
    }

    findTeamByUserId(rosters, users, userId) {
        const user = users.find(u => u.user_id === userId);
        if (!user) {
            console.log('User not found with ID:', userId);
            console.log('Available user IDs:', users.map(u => u.user_id));
            return null;
        }
        
        const roster = rosters.find(r => r.owner_id === userId);
        if (!roster) {
            console.log('No roster found for user ID:', userId);
            return null;
        }
        
        return { roster, user };
    }

    // UPDATED: Enhanced save configuration with validation
    saveConfiguration(newConfig) {
        // Validate required fields
        if (!newConfig.leagueName && !newConfig.teamName) {
            this.showNotification('❌ Please enter at least a League Name or Team Name', 'error');
            return false;
        }

        // Validate league size
        if (newConfig.leagueSize && (newConfig.leagueSize < 4 || newConfig.leagueSize > 20)) {
            this.showNotification('❌ League size must be between 4 and 20 teams', 'error');
            return false;
        }

        if (this.config.sleeperUsername) {
            newConfig.sleeperUsername = this.config.sleeperUsername;
        }

        // The form has one box for both league IDs and draft links, so re-read it
        // here rather than trusting whatever the field happens to hold.
        if (Object.prototype.hasOwnProperty.call(newConfig, 'sleeperLeagueId')) {
            const parsed = this.parseSleeperInput(newConfig.sleeperLeagueId);

            if (parsed.kind === 'draft') {
                newConfig.sleeperLeagueId = '';
                newConfig.sleeperDraftId = parsed.id;
                newConfig.isMockDraft = true;
            } else if (parsed.kind === 'league') {
                newConfig.sleeperLeagueId = parsed.id;
                newConfig.sleeperDraftId = null;
                newConfig.isMockDraft = false;
            } else {
                // Nothing usable typed - keep whatever the popup already resolved.
                delete newConfig.sleeperLeagueId;
            }
        }

        // Merge with existing config
        this.config = {
            ...this.config,
            ...newConfig,
            isConfigured: true,
            lastUpdated: new Date().toISOString()
        };

        this.normalizeSleeperTarget(this.config);
        this.normalizeFormats(this.config);

        // Save to localStorage with error handling
        try {
            localStorage.setItem('fantasyAppConfig', JSON.stringify(this.config));
            this.applyConfiguration();
            this.showNotification('✅ Configuration saved successfully!', 'success');

            // Mirror to the user's other devices. Local storage has already
            // succeeded by this point, so a sync failure is a warning, not a
            // failed save - it must not turn a good save into an error.
            if (this.profileSync && this.profileSync.isEnabled) {
                this.profileSync.push({ silent: true }).catch(error => {
                    console.warn('Could not sync configuration:', error);
                });
            }
            
            // Close config panel after successful save
            setTimeout(() => {
                document.getElementById('configPanel').classList.add('hidden');
            }, 1000);
            
            return true;
        } catch (error) {
            console.error('Error saving configuration:', error);
            this.showNotification('❌ Error saving configuration. Please try again.', 'error');
            return false;
        }
    }

    // UPDATED: Enhanced apply configuration with better error handling
    applyConfiguration() {
        try {
            // Update page title with team/league info
            const titleParts = [];
            if (this.config.teamName) titleParts.push(this.config.teamName);
            if (this.config.leagueName) titleParts.push(this.config.leagueName);
            titleParts.push('Fantasy Football Command Center');
            
            const pageTitle = titleParts.join(' - ');
            document.title = pageTitle;
            
            // Safely update elements that might not exist
            this.safeUpdateElement('app-title', pageTitle);
            this.safeUpdateElement('appLogoTitle', this.config.teamName || 'Fantasy Command Center');
            this.safeUpdateElement('appLogoSubtitle', this.config.leagueName || 'Your Learning Hub');
            this.safeUpdateElement('navTeamName', this.config.teamName || 'My Team');
            this.safeUpdateElement('myTeamPageTitle', this.config.teamName || 'My Team');
            
            // Update dashboard subtitle
            const subtitle = this.config.leagueName ? 
                `${this.config.leagueName} - ${this.config.scoringFormat} League` :
                'Configure your league to get started';
            this.safeUpdateElement('dashboardSubtitle', subtitle);
            
            // Apply theme color
            if (this.config.themeColor && document.body) {
                document.body.setAttribute('data-theme', this.config.themeColor);
            }
            
            // Update page content based on configuration status
            this.updatePageContent();
            
            console.log('Configuration applied successfully:', this.config);
            
        } catch (error) {
            console.error('Error applying configuration:', error);
            this.showNotification('⚠️ Some settings may not have applied correctly', 'warning');
        }
    }

    // UPDATED: Enhanced page content updates
    updatePageContent() {
        const isConfigured = this.config.isConfigured && (this.config.leagueName || this.config.teamName);
        
        try {
            // Update dashboard based on configuration status
            const dashboardWelcome = document.querySelector('#dashboard .empty-state');
            if (dashboardWelcome) {
                if (isConfigured) {
                    // Show configured dashboard
                    dashboardWelcome.innerHTML = `
                        <div class="icon">🏆</div>
                        <h3>Welcome back, ${this.config.teamName || 'Champion'}!</h3>
                        <p>
                            Your ${this.config.leagueName || 'Fantasy League'} dashboard is ready. 
                            Current record: ${this.config.teamRecord || '0-0'} | 
                            League rank: #${this.config.leagueRanking || 1}
                        </p>
                        <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                            <button class="btn btn-primary" onclick="navigationManager?.navigateToPage('my-team')">
                                <span>⭐</span> View My Team
                            </button>
                            <button class="btn btn-secondary" onclick="navigationManager?.navigateToPage('ai-insights')">
                                <span>🤖</span> AI Insights
                            </button>
                        </div>
                    `;
                } else {
                    // Show welcome/setup message
                    dashboardWelcome.innerHTML = `
                        <div class="icon">🏈</div>
                        <h3>Welcome to Fantasy Football Command Center!</h3>
                        <p>
                            The educational fantasy platform that teaches you WHY behind every decision. 
                            Get started by configuring your league information to unlock personalized insights and AI recommendations.
                        </p>
                        <button class="btn btn-primary" onclick="showConfiguration()" style="margin-top: 15px;">
                            <span>⚙️</span> Set Up My League
                        </button>
                    `;
                }
            }

            // Update other pages based on configuration
            this.updateMyTeamPage(isConfigured);
            this.updateDraftPage(isConfigured);
            this.updateInsightsPage(isConfigured);
            
        } catch (error) {
            console.error('Error updating page content:', error);
        }
    }

    // NEW: Update My Team page content
    updateMyTeamPage(isConfigured) {
        const myTeamEmpty = document.querySelector('#my-team .empty-state');
        if (myTeamEmpty) {
            if (isConfigured && this.config.draftCompleted) {
                myTeamEmpty.innerHTML = `
                    <div class="icon">⭐</div>
                    <h3>Team: ${this.config.teamName}</h3>
                    <p>
                        Record: ${this.config.teamRecord} | Points: ${this.config.totalPoints} | Rank: #${this.config.leagueRanking}
                        <br>Your lineup analysis and weekly matchup insights will appear here.
                    </p>
                    <button class="btn btn-primary" data-action="connect-sleeper" style="margin-top: 15px;">
                        <span>🔗</span> Load Current Roster
                    </button>
                `;
            } else if (isConfigured) {
                myTeamEmpty.innerHTML = `
                    <div class="icon">📋</div>
                    <h3>Ready for Draft Day!</h3>
                    <p>
                        Your team "${this.config.teamName}" is set up in ${this.config.leagueName}. 
                        Complete your draft to see lineup optimization and matchup analysis.
                    </p>
                    <button class="btn btn-primary" onclick="navigationManager?.navigateToPage('live-draft')" style="margin-top: 15px;">
                        <span>🔥</span> Go to Draft Tracker
                    </button>
                `;
            }
        }
    }

    // NEW: Update Draft page content
    updateDraftPage(isConfigured) {
        // Check if DraftTracker has already set up its interface
        const draftTrackerUI = document.querySelector('#live-draft .draft-tracker-controls');
        if (draftTrackerUI) {
            console.log('✅ DraftTracker interface already set up, skipping ConfigManager draft page update');
            return;
        }
        
        const draftEmpty = document.querySelector('#live-draft .empty-state');
        if (draftEmpty && isConfigured) {
            if (this.config.sleeperLeagueId) {
                draftEmpty.innerHTML = `
                    <div class="icon">🔗</div>
                    <h3>Connected to ${this.config.leagueName}</h3>
                    <p>
                        Your Sleeper league is connected! Live draft tracking, real-time pick analysis, 
                        and AI-powered recommendations are ready to go.
                    </p>
                    <button class="btn btn-primary" data-action="connect-sleeper" style="margin-top: 15px;">
                        <span>🔥</span> Start Draft Tracking
                    </button>
                `;
            } else {
                draftEmpty.innerHTML = `
                    <div class="icon">🔗</div>
                    <h3>Connect Your League for Live Features</h3>
                    <p>
                        Add your Sleeper League ID to enable live draft tracking, real-time pick analysis, 
                        and AI-powered recommendations during your draft.
                    </p>
                    <button class="btn btn-primary" onclick="showConfiguration()" style="margin-top: 15px;">
                        <span>⚙️</span> Add Sleeper League ID
                    </button>
                `;
            }
        }
    }

    // NEW: Update AI Insights page content
    updateInsightsPage(isConfigured) {
        const insightsEmpty = document.querySelector('#ai-insights .empty-state');
        if (insightsEmpty && isConfigured) {
            insightsEmpty.innerHTML = `
                <div class="icon">🤖</div>
                <h3>AI Analysis Ready for ${this.config.teamName}</h3>
                <p>
                    Your league setup is complete! AI will analyze player trends, hot/cold streaks, 
                    weather impacts, and provide predictive insights with confidence levels.
                </p>
                <button class="btn btn-primary" onclick="generateInsights()" style="margin-top: 15px;">
                    <span>✨</span> Generate Team Insights
                </button>
            `;
        }
    }

    // UPDATED: Enhanced populate config form with better error handling
    populateConfigForm() {
        try {
            // Basic league information
            this.safeSetInputValue('leagueName', this.config.leagueName);
            this.safeSetInputValue('teamName', this.config.teamName);
            this.safeSetInputValue('leagueSize', this.config.leagueSize);
            this.safeSetInputValue('scoringFormat', this.config.scoringFormat);
            this.safeSetInputValue('rosterFormat', this.config.rosterFormat);
            this.safeSetInputValue('draftPosition', this.config.draftPosition);
            this.safeSetInputValue('sleeperLeagueId', this.config.sleeperLeagueId);
            // FIX: Use the correct input field ID from HTML (sleeperUserName not sleeperUsername)
            this.safeSetInputValue('sleeperUserName', this.config.sleeperUsername || '');

            // Clear any previous status
            const statusDiv = document.getElementById('sleeperStatus');
            if (statusDiv) {
                statusDiv.style.display = 'none';
                statusDiv.innerHTML = '';
            }

            // Update draft position options based on league size
            if (window.eventManager && window.eventManager.updateDraftPositionOptions) {
                window.eventManager.updateDraftPositionOptions(this.config.leagueSize || 12);
            }

            console.log('Config form populated with:', this.config);
            
        } catch (error) {
            console.error('Error populating config form:', error);
            this.showNotification('⚠️ Some form fields may not have loaded correctly', 'warning');
        }
    }

    // UPDATED: Enhanced notification system with better styling and auto-dismiss
    showNotification(message, type = 'info', duration = 4000) {
        try {
            // Remove any existing notifications
            const existingNotifications = document.querySelectorAll('.notification');
            existingNotifications.forEach(notification => notification.remove());

            const notification = document.createElement('div');
            notification.className = `notification notification-${type}`;
            
            const icons = {
                success: '✅',
                error: '❌',
                warning: '⚠️',
                info: 'ℹ️'
            };

            // Most callers already lead with a status emoji. The panel adds its own,
            // so drop a leading duplicate rather than rendering "❌ ❌ ...".
            const withoutLeadingIcon = String(message).replace(/^\s*(?:\p{Extended_Pictographic}|️|‍)+\s*/u, '');
            if (withoutLeadingIcon) {
                message = withoutLeadingIcon;
            }

            notification.innerHTML = `
                <div style="display: flex; align-items: flex-start; gap: 10px;">
                    <span style="font-size: 1.2em;">${icons[type]}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: 500; margin-bottom: 2px;">${message}</div>
                        <div style="font-size: 0.8em; color: var(--text-secondary); opacity: 0.8;">
                            Click to dismiss • Auto-dismiss in ${duration/1000}s
                        </div>
                    </div>
                    <span style="font-size: 0.9em; color: var(--text-secondary); cursor: pointer;" onclick="this.parentElement.parentElement.remove()">✕</span>
                </div>
            `;
            
            // Click to dismiss
            notification.addEventListener('click', () => notification.remove());

            document.body.appendChild(notification);

            // The bare .notification rule is a hidden state - translateX(100%),
            // opacity 0, pointer-events none - and .show is what reveals it.
            // Without this class every toast was built off-screen and invisible,
            // sat out its whole lifetime there, and only became briefly visible
            // during the slide-out animation as it was removed. That made the app
            // look silent while it was in fact reporting errors the entire time,
            // and made "click to dismiss" impossible.
            requestAnimationFrame(() => notification.classList.add('show'));

            // Auto-dismiss after duration
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.classList.remove('show');
                    notification.classList.add('hide');
                    setTimeout(() => notification.remove(), 300);
                }
            }, duration);
            
        } catch (error) {
            console.error('Error showing notification:', error);
            // Fallback to console log and alert
            console.log(`${type.toUpperCase()}: ${message}`);
            if (type === 'error') {
                alert(message);
            }
        }
    }

    // NEW: Helper method to safely update element text content
    safeUpdateElement(elementId, content) {
        try {
            const element = document.getElementById(elementId);
            if (element && content !== undefined && content !== null) {
                element.textContent = content;
                return true;
            }
            return false;
        } catch (error) {
            console.warn(`Could not update element ${elementId}:`, error);
            return false;
        }
    }

    // NEW: Helper method to safely set input values
    safeSetInputValue(elementId, value) {
        try {
            const element = document.getElementById(elementId);
            if (element && value !== undefined && value !== null) {
                element.value = value;
                return true;
            }
            return false;
        } catch (error) {
            console.warn(`Could not set value for ${elementId}:`, error);
            return false;
        }
    }

    // NEW: Get current configuration status for debugging
    getConfigStatus() {
        return {
            isConfigured: this.config.isConfigured,
            hasLeagueName: !!this.config.leagueName,
            hasTeamName: !!this.config.teamName,
            hasSleeperConnection: !!this.config.sleeperLeagueId,
            draftCompleted: this.config.draftCompleted,
            lastUpdated: this.config.lastUpdated,
            config: this.config
        };
    }

    // NEW: Reset configuration (useful for testing)
    /**
     * The complete set of keys this app owns. Everything else it displays -
     * players, rosters, picks, standings - belongs to Sleeper and is refetched,
     * so a backup only needs to carry these.
     */
    getPersistedKeys() {
        return ['fantasyAppConfig', 'draftPlan', 'conceptsLearned'];
    }

    /**
     * Writes local app data to a JSON file. Nothing is uploaded - the file is
     * produced in the browser and saved to disk.
     *
     * Note the file contains your draft plan in plain text, which is exactly the
     * information you would not want a league mate to read.
     */
    exportAppData() {
        try {
            const data = {};
            let found = 0;

            this.getPersistedKeys().forEach(key => {
                const raw = localStorage.getItem(key);
                if (raw === null) return;
                found++;
                // Store parsed JSON where possible so the file stays readable.
                try {
                    data[key] = JSON.parse(raw);
                } catch (e) {
                    data[key] = raw;
                }
            });

            if (!found) {
                this.showNotification('Nothing to export yet - configure your league first', 'warning');
                return false;
            }

            const payload = {
                app: 'fantasy-football-command-center',
                formatVersion: 1,
                exportedAt: new Date().toISOString(),
                data
            };

            const teamName = (this.config.teamName || 'fantasy')
                .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fantasy';
            const stamp = new Date().toISOString().slice(0, 10);

            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${teamName}-backup-${stamp}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 0);

            this.showNotification(`Backup saved - ${found} item${found === 1 ? '' : 's'}`, 'success');
            return true;

        } catch (error) {
            console.error('❌ Error exporting app data:', error);
            this.showNotification(`Export failed: ${error.message}`, 'error');
            return false;
        }
    }

    /** Opens a file picker and restores a backup written by exportAppData. */
    importAppData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';

        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            if (!file) return;

            try {
                const payload = JSON.parse(await file.text());

                if (!payload || payload.app !== 'fantasy-football-command-center' || !payload.data) {
                    throw new Error('Not a backup from this app');
                }

                const keys = this.getPersistedKeys();
                const restorable = Object.keys(payload.data).filter(k => keys.includes(k));

                if (!restorable.length) {
                    throw new Error('Backup contains nothing this app can restore');
                }

                const confirmed = confirm(
                    `Restore ${restorable.length} item(s) from ${file.name}?\n\n` +
                    `This replaces your current league setup, draft plan and learning progress.`
                );
                if (!confirmed) return;

                restorable.forEach(key => {
                    const value = payload.data[key];
                    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
                });

                this.showNotification('Backup restored - reloading...', 'success');
                setTimeout(() => window.location.reload(), 900);

            } catch (error) {
                console.error('❌ Error importing app data:', error);
                this.showNotification(`Import failed: ${error.message}`, 'error');
            }
        });

        input.click();
    }

    resetConfiguration() {
        if (confirm('Are you sure you want to reset all configuration? This cannot be undone.')) {
            localStorage.removeItem('fantasyAppConfig');
            this.config = this.getDefaultConfig();
            this.applyConfiguration();
            this.showNotification('🔄 Configuration reset successfully', 'info');
            showConfiguration();
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConfigManager;
}