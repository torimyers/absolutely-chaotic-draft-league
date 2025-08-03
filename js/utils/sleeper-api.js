/**
 * Sleeper API Utility Module
 * Centralized API calls for Sleeper Fantasy Football
 */

class SleeperAPI {
    constructor() {
        this.baseURL = 'https://api.sleeper.app/v1';
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Generic API fetch with caching
     */
    async fetchAPI(endpoint, useCache = true) {
        const cacheKey = endpoint;
        
        // Check cache first
        if (useCache && this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                console.log(`=æ Using cached data for: ${endpoint}`);
                return cached.data;
            }
        }

        try {
            const response = await fetch(`${this.baseURL}${endpoint}`);
            
            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            
            // Cache the response
            this.cache.set(cacheKey, {
                data,
                timestamp: Date.now()
            });
            
            return data;
            
        } catch (error) {
            console.error(`L Sleeper API Error for ${endpoint}:`, error);
            throw error;
        }
    }

    /**
     * Get league information
     */
    async getLeague(leagueId) {
        return this.fetchAPI(`/league/${leagueId}`);
    }

    /**
     * Get all rosters in a league
     */
    async getRosters(leagueId) {
        return this.fetchAPI(`/league/${leagueId}/rosters`);
    }

    /**
     * Get all users in a league
     */
    async getUsers(leagueId) {
        return this.fetchAPI(`/league/${leagueId}/users`);
    }

    /**
     * Get all drafts for a league
     */
    async getDrafts(leagueId) {
        return this.fetchAPI(`/league/${leagueId}/drafts`);
    }

    /**
     * Get specific draft information
     */
    async getDraft(draftId) {
        return this.fetchAPI(`/draft/${draftId}`);
    }

    /**
     * Get all picks in a draft
     */
    async getDraftPicks(draftId) {
        return this.fetchAPI(`/draft/${draftId}/picks`);
    }

    /**
     * Get traded picks in a draft
     */
    async getTradedPicks(draftId) {
        return this.fetchAPI(`/draft/${draftId}/traded_picks`);
    }

    /**
     * Get all NFL players (large dataset, cached for longer)
     */
    async getAllPlayers() {
        const cacheKey = '/players/nfl';
        
        // Check for longer cache (24 hours for player data)
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
                console.log('=æ Using cached player database');
                return cached.data;
            }
        }
        
        return this.fetchAPI('/players/nfl', false);
    }

    /**
     * Get specific player information
     */
    async getPlayer(playerId) {
        const players = await this.getAllPlayers();
        return players[playerId] || null;
    }

    /**
     * Get user by username
     */
    async getUserByUsername(username) {
        return this.fetchAPI(`/user/${username}`);
    }

    /**
     * Get trending players (adds/drops)
     */
    async getTrendingPlayers(type = 'add', lookback = 24, limit = 25) {
        return this.fetchAPI(`/players/nfl/trending/${type}?lookback_hours=${lookback}&limit=${limit}`);
    }

    /**
     * Get matchups for a specific week
     */
    async getMatchups(leagueId, week) {
        return this.fetchAPI(`/league/${leagueId}/matchups/${week}`);
    }

    /**
     * Get transactions for a specific week
     */
    async getTransactions(leagueId, week) {
        return this.fetchAPI(`/league/${leagueId}/transactions/${week}`);
    }

    /**
     * Get state of the NFL season
     */
    async getNFLState() {
        return this.fetchAPI('/state/nfl');
    }

    /**
     * Clear cache (useful for forcing fresh data)
     */
    clearCache() {
        this.cache.clear();
        console.log('>ù Sleeper API cache cleared');
    }

    /**
     * Get comprehensive league data (league + rosters + users)
     */
    async getLeagueData(leagueId) {
        try {
            const [league, rosters, users] = await Promise.all([
                this.getLeague(leagueId),
                this.getRosters(leagueId),
                this.getUsers(leagueId)
            ]);
            
            return {
                league,
                rosters,
                users,
                success: true
            };
        } catch (error) {
            console.error('L Error fetching league data:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get draft data with picks
     */
    async getDraftData(leagueId) {
        try {
            const drafts = await this.getDrafts(leagueId);
            
            if (!drafts || drafts.length === 0) {
                return {
                    success: false,
                    error: 'No drafts found for this league'
                };
            }
            
            // Get the most recent draft
            const draft = drafts[0];
            const picks = await this.getDraftPicks(draft.draft_id);
            
            return {
                draft,
                picks,
                success: true
            };
        } catch (error) {
            console.error('L Error fetching draft data:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// Create singleton instance
const sleeperAPI = new SleeperAPI();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = sleeperAPI;
}