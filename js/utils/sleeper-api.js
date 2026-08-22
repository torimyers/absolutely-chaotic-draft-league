/**
 * Sleeper API Utility Module
 * Centralized API calls for Sleeper Fantasy Football
 */

class SleeperAPI {
    constructor() {
        this.baseURL = 'https://api.sleeper.app/v1';

        // Cache and in-flight requests are shared by every instance. Each feature
        // constructs its own SleeperAPI, so per-instance state meant the same
        // endpoint was fetched once per manager - /players/nfl is roughly 5 MB and
        // was being downloaded four times on every page load.
        this.cache = SleeperAPI.sharedCache;
        this.inFlight = SleeperAPI.sharedInFlight;
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * The IndexedDB layer, or a no-op stand-in.
     *
     * persistent-cache.js is a separate script tag. If it fails to load, the app
     * should lose persistence and nothing else, so the reference is resolved at
     * call time rather than assumed to exist.
     */
    persistence() {
        return typeof persistentCache !== 'undefined' ? persistentCache : SleeperAPI.noopCache;
    }

    /**
     * Generic API fetch with caching.
     *
     * Managers all initialise at once, so a plain cache does not help on startup:
     * nothing has resolved yet when the second caller arrives. Concurrent callers
     * therefore share one in-flight promise per endpoint.
     *
     * `options.maxAge` overrides how long a cached entry stays usable, and
     * `options.persist` additionally routes the endpoint through IndexedDB so it
     * survives a reload. Persistence is opt-in: it only pays for itself on
     * payloads that are large and change slowly.
     *
     * `options.preferURL` names a same-origin endpoint to try before Sleeper,
     * falling back automatically. That fallback is what keeps the app working
     * on a plain static deploy, in Docker, and off a file server, none of which
     * have the D1-backed cache in front of them.
     */
    async fetchAPI(endpoint, useCache = true, options = {}) {
        const cacheKey = endpoint;
        const maxAge = options.maxAge || this.cacheTimeout;
        const persist = options.persist === true;

        // Check cache first
        if (useCache && this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < maxAge) {
                console.log(`📦 Using cached data for: ${endpoint}`);
                return cached.data;
            }
        }

        // Join a request that is already running for this endpoint.
        if (this.inFlight.has(cacheKey)) {
            console.log(`🔗 Joining in-flight request for: ${endpoint}`);
            return this.inFlight.get(cacheKey);
        }

        const request = (async () => {
            // The IndexedDB read happens inside the in-flight promise, not before
            // it, so callers arriving during the read join it rather than each
            // deserialising megabytes of their own copy.
            if (persist && useCache) {
                const stored = await this.persistence().get(cacheKey, maxAge);
                // An older build may have persisted something this one considers
                // malformed, so stored data is validated like fresh data.
                if (stored && (!options.validate || options.validate(stored.data))) {
                    this.cache.set(cacheKey, {
                        data: stored.data,
                        timestamp: stored.timestamp
                    });
                    const ageHours = ((Date.now() - stored.timestamp) / 3600000).toFixed(1);
                    console.log(`💾 Restored ${endpoint} from IndexedDB (${ageHours}h old)`);
                    return stored.data;
                }
            }

            const data = options.preferURL
                ? await this.fetchPreferred(options.preferURL, endpoint)
                : await this.fetchJSON(`${this.baseURL}${endpoint}`);

            // Validated before it is cached anywhere. Storing a malformed
            // payload would hand it back for the next 24 hours, long after the
            // upstream problem had passed.
            if (options.validate && !options.validate(data)) {
                throw new SleeperAPI.InvalidPayloadError(
                    `${endpoint} returned ${Array.isArray(data) ? 'an array' : typeof data}`
                );
            }

            const timestamp = Date.now();

            // Cache the response
            this.cache.set(cacheKey, { data, timestamp });

            // Deliberately not awaited: the data is already in hand, and cloning
            // it into IndexedDB should not delay the render.
            if (persist) this.persistence().set(cacheKey, data, timestamp);

            return data;
        })();

        this.inFlight.set(cacheKey, request);

        try {
            return await request;
        } catch (error) {
            console.error(`❌ Sleeper API Error for ${endpoint}:`, error);
            throw error;
        } finally {
            this.inFlight.delete(cacheKey);
        }
    }

    /**
     * Fetches one URL as JSON.
     *
     * A same-origin miss can come back as the SPA shell with a 200 - both the
     * Pages catch-all rewrite and the nginx try_files in the Docker image do
     * that - so the content type is checked rather than assumed. Parsing HTML
     * as JSON would otherwise surface as an unrelated syntax error.
     */
    async fetchJSON(url) {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const type = response.headers.get('Content-Type') || '';
        if (!type.includes('json')) {
            throw new Error(`Expected JSON from ${url}, got ${type || 'no content type'}`);
        }

        return response.json();
    }

    /**
     * Tries the cached same-origin copy first, then Sleeper.
     *
     * The cached copy is smaller and spares Sleeper a request, but it is an
     * optimisation: any failure at all falls through, because a deployment
     * without the D1 cache in front of it must behave exactly as it did before.
     */
    async fetchPreferred(preferURL, endpoint) {
        try {
            const data = await this.fetchJSON(preferURL);
            console.log(`🚀 Loaded ${endpoint} from the cached copy at ${preferURL}`);
            return data;
        } catch (error) {
            console.warn(`⚠️ ${preferURL} unavailable (${error.message}); using Sleeper directly`);
        }

        return this.fetchJSON(`${this.baseURL}${endpoint}`);
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
     * Get all NFL players.
     *
     * Roughly 5 MB, and the only endpoint the app uses where the download
     * dominates startup, so this is the one that earns a persistent cache. The
     * contents - team, position, injury status - move on a daily cadence, which
     * is what sets the 24 hour lifetime.
     *
     * Always resolves to an object keyed by player ID - the shape every caller
     * assumes when it does `allPlayers[id]` or `Object.values(allPlayers)`. A
     * malformed success used to reach those call sites and throw. A failed
     * request still rejects.
     */
    async getAllPlayers() {
        try {
            return await this.fetchAPI('/players/nfl', true, {
                maxAge: SleeperAPI.PLAYER_CACHE_MAX_AGE,
                persist: true,
                preferURL: SleeperAPI.PLAYER_CACHE_URL,
                validate: SleeperAPI.isPlayerMap
            });
        } catch (error) {
            // Only a shape failure becomes an empty map. A network or HTTP
            // failure still rejects, so callers can tell "Sleeper is down" from
            // "Sleeper answered with something unusable".
            if (error instanceof SleeperAPI.InvalidPayloadError) {
                console.warn('⚠️ Sleeper returned no usable player database:', error.message);
                return {};
            }
            throw error;
        }
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
     * Get trending players (adds/drops).
     *
     * Always resolves to an array of row objects. Every caller iterates the
     * result - `.map`, `.forEach`, `.find`, `for...of` - and Sleeper normally
     * answers with an array, but an outage or an error page can put an object
     * or null there instead. Iterating that threw straight out of a manager's
     * initialize(), and a guard like `(rows || []).forEach` does not help: the
     * bad value is a truthy object, not a nullish one.
     *
     * A failed request still rejects, so the callers that surface an error
     * state keep doing so. Only a malformed success is flattened, and rows that
     * are not objects are dropped so `row.player_id` is always safe to read.
     */
    async getTrendingPlayers(type = 'add', lookback = 24, limit = 25) {
        const rows = await this.fetchAPI(`/players/nfl/trending/${type}?lookback_hours=${lookback}&limit=${limit}`);

        if (!Array.isArray(rows)) {
            console.warn(`⚠️ Sleeper returned no usable trending "${type}" data:`, rows);
            return [];
        }

        return rows.filter(row => row && typeof row === 'object');
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
     * Season-long projected fantasy points, keyed by player id.
     *
     * This is what a draft needs: stats describe games already played, and in
     * August there are none. Sleeper's season-aggregate form is undocumented and
     * may not exist for every season, so a failure here is expected rather than
     * exceptional - the caller falls back rather than breaking.
     */
    async getSeasonProjections(season) {
        try {
            const data = await this.fetchAPI(`/projections/nfl/regular/${season}`);
            return this.normalizeProjectionResponse(data);
        } catch (error) {
            console.warn(`⚠️ Season projections unavailable for ${season}:`, error.message);
            return null;
        }
    }

    /** Projected points for a single week. */
    async getWeeklyProjections(season, week) {
        try {
            const data = await this.fetchAPI(`/projections/nfl/regular/${season}/${week}`);
            return this.normalizeProjectionResponse(data);
        } catch (error) {
            console.warn(`⚠️ Week ${week} projections unavailable:`, error.message);
            return null;
        }
    }

    /** Actual scored points for a week. Empty before the season starts. */
    async getWeeklyStats(season, week) {
        try {
            const data = await this.fetchAPI(`/stats/nfl/regular/${season}/${week}`);
            return this.normalizeProjectionResponse(data);
        } catch (error) {
            console.warn(`⚠️ Week ${week} stats unavailable:`, error.message);
            return null;
        }
    }

    /** Actual scored points for a whole season. */
    async getSeasonStats(season) {
        try {
            const data = await this.fetchAPI(`/stats/nfl/regular/${season}`);
            return this.normalizeProjectionResponse(data);
        } catch (error) {
            console.warn(`⚠️ Season stats unavailable for ${season}:`, error.message);
            return null;
        }
    }

    /**
     * These endpoints are undocumented, and have been observed both keyed by
     * player id and as a flat array of rows carrying player_id. Accept either,
     * and treat an empty result as absent so callers do not mistake "no games
     * played yet" for "every player projected zero".
     */
    normalizeProjectionResponse(data) {
        if (!data) return null;

        if (Array.isArray(data)) {
            if (!data.length) return null;
            const keyed = {};
            data.forEach(row => {
                const id = row && (row.player_id || row.playerId);
                if (id) keyed[String(id)] = row.stats || row;
            });
            return Object.keys(keyed).length ? keyed : null;
        }

        return Object.keys(data).length ? data : null;
    }

    /**
     * Pulls the points field matching the league's scoring format. Sleeper
     * publishes the three formats as separate fields, which removes the need to
     * approximate PPR with a positional multiplier.
     */
    static pointsForFormat(statLine, scoringFormat) {
        if (!statLine) return null;

        const format = (scoringFormat || 'Half PPR').toLowerCase();
        const order = format.includes('half')
            ? ['pts_half_ppr', 'pts_ppr', 'pts_std']
            : format.includes('ppr')
                ? ['pts_ppr', 'pts_half_ppr', 'pts_std']
                : ['pts_std', 'pts_half_ppr', 'pts_ppr'];

        for (const field of order) {
            const value = statLine[field];
            if (typeof value === 'number' && !Number.isNaN(value)) return value;
        }
        return null;
    }

    /**
     * Get state of the NFL season
     */
    async getNFLState() {
        return this.fetchAPI('/state/nfl');
    }

    /**
     * Clear cache (useful for forcing fresh data).
     *
     * Clears IndexedDB too - leaving it behind would mean the next reload
     * restored exactly the data the caller asked to discard.
     */
    async clearCache() {
        this.cache.clear();
        await this.persistence().clear();
        console.log('🧹 Sleeper API cache cleared');
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
            console.error('❌ Error fetching league data:', error);
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
            console.error('❌ Error fetching draft data:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// One cache and one in-flight map for every instance in the page.
SleeperAPI.sharedCache = new Map();
SleeperAPI.sharedInFlight = new Map();

// How long the player database stays usable, in memory and in IndexedDB alike.
SleeperAPI.PLAYER_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

// Same-origin copy of the player database, trimmed to the fields the app reads
// and refreshed once a day by workers/player-sync. Absent on a static-only
// deploy, in which case getAllPlayers falls back to Sleeper.
SleeperAPI.PLAYER_CACHE_URL = '/api/players';

/** Thrown when a response parses but is not the shape callers rely on. */
SleeperAPI.InvalidPayloadError = class InvalidPayloadError extends Error {};

// An array would survive Object.values() but break every lookup by id, so it is
// rejected here rather than half-working downstream.
SleeperAPI.isPlayerMap = data =>
    Boolean(data) && typeof data === 'object' && !Array.isArray(data);

// Stand-in used when persistent-cache.js is absent: every lookup misses, every
// write is discarded, and the in-memory cache carries the page on its own.
SleeperAPI.noopCache = {
    get: async () => null,
    set: async () => false,
    delete: async () => false,
    clear: async () => false
};

// Create singleton instance
const sleeperAPI = new SleeperAPI();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = sleeperAPI;
}