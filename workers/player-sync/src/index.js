import { PLAYER_COLUMNS, isFantasyRelevant, toRow } from '../../../functions/_shared/players.js';

/**
 * Refreshes the cached NFL player database in D1.
 *
 * Runs on a daily Cron Trigger, which is why this is a Worker and not another
 * Pages Function - Pages does not support scheduled handlers. It also exposes
 * POST /refresh for a manual run, which matters in-season when injury statuses
 * move faster than the cron.
 *
 * Sleeper asks that /players/nfl be called at most once a day. One scheduled
 * run here covers every reader of the site, however many browsers and devices
 * they are spread across.
 */

// Overridable via the SLEEPER_PLAYERS_URL var so a staging deploy can point at
// a mirror or a fixture instead of spending a real call against Sleeper's
// once-a-day budget.
const DEFAULT_SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';

// One D1 batch is one transaction. 20 bound parameters per statement sits well
// inside D1's per-query limit, and this many statements per batch keeps each
// round trip a sensible size.
const BATCH_SIZE = 400;

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(
            refresh(env, 'cron').catch(error => {
                // A throw here is invisible outside the dashboard, so make sure
                // the reason is at least in the logs.
                console.error('Scheduled player refresh failed:', error && error.message);
                throw error;
            })
        );
    },

    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname !== '/refresh') {
            return json({ error: 'Not found' }, 404);
        }
        if (request.method !== 'POST') {
            return json({ error: 'Use POST' }, 405, { Allow: 'POST' });
        }
        if (!env.REFRESH_SECRET) {
            return json({ error: 'Manual refresh is not configured' }, 503);
        }
        if (!(await isAuthorized(request, env.REFRESH_SECRET))) {
            return json({ error: 'Unauthorized' }, 401);
        }

        try {
            return json(await refresh(env, 'manual'), 200);
        } catch (error) {
            console.error('Manual player refresh failed:', error && error.message);
            return json({ error: String(error && error.message) }, 502);
        }
    }
};

/**
 * Compares the bearer token without leaking its length or contents through
 * timing. Both sides are hashed first so the comparison is over fixed-length
 * digests whatever the input.
 */
async function isAuthorized(request, secret) {
    const header = request.headers.get('Authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) return false;

    const encoder = new TextEncoder();
    const [presented, expected] = await Promise.all([
        crypto.subtle.digest('SHA-256', encoder.encode(match[1])),
        crypto.subtle.digest('SHA-256', encoder.encode(secret))
    ]);

    const a = new Uint8Array(presented);
    const b = new Uint8Array(expected);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

/**
 * Pulls Sleeper's player list and writes it as a new generation.
 *
 * The generation is only published once every row is in, and the previous one
 * is only dropped after that. A run that dies partway leaves readers on the old
 * generation rather than on a half-written table.
 */
async function refresh(env, trigger) {
    if (!env.DB) throw new Error('No D1 binding named DB');

    const startedAt = Date.now();

    const source = env.SLEEPER_PLAYERS_URL || DEFAULT_SLEEPER_PLAYERS_URL;
    const response = await fetch(source, {
        headers: { Accept: 'application/json' },
        cf: { cacheTtl: 0 }
    });
    if (!response.ok) {
        throw new Error(`Sleeper returned ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const ids = Object.keys(payload);
    if (!ids.length) throw new Error('Sleeper returned an empty player list');

    const current = await currentGeneration(env.DB);
    const generation = current + 1;

    const placeholders = PLAYER_COLUMNS.map(() => '?').join(', ');
    const insert = env.DB.prepare(
        `INSERT INTO players (generation, ${PLAYER_COLUMNS.join(', ')})
         VALUES (?, ${placeholders})`
    );

    let statements = [];
    let written = 0;

    for (const id of ids) {
        const player = payload[id];
        if (!isFantasyRelevant(player)) continue;

        statements.push(insert.bind(generation, ...toRow(id, player)));

        if (statements.length >= BATCH_SIZE) {
            await env.DB.batch(statements);
            written += statements.length;
            statements = [];
        }
    }

    if (statements.length) {
        await env.DB.batch(statements);
        written += statements.length;
    }

    if (!written) throw new Error('No fantasy-relevant players survived filtering');

    const refreshedAt = new Date().toISOString();

    // Publishing the generation is the commit point. Everything before it is
    // invisible to readers; everything after it is cleanup.
    await env.DB.batch([
        env.DB.prepare("INSERT INTO player_cache_meta (key, value) VALUES ('current_generation', ?) " +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(String(generation)),
        env.DB.prepare("INSERT INTO player_cache_meta (key, value) VALUES ('refreshed_at', ?) " +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(refreshedAt),
        env.DB.prepare("INSERT INTO player_cache_meta (key, value) VALUES ('player_count', ?) " +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(String(written))
    ]);

    await env.DB.prepare('DELETE FROM players WHERE generation != ?').bind(generation).run();

    const result = {
        ok: true,
        trigger,
        generation,
        refreshedAt,
        received: ids.length,
        stored: written,
        durationMs: Date.now() - startedAt
    };
    console.log('Player refresh complete:', JSON.stringify(result));
    return result;
}

async function currentGeneration(db) {
    const row = await db.prepare("SELECT value FROM player_cache_meta WHERE key = 'current_generation'").first();
    const generation = row ? Number.parseInt(row.value, 10) : NaN;
    return Number.isInteger(generation) ? generation : 0;
}

function json(body, status, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
    });
}
