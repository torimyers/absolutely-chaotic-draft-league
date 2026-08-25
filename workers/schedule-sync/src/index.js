import { GAME_COLUMNS, eventToGame, REGULAR_SEASON_WEEKS } from '../../../functions/_shared/schedule.js';

/**
 * Refreshes the cached NFL schedule in D1.
 *
 * Weekly rather than daily: a season's fixtures are set months ahead, and the
 * only thing that moves is flex scheduling for late-season kickoff times. A
 * Worker rather than a Pages Function because Pages cannot run on a cron.
 *
 * ESPN's scoreboard is per-week, so a full refresh is 18 requests. That is the
 * whole reason this exists - every visitor was making the same ones.
 */

const DEFAULT_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

// 20 bound parameters per statement is well inside D1's limit, and a season is
// only ~272 games, so one batch per week keeps each round trip small.
const BATCH_SIZE = 200;

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(
            refresh(env, 'cron').catch(error => {
                console.error('Scheduled schedule refresh failed:', error && error.message);
                throw error;
            })
        );
    },

    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname !== '/refresh') return json({ error: 'Not found' }, 404);
        if (request.method !== 'POST') return json({ error: 'Use POST' }, 405, { Allow: 'POST' });
        if (!env.REFRESH_SECRET) return json({ error: 'Manual refresh is not configured' }, 503);
        if (!(await isAuthorized(request, env.REFRESH_SECRET))) return json({ error: 'Unauthorized' }, 401);

        // ?season=2026 to backfill or correct a specific season; otherwise the
        // one the cron would pick.
        const requested = url.searchParams.get('season');
        const season = requested ? Number.parseInt(requested, 10) : null;
        if (requested && (!Number.isInteger(season) || season < 1990 || season > 2100)) {
            return json({ error: 'season must be four digits' }, 400);
        }

        try {
            return json(await refresh(env, 'manual', season), 200);
        } catch (error) {
            console.error('Manual schedule refresh failed:', error && error.message);
            return json({ error: String(error && error.message) }, 502);
        }
    }
};

/** Constant-time bearer comparison over fixed-length digests. */
async function isAuthorized(request, secret) {
    const match = /^Bearer\s+(.+)$/i.exec((request.headers.get('Authorization') || '').trim());
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
 * Which NFL season a given date should refresh.
 *
 * A season is named for the calendar year it starts in and runs into the next,
 * so January's games belong to the previous season. The schedule for an upcoming
 * season is not published until around May, so asking for it before then returns
 * nothing at all - which this Worker treats as an error rather than publishing a
 * season full of holes.
 *
 * July is the cutover: by then the coming season is out, and the previous one
 * has been over for months. Anything unusual - a backfill, an early look at a
 * freshly released schedule - goes through POST /refresh?season=YYYY instead of
 * being guessed at here.
 */
function currentSeason(now) {
    const year = now.getUTCFullYear();
    return now.getUTCMonth() < 6 ? year - 1 : year;
}

async function refresh(env, trigger, requestedSeason = null) {
    if (!env.SCHEDULE_DB) throw new Error('No D1 binding named SCHEDULE_DB');

    const startedAt = Date.now();
    const season = requestedSeason || currentSeason(new Date());
    const source = env.SCOREBOARD_URL || DEFAULT_SCOREBOARD_URL;

    // Weeks are fetched in sequence, not in parallel: this runs once a week with
    // no one waiting on it, and 18 concurrent requests at a public API is a
    // worse neighbour than 18 sequential ones.
    const games = [];
    const emptyWeeks = [];

    for (let week = 1; week <= REGULAR_SEASON_WEEKS; week++) {
        const response = await fetch(`${source}?week=${week}&seasontype=2&dates=${season}`, {
            headers: { Accept: 'application/json' },
            cf: { cacheTtl: 0 }
        });
        if (!response.ok) {
            throw new Error(`ESPN returned ${response.status} for week ${week}`);
        }

        const data = await response.json();
        const events = data.events || [];
        const weekGames = events.map(event => eventToGame(event, season, week)).filter(Boolean);

        if (!weekGames.length) emptyWeeks.push(week);
        games.push(...weekGames);
    }

    // Publishing a season with holes in it would let the byes endpoint derive
    // wrong answers, so refuse rather than half-write.
    if (emptyWeeks.length) {
        throw new Error(`No fixtures returned for week(s) ${emptyWeeks.join(', ')} of ${season}`);
    }
    if (!games.length) throw new Error(`No fixtures found for season ${season}`);

    const current = await currentGeneration(env.SCHEDULE_DB);
    const generation = current + 1;

    const placeholders = GAME_COLUMNS.map(() => '?').join(', ');
    const insert = env.SCHEDULE_DB.prepare(
        `INSERT INTO games (generation, ${GAME_COLUMNS.join(', ')}) VALUES (?, ${placeholders})`
    );

    let statements = [];
    let written = 0;
    for (const game of games) {
        statements.push(insert.bind(generation, ...GAME_COLUMNS.map(c => game[c] ?? null)));
        if (statements.length >= BATCH_SIZE) {
            await env.SCHEDULE_DB.batch(statements);
            written += statements.length;
            statements = [];
        }
    }
    if (statements.length) {
        await env.SCHEDULE_DB.batch(statements);
        written += statements.length;
    }

    const refreshedAt = new Date().toISOString();

    // The commit point. Readers are on the previous generation until this lands.
    await env.SCHEDULE_DB.batch([
        metaPut(env.SCHEDULE_DB, 'current_generation', String(generation)),
        metaPut(env.SCHEDULE_DB, 'refreshed_at', refreshedAt),
        metaPut(env.SCHEDULE_DB, 'season', String(season)),
        metaPut(env.SCHEDULE_DB, 'game_count', String(written))
    ]);

    await env.SCHEDULE_DB.prepare('DELETE FROM games WHERE generation != ?').bind(generation).run();

    const result = {
        ok: true, trigger, season, generation, refreshedAt,
        weeks: REGULAR_SEASON_WEEKS, stored: written,
        durationMs: Date.now() - startedAt
    };
    console.log('Schedule refresh complete:', JSON.stringify(result));
    return result;
}

function metaPut(db, key, value) {
    return db.prepare(
        'INSERT INTO schedule_meta (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).bind(key, value);
}

async function currentGeneration(db) {
    const row = await db.prepare("SELECT value FROM schedule_meta WHERE key = 'current_generation'").first();
    const generation = row ? Number.parseInt(row.value, 10) : NaN;
    return Number.isInteger(generation) ? generation : 0;
}

function json(body, status, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
    });
}
