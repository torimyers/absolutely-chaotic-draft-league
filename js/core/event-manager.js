/**
 * EventManager - Modern Event Delegation System
 * Replaces global onclick handlers with data-action attributes
 * 
 * Usage: new EventManager(configManager, navigationManager, learningManager, draftTracker)
 */
class EventManager {
    constructor(configManager, navigationManager, learningManager, draftTracker) {
        this.configManager = configManager;
        this.navigationManager = navigationManager;
        this.learningManager = learningManager;
        this.draftTracker = draftTracker;
        
        // Store global data references for Sleeper integration
        this.sleeperRosters = null;
        this.sleeperUsers = null;
        
        this.initialize();
    }

    initialize() {
        this.setupEventDelegation();
        this.setupKeyboardShortcuts();
        this.setupFormSubmissions();
        console.log('🎯 EventManager initialized - all event handlers ready');
    }

    /**
     * Main event delegation - handles all click events with data-action attributes
     */
    // Replace your setupEventDelegation method in event-manager.js with this:

    setupEventDelegation() {
        document.addEventListener('click', (e) => {
            // FIXED: Walk up the DOM tree to find data-action (not just check e.target)
            let actionElement = e.target;
            let action = null;
            
            // Walk up the DOM tree to find an element with data-action
            while (actionElement && actionElement !== document) {
                action = actionElement.getAttribute('data-action');
                if (action) break;
                actionElement = actionElement.parentElement;
            }
            
            const form = e.target.closest('form');
            
            // Handle form submissions with data-action
            if (form && action) {
                e.preventDefault();
            }
            
            if (!action) return;
            
            e.preventDefault();
            this.handleAction(action, actionElement, e); // Use actionElement, not e.target
        });

        // Handle form submissions separately for better UX
        document.addEventListener('submit', (e) => {
            const action = e.target.getAttribute('data-action');
            if (action) {
                e.preventDefault();
                this.handleAction(action, e.target, e);
            }
        });
        
        console.log('🎯 Enhanced event delegation setup complete - will catch dynamic content');
    }

    /**
     * Central action dispatcher - routes all data-action events
     */
    handleAction(action, element, event) {
        try {
            console.log(`🎯 EventManager: Handling action "${action}"`);
            
            switch (action) {
                // Configuration Actions
                case 'show-configuration':
                    this.showConfiguration();
                    break;
                case 'save-configuration':
                    this.saveConfiguration();
                    break;
                case 'skip-configuration':
                    this.skipConfiguration();
                    break;
                case 'fetch-sleeper-data':
                    this.fetchSleeperData();
                    break;
                case 'reset-configuration':
                    this.resetConfiguration();
                    break;

                // Navigation Actions
                case 'navigate-to-page':
                    const page = element.getAttribute('data-page');
                    this.navigateToPage(page);
                    break;
                case 'close-modal':
                    this.closeModal(element);
                    break;

                // Sleeper Integration Actions
                case 'connect-sleeper':
                    this.connectSleeper();
                    break;
                case 'select-sleeper-team':
                    const teamIndex = element.getAttribute('data-team-index');
                    this.selectSleeperTeam(parseInt(teamIndex));
                    break;

                // Draft Tracker Actions
                case 'start-draft-tracking':
                    this.startDraftTracking();
                    break;
                case 'stop-draft-tracking':
                    this.stopDraftTracking();
                    break;
                case 'activate-panic-mode':
                    this.activatePanicMode();
                    break;
                case 'deactivate-panic-mode':
                    this.deactivatePanicMode();
                    break;

                // Learning Actions
                case 'start-learning-module':
                    this.startLearningModule();
                    break;
                case 'complete-module':
                    this.completeModule();
                    break;
                case 'learn-concept':
                    const concept = element.getAttribute('data-concept');
                    this.learnConcept(concept);
                    break;

                // AI Insights Actions
                case 'generate-insights':
                    this.handleStreakAnalysis();
                    break;
                case 'run-streak-demo':
                    this.runStreakDemo();
                    break;

                // Mobile Actions
                case 'toggle-mobile-menu':
                    this.toggleMobileMenu();
                    break;

                default:
                    console.warn(`🚨 EventManager: Unknown action "${action}"`);
                    this.showNotification(`Unknown action: ${action}`, 'warning');
            }
        } catch (error) {
            console.error(`❌ EventManager: Error handling action "${action}":`, error);
            this.showNotification(`Error: ${error.message}`, 'error');
        }
    }

    // ======================
    // CONFIGURATION ACTIONS
    // ======================

    showConfiguration() {
        if (!this.configManager) {
            this.showNotification('❌ Configuration system not available', 'error');
            return;
        }
        
        this.configManager.populateConfigForm();
        const configPanel = document.getElementById('configPanel');
        if (configPanel) {
            configPanel.classList.remove('hidden');
        }
    }

    // Fixed saveConfiguration method in EventManager to handle username properly
    saveConfiguration() {
        if (!this.configManager) {
            this.showNotification('❌ Configuration system not available', 'error');
            return;
        }

        // Gather form data
        const formData = {
            leagueName: this.getInputValue('leagueName'),
            teamName: this.getInputValue('teamName'),
            leagueSize: parseInt(this.getInputValue('leagueSize')) || 12,
            scoringFormat: this.getInputValue('scoringFormat'),
            sleeperLeagueId: this.getInputValue('sleeperLeagueId'),
            // FIX: Get the correct input field name (sleeperUserName in HTML)
            sleeperUsername: this.getInputValue('sleeperUserName') || this.getInputValue('sleeperUsername')
        };

        console.log('💾 Saving configuration:', formData);

        // Save configuration
        const success = this.configManager.saveConfiguration(formData);
        
        if (success) {
            // Close configuration panel after successful save
            setTimeout(() => {
                const configPanel = document.getElementById('configPanel');
                if (configPanel) {
                    configPanel.classList.add('hidden');
                }
            }, 1500);
        }
    }

    skipConfiguration() {
        const configPanel = document.getElementById('configPanel');
        if (configPanel) {
            configPanel.classList.add('hidden');
        }
        this.showNotification('⏭️ Configuration skipped - you can configure later', 'info');
    }

    resetConfiguration() {
        if (!this.configManager) {
            this.showNotification('❌ Configuration system not available', 'error');
            return;
        }

        this.configManager.resetConfiguration();
    }

    // ======================
    // NAVIGATION ACTIONS
    // ======================

    navigateToPage(page) {
        if (!this.navigationManager) {
            this.showNotification('❌ Navigation system not available', 'error');
            return;
        }

        if (!page) {
            console.warn('🚨 No page specified for navigation');
            return;
        }

        this.navigationManager.navigateToPage(page);
    }

    closeModal(element) {
        const modal = element.closest('.config-panel, .modal, [data-modal]');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    toggleMobileMenu() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.classList.toggle('mobile-visible');
        }
    }

    // ======================
    // SLEEPER INTEGRATION
    // ======================

    connectSleeper() {
        // First check if we have Sleeper League ID configured
        const sleeperLeagueId = this.configManager?.config?.sleeperLeagueId;
        
        if (!sleeperLeagueId) {
            this.showNotification('❌ Please configure your Sleeper League ID first', 'warning');
            this.showConfiguration();
            return;
        }

        // If we have the ID, fetch the data
        this.fetchSleeperData();
    }

    // Fixed selectSleeperTeam method in EventManager
    selectSleeperTeam(teamIndex) {
        console.log('🎯 selectSleeperTeam called with index:', teamIndex);
    
        // INSTANT VISUAL FEEDBACK - Add this first, before any data processing
        const clickedElement = document.querySelector(`[data-team-index="${teamIndex}"]`);
        if (clickedElement) {
            // Clear all previous selections immediately
            document.querySelectorAll('.team-option').forEach(option => {
                option.classList.remove('selected');
                option.style.background = '';
                option.style.border = '';
                option.style.boxShadow = '';
            });
            
            // Apply immediate selection styling
            clickedElement.classList.add('selected');
            clickedElement.style.background = 'linear-gradient(135deg, rgba(46, 204, 113, 0.1), rgba(46, 204, 113, 0.05))';
            clickedElement.style.border = '2px solid #2ecc71';
            clickedElement.style.boxShadow = '0 4px 12px rgba(46, 204, 113, 0.3)';
            
            // Add a subtle "click" animation
            clickedElement.style.transform = 'scale(0.98)';
            setTimeout(() => {
                clickedElement.style.transform = 'scale(1.02)';
                setTimeout(() => {
                    clickedElement.style.transform = '';
                }, 150);
            }, 50);
            
            // Update the team name in the option to show it's confirmed
            const teamNameElement = clickedElement.querySelector('.team-name');
            if (teamNameElement) {
                teamNameElement.style.color = '#2ecc71';
                teamNameElement.style.fontWeight = 'bold';
            }
        }
        
        // Show immediate success notification
        this.showNotification('✅ Team selected! Applying configuration...', 'success', 3000);
        
        // Continue with your existing logic...
        let rosters = this.sleeperRosters || window.sleeperRosters;
        let users = this.sleeperUsers || window.sleeperUsers;
        
        console.log('📊 Available data:', { 
            rosters: rosters?.length, 
            users: users?.length, 
            teamIndex 
        });
        
        if (!rosters || !users || teamIndex === undefined) {
            console.error('❌ Sleeper data not available or invalid team index:', {
                rosters: !!rosters,
                users: !!users,
                teamIndex
            });
            this.showNotification('❌ Team selection data not available', 'error');
            return;
        }

        try {
            // Remove previous selections
            document.querySelectorAll('.team-option').forEach(option => {
                option.classList.remove('selected');
            });

            // Mark selected team
            const selectedElement = document.querySelector(`[data-team-index="${teamIndex}"]`);
            if (selectedElement) {
                selectedElement.classList.add('selected');
                console.log('✅ Marked team option as selected');
            }

            // Get roster and user data
            const roster = rosters[teamIndex];
            const user = users.find(u => u.user_id === roster.owner_id);
            
            console.log('🔍 Selected team data:', {
                roster: roster?.roster_id,
                user: user?.display_name,
                teamName: user?.metadata?.team_name
            });

            // Add this to the end of your selectSleeperTeam method in EventManager
            // After the line: this.configManager.applyTeamData({ roster, user });

            if (roster && user && this.configManager) {
                // Apply team data
                this.configManager.applyTeamData({ roster, user });
                
                // *** ADD THIS: Auto-save the configuration ***
                const currentConfig = this.configManager.config;
                const success = this.configManager.saveConfiguration(currentConfig);
                
                if (success) {
                    this.showNotification('🎯 Team selected and saved!', 'success');
                    
                    // Close configuration panel automatically after 2 seconds
                    setTimeout(() => {
                        const configPanel = document.getElementById('configPanel');
                        if (configPanel) {
                            configPanel.classList.add('hidden');
                        }
                    }, 2000);
                } else {
                    this.showNotification('⚠️ Team selected but not saved. Please click "Start Using App"', 'warning');
                }
                
            } else {
                console.error('❌ Missing roster, user, or configManager:', {
                    roster: !!roster,
                    user: !!user,
                    configManager: !!this.configManager
                });
                this.showNotification('❌ Error applying team data', 'error');
            }
        } catch (error) {
            console.error('❌ Error selecting Sleeper team:', error);
            this.showNotification('❌ Error selecting team. Please try again.', 'error');
        }
    }

    // Also fix the fetchSleeperData method to properly store references
    async fetchSleeperData() {
        if (!this.configManager) {
            this.showNotification('❌ Configuration system not available', 'error');
            return;
        }

        const fetchBtn = document.getElementById('fetchSleeperBtn');
        if (fetchBtn) {
            fetchBtn.disabled = true;
            fetchBtn.innerHTML = '<span>⏳</span> Loading...';
        }

        try {
            const success = await this.configManager.loadFromSleeper();
            
            if (success) {
                // FIX: Store references in EventManager for team selection
                this.sleeperRosters = window.sleeperRosters;
                this.sleeperUsers = window.sleeperUsers;
                
                console.log('✅ EventManager now has Sleeper data:', {
                    rosters: this.sleeperRosters?.length,
                    users: this.sleeperUsers?.length
                });
            }
        } catch (error) {
            console.error('Error fetching Sleeper data:', error);
            this.showNotification('❌ Error loading Sleeper data', 'error');
        } finally {
            if (fetchBtn) {
                fetchBtn.disabled = false;
                fetchBtn.innerHTML = '<span>🔗</span> Auto-Fill All Fields from Sleeper';
            }
        }
    }

    // ======================
    // DRAFT TRACKER ACTIONS
    // ======================

    async startDraftTracking() {
        if (!this.draftTracker) {
            this.showNotification('❌ Draft tracker not available', 'error');
            return;
        }

        const startBtn = document.getElementById('startDraftBtn');
        const stopBtn = document.getElementById('stopDraftBtn');

        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;

        try {
            await this.draftTracker.startDraftTracking();
        } catch (error) {
            console.error('❌ Error starting draft tracking:', error);
            if (startBtn) startBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
        }
    }

    stopDraftTracking() {
        if (!this.draftTracker) {
            this.showNotification('❌ Draft tracker not available', 'error');
            return;
        }

        this.draftTracker.stopPolling();
        
        const startBtn = document.getElementById('startDraftBtn');
        const stopBtn = document.getElementById('stopDraftBtn');

        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;

        this.showNotification('⏹️ Draft tracking stopped', 'info');
    }

    activatePanicMode() {
        if (!this.draftTracker) {
            this.showNotification('❌ Draft tracker not available', 'error');
            return;
        }

        this.draftTracker.activatePanicMode();
    }

    deactivatePanicMode() {
        if (!this.draftTracker) {
            this.showNotification('❌ Draft tracker not available', 'error');
            return;
        }

        this.draftTracker.deactivatePanicMode();
    }

    // ======================
    // LEARNING ACTIONS
    // ======================

    startLearningModule() {
        if (!this.learningManager) {
            this.showNotification('❌ Learning system not available', 'error');
            return;
        }

        // For now, just increment progress as a demo
        this.learningManager.learnConcept();
        this.showNotification('🎓 Learning module started! Keep going to master fantasy concepts.', 'success');
    }

    completeModule() {
        if (!this.learningManager) {
            this.showNotification('❌ Learning system not available', 'error');
            return;
        }

        this.learningManager.learnConcept();
        this.showNotification('✅ Module completed! You\'re becoming a fantasy expert.', 'success');
    }

    learnConcept(concept) {
        if (!this.learningManager) {
            this.showNotification('❌ Learning system not available', 'error');
            return;
        }

        this.learningManager.learnConcept();
        
        if (concept) {
            this.showNotification(`🧠 Learned about: ${concept}`, 'success');
        }
    }

    // ======================
    // AI INSIGHTS ACTIONS
    // ======================

    generateInsights() {
        // For now, show a demo message about AI features
        const insights = [
            '🔥 Hot Streak Alert: Christian McCaffrey averaging 22+ points over last 3 games',
            '🌦️ Weather Impact: 15+ MPH winds in Buffalo could reduce passing efficiency by 12%',
            '📈 Breakout Prediction: 87% confidence Calvin Ridley bounces back this week',
            '⚠️ Position Scarcity: Elite RBs disappearing fast - consider handcuffs',
            '🎯 Matchup Advantage: Your WRs vs weak secondary = 15% scoring boost'
        ];

        const randomInsight = insights[Math.floor(Math.random() * insights.length)];
        this.showNotification(randomInsight, 'success', 6000);

        // Also show educational tip
        setTimeout(() => {
            this.showNotification('💡 AI Insights will be fully available after configuring your league and connecting Sleeper', 'info', 5000);
        }, 2000);
    }

    handleStreakAnalysis() {
        try {
            // Initialize streak analysis UI if not already done
            if (!this.streakAnalysisUI) {
                this.streakAnalysisUI = new StreakAnalysisUI('streak-analysis-container');
            }

            // Show loading state
            this.showStreakLoading();

            // For demo purposes, use sample data
            // In production, this would fetch real player data
            const sampleData = StreakAnalysisDemo.getSampleData();
            
            // Render the analysis
            this.streakAnalysisUI.renderStreakAnalysis(sampleData);
            
            // Hide empty state
            const emptyState = document.getElementById('streak-empty-state');
            if (emptyState) {
                emptyState.style.display = 'none';
            }

            this.showNotification('🔥 Streak analysis generated! Educational insights included.', 'success');
            
        } catch (error) {
            console.error('Error generating streak analysis:', error);
            this.showNotification('❌ Error generating streak analysis. Please try again.', 'error');
        }
    }

    runStreakDemo() {
        // Switch to streak analysis tab if not already active
        this.switchToTab('streak-analysis');
        
        // Run the streak analysis
        this.handleStreakAnalysis();
        
        // Show educational notification
        setTimeout(() => {
            this.showNotification(
                '📚 Demo shows how AI detects performance patterns and explains WHY they matter for fantasy decisions.',
                'info',
                6000
            );
        }, 1000);
    }

    showStreakLoading() {
        const container = document.getElementById('streak-analysis-container');
        if (container) {
            container.innerHTML = `
                <div class="streak-loading">
                    <div class="streak-loading-spinner"></div>
                    Analyzing player performance trends...
                </div>
            `;
        }
    }

    switchToTab(tabName) {
        // Remove active class from all tabs and content
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        
        // Add active class to selected tab and content
        const tabBtn = document.querySelector(`[data-tab="${tabName}"]`);
        const tabContent = document.getElementById(`${tabName}-tab`);
        
        if (tabBtn) tabBtn.classList.add('active');
        if (tabContent) tabContent.classList.add('active');
    }

    // Add to your existing setupEventListeners method:
    setupTabNavigation() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabName = e.target.dataset.tab;
                this.switchToTab(tabName);
            });
        });
    }

    // ======================
    // KEYBOARD SHORTCUTS
    // ======================

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Only handle shortcuts when not typing in inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                return;
            }

            const key = e.key.toLowerCase();
            const altPressed = e.altKey;
            const ctrlPressed = e.ctrlKey;

            // Alt + C: Show Configuration
            if (altPressed && key === 'c') {
                e.preventDefault();
                this.showConfiguration();
                return;
            }

            // Alt + 1-5: Navigate to pages
            if (altPressed && key >= '1' && key <= '5') {
                e.preventDefault();
                const pages = ['dashboard', 'live-draft', 'my-team', 'ai-insights', 'fantasy-academy'];
                const pageIndex = parseInt(key) - 1;
                if (pages[pageIndex]) {
                    this.navigateToPage(pages[pageIndex]);
                }
                return;
            }

            // Escape: Close modals
            if (key === 'escape') {
                const configPanel = document.getElementById('configPanel');
                if (configPanel && !configPanel.classList.contains('hidden')) {
                    configPanel.classList.add('hidden');
                }
                
                const sidebar = document.getElementById('sidebar');
                if (sidebar && sidebar.classList.contains('mobile-visible')) {
                    sidebar.classList.remove('mobile-visible');
                }
                return;
            }

            // Space: Activate panic mode (when draft tracking)
            if (key === ' ' && this.draftTracker && this.draftTracker.isTracking) {
                e.preventDefault();
                this.activatePanicMode();
                return;
            }
        });

        console.log('⌨️ Keyboard shortcuts activated: Alt+C (Config), Alt+1-5 (Navigation), Space (Panic Mode), Esc (Close)');
    }

    // ======================
    // FORM HANDLING
    // ======================

    setupFormSubmissions() {
        // Handle Enter key in configuration form
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.closest('.config-panel')) {
                const configPanel = document.getElementById('configPanel');
                if (configPanel && !configPanel.classList.contains('hidden')) {
                    e.preventDefault();
                    this.saveConfiguration();
                }
            }
        });
    }

    // ======================
    // UTILITY METHODS
    // ======================

    getInputValue(elementId) {
        const element = document.getElementById(elementId);
        return element ? element.value.trim() : '';
    }

    showNotification(message, type = 'info', duration = 4000) {
        if (this.configManager && this.configManager.showNotification) {
            this.configManager.showNotification(message, type, duration);
        } else {
            // Fallback notification system
            console.log(`${type.toUpperCase()}: ${message}`);
            
            // Create simple notification if config manager isn't available
            const notification = document.createElement('div');
            notification.className = `notification notification-${type}`;
            notification.textContent = message;
            notification.style.cssText = `
                position: fixed; top: 20px; right: 20px; z-index: 9999;
                padding: 15px 20px; border-radius: 8px; color: white;
                background: ${type === 'error' ? '#e74c3c' : type === 'warning' ? '#f39c12' : type === 'success' ? '#2ecc71' : '#3498db'};
                cursor: pointer;
            `;
            
            notification.addEventListener('click', () => notification.remove());
            document.body.appendChild(notification);
            
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, duration);
        }
    }

    // ======================
    // DEBUG & MAINTENANCE
    // ======================

    getEventStatus() {
        return {
            configManager: !!this.configManager,
            navigationManager: !!this.navigationManager,
            learningManager: !!this.learningManager,
            draftTracker: !!this.draftTracker,
            sleeperDataAvailable: !!(this.sleeperRosters && this.sleeperUsers),
            totalEventListeners: 3 // click, keydown, submit
        };
    }

    destroy() {
        // Clean up event listeners if needed
        console.log('🧹 EventManager destroyed');
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EventManager;
}