/**
 * IndexedDB-backed cache for large, slow-changing Sleeper responses.
 *
 * SleeperAPI's in-memory Map dies with the page, so before this layer existed
 * every reload re-downloaded /players/nfl - roughly 5 MB - even though the
 * payload changes about once a day. This sits behind that Map and survives
 * reloads, browser restarts and offline periods.
 *
 * localStorage is not an option here: the player payload alone exceeds the
 * ~5 MB quota most browsers enforce, and it is synchronous, so serialising it
 * would block the main thread during startup.
 *
 * Every method resolves rather than rejects. A private window, a browser with
 * storage disabled, or an exhausted quota must degrade to a plain network
 * fetch - never to a broken page - so failures are logged and reported as a
 * miss.
 */

const PERSISTENT_CACHE_DB = 'fantasy-football-cache';
const PERSISTENT_CACHE_DB_VERSION = 1;
const PERSISTENT_CACHE_STORE = 'responses';

// Stamped into every record and checked on read. Bump this when the shape of a
// cached payload changes so existing entries are discarded instead of being
// handed to code that can no longer read them.
const PERSISTENT_CACHE_SCHEMA = 1;

// A version-change transaction blocked by another tab leaves open() pending
// forever. Startup cannot wait on that, so give up and use the network.
const PERSISTENT_CACHE_OPEN_TIMEOUT = 5000;

class PersistentCache {
    constructor() {
        this.dbPromise = null;
        this.unavailable = typeof indexedDB === 'undefined';

        if (this.unavailable) {
            console.warn('⚠️ IndexedDB unavailable - cached data will not survive reloads');
        }
    }

    /**
     * Opens the database once and reuses the connection. Resolves to null when
     * IndexedDB cannot be used, which every caller treats as a cache miss.
     */
    open() {
        if (this.unavailable) return Promise.resolve(null);
        if (this.dbPromise) return this.dbPromise;

        this.dbPromise = new Promise(resolve => {
            let settled = false;
            const finish = (db, reason) => {
                if (settled) return;
                settled = true;
                if (!db && reason) console.warn(`⚠️ IndexedDB unavailable: ${reason}`);
                resolve(db);
            };

            const timer = setTimeout(
                () => finish(null, 'open() timed out, likely blocked by another tab'),
                PERSISTENT_CACHE_OPEN_TIMEOUT
            );

            let request;
            try {
                request = indexedDB.open(PERSISTENT_CACHE_DB, PERSISTENT_CACHE_DB_VERSION);
            } catch (error) {
                clearTimeout(timer);
                finish(null, error.message);
                return;
            }

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(PERSISTENT_CACHE_STORE)) {
                    db.createObjectStore(PERSISTENT_CACHE_STORE, { keyPath: 'key' });
                }
            };

            request.onsuccess = () => {
                clearTimeout(timer);
                const db = request.result;

                // Another tab loading a newer build needs to upgrade the schema,
                // which it cannot do while this connection is held open.
                db.onversionchange = () => {
                    db.close();
                    this.dbPromise = null;
                };

                finish(db);
            };

            request.onerror = () => {
                clearTimeout(timer);
                finish(null, request.error ? request.error.message : 'open() failed');
            };

            request.onblocked = () => {
                clearTimeout(timer);
                finish(null, 'another tab is holding an older version of the database open');
            };
        });

        return this.dbPromise;
    }

    /** Wraps one store operation, resolving to null on any failure. */
    async withStore(mode, operation) {
        const db = await this.open();
        if (!db) return null;

        return new Promise(resolve => {
            let request;
            try {
                const tx = db.transaction(PERSISTENT_CACHE_STORE, mode);
                tx.onabort = () => resolve(null);
                request = operation(tx.objectStore(PERSISTENT_CACHE_STORE));
            } catch (error) {
                console.warn(`⚠️ Cache ${mode} failed:`, error.message);
                resolve(null);
                return;
            }

            request.onsuccess = () => resolve(request.result === undefined ? true : request.result);
            request.onerror = () => {
                console.warn(`⚠️ Cache ${mode} failed:`, request.error ? request.error.message : 'unknown');
                resolve(null);
            };
        });
    }

    /**
     * Returns { data, timestamp } for a live entry, or null when the key is
     * absent, stale, or written by an older schema. Stale records are dropped
     * on the way past so a key that stops being requested does not linger.
     */
    async get(key, maxAge) {
        const record = await this.withStore('readonly', store => store.get(key));
        if (!record || record === true) return null;

        if (record.schema !== PERSISTENT_CACHE_SCHEMA) {
            this.delete(key);
            return null;
        }

        const age = Date.now() - record.timestamp;
        if (!(age >= 0) || age >= maxAge) {
            this.delete(key);
            return null;
        }

        return { data: record.data, timestamp: record.timestamp };
    }

    /**
     * Writes an entry. Callers do not await this: the payload is already in
     * hand, and structured-cloning several megabytes should not sit between the
     * response and the render.
     */
    async set(key, data, timestamp = Date.now()) {
        const result = await this.withStore('readwrite', store =>
            store.put({ key, data, timestamp, schema: PERSISTENT_CACHE_SCHEMA })
        );

        if (result === null) {
            // Almost always a quota rejection. Nothing to recover - the next
            // load simply refetches.
            console.warn(`⚠️ Could not persist ${key}; it will be refetched next load`);
            return false;
        }
        return true;
    }

    async delete(key) {
        return (await this.withStore('readwrite', store => store.delete(key))) !== null;
    }

    async clear() {
        const result = await this.withStore('readwrite', store => store.clear());
        if (result !== null) console.log('🧹 Persistent cache cleared');
        return result !== null;
    }
}

// One connection per page, shared by every SleeperAPI instance.
const persistentCache = new PersistentCache();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PersistentCache, persistentCache };
}
