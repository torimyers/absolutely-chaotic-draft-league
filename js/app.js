// Fantasy Football App - Main Application Entry Point (Refactored with EventManager)

// Application managers
let configManager, navigationManager, learningManager, draftTracker, eventManager;

// Initialize app components
document.addEventListener('DOMContentLoaded', function() {
    console.log('🏈 Fantasy Football Command Center - Event-Driven Architecture');
    
    // Initialize core systems first
    try {
        configManager = new ConfigManager();
        navigationManager = new NavigationManager();
        learningManager = new LearningManager();
        
        console.log('✅ Core systems initialized');
        
        // Initialize features after core is ready
        setTimeout(() => {
            try {
                draftTracker = new DraftTracker(configManager);
                console.log('✅ Draft tracker initialized');
                
                // Initialize EventManager last - it needs all other managers
                eventManager = new EventManager(
                    configManager, 
                    navigationManager, 
                    learningManager, 
                    draftTracker
                );
                
                console.log('🎯 EventManager initialized - all event handlers active');
                console.log('🏈 All systems ready! App fully functional.');
                
                // Log event system status for debugging
                console.log('📊 Event System Status:', eventManager.getEventStatus());
                
                // Make managers globally available for debugging
                window.configManager = configManager;
                window.navigationManager = navigationManager;
                window.learningManager = learningManager;
                window.draftTracker = draftTracker;
                window.eventManager = eventManager;
                
            } catch (error) {
                console.error('❌ Error initializing features:', error);
                showFallbackNotification('⚠️ Some features may not work correctly. Please refresh the page.', 'warning');
            }
        }, 750);
        
    } catch (error) {
        console.error('❌ Critical error initializing core systems:', error);
        showFallbackNotification('❌ App initialization failed. Please refresh the page.', 'error');
    }
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
        eventManager: !!eventManager,
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