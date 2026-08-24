/**
 * Which players the daily refresh keeps.
 *
 * This is a pure function, tested directly rather than through the browser,
 * because it is the one decision that determines how big the cache is - and it
 * is easy to get wrong in a way nothing else notices. Too generous and the app
 * carries thousands of players it can never look up; too strict and a real
 * roster renders blanks where a player should be.
 *
 * The position values here are the ones Sleeper actually returns, taken from a
 * live refresh rather than invented.
 */

import { isFantasyRelevant, FANTASY_POSITIONS } from '../../functions/_shared/players.js';

export const name = 'Player filter';

// [position, fantasy_positions, kept?] - `position` is Sleeper's raw value,
// `fantasy_positions` its normalised one. The two disagree constantly, which is
// the whole reason the filter checks both.
const CASES = [
    ['QB',  ['QB'],  true,  'quarterbacks'],
    ['RB',  ['RB'],  true,  'running backs'],
    ['WR',  ['WR'],  true,  'wide receivers'],
    ['TE',  ['TE'],  true,  'tight ends'],
    ['K',   ['K'],   true,  'kickers'],
    ['DEF', ['DEF'], true,  'team defences'],
    // Raw position FB, normalised to RB. Kept by fantasy_positions, not by
    // position - 111 players in the live data depend on that.
    ['FB',  ['RB'],  true,  'fullbacks, via their RB fantasy position'],

    // Every defensive shape Sleeper publishes. The app has no tackle scoring
    // and no defensive roster slot, so none of these can ever be looked up.
    ['LB',  ['LB'],  false, 'linebackers'],
    ['OLB', ['LB'],  false, 'outside linebackers'],
    ['ILB', ['LB'],  false, 'inside linebackers'],
    ['CB',  ['DB'],  false, 'cornerbacks'],
    ['SS',  ['DB'],  false, 'strong safeties'],
    ['FS',  ['DB'],  false, 'free safeties'],
    ['S',   ['DB'],  false, 'safeties'],
    ['DB',  ['DB'],  false, 'defensive backs'],
    ['DE',  ['DL'],  false, 'defensive ends'],
    ['DT',  ['DL'],  false, 'defensive tackles'],
    ['NT',  ['DL'],  false, 'nose tackles'],
    ['DL',  ['DL'],  false, 'defensive linemen'],

    ['G',   [],      false, 'guards'],
    ['T',   [],      false, 'tackles'],
    ['OL',  [],      false, 'offensive linemen'],
    ['LS',  [],      false, 'long snappers']
];

export async function run({ t }) {
    t.describe('Positions the app can roster are kept');
    for (const [position, fantasy, keep, label] of CASES.filter(c => c[2])) {
        t.check(label, isFantasyRelevant({ position, fantasy_positions: fantasy }) === keep);
    }

    t.describe('Positions it cannot are dropped');
    for (const [position, fantasy, keep, label] of CASES.filter(c => !c[2])) {
        t.check(label, isFantasyRelevant({ position, fantasy_positions: fantasy }) === keep);
    }

    t.describe('Malformed players do not slip through');
    {
        t.check('null', isFantasyRelevant(null) === false);
        t.check('undefined', isFantasyRelevant(undefined) === false);
        t.check('an empty object', isFantasyRelevant({}) === false);
        // Sleeper sends null here more often than an empty array, and reading
        // .some() off it would throw rather than drop the player.
        t.check('fantasy_positions null', isFantasyRelevant({ position: 'LB', fantasy_positions: null }) === false);
        t.check('fantasy_positions null on a kept position',
            isFantasyRelevant({ position: 'WR', fantasy_positions: null }) === true);
    }

    t.describe('The keep-list itself');
    {
        t.equal('holds exactly the six rosterable positions', FANTASY_POSITIONS.length, 6);
        // Guards the 55%-of-the-cache regression: putting IDP back here without
        // also building roster slots and scoring for it is not the way in.
        const idp = ['DL', 'LB', 'DB', 'IDP_FLEX'].filter(p => FANTASY_POSITIONS.includes(p));
        t.check('and no IDP positions, which the app cannot roster', idp.length === 0, idp.join(','));
    }
}
