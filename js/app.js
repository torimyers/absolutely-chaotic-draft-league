// Fantasy Football App - Main Application Entry Point (Refactored with EventManager)

// Application managers
let configManager, navigationManager, learningManager, draftTracker, eventManager, teamManager, waiverWireManager, performanceAnalytics, leagueAnalyzer, tradeAnalyzer, playoffSimulator, weatherAnalyzer, predictiveAnalytics, profileSync;

/** Human-readable names of anything that failed to start, for the warning. */
const failedManagers = [];

/**
 * Starts one manager in isolation and publishes it on `window`.
 *
 * Every manager used to be built inside a single try block, so the first one to
 * throw skipped all the rest - and EventManager, built last and owning every
 * click handler on the page, was the usual casualty. One unexpected API shape
 * could leave the entire UI inert while the console claimed only that "some
 * features may not work correctly". Each manager now fails on its own.
 *
 * @param {string} name  Global to publish under, and the label used in logs.
 * @param {string} label What to call this in a message to the user.
 * @param {() => any} start Builds the manager. May be async.
 * @returns {Promise<any|null>} The manager, or null if it could not start.
 */
async function startManager(name, label, start) {
    try {
        const manager = await start();
        window[name] = manager;
        console.log(`✅ ${name} ready`);
        return manager;
    } catch (error) {
        console.error(`❌ ${name} failed to start:`, error);
        failedManagers.push(label);
        return null;
    }
}

// Initialize app components
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🏈 Fantasy Football Command Center - Event-Driven Architecture');

    // ConfigManager is the one hard dependency: every other manager is
    // constructed with it, so there is nothing to degrade to if it fails.
    try {
        configManager = new ConfigManager();
        window.configManager = configManager;
    } catch (error) {
        console.error('❌ Critical error initializing configuration:', error);
        showFallbackNotification('❌ App initialization failed. Please refresh the page.', 'error');
        return;
    }

    navigationManager = await startManager('navigationManager', 'Navigation', () => new NavigationManager());
    learningManager = await startManager('learningManager', 'Fantasy Academy', () => new LearningManager());

    // Sync is optional and must never block startup: the local setup is the
    // source of truth, so the pull happens in the background and a failure
    // leaves the app exactly as it would have been without it.
    profileSync = await startManager('profileSync', 'Cross-device sync', () => new ProfileSync(configManager));
    if (profileSync) {
        configManager.profileSync = profileSync;
        profileSync.pullOnStartup().catch(error => {
            console.warn('Profile sync unavailable:', error);
        });
    }

    // DraftTracker, then EventManager - both before the feature pass below.
    // EventManager owns every click handler on the page, so until it exists the
    // UI does nothing at all: it has to be the first thing standing, not the
    // last. It null-checks each of its four dependencies, so one that failed
    // above only disables the actions that actually need it.
    draftTracker = await startManager('draftTracker', 'Live draft tracking', () => new DraftTracker(configManager));
    eventManager = await startManager('eventManager', 'Buttons and menus', () => new EventManager(
        configManager,
        navigationManager,
        learningManager,
        draftTracker
    ));

    if (eventManager) {
        console.log('🎯 EventManager initialized - all event handlers active');
        console.log('📊 Event System Status:', eventManager.getEventStatus());
    } else {
        // Nothing on the page responds to a click without it, so say so plainly
        // rather than letting the user wonder why the buttons are dead.
        showFallbackNotification('❌ The page is not responding to clicks. Please refresh.', 'error');
    }

    console.log('✅ Core systems initialized');

    // Features last. None of them is needed for the app to be usable, and each
    // starts in isolation so one failure cannot take the others - or the event
    // handling - down with it.
    setTimeout(async () => {
        teamManager = await startManager('teamManager', 'My Team', () => new TeamManager(configManager));

        waiverWireManager = await startManager('waiverWireManager', 'Waiver wire', async () => {
            const manager = new WaiverWireManager(configManager);
            await manager.initialize();
            return manager;
        });

        performanceAnalytics = await startManager('performanceAnalytics', 'Performance analytics', async () => {
            const manager = new PerformanceAnalytics(configManager);
            await manager.initialize();
            return manager;
        });

        leagueAnalyzer = await startManager('leagueAnalyzer', 'League analysis', async () => {
            const manager = new LeagueAnalyzer(configManager);
            await manager.initialize();
            return manager;
        });

        tradeAnalyzer = await startManager('tradeAnalyzer', 'Trade analyzer', async () => {
            const manager = new TradeAnalyzer(configManager);
            await manager.initialize();
            return manager;
        });

        playoffSimulator = await startManager('playoffSimulator', 'Playoff odds', async () => {
            const manager = new PlayoffSimulator(configManager);
            await manager.initialize();
            return manager;
        });

        weatherAnalyzer = await startManager('weatherAnalyzer', 'Weather', async () => {
            const manager = new WeatherAnalyzer(configManager);
            await manager.initialize();
            return manager;
        });

        predictiveAnalytics = await startManager('predictiveAnalytics', 'Season predictions', async () => {
            const manager = new PredictiveAnalytics(configManager);
            await manager.initialize();
            return manager;
        });

        if (failedManagers.length) {
            console.warn(`⚠️ Started with ${failedManagers.length} part(s) unavailable:`, failedManagers.join(', '));
            // Name what is actually missing. The old message said "some features
            // may not work" no matter how much had failed, which was as true of
            // one broken analyser as it was of the whole UI being dead.
            showFallbackNotification(
                `⚠️ Unavailable right now: ${failedManagers.join(', ')}. Everything else works.`,
                'warning'
            );
        } else {
            console.log('🏈 All systems ready! App fully functional.');
        }
    }, 750);
});

/**
 * Fallback notification system for when EventManager isn't available
 */
function showFallbackNotification(message, type = 'info') {
    console.log(`${type.toUpperCase()}: ${message}`);
    
    // Create simple notification
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 9999;
        padding: 15px 20px; border-radius: 8px; color: white;
        background: ${type === 'error' ? '#e74c3c' : type === 'warning' ? '#f39c12' : '#3498db'};
        cursor: pointer; max-width: 400px; font-size: 14px;
    `;
    notification.textContent = message;
    
    notification.addEventListener('click', () => notification.remove());
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
}

/**
 * Enhanced global error handling
 */
window.addEventListener('error', (event) => {
    console.error('🚨 Global Error:', event.error);
    showFallbackNotification('An unexpected error occurred. Some features may not work correctly.', 'error');
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('🚨 Unhandled Promise Rejection:', event.reason);
    showFallbackNotification('A network or data error occurred. Please check your connection.', 'warning');
});

/**
 * Legacy support functions (for backward compatibility)
 * These will be automatically handled by EventManager, but we keep them for any edge cases
 */

// Configuration functions
function showConfiguration() {
    if (eventManager) {
        eventManager.showConfiguration();
    } else if (configManager) {
        // Direct fallback if EventManager isn't ready
        configManager.populateConfigForm();
        const configPanel = document.getElementById('configPanel');
        if (configPanel) {
            configPanel.classList.remove('hidden');
        }
    } else {
        showFallbackNotification('⏳ App is still loading. Please wait a moment...', 'info');
        // Retry after a short delay
        setTimeout(showConfiguration, 500);
    }
}

function saveConfiguration() {
    console.warn('⚠️ saveConfiguration() called directly - should use EventManager');
    if (eventManager) {
        eventManager.handleAction('save-configuration');
    }
}

function fetchSleeperData() {
    console.warn('⚠️ fetchSleeperData() called directly - should use EventManager');
    if (eventManager) {
        eventManager.handleAction('fetch-sleeper-data');
    }
}

function selectSleeperTeam(teamIndex) {
    console.warn('⚠️ selectSleeperTeam() called directly - should use EventManager');
    if (eventManager) {
        // Create a mock element with the team index
        const mockElement = { getAttribute: () => teamIndex.toString() };
        eventManager.handleAction('select-sleeper-team', mockElement);
    }
}

// Navigation functions
function navigateToPage(page) {
    console.warn('⚠️ navigateToPage() called directly - should use EventManager');
    if (eventManager) {
        const mockElement = { getAttribute: () => page };
        eventManager.handleAction('navigate-to-page', mockElement);
    }
}

// Draft functions
function connectSleeper() {
    console.warn('⚠️ connectSleeper() called directly - should use EventManager');
    if (eventManager) {
        eventManager.handleAction('connect-sleeper');
    }
}

// Learning functions
function startLearningModule() {
    console.warn('⚠️ startLearningModule() called directly - should use EventManager');
    if (eventManager) {
        eventManager.handleAction('start-learning-module');
    }
}

function completeModule() {
    console.warn('⚠️ completeModule() called directly - should use EventManager');
    if (eventManager) {
        eventManager.handleAction('complete-module');
    }
}

// AI functions
function generateInsights() {
    console.warn('⚠️ generateInsights() called directly - should use EventManager');
    if (eventManager) {
        eventManager.handleAction('generate-insights');
    }
}

function skipConfiguration() {
    console.warn('⚠️ skipConfiguration() called directly - should use EventManager');
    if (eventManager) {
        eventManager.handleAction('skip-configuration');
    }
}

/**
 * Development helper functions
 */
function getAppStatus() {
    return {
        configManager: !!configManager,
        navigationManager: !!navigationManager,
        learningManager: !!learningManager,
        draftTracker: !!draftTracker,
        teamManager: !!teamManager,
        waiverWireManager: !!waiverWireManager,
        performanceAnalytics: !!performanceAnalytics,
        leagueAnalyzer: !!leagueAnalyzer,
        tradeAnalyzer: !!tradeAnalyzer,
        playoffSimulator: !!playoffSimulator,
        weatherAnalyzer: !!weatherAnalyzer,
        predictiveAnalytics: !!predictiveAnalytics,
        profileSync: !!profileSync,
        eventManager: !!eventManager,
        failedManagers: [...failedManagers],
        eventSystemStatus: eventManager ? eventManager.getEventStatus() : null,
        configStatus: configManager ? configManager.getConfigStatus() : null
    };
}

// Make status function available in console for debugging
window.getAppStatus = getAppStatus;

/**
 * App performance monitoring
 */
if (window.performance && window.performance.mark) {
    window.performance.mark('app-start');
    
    window.addEventListener('load', () => {
        window.performance.mark('app-loaded');
        if (eventManager) {
            window.performance.mark('app-ready');
            console.log('⚡ App Performance: Fully loaded and interactive');
        }
    });
}

/**
 * Development console messages
 */
console.log('%c🏈 Fantasy Football Command Center', 'color: #4ecdc4; font-size: 18px; font-weight: bold;');
console.log('%cWelcome! Configure your league to get started with personalized insights.', 'color: #45b7d1; font-size: 14px;');
console.log('%cKeyboard shortcuts: Alt+C (Config), Alt+1-5 (Navigation), Space (Panic Mode)', 'color: #999; font-size: 12px;');
console.log('%cEvent System: All interactions now use modern event delegation', 'color: #2ecc71; font-size: 12px;');
console.log('%cType getAppStatus() in console to check system status', 'color: #f39c12; font-size: 12px;');

/**
 * Service Worker registration for PWA support (optional)
 */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('🔧 ServiceWorker registered:', registration.scope);
            })
            .catch(error => {
                console.log('❌ ServiceWorker registration failed:', error);
            });
    });
}

/**
 * App cleanup on page unload
 */
window.addEventListener('beforeunload', () => {
    if (eventManager) {
        eventManager.destroy();
    }
    if (draftTracker) {
        draftTracker.stopPolling();
    }
    console.log('🧹 App cleanup completed');
});