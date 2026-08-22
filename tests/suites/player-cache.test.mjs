/**
 * The browser side of the player cache: IndexedDB persistence, and choosing
 * between the site's own cached copy and Sleeper.
 *
 * The player list is roughly 5 MB and the app's in-memory cache dies with the
 * page, so before this layer existed every reload re-downloaded it. Two things
 * are worth pinning down: that a reload really does avoid the network, and that
 * every way the cached copy can be missing still leaves a working app - the
 * cache is an optimisation, and a static deploy has none of it.
 */

import { openApp, healthySleeper } from '../helpers/app.mjs';

export const name = 'Player cache (browser)';

/** Enough players that a real payload is being moved around, not a stub. */
function bigPlayerMap(prefix, count) {
    const players = {};
    for (let i = 0; i < count; i++) {
        players[`${prefix}${i}`] = {
            player_id: `${prefix}${i}`, full_name: `Player ${i}`, position: 'WR',
            team: 'DAL', active: true, fantasy_positions: ['WR'], search_rank: i
        };
    }
    return players;
}

const SLEEPER_PLAYERS = bigPlayerMap('s', 2000);
const CACHED_PLAYERS = bigPlayerMap('c', 400);

/** Counts Sleeper player fetches and serves a large map for them. */
function countingSleeper(counter) {
    return url => {
        if (url.includes('/players/nfl') && !url.includes('trending')) {
            counter.players++;
            return JSON.stringify(SLEEPER_PLAYERS);
        }
        return healthySleeper(url);
    };
}

const getPlayers = page => page.evaluate(async () => {
    const players = await new SleeperAPI().getAllPlayers();
    return { count: Object.keys(players).length, firstKey: Object.keys(players)[0] || null };
});

export async function run({ browser, baseUrl, t }) {
    t.describe('Surviving a reload');
    {
        const counter = { players: 0 };
        // No cached copy in front of it, so this is the plain Sleeper path.
        const { context, page } = await openApp(browser, {
            baseUrl, sleeper: countingSleeper(counter),
            beforeLoad: ctx => ctx.route('**/api/players*', route =>
                route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unbound"}' }))
        });

        const first = counter.players;
        t.check('the first load fetches the player list once', first === 1, `fetches=${first}`);

        // The write is deliberately not awaited by the app, so wait for it.
        let persisted = false;
        for (let i = 0; i < 40 && !persisted; i++) {
            persisted = await page.evaluate(async () =>
                (await persistentCache.get('/players/nfl', 86400000)) !== null);
            if (!persisted) await page.waitForTimeout(250);
        }
        t.check('and writes it to IndexedDB', persisted);

        await page.reload();
        await page.waitForTimeout(3000);
        t.equal('a reload adds no further fetches', counter.players, first);

        const after = await getPlayers(page);
        t.equal('and the full list is still there', after.count, Object.keys(SLEEPER_PLAYERS).length);
        await context.close();
    }

    t.describe('Preferring the site\'s own cached copy');
    {
        const counter = { players: 0 };
        let apiHits = 0;
        const { context, page } = await openApp(browser, {
            baseUrl, sleeper: countingSleeper(counter),
            beforeLoad: ctx => ctx.route('**/api/players*', route => {
                apiHits++;
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CACHED_PLAYERS) });
            })
        });

        t.check('the cached copy is used', apiHits > 0, `hits=${apiHits}`);
        t.equal('and Sleeper is left alone entirely', counter.players, 0);

        const loaded = await getPlayers(page);
        t.equal('the app gets the cached list', loaded.count, Object.keys(CACHED_PLAYERS).length);
        t.check('and it is the cached one, not Sleeper\'s', loaded.firstKey?.startsWith('c'), loaded.firstKey);
        await context.close();
    }

    t.describe('Falling back whenever that copy is not usable');
    // A static deploy, a Docker deploy and a Pages project without the binding
    // each fail differently. None of them may cost the user the app.
    const failures = [
        ['a 503 from an unbound deployment', route => route.fulfill({
            status: 503, contentType: 'application/json', body: '{"error":"unbound"}' })],
        ['a 404 where no Function is deployed', route => route.fulfill({
            status: 404, contentType: 'text/plain', body: 'not found' })],
        ['the SPA shell answering 200 with HTML', route => route.fulfill({
            status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html></html>' })],
        ['the request failing outright', route => route.abort()]
    ];

    for (const [why, handler] of failures) {
        const counter = { players: 0 };
        const { context, page, pageErrors } = await openApp(browser, {
            baseUrl, sleeper: countingSleeper(counter),
            beforeLoad: ctx => ctx.route('**/api/players*', handler)
        });

        const loaded = await getPlayers(page);
        t.check(`${why} falls back to Sleeper`,
            loaded.count === Object.keys(SLEEPER_PLAYERS).length && loaded.firstKey?.startsWith('s'),
            `n=${loaded.count} first=${loaded.firstKey}`);
        t.check(`${why} leaves the page free of errors`, pageErrors.length === 0, pageErrors.join(' | '));
        await context.close();
    }

    t.describe('Refusing to cache a malformed player list');
    {
        // Sleeper answering with an array parses fine but breaks every lookup by
        // id. Caching it would keep handing it back for a day after the upstream
        // problem had passed.
        const { context, page } = await openApp(browser, {
            baseUrl,
            sleeper: url => (url.includes('/players/nfl') && !url.includes('trending'))
                ? '[{"player_id":"1"}]' : healthySleeper(url),
            beforeLoad: ctx => ctx.route('**/api/players*', route =>
                route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
        });

        const loaded = await getPlayers(page);
        t.equal('an array becomes an empty map rather than reaching call sites', loaded.count, 0);

        const stored = await page.evaluate(async () =>
            (await persistentCache.get('/players/nfl', 86400000)) !== null);
        t.check('and nothing is written to IndexedDB', !stored);
        await context.close();
    }

    t.describe('When IndexedDB itself is unavailable');
    {
        const counter = { players: 0 };
        const { context, page, pageErrors } = await openApp(browser, {
            baseUrl, sleeper: countingSleeper(counter),
            // A page that never loads the module is the same as one whose
            // browser refuses storage: persistence goes, nothing else does.
            //
            // /api/players is stubbed away too. The site under test shares one
            // database with the API suite, which seeds it, so leaving this
            // unrouted would quietly measure that suite's rows instead of the
            // fallback this check is about.
            beforeLoad: async ctx => {
                await ctx.route('**/js/utils/persistent-cache.js', route => route.abort());
                await ctx.route('**/api/players*', route => route.fulfill({
                    status: 503, contentType: 'application/json', body: '{"error":"unbound"}' }));
            }
        });

        const loaded = await getPlayers(page);
        t.equal('the app still loads its players', loaded.count, Object.keys(SLEEPER_PLAYERS).length);
        t.check('without a page error', pageErrors.length === 0, pageErrors.join(' | '));
        await context.close();
    }
}
