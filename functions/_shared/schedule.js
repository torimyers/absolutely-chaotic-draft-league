/**
 * Shared between the Pages Functions that read the schedule cache and the Worker
 * that refreshes it, so the column list, the team-abbreviation normalisation and
 * the bye derivation cannot drift apart.
 */

export const GAME_COLUMNS = [
    'game_id',
    'season',
    'week',
    'kickoff',
    'home_team',
    'away_team',
    'home_name',
    'away_name',
    'venue_name',
    'venue_city',
    'venue_indoor'
];

/** The 18-week regular season. Bye derivation depends on knowing all of them. */
export const REGULAR_SEASON_WEEKS = 18;

/**
 * ESPN and Sleeper disagree on a handful of abbreviations, and the app indexes
 * players by Sleeper's. Normalising on the way in means every consumer of this
 * cache sees one vocabulary.
 *
 * Kept identical to weather-analyzer's own map, which still needs it for the
 * ESPN fallback path.
 */
const TEAM_ALIASES = { WSH: 'WAS', LA: 'LAR', JAC: 'JAX', OAK: 'LV', SD: 'LAC', STL: 'LAR' };

export function normalizeTeam(abbr) {
    if (!abbr) return null;
    const upper = String(abbr).toUpperCase();
    return TEAM_ALIASES[upper] || upper;
}

/** Turns one ESPN scoreboard event into a row, or null if it is unusable. */
export function eventToGame(event, season, week) {
    const competition = (event.competitions || [])[0];
    if (!competition) return null;

    const competitors = competition.competitors || [];
    const home = competitors.find(c => c.homeAway === 'home');
    const away = competitors.find(c => c.homeAway === 'away');
    if (!home || !away) return null;

    const homeTeam = normalizeTeam(home.team?.abbreviation);
    const awayTeam = normalizeTeam(away.team?.abbreviation);
    if (!homeTeam || !awayTeam) return null;

    const venue = competition.venue || {};

    return {
        game_id: String(event.id),
        season,
        week,
        kickoff: event.date || competition.date || null,
        home_team: homeTeam,
        away_team: awayTeam,
        home_name: home.team?.displayName || null,
        away_name: away.team?.displayName || null,
        venue_name: venue.fullName || null,
        venue_city: venue.address?.city || null,
        venue_indoor: venue.indoor === true ? 1 : 0
    };
}

/** A D1 row back to the shape weather-analyzer already expects from ESPN. */
export function rowToGame(row) {
    return {
        id: row.game_id,
        season: row.season,
        week: row.week,
        kickoff: row.kickoff,
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        homeName: row.home_name || '',
        awayName: row.away_name || '',
        venueName: row.venue_name || '',
        venueCity: row.venue_city || '',
        venueIndoor: row.venue_indoor === 1
    };
}

/**
 * Derives each team's bye week from a full season of fixtures.
 *
 * A bye is a week in which a team has no game, which is only a safe inference
 * when every week is present: with weeks missing, a team simply looks idle. The
 * caller is responsible for passing a complete season - see
 * `isCompleteSeason` - and a team with no gap, or more than one, is left out
 * rather than guessed at.
 *
 * @param {Array<{week:number, home_team:string, away_team:string}>} games
 * @param {number} totalWeeks
 * @returns {Object<string, number>} team abbreviation -> bye week
 */
export function deriveByeWeeks(games, totalWeeks = REGULAR_SEASON_WEEKS) {
    const playedWeeks = new Map();

    for (const game of games) {
        for (const team of [game.home_team, game.away_team]) {
            if (!team) continue;
            if (!playedWeeks.has(team)) playedWeeks.set(team, new Set());
            playedWeeks.get(team).add(game.week);
        }
    }

    const byes = {};
    for (const [team, weeks] of playedWeeks) {
        const missing = [];
        for (let week = 1; week <= totalWeeks; week++) {
            if (!weeks.has(week)) missing.push(week);
        }
        // Exactly one gap is a bye. Zero means the season is not what we think
        // it is; more than one means the data is incomplete for this team, and
        // a wrong bye is worse than no bye - it benches a playing starter.
        if (missing.length === 1) byes[team] = missing[0];
    }

    return byes;
}

/** Whether every week of the regular season is represented. */
export function isCompleteSeason(weeks, totalWeeks = REGULAR_SEASON_WEEKS) {
    const present = new Set(weeks);
    for (let week = 1; week <= totalWeeks; week++) {
        if (!present.has(week)) return false;
    }
    return true;
}
