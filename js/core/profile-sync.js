/**
 * Cross-device profile sync.
 *
 * The league setup lives in localStorage as it always has - that stays the
 * source of truth, and the app works exactly as before with sync switched off
 * or the network down. When sync is on, a copy is mirrored to a small
 * Cloudflare D1 table keyed on the user's Sleeper account, so opening the app
 * on a phone picks up the league configured on a laptop.
 *
 * This is NOT a login. There is no password: typing a Sleeper username is
 * enough to pull down or overwrite that account's profile. It is only
 * defensible because the data involved - league ID, team name, scoring format -
 * is already visible to anyone in the league on Sleeper. The UI says so plainly
 * rather than implying an account system that does not exist.
 */

class ProfileSync {
    constructor(configManager) {
        this.configManager = configManager;

        // Identity of the linked Sleeper account, plus the last timestamp we
        // pushed. Kept separate from fantasyAppConfig so turning sync off never
        // risks disturbing the league setup itself.
        this.state = this.loadState();

        // Set while a pull is applying a remote profile, so the resulting save
        // does not immediately push the same thing back.
        this.applyingRemote = false;
    }

    static get STORAGE_KEY() {
        return 'fantasyProfileSync';
    }

    /** Endpoints are same-origin, so the existing CSP `connect-src 'self'` covers them. */
    static get API_BASE() {
        return '/api/profile';
    }

    loadState() {
        try {
            const raw = localStorage.getItem(ProfileSync.STORAGE_KEY);
            if (!raw) return { enabled: false, userId: null, username: null, lastSyncedAt: null };
            const parsed = JSON.parse(raw);
            return {
                enabled: Boolean(parsed.enabled),
                userId: parsed.userId || null,
                username: parsed.username || null,
                lastSyncedAt: parsed.lastSyncedAt || null
            };
        } catch (error) {
            console.warn('Could not read sync state, treating sync as off');
            return { enabled: false, userId: null, username: null, lastSyncedAt: null };
        }
    }

    saveState() {
        try {
            localStorage.setItem(ProfileSync.STORAGE_KEY, JSON.stringify(this.state));
        } catch (error) {
            console.warn('Could not persist sync state:', error);
        }
    }

    get isEnabled() {
        return Boolean(this.state.enabled && this.state.userId);
    }

    notify(message, type = 'info') {
        if (this.configManager && typeof this.configManager.showNotification === 'function') {
            this.configManager.showNotification(message, type);
        } else {
            console.log(`${type.toUpperCase()}: ${message}`);
        }
    }

    /**
     * Reads a JSON response, preferring the server's own error message over a
     * bare status code - the endpoints always explain themselves.
     */
    async parse(response) {
        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }
        if (!response.ok) {
            const message = payload && payload.error ? payload.error : `Request failed (${response.status})`;
            const err = new Error(message);
            err.status = response.status;
            err.payload = payload;
            throw err;
        }
        return payload;
    }

    /**
     * Links this browser to a Sleeper account and performs the first sync.
     *
     * If the account already has a profile the user is asked which side wins,
     * because silently overwriting either one loses work: the remote copy may be
     * the setup they came here to fetch, or this browser may hold the newer one.
     */
    async enable(username) {
        const name = String(username || '').trim();
        if (!name) {
            this.notify('Enter your Sleeper username to turn on sync', 'error');
            return false;
        }

        try {
            this.notify('🔗 Linking your Sleeper account...', 'info');

            const linked = await this.parse(await fetch(`${ProfileSync.API_BASE}/link`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: name })
            }));

            this.state.enabled = true;
            this.state.userId = linked.userId;
            this.state.username = linked.username;
            this.saveState();

            const remote = await this.fetchRemote();

            if (remote && this.shouldPreferRemote(remote)) {
                this.applyRemote(remote);
                this.notify(`✅ Synced - loaded the setup saved for ${linked.displayName}`, 'success');
            } else {
                await this.push({ silent: true });
                this.notify(`✅ Sync on for ${linked.displayName}`, 'success');
            }

            this.render();
            return true;

        } catch (error) {
            console.error('Sync link failed:', error);
            // A failed link must not leave the browser half-connected.
            this.state = { enabled: false, userId: null, username: null, lastSyncedAt: null };
            this.saveState();
            this.render();
            this.notify(`❌ ${error.message}`, 'error');
            return false;
        }
    }

    /** Stops syncing. The local setup is untouched; the stored copy is left alone. */
    disable() {
        this.state = { enabled: false, userId: null, username: null, lastSyncedAt: null };
        this.saveState();
        this.render();
        this.notify('Sync turned off. Your league stays saved in this browser.', 'info');
    }

    /** @returns {Promise<object|null>} the stored profile, or null if there is none. */
    async fetchRemote() {
        if (!this.state.userId) return null;
        try {
            const url = `${ProfileSync.API_BASE}?userId=${encodeURIComponent(this.state.userId)}`;
            return await this.parse(await fetch(url, { headers: { accept: 'application/json' } }));
        } catch (error) {
            if (error.status === 404) return null;
            throw error;
        }
    }

    /**
     * Whether the stored profile should win over what this browser holds.
     *
     * An unconfigured browser always takes the remote copy - that is the whole
     * point of opening the app on a second device. Otherwise the newer of the
     * two wins.
     */
    shouldPreferRemote(remote) {
        if (!remote || !remote.config) return false;

        const local = this.configManager.config;
        if (!local.isConfigured && !local.leagueName && !local.teamName) return true;

        const localStamp = Date.parse(local.lastUpdated || '') || 0;
        return Number(remote.updatedAt || 0) > localStamp;
    }

    /** Writes a fetched profile into the local config and refreshes the UI. */
    applyRemote(remote) {
        this.applyingRemote = true;
        try {
            this.configManager.config = {
                ...this.configManager.config,
                ...remote.config,
                lastUpdated: new Date(Number(remote.updatedAt) || Date.now()).toISOString()
            };

            this.configManager.normalizeSleeperTarget(this.configManager.config);
            this.configManager.normalizeFormats(this.configManager.config);

            localStorage.setItem('fantasyAppConfig', JSON.stringify(this.configManager.config));

            this.configManager.applyConfiguration();
            if (typeof this.configManager.populateConfigForm === 'function') {
                this.configManager.populateConfigForm();
            }

            this.state.lastSyncedAt = Number(remote.updatedAt) || Date.now();
            this.saveState();
        } finally {
            this.applyingRemote = false;
        }
    }

    /**
     * Mirrors the current setup to the server. Called after every save, so it
     * stays quiet unless something actually goes wrong.
     */
    async push({ silent = false } = {}) {
        if (!this.isEnabled || this.applyingRemote) return false;

        const config = this.configManager.config;
        const updatedAt = Date.parse(config.lastUpdated || '') || Date.now();

        try {
            const result = await this.parse(await fetch(ProfileSync.API_BASE, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    userId: this.state.userId,
                    username: this.state.username,
                    config,
                    updatedAt
                })
            }));

            this.state.lastSyncedAt = result.updatedAt;
            this.saveState();
            this.render();
            if (!silent) this.notify('✅ Synced to your other devices', 'success');
            return true;

        } catch (error) {
            console.warn('Sync push failed:', error);

            // A 409 means another device saved something newer. Take it rather
            // than fighting over which copy wins.
            if (error.status === 409) {
                try {
                    const remote = await this.fetchRemote();
                    if (remote) {
                        this.applyRemote(remote);
                        this.notify('↩️ A newer setup from another device was loaded instead', 'warning');
                        return false;
                    }
                } catch (pullError) {
                    console.warn('Could not pull the newer profile:', pullError);
                }
            }

            if (!silent) this.notify(`⚠️ Could not sync: ${error.message}`, 'warning');
            return false;
        }
    }

    /**
     * Pulls on startup so a device that was configured elsewhere catches up.
     * Failures are logged and otherwise ignored - the local setup already works,
     * and an offline start should not produce an error banner.
     */
    async pullOnStartup() {
        if (!this.isEnabled) {
            this.render();
            return;
        }

        try {
            const remote = await this.fetchRemote();
            if (remote && this.shouldPreferRemote(remote)) {
                this.applyRemote(remote);
                this.notify('🔄 Loaded your league setup from your other device', 'info');
            }
        } catch (error) {
            console.warn('Startup sync pull failed, using the local setup:', error);
        }

        this.render();
    }

    /** Manual "sync now": push local, or pull if the server has something newer. */
    async syncNow() {
        if (!this.isEnabled) {
            this.notify('Turn on sync first', 'warning');
            return;
        }

        try {
            const remote = await this.fetchRemote();
            if (remote && this.shouldPreferRemote(remote)) {
                this.applyRemote(remote);
                this.notify('🔄 Loaded the newer setup from your other device', 'success');
                this.render();
                return;
            }
        } catch (error) {
            console.warn('Sync check failed:', error);
        }

        await this.push();
    }

    /** Reflects the current sync state in the configuration panel. */
    render() {
        const status = document.getElementById('syncStatus');
        const linkBtn = document.getElementById('syncEnableBtn');
        const unlinkBtn = document.getElementById('syncDisableBtn');
        const nowBtn = document.getElementById('syncNowBtn');
        const input = document.getElementById('syncUsername');

        if (input && this.state.username && !input.value) {
            input.value = this.state.username;
        }

        if (linkBtn) linkBtn.classList.toggle('hidden', this.isEnabled);
        if (unlinkBtn) unlinkBtn.classList.toggle('hidden', !this.isEnabled);
        if (nowBtn) nowBtn.classList.toggle('hidden', !this.isEnabled);

        if (!status) return;

        if (!this.isEnabled) {
            status.textContent = 'Sync is off. Your league is saved in this browser only.';
            status.className = 'sync-status';
            return;
        }

        const when = this.state.lastSyncedAt
            ? new Date(this.state.lastSyncedAt).toLocaleString()
            : 'not yet';
        status.textContent = `Syncing as ${this.state.username} · last synced ${when}`;
        status.className = 'sync-status sync-status-on';
    }
}

window.ProfileSync = ProfileSync;
