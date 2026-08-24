import { PLAYER_COLUMNS, fromRow } from '../_shared/players.js';

/**
 * GET /api/players - the cached NFL player database.
 *
 * Returns the same id-keyed map the Sleeper endpoint does, so the client can
 * treat this as a drop-in and needs no reshaping. Metadata that would otherwise
 * change that shape travels in response headers instead.
 *
 * Query parameters:
 *   position=WR,RB   restrict to those positions
 *   limit=300        highest-ranked N only (search_rank ascending, nulls last)
 *
 * A draft board wants the top few hundred by rank, which is roughly 40 KB
 * rather than the whole set - the reason this is a queryable table and not a
 * stored blob.
 */

const MAX_LIMIT = 12000;

// Every value is bound, never interpolated, but the position filter is
// validated against this set anyway so a malformed request fails fast instead
// of silently matching nothing.
const ALLOWED_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'OL', 'P']);

function json(body, status, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
    });
}

export async function onRequestGet({ request, env }) {
    // PLAYERS_DB, not DB: the player cache has its own database so the daily
    // bulk rewrite never holds a connection to the profile data.
    if (!env.PLAYERS_DB) {
        return json({ error: 'Player database is not bound to this deployment' }, 503);
    }

    const url = new URL(request.url);

    let limit = null;
    if (url.searchParams.has('limit')) {
        limit = Number.parseInt(url.searchParams.get('limit'), 10);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
            return json({ error: `limit must be an integer between 1 and ${MAX_LIMIT}` }, 400);
        }
    }

    let positions = null;
    if (url.searchParams.has('position')) {
        positions = url.searchParams.get('position').split(',')
            .map(p => p.trim().toUpperCase())
            .filter(Boolean);

        const unknown = positions.filter(p => !ALLOWED_POSITIONS.has(p));
        if (!positions.length || unknown.length) {
            return json({ error: `Unsupported position: ${unknown.join(', ') || '(empty)'}` }, 400);
        }
    }

    try {
        const meta = await readMeta(env.PLAYERS_DB);

        // No generation means the sync Worker has never completed a run. Say so
        // rather than returning an empty map the client would cache for a day.
        if (meta.generation === null) {
            return json({ error: 'Player cache has not been populated yet' }, 503);
        }

        const bindings = [meta.generation];
        let sql = `SELECT ${PLAYER_COLUMNS.join(', ')} FROM players WHERE generation = ?`;

        if (positions) {
            sql += ` AND position IN (${positions.map(() => '?').join(', ')})`;
            bindings.push(...positions);
        }

        // Unranked players sort last rather than first, which is where SQLite
        // would otherwise put NULL.
        sql += ' ORDER BY search_rank IS NULL, search_rank ASC';

        if (limit !== null) {
            sql += ' LIMIT ?';
            bindings.push(limit);
        }

        const { results } = await env.PLAYERS_DB.prepare(sql).bind(...bindings).all();

        const players = {};
        for (const row of results) players[row.player_id] = fromRow(row);

        return json(players, 200, {
            // The client holds this for a day of its own; letting the edge do
            // the same keeps repeat cold loads off D1 entirely.
            'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
            'X-Players-Count': String(results.length),
            'X-Players-Generation': String(meta.generation),
            'X-Players-Refreshed-At': meta.refreshedAt || 'unknown'
        });
    } catch (error) {
        console.error('Player cache read failed:', error && error.message);
        return json({ error: 'Player cache is unavailable' }, 502);
    }
}

async function readMeta(db) {
    const { results } = await db.prepare('SELECT key, value FROM player_cache_meta').all();
    const byKey = Object.fromEntries(results.map(r => [r.key, r.value]));

    const generation = Number.parseInt(byKey.current_generation, 10);
    return {
        generation: Number.isInteger(generation) ? generation : null,
        refreshedAt: byKey.refreshed_at || null
    };
}
