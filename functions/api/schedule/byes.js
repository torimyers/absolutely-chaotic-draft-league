import { deriveByeWeeks, isCompleteSeason, REGULAR_SEASON_WEEKS } from '../../_shared/schedule.js';
import { readScheduleMeta, json, parseSeason } from './_shared.js';

/**
 * GET /api/schedule/byes?season=2026 - each team's bye week.
 *
 * `{ "BUF": 12, "MIA": 6, ... }`, which is exactly the shape the app's bye check
 * wants. Derived here rather than in the browser so every client is not walking
 * a season of fixtures to compute the same 32 numbers - and so a client can hold
 * one small object instead of the whole schedule.
 *
 * This replaces a hand-maintained table that still said 2024 two seasons later.
 */

export async function onRequestGet({ request, env }) {
    if (!env.SCHEDULE_DB) {
        return json({ error: 'Schedule database is not bound to this deployment' }, 503);
    }

    const season = parseSeason(new URL(request.url).searchParams.get('season'));
    if (season === null) return json({ error: 'A four-digit season is required' }, 400);

    try {
        const meta = await readScheduleMeta(env.SCHEDULE_DB);
        if (meta.generation === null) {
            return json({ error: 'Schedule cache has not been populated yet' }, 503);
        }

        const { results } = await env.SCHEDULE_DB
            .prepare('SELECT week, home_team, away_team FROM games WHERE generation = ? AND season = ?')
            .bind(meta.generation, season)
            .all();

        if (!results.length) {
            return json({ error: `No cached schedule for season ${season}` }, 404);
        }

        // A bye is a week with no game, which only means anything once every
        // week is present. With weeks missing, an idle team is indistinguishable
        // from one on bye - and a wrong bye benches a player who is playing.
        const weeks = results.map(row => row.week);
        if (!isCompleteSeason(weeks, REGULAR_SEASON_WEEKS)) {
            const present = new Set(weeks);
            const missing = [];
            for (let week = 1; week <= REGULAR_SEASON_WEEKS; week++) {
                if (!present.has(week)) missing.push(week);
            }
            return json({
                error: `Schedule for ${season} is incomplete; byes cannot be derived`,
                missingWeeks: missing
            }, 409);
        }

        const byes = deriveByeWeeks(results, REGULAR_SEASON_WEEKS);

        return json(byes, 200, {
            'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
            'X-Schedule-Generation': String(meta.generation),
            'X-Schedule-Refreshed-At': meta.refreshedAt || 'unknown',
            'X-Byes-Teams': String(Object.keys(byes).length)
        });
    } catch (error) {
        console.error('Bye derivation failed:', error && error.message);
        return json({ error: 'Schedule cache is unavailable' }, 502);
    }
}
