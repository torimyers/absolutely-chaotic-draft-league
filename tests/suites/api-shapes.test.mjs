/**
 * Malformed Sleeper responses must not break a feature.
 *
 * `loadMarketMoves` guarded its trending data with `(adds || []).forEach`,
 * which reads as a null check but is not one: the value that broke it was a
 * truthy object, so `.forEach` threw a TypeError out of initialize(). Ten other
 * call sites across five features had no guard at all, so sleeper-api.js now
 * guarantees the shapes every caller already assumed.
 *
 * These checks assert the feature keeps *working* on a bad payload - degrading
 * to an empty market - rather than merely failing tidily.
 */

import { openApp, readAppState, PLAYERS, TRENDING_ADDS, TRENDING_DROPS } from '../helpers/app.mjs';

export const name = 'Sleeper response shapes';

/**
 * Builds a Sleeper stub where the two endpoints that used to break can be given
 * any body at all.
 */
function sleeperWith({ trending, drops, players }) {
    return url => {
        if (url.includes('/state/nfl')) {
            return JSON.stringify({ week: 1, season: '2025', season_type: 'regular' });
        }
        if (url.includes('/projections/')) return '[]';
        if (url.includes('trending/drop')) return drops;
        if (url.includes('trending')) return trending;
        if (url.includes('/players/nfl')) return players;
        return '{}';
    };
}

const GOOD = {
    trending: JSON.stringify(TRENDING_ADDS),
    drops: JSON.stringify(TRENDING_DROPS),
    players: JSON.stringify(PLAYERS)
};

/** Reads how much of the trade market actually survived. */
const readMarket = page => page.evaluate(() => ({
    started: !!window.tradeAnalyzer,
    moves: window.tradeAnalyzer?.marketMoves?.size ?? null,
    scale: window.tradeAnalyzer?.marketScale ?? null
}));

export async function run({ browser, baseUrl, t }) {
    t.describe('Well-formed responses');
    {
        const { context, page } = await openApp(browser, { baseUrl, sleeper: sleeperWith(GOOD) });
        const state = await readAppState(page);
        const market = await readMarket(page);
        t.equal('nothing fails', state.status.failedManagers, []);
        t.check('both trending feeds are parsed', market.moves === 2, market.moves);
        t.check('and the market scale comes from the real counts', market.scale === 900, market.scale);
        await context.close();
    }

    t.describe('Trending returns an object instead of an array');
    {
        const { context, page } = await openApp(browser, {
            baseUrl, sleeper: sleeperWith({ ...GOOD, trending: '{}', drops: '{}' })
        });
        const state = await readAppState(page);
        const market = await readMarket(page);
        t.equal('nothing fails', state.status.failedManagers, []);
        t.check('the trade analyser still starts', market.started === true);
        t.check('the market degrades to empty', market.moves === 0, market.moves);
        t.check('and the scale degrades to zero', market.scale === 0, market.scale);
        await context.close();
    }

    t.describe('The player database returns an array instead of an object');
    {
        const { context, page } = await openApp(browser, {
            baseUrl, sleeper: sleeperWith({ ...GOOD, players: '[]' })
        });
        const state = await readAppState(page);
        t.equal('nothing fails', state.status.failedManagers, []);
        await context.close();
    }

    t.describe('Junk entries inside an otherwise valid array');
    {
        const { context, page } = await openApp(browser, {
            baseUrl,
            sleeper: sleeperWith({
                trending: '[null, {"player_id":"111","count":5}, 7]',
                drops: '[]',
                players: 'null'
            })
        });
        const state = await readAppState(page);
        const market = await readMarket(page);
        t.equal('nothing fails', state.status.failedManagers, []);
        t.check('the junk rows are dropped', market.moves === 1, market.moves);
        t.check('and the real row is kept', market.started === true);
        await context.close();
    }
}
