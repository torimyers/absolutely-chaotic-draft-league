import { GAME_COLUMNS, rowToGame } from '../../_shared/schedule.js';
import { readScheduleMeta, json, parseSeason } from './_shared.js';

/**
 * GET /api/schedule?season=2026&week=3 - the week's fixtures.
 *
 * Returns the same array of game objects weather-analyzer already builds from
 * ESPN, so it is a drop-in for that fetch and needs no reshaping. Metadata
 * travels in response headers rather than changing the shape.
 *
 * Omit `week` to get the whole season, which is what bye derivation needs.
 */

export async function onRequestGet({ request, env }) {
    if (!env.SCHEDULE_DB) {
        return json({ error: 'Schedule database is not bound to this deployment' }, 503);
    }

    const url = new URL(request.url);

    const season = parseSeason(url.searchParams.get('season'));
    if (season === null) return json({ error: 'A four-digit season is required' }, 400);

    let week = null;
    if (url.searchParams.has('week')) {
        week = Number.parseInt(url.searchParams.get('week'), 10);
        if (!Number.isInteger(week) || week < 1 || week > 25) {
            return json({ error: 'week must be an integer between 1 and 25' }, 400);
        }
    }

    try {
        const meta = await readScheduleMeta(env.SCHEDULE_DB);
        if (meta.generation === null) {
            return json({ error: 'Schedule cache has not been populated yet' }, 503);
        }

        const bindings = [meta.generation, season];
        let sql = `SELECT ${GAME_COLUMNS.join(', ')} FROM games WHERE generation = ? AND season = ?`;
        if (week !== null) {
            sql += ' AND week = ?';
            bindings.push(week);
        }
        sql += ' ORDER BY week ASC, kickoff ASC, game_id ASC';

        const { results } = await env.SCHEDULE_DB.prepare(sql).bind(...bindings).all();

        // An empty result for a season nobody has loaded is not the same as a
        // week with no games, and the client should fall back rather than cache
        // an empty schedule for the day.
        if (!results.length) {
            return json({ error: `No cached schedule for season ${season}` }, 404);
        }

        return json(results.map(rowToGame), 200, {
            'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
            'X-Schedule-Count': String(results.length),
            'X-Schedule-Generation': String(meta.generation),
            'X-Schedule-Refreshed-At': meta.refreshedAt || 'unknown'
        });
    } catch (error) {
        console.error('Schedule read failed:', error && error.message);
        return json({ error: 'Schedule cache is unavailable' }, 502);
    }
}
