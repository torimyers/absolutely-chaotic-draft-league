// Fantasy Football App - Core JavaScript (Clean Version)
// Show Me Your TDs - Educational Fantasy Football Platform

// Configuration Management System
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

    findTeamByUsername(rosters, users, username) {
        const normalizedUsername = username.toLowerCase().trim();
        
        console.log('🔍 Looking for username:', normalizedUsername);
        console.log('📋 Available users in league:', users.map(u => ({
            username: u.username,
            display_name: u.display_name,
            user_id: u.user_id
        })));
        // Try to find user by username or display_name
        const user = users.find(u => {
            const usernameMatch = u.username && u.username.toLowerCase().trim() === normalizedUsername;
            const displayMatch = u.display_name && u.display_name.toLowerCase().trim() === normalizedUsername;
            
            if (usernameMatch) {
                console.log('✅ Found by username:', u.username);
                return true;
            }
            if (displayMatch) {
                console.log('✅ Found by display name:', u.display_name);
                return true;
            }
            return false;
        });
        
        if (!user) {
            console.log('❌ No user found with username/display name:', normalizedUsername);
            console.log('💡 Available options:', users.map(u => u.username || u.display_name).join(', '));
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
            roster_id: roster.roster_id 
        });
        return { roster, user };
    }

    // Enhanced team selection interface
    // Replace this method in your ConfigManager class in app.js
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
            // Create team options - FIX: Match owner_id to user_id properly
            const teamsHtml = rosters.map((roster, index) => {
                // Find user by matching roster.owner_id to user.user_id
                const owner = users.find(u => u.user_id === roster.owner_id);
                const wins = roster.settings?.wins || 0;
                const losses = roster.settings?.losses || 0;
                const points = Math.round(roster.settings?.fpts || 0);
                const record = `${wins}-${losses}`;
                
                // Get team name from metadata or use display name
                const teamName = owner?.metadata?.team_name || `Team ${index + 1}`;
                const displayName = owner?.display_name || `User ${index + 1}`;
                
                console.log(`Team ${index + 1}:`, { 
                    teamName, 
                    displayName, 
                    record, 
                    points, 
                    roster_owner_id: roster.owner_id,
                    found_owner: !!owner,
                    owner_user_id: owner?.user_id
                });
                
                return `
                    <div class="team-option" onclick="selectSleeperTeam(${index})" data-team-index="${index}">
                        <div class="team-header">
                            <div class="team-name">${teamName}</div>
                            <div class="team-username">${displayName}</div>
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
                        <small>💡 Look for your team name or display name. This is a pre-draft league.</small>
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

    // Enhanced team data application
    applyTeamData(teamData) {
        const { roster, user } = teamData;
        
        // Update config with team data
        this.config.teamName = user.display_name || user.username || 'My Team';
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
        
        // Show confirmation
        const statusDiv = document.getElementById('sleeperStatus');
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
            this.safeSetInputValue('sleeperUsername', this.config.sleeperUsername || '');

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

// Navigation System
class NavigationManager {
    constructor() {
        this.currentPage = 'dashboard';
        this.setupNavigation();
        this.setupMobileToggle();
    }

    setupNavigation() {
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.getAttribute('data-page');
                this.navigateToPage(page);
            });
        });
    }

    navigateToPage(page) {
        // Update active nav link
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelector(`[data-page="${page}"]`).classList.add('active');

        // Show/hide page content
        document.querySelectorAll('.page-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(page).classList.add('active');

        this.currentPage = page;

        // Close mobile menu if open
        document.getElementById('sidebar').classList.remove('mobile-visible');
    }

    setupMobileToggle() {
        const mobileToggle = document.getElementById('mobileToggle');
        const sidebar = document.getElementById('sidebar');

        mobileToggle.addEventListener('click', () => {
            sidebar.classList.toggle('mobile-visible');
        });

        // Close mobile menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!sidebar.contains(e.target) && !mobileToggle.contains(e.target)) {
                sidebar.classList.remove('mobile-visible');
            }
        });
    }
}

// Learning Progress System
class LearningManager {
    constructor() {
        this.conceptsLearned = parseInt(localStorage.getItem('conceptsLearned') || '0');
        this.totalConcepts = 25;
        this.updateProgress();
    }

    updateProgress() {
        document.getElementById('conceptsLearned').textContent = this.conceptsLearned;
        const percentage = (this.conceptsLearned / this.totalConcepts) * 100;
        document.getElementById('progressFill').style.width = `${percentage}%`;
        
        // Update compact progress indicators
        for (let i = 1; i <= 5; i++) {
            const compactElement = document.getElementById(`compactConceptsLearned${i}`);
            const compactFill = document.getElementById(`compactProgressFill${i}`);
            if (compactElement) {
                compactElement.textContent = this.conceptsLearned;
            }
            if (compactFill) {
                compactFill.style.width = `${percentage}%`;
            }
        }
        
        const mainCompactElement = document.getElementById('compactConceptsLearned');
        const mainCompactFill = document.getElementById('compactProgressFill');
        if (mainCompactElement) {
            mainCompactElement.textContent = this.conceptsLearned;
        }
        if (mainCompactFill) {
            mainCompactFill.style.width = `${percentage}%`;
        }
    }

    learnConcept() {
        if (this.conceptsLearned < this.totalConcepts) {
            this.conceptsLearned++;
            localStorage.setItem('conceptsLearned', this.conceptsLearned.toString());
            this.updateProgress();
            
            // Show achievement notification
            configManager.showNotification(`New concept learned! Progress: ${this.conceptsLearned}/${this.totalConcepts}`, 'success');
        }
    }
}

// Initialize app components
let configManager, navigationManager, learningManager;

document.addEventListener('DOMContentLoaded', function() {
    configManager = new ConfigManager();
    navigationManager = new NavigationManager();
    learningManager = new LearningManager();
});

// Global function for team selection (add this after the class definitions)
function selectSleeperTeam(teamIndex) {
    if (!window.sleeperRosters || !window.sleeperUsers) return;
    
    // Remove previous selections
    document.querySelectorAll('.team-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    // Mark selected team
    document.querySelector(`[data-team-index="${teamIndex}"]`).classList.add('selected');
    
    // Apply team data
    const roster = window.sleeperRosters[teamIndex];
    const user = window.sleeperUsers.find(u => u.user_id === roster.owner_id);
    
    configManager.applyTeamData({ roster, user });
    configManager.showNotification('🎯 Team selected! Your info has been auto-filled.', 'success');
}

// Global Functions
function showConfiguration() {
    if (!configManager) return;
    configManager.populateConfigForm();
    document.getElementById('configPanel').classList.remove('hidden');
}

// Global function for team selection
function selectSleeperTeam(teamIndex) {
    if (!window.sleeperRosters || !window.sleeperUsers) return;
    
    // Remove previous selections
    document.querySelectorAll('.team-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    // Mark selected team
    document.querySelector(`[data-team-index="${teamIndex}"]`).classList.add('selected');
    
    // Apply team data
    const roster = window.sleeperRosters[teamIndex];
    const user = window.sleeperUsers.find(u => u.user_id === roster.owner_id);
    
    configManager.applyTeamData({ roster, user });
    configManager.showNotification('🎯 Team selected! Your info has been auto-filled.', 'success');
}

async function fetchSleeperData() {
    const sleeperLeagueId = document.getElementById('sleeperLeagueId').value.trim();
    const sleeperUsername = document.getElementById('sleeperUserName').value.trim(); // Fixed: was sleeperUsername
    const statusDiv = document.getElementById('sleeperStatus');
    const fetchBtn = document.getElementById('fetchSleeperBtn');
    
    if (!sleeperLeagueId) {
        statusDiv.style.display = 'block';
        statusDiv.style.background = 'rgba(231, 76, 60, 0.1)';
        statusDiv.style.border = '1px solid var(--danger-color)';
        statusDiv.style.color = 'var(--danger-color)';
        statusDiv.innerHTML = '❌ Please enter a Sleeper League ID first';
        return;
    }
    
    // Show loading state
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<span>⏳</span> Fetching data...';
    statusDiv.style.display = 'block';
    statusDiv.style.background = 'rgba(69, 183, 209, 0.1)';
    statusDiv.style.border = '1px solid var(--accent-color)';
    statusDiv.style.color = 'var(--accent-color)';
    statusDiv.innerHTML = '🔗 Connecting to Sleeper...';
    
    try {
        // Temporarily update config with league ID and username
        configManager.config.sleeperLeagueId = sleeperLeagueId;
        if (sleeperUsername) {
            configManager.config.sleeperUsername = sleeperUsername;
        }
        
        // Attempt to load from Sleeper
        const success = await configManager.loadFromSleeper();
        
        if (success) {
            // Auto-fill the form with fetched data
            document.getElementById('leagueName').value = configManager.config.leagueName;
            document.getElementById('teamName').value = configManager.config.teamName;
            document.getElementById('leagueSize').value = configManager.config.leagueSize;
            document.getElementById('scoringFormat').value = configManager.config.scoringFormat;
            
            // Show success message based on whether team was auto-detected
            let successMessage = '✅ Successfully loaded league data!<br>';
            successMessage += `<small>League: ${configManager.config.leagueName}<br>`;
            
            if (configManager.config.teamName && sleeperUsername) {
                successMessage += `Team: ${configManager.config.teamName} (auto-detected)<br>`;
            } else if (!sleeperUsername) {
                successMessage += 'Please select your team from the list below<br>';
            } else {
                successMessage += `Username "${sleeperUsername}" not found - please select manually<br>`;
            }
            
            successMessage += `Format: ${configManager.config.scoringFormat}</small>`;
            
            statusDiv.style.background = 'rgba(46, 204, 113, 0.1)';
            statusDiv.style.border = '1px solid var(--success-color)';
            statusDiv.style.color = 'var(--success-color)';
            statusDiv.innerHTML = successMessage;
            
            // Enable auto-save button
            const saveBtn = document.querySelector('.btn-primary');
            if (configManager.config.teamName) {
                saveBtn.innerHTML = '<span>🚀</span> Save Auto-Loaded Data';
                saveBtn.style.background = 'linear-gradient(45deg, var(--success-color), var(--primary-color))';
            } else {
                saveBtn.innerHTML = '<span>💾</span> Save League Data';
            }
            
        } else {
            // Show error message
            statusDiv.style.background = 'rgba(231, 76, 60, 0.1)';
            statusDiv.style.border = '1px solid var(--danger-color)';
            statusDiv.style.color = 'var(--danger-color)';
            statusDiv.innerHTML = '❌ Could not find league. Please check your League ID and try again.';
        }
        
    } catch (error) {
        console.error('Error fetching Sleeper data:', error);
        statusDiv.style.background = 'rgba(231, 76, 60, 0.1)';
        statusDiv.style.border = '1px solid var(--danger-color)';
        statusDiv.style.color = 'var(--danger-color)';
        statusDiv.innerHTML = '❌ Error connecting to Sleeper. Please try again or fill manually.';
    } finally {
        // Reset button state
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = '<span>🔗</span> Auto-Fill All Fields from Sleeper';
    }
}

function saveConfiguration() {
    if (!configManager) return;
    
    const newConfig = {
        leagueName: document.getElementById('leagueName').value.trim() || '',
        teamName: document.getElementById('teamName').value.trim() || '',
        leagueSize: parseInt(document.getElementById('leagueSize').value),
        scoringFormat: document.getElementById('scoringFormat').value,
        sleeperLeagueId: document.getElementById('sleeperLeagueId').value.trim() || ''
    };

    configManager.saveConfiguration(newConfig);
    document.getElementById('configPanel').classList.add('hidden');
}

function skipConfiguration() {
    if (!configManager) return;
    document.getElementById('configPanel').classList.add('hidden');
    configManager.showNotification('You can configure your league anytime using the settings button!', 'info');
}

function connectSleeper() {
    if (!configManager) return;
    configManager.showNotification('Configure your Sleeper League ID in settings to enable live features!', 'info');
}

function generateInsights() {
    if (!configManager) return;
    configManager.showNotification('AI insights will be available after you configure your league and draft your team!', 'info');
}

function startLearningModule() {
    if (!configManager) return;
    configManager.showNotification('🎓 Welcome to Fantasy Academy! Start with the basics and work your way up.', 'success');
}

function completeModule() {
    if (!learningManager) return;
    learningManager.learnConcept();
    configManager.showNotification('📚 Great job! You\'ve completed a learning module!', 'success');
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Alt + C for configuration
    if (e.altKey && e.key === 'c') {
        e.preventDefault();
        showConfiguration();
    }
    
    // Alt + 1-5 for navigation
    if (e.altKey && e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        const pages = ['dashboard', 'live-draft', 'my-team', 'ai-insights', 'fantasy-academy'];
        const pageIndex = parseInt(e.key) - 1;
        if (pages[pageIndex] && navigationManager) {
            navigationManager.navigateToPage(pages[pageIndex]);
        }
    }
    
    // Escape to close modals
    if (e.key === 'Escape') {
        document.getElementById('configPanel').classList.add('hidden');
    }
});

// Console welcome message
console.log('%c🏈 Fantasy Football Command Center - Clean Version', 'color: #4ecdc4; font-size: 18px; font-weight: bold;');
console.log('%cWelcome! Configure your league to get started with personalized insights.', 'color: #45b7d1; font-size: 14px;');
console.log('%cKeyboard shortcuts: Alt+C (Config), Alt+1-5 (Navigation)', 'color: #999; font-size: 12px;');