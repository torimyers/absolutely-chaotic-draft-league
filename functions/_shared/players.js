/**
 * Shared between the Pages Function that reads the cache and the Worker that
 * refreshes it, so the column list and the row shape cannot drift apart.
 *
 * Lives under functions/_shared/ because Pages neither routes nor serves
 * underscore-prefixed directories, and the sync Worker bundles it by relative
 * import.
 */

/**
 * The fields the app actually reads off a player, and nothing else.
 *
 * Sleeper returns roughly 45 per player. The rest are cross-provider ids
 * (espn_id, yahoo_id, rotowire_id, sportradar_id, gsis_id), search duplicates
 * of names already present, and biographical detail no feature touches. Adding
 * a field here means adding the column in schema.sql too.
 */
export const PLAYER_COLUMNS = [
    'player_id',
    'first_name',
    'last_name',
    'full_name',
    'position',
    'fantasy_positions',
    'team',
    'age',
    'years_exp',
    'status',
    'active',
    'injury_status',
    'injury_body_part',
    'depth_chart_order',
    'depth_chart_position',
    'search_rank',
    'college',
    'height',
    'weight',
    'birth_date'
];

/**
 * Positions this app can actually roster. Anything else is not worth storing.
 *
 * Sleeper also publishes the IDP positions - DL, LB, DB, IDP_FLEX - because it
 * supports leagues that draft individual defenders. This app does not: its
 * roster formats are QB-count variants and its scoring formats are PPR
 * variants, with nowhere to configure a tackle or a linebacker slot. Keeping
 * them cost 5,485 of 9,884 rows, 55% of the cache, for players nothing could
 * ever look up.
 *
 * Adding IDP support later means putting them back here and re-running a
 * refresh - but the roster slots and scoring are the real work, not this.
 */
export const FANTASY_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/**
 * Whether a Sleeper player is worth keeping.
 *
 * Position is the axis, not `active`: filtering on that would drop injured and
 * suspended players who are still sitting on somebody's roster, and a roster
 * referencing a player id we discarded renders as a blank.
 *
 * `fantasy_positions` is checked first because it is the normalised form.
 * Sleeper's raw `position` splits the defence a dozen ways - CB, SS, FS, S,
 * DE, DT, NT, OLB, ILB - which all collapse to DL/LB/DB there. Fullbacks come
 * the other way and are kept by it: their position is FB, their
 * fantasy_positions is ["RB"].
 */
export function isFantasyRelevant(player) {
    if (!player) return false;

    const positions = Array.isArray(player.fantasy_positions) ? player.fantasy_positions : [];
    if (positions.some(p => FANTASY_POSITIONS.includes(p))) return true;

    return FANTASY_POSITIONS.includes(player.position);
}

/** SQLite has no boolean type, and undefined is not a bindable value. */
function toBindable(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
    return value;
}

/** Sleeper's player object to a positional row matching PLAYER_COLUMNS. */
export function toRow(playerId, player) {
    return PLAYER_COLUMNS.map(column => {
        if (column === 'player_id') return String(playerId);
        return toBindable(player[column]);
    });
}

/**
 * A D1 row back to the object shape the client already expects, so the browser
 * cannot tell whether a player came from here or straight from Sleeper.
 */
export function fromRow(row) {
    const player = {};

    for (const column of PLAYER_COLUMNS) {
        const value = row[column];
        if (value === null || value === undefined) continue;

        if (column === 'fantasy_positions') {
            try {
                player[column] = JSON.parse(value);
            } catch {
                player[column] = null;
            }
        } else if (column === 'active') {
            player[column] = value === 1;
        } else {
            player[column] = value;
        }
    }

    // Sleeper always sends these two; features read them without guarding, so
    // rebuild them rather than letting a null column surface as undefined.
    if (!player.full_name) {
        const name = [player.first_name, player.last_name].filter(Boolean).join(' ');
        if (name) player.full_name = name;
    }
    if (!player.fantasy_positions && player.position) {
        player.fantasy_positions = [player.position];
    }

    return player;
}
