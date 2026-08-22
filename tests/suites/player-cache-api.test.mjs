/**
 * The /api/players endpoint, driven directly rather than through the browser.
 *
 * This is the read half of the player cache. The write half lives in
 * workers/player-sync, which `wrangler pages dev` does not boot, so the rows are
 * seeded here instead - what matters for this endpoint is the SQL it runs and
 * the shape it hands back, not how the table came to be filled.
 *
 * The shape is the load-bearing part: the client swaps this in for Sleeper's own
 * /players/nfl without reshaping anything, so a row that does not round-trip
 * back into Sleeper's object form breaks call sites far from here.
 */

import { execSql } from '../helpers/servers.mjs';

export const name = 'Player cache API';

const GENERATION = 3;

// Two positions and a deliberate gap in search_rank, so ordering and filtering
// are distinguishable from "returned everything in insertion order".
const SEEDED = [
    { id: 'p1', first: 'Alpha', last: 'Back',  pos: 'RB', team: 'DAL', rank: 1,    active: 1 },
    { id: 'p2', first: 'Bravo', last: 'Wide',  pos: 'WR', team: 'PHI', rank: 5,    active: 1 },
    { id: 'p3', first: 'Chas',  last: 'Wide',  pos: 'WR', team: 'KC',  rank: 12,   active: 0 },
    { id: 'p4', first: 'Delta', last: 'Tight', pos: 'TE', team: 'SF',  rank: null, active: 1 }
];

export async function run({ baseUrl, t, repoRoot, persistTo, log, startUnboundSite }) {
    const values = SEEDED.map(p => `(${GENERATION}, '${p.id}', '${p.first}', '${p.last}', ` +
        `'${p.first} ${p.last}', '${p.pos}', '["${p.pos}"]', '${p.team}', 27, 4, 'Active', ` +
        `${p.active}, NULL, NULL, 1, '${p.pos}', ${p.rank === null ? 'NULL' : p.rank}, ` +
        `'Alabama', '72', '210', '1998-01-01')`).join(', ');

    // A stale generation that must never be served, proving reads are scoped
    // rather than just picking up whatever is in the table.
    const stale = `(${GENERATION - 1}, 'old1', 'Stale', 'Player', 'Stale Player', 'RB', ` +
        `'["RB"]', 'NYG', 30, 9, 'Active', 1, NULL, NULL, 1, 'RB', 2, 'LSU', '70', '200', '1994-01-01')`;

    const columns = 'generation, player_id, first_name, last_name, full_name, position, ' +
        'fantasy_positions, team, age, years_exp, status, active, injury_status, ' +
        'injury_body_part, depth_chart_order, depth_chart_position, search_rank, ' +
        'college, height, weight, birth_date';

    const call = async (path) => {
        const response = await fetch(`${baseUrl}${path}`);
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        return { status: response.status, body, headers: response.headers };
    };

    t.describe('Before the sync Worker has ever run');
    {
        const empty = await call('/api/players');
        t.equal('an unpopulated cache is a 503, not an empty map', empty.status, 503);
        // An empty 200 would be cached by the client for a day, which is a much
        // worse failure than saying "not ready" and letting it use Sleeper.
        t.check('and does not answer with players', !empty.body || !empty.body.p1);
    }

    await execSql({ repoRoot, persistTo, log, sql: `INSERT INTO players (${columns}) VALUES ${values}, ${stale};` });
    await execSql({
        repoRoot, persistTo, log,
        sql: `INSERT INTO player_cache_meta (key, value) VALUES ('current_generation', '${GENERATION}'), ` +
             `('refreshed_at', '2026-08-22T09:12:00.000Z'), ('player_count', '${SEEDED.length}') ` +
             `ON CONFLICT(key) DO UPDATE SET value = excluded.value;`
    });

    t.describe('Serving the current generation');
    {
        const all = await call('/api/players');
        t.equal('a populated cache answers 200', all.status, 200);
        t.equal('with one entry per seeded player', Object.keys(all.body || {}).length, SEEDED.length);
        t.check('keyed by player id, the shape callers index by', Boolean(all.body?.p1));
        t.check('and the superseded generation is not served', !all.body?.old1);

        t.equal('the count header matches the body', all.headers.get('X-Players-Count'), String(SEEDED.length));
        t.equal('the generation header names the live one', all.headers.get('X-Players-Generation'), String(GENERATION));
        t.check('the refreshed-at header is a timestamp',
            /^\d{4}-\d{2}-\d{2}T/.test(all.headers.get('X-Players-Refreshed-At') || ''),
            all.headers.get('X-Players-Refreshed-At'));
    }

    t.describe('Rows round-trip back into Sleeper\'s object shape');
    {
        const { body } = await call('/api/players');
        const player = body.p1;
        t.equal('full_name survives', player.full_name, 'Alpha Back');
        t.equal('position survives', player.position, 'RB');
        t.equal('team survives', player.team, 'DAL');
        // SQLite has no boolean or array type, so both are lossy unless the
        // mapping puts them back - and callers treat them as JS types.
        t.equal('active comes back as a boolean, not 1', typeof player.active, 'boolean');
        t.check('fantasy_positions comes back as an array', Array.isArray(player.fantasy_positions),
            JSON.stringify(player.fantasy_positions));
        t.check('the fields the app never reads are absent',
            !('espn_id' in player) && !('hashtag' in player) && !('search_full_name' in player),
            Object.keys(player).join(','));
    }

    t.describe('Slicing, which is why this is a table and not a blob');
    {
        const top = await call('/api/players?limit=2');
        const ranks = Object.values(top.body).map(p => p.search_rank);
        t.equal('limit caps the result', Object.keys(top.body).length, 2);
        t.check('and takes them in rank order', ranks[0] === 1 && ranks[1] === 5, JSON.stringify(ranks));

        const wrs = await call('/api/players?position=WR');
        t.check('position filters', Object.values(wrs.body).every(p => p.position === 'WR'),
            Object.values(wrs.body).map(p => p.position).join(','));
        t.equal('and returns every match', Object.keys(wrs.body).length, 2);

        const both = await call('/api/players?position=WR,RB&limit=2');
        t.equal('position and limit combine', Object.keys(both.body).length, 2);

        // NULL sorts first in SQLite, which would put the unranked player at the
        // top of a draft board.
        const all = await call('/api/players?limit=4');
        const order = Object.values(all.body).map(p => p.search_rank ?? 'null');
        t.check('unranked players sort last, not first', order[order.length - 1] === 'null',
            JSON.stringify(order));
    }

    t.describe('Rejecting nonsense rather than guessing');
    for (const [query, why] of [
        ['?limit=0', 'a zero limit'],
        ['?limit=abc', 'a non-numeric limit'],
        ['?limit=999999', 'a limit past the cap'],
        ['?position=', 'an empty position'],
        ["?position=QB';DROP TABLE players;--", 'a position carrying SQL']
    ]) {
        const bad = await call(`/api/players${query}`);
        t.equal(`${why} is a 400`, bad.status, 400);
    }
    {
        // The rejection above must not have executed; the table is still there.
        const after = await call('/api/players');
        t.equal('and the table survived the attempt', Object.keys(after.body || {}).length, SEEDED.length);
    }

    t.describe('With no D1 binding, as the repository ships');
    {
        const unbound = await startUnboundSite();
        const response = await fetch(`${unbound.baseUrl}/api/players`);
        t.equal('the endpoint answers 503', response.status, 503);
        t.check('as JSON, so the client can tell it apart from the SPA shell',
            (response.headers.get('content-type') || '').includes('json'),
            response.headers.get('content-type'));
    }
}
