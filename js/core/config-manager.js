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
            
            // Season Stats
            teamRecord: "0-0",
            totalPoints: 0,
            leagueRanking: 1,
            playoffOdds: 50,
            
            // App Settings
            sleeperLeagueId: "",
            learningMode: "beginner",
            themeColor: "teal",
            
            // Status flags
            isConfigured: false,
            draftCompleted: false
        };
    }

    async loadConfiguration() {
        // Try to load from localStorage first
        const saved = localStorage.getItem('fantasyAppConfig');
        if (saved) {
            try {
                this.config = { ...this.config, ...JSON.parse(saved) };
            } catch (e) {
                console.warn('Could not load saved configuration, using defaults');
            }
        }

        // Load from environment variables (meta tags)
        this.loadFromEnvironment();
        
        // Apply configuration to the app
        this.applyConfiguration();
        
        // Show config panel for first-time users or incomplete setups
        if (this.isFirstTime || !this.config.isConfigured || (!this.config.leagueName && !this.config.teamName)) {
            setTimeout(() => showConfiguration(), 500);
        }
    }

    loadFromEnvironment() {
        const envVars = {
            FANTASY_LEAGUE_NAME: 'leagueName',
            FANTASY_TEAM_NAME: 'teamName',
            FANTASY_LEAGUE_SIZE: 'leagueSize',
            FANTASY_SCORING_FORMAT: 'scoringFormat',
            FANTASY_TEAM_RECORD: 'teamRecord',
            FANTASY_TOTAL_POINTS: 'totalPoints',
            FANTASY_LEAGUE_RANKING: 'leagueRanking',
            FANTASY_PLAYOFF_ODDS: 'playoffOdds',
            SLEEPER_LEAGUE_ID: 'sleeperLeagueId',
            FANTASY_LEARNING_MODE: 'learningMode',
            FANTASY_THEME_COLOR: 'themeColor'
        };

        Object.keys(envVars).forEach(envVar => {
            const metaTag = document.querySelector(`meta[name="${envVar}"]`);
            if (metaTag && metaTag.content && metaTag.content.trim() !== '') {
                const configKey = envVars[envVar];
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
        const leagueId = this.config.sleeperLeagueId;
        if (!leagueId) {
            this.showNotification('❌ Please enter a Sleeper League ID first', 'error');
            return false;
        }
        
        // Save username from form before API call
        const usernameInput = document.getElementById('sleeperUserName');
        if (usernameInput && usernameInput.value.trim()) {
            this.config.sleeperUsername = usernameInput.value.trim();
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
                throw new Error(`League not found. Status: ${leagueResponse.status}`);
            }
            
            const leagueData = await leagueResponse.json();
            const rosters = rostersResponse.ok ? await rostersResponse.json() : [];
            const users = usersResponse.ok ? await usersResponse.json() : [];
            
            console.log('Sleeper Data:', { leagueData, rosters, users }); // Debug log
            
            // Update basic league info
            this.config.leagueName = leagueData.name || 'My Fantasy League';
            this.config.leagueSize = leagueData.total_rosters || 12;
            this.config.draftCompleted = leagueData.status === 'in_season' || leagueData.status === 'complete';
            
            // Determine scoring format
            const scoringSettings = leagueData.scoring_settings;
            if (scoringSettings) {
                if (scoringSettings.rec === 1) {
                    this.config.scoringFormat = 'PPR';
                } else if (scoringSettings.rec === 0.5) {
                    this.config.scoringFormat = 'Half PPR';
                } else {
                    this.config.scoringFormat = 'Standard';
                }
            }
            
            // Auto-fill basic league info
            this.updateFormFields({
                leagueName: this.config.leagueName,
                leagueSize: this.config.leagueSize,
                scoringFormat: this.config.scoringFormat
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
                        this.showNotification(`❌ Username "${sleeperUsername}" not found in league. Please select manually.`, 'warning');
                    }
                }
                
                // Show team selection interface
                this.showTeamSelectionInterface(rosters, users);
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

        // Merge with existing config
        this.config = { 
            ...this.config, 
            ...newConfig,
            isConfigured: true,
            lastUpdated: new Date().toISOString()
        };

        // Save to localStorage with error handling
        try {
            localStorage.setItem('fantasyAppConfig', JSON.stringify(this.config));
            this.applyConfiguration();
            this.showNotification('✅ Configuration saved successfully!', 'success');
            
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
            this.safeSetInputValue('sleeperLeagueId', this.config.sleeperLeagueId);
            // FIX: Use the correct input field ID from HTML (sleeperUserName not sleeperUsername)
            this.safeSetInputValue('sleeperUserName', this.config.sleeperUsername || '');

            // Clear any previous status
            const statusDiv = document.getElementById('sleeperStatus');
            if (statusDiv) {
                statusDiv.style.display = 'none';
                statusDiv.innerHTML = '';
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
            
            // Auto-dismiss after duration
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.style.animation = 'slideOutRight 0.3s ease';
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