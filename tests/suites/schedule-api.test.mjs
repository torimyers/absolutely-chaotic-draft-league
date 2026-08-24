/**
 * The schedule cache: fixtures, and the bye weeks derived from them.
 *
 * Byes are the reason this exists. They used to be a table written into the
 * source by hand, still saying 2024 two seasons later, and two pieces of lineup
 * advice trusted it. Deriving them from fixtures means they cannot go stale
 * without the fixtures going stale too - and those are refreshed weekly.
 *
 * The seeded season is small but structurally real: every team plays every week
 * except one, which is the only shape a bye can be read out of.
 */

import { execSql } from '../helpers/servers.mjs';
import { onRequestGet as readSchedule } from '../../functions/api/schedule/index.js';
import { onRequestGet as readByes } from '../../functions/api/schedule/byes.js';

export const name = 'Schedule API';

const SEASON = 2031;
const GENERATION = 2;
const WEEKS = 18;

// Four teams over a full 18-week season. BUF and MIA sit out week 5, NE and NYJ
// sit out week 9; everyone plays every other week.
const TEAMS = ['BUF', 'MIA', 'NE', 'NYJ'];
const BYES = { BUF: 5, MIA: 5, NE: 9, NYJ: 9 };

function buildSeason() {
    const rows = [];
    for (let week = 1; week <= WEEKS; week++) {
        const playing = TEAMS.filter(team => BYES[team] !== week);
        for (let i = 0; i + 1 < playing.length; i += 2) {
            rows.push({
                id: `g${SEASON}w${week}-${playing[i]}`,
                week,
                home: playing[i],
                away: playing[i + 1],
                kickoff: `${SEASON}-09-${String(week).padStart(2, '0')}T17:00:00Z`
            });
        }
    }
    return rows;
}

export async function run({ baseUrl, t, repoRoot, persistTo, log }) {
    const call = async (path) => {
        const response = await fetch(`${baseUrl}${path}`);
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        return { status: response.status, body, headers: response.headers };
    };

    t.describe('Before the sync Worker has ever run');
    {
        const schedule = await call(`/api/schedule?season=${SEASON}&week=1`);
        t.equal('an unpopulated cache is a 503', schedule.status, 503);
        const byes = await call(`/api/schedule/byes?season=${SEASON}`);
        t.equal('and so is the byes endpoint', byes.status, 503);
    }

    const rows = buildSeason();
    const columns = 'generation, season, week, game_id, kickoff, home_team, away_team, ' +
        'home_name, away_name, venue_name, venue_city, venue_indoor';
    const values = rows.map(r =>
        `(${GENERATION}, ${SEASON}, ${r.week}, '${r.id}', '${r.kickoff}', '${r.home}', '${r.away}', ` +
        `'${r.home} Team', '${r.away} Team', '${r.home} Field', '${r.home} City', 0)`).join(', ');
    // A superseded generation that must never surface.
    const stale = `(${GENERATION - 1}, ${SEASON}, 1, 'stale-1', '${SEASON}-09-01T17:00:00Z', ` +
        `'BUF', 'NE', 'Old', 'Old', 'Old Field', 'Old City', 0)`;

    await execSql({ repoRoot, persistTo, log, binding: 'SCHEDULE_DB',
        sql: `INSERT INTO games (${columns}) VALUES ${values}, ${stale};` });
    await execSql({ repoRoot, persistTo, log, binding: 'SCHEDULE_DB',
        sql: `INSERT INTO schedule_meta (key, value) VALUES ('current_generation', '${GENERATION}'), ` +
             `('refreshed_at', '${SEASON}-08-01T08:47:00.000Z'), ('season', '${SEASON}') ` +
             `ON CONFLICT(key) DO UPDATE SET value = excluded.value;` });

    t.describe('Serving a week of fixtures');
    {
        const week3 = await call(`/api/schedule?season=${SEASON}&week=3`);
        t.equal('answers 200', week3.status, 200);
        t.equal('with that week only', new Set((week3.body || []).map(g => g.week)).size, 1);
        t.check('in the shape the ESPN path produces',
            (week3.body || []).every(g => g.homeTeam && g.awayTeam && 'venueIndoor' in g),
            JSON.stringify((week3.body || [])[0]));
        t.check('and never the superseded generation',
            !(week3.body || []).some(g => g.id === 'stale-1'));
        t.equal('the generation header names the live one',
            week3.headers.get('X-Schedule-Generation'), String(GENERATION));
    }

    t.describe('Serving a whole season');
    {
        const all = await call(`/api/schedule?season=${SEASON}`);
        t.equal('answers 200', all.status, 200);
        t.equal('with every seeded fixture', (all.body || []).length, rows.length);
        const weeks = (all.body || []).map(g => g.week);
        t.check('ordered by week', weeks.every((w, i) => i === 0 || weeks[i - 1] <= w));
    }

    t.describe('Deriving bye weeks');
    {
        const byes = await call(`/api/schedule/byes?season=${SEASON}`);
        t.equal('answers 200', byes.status, 200);
        for (const [team, week] of Object.entries(BYES)) {
            t.equal(`${team} is on bye in week ${week}`, byes.body?.[team], week);
        }
        t.equal('and names no other team', Object.keys(byes.body || {}).length, TEAMS.length);
        t.equal('the team count header agrees', byes.headers.get('X-Byes-Teams'), String(TEAMS.length));
    }

    t.describe('Refusing to guess from a season it does not have');
    {
        // Every team looks idle in a week that is missing, so a bye derived from
        // a partial season benches players who are playing.
        const missing = await call(`/api/schedule/byes?season=${SEASON + 1}`);
        t.equal('an unknown season is a 404, not an empty map', missing.status, 404);
        const fixtures = await call(`/api/schedule?season=${SEASON + 1}`);
        t.equal('and the fixtures endpoint agrees', fixtures.status, 404);
    }

    t.describe('Rejecting nonsense');
    for (const [path, why] of [
        ['/api/schedule', 'a missing season'],
        ['/api/schedule?season=abc', 'a non-numeric season'],
        ['/api/schedule?season=42', 'a two-digit season'],
        [`/api/schedule?season=${SEASON}&week=0`, 'a zero week'],
        [`/api/schedule?season=${SEASON}&week=99`, 'a week past any season'],
        ['/api/schedule/byes?season=abc', 'a non-numeric season on byes']
    ]) {
        const bad = await call(path);
        t.equal(`${why} is a 400`, bad.status, 400);
    }

    t.describe('With no D1 binding');
    {
        // Called directly: wrangler.toml carries the real bindings, so
        // `wrangler pages dev` cannot serve this repository without them.
        for (const [label, handler] of [['fixtures', readSchedule], ['byes', readByes]]) {
            const response = await handler({
                request: new Request(`https://example.test/api/schedule?season=${SEASON}`),
                env: {}
            });
            t.equal(`${label} answer 503`, response.status, 503);
            const body = await response.json();
            t.check(`${label} name the binding that is missing`,
                /not bound/i.test(body.error || ''), body.error);
        }
    }
}
