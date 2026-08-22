/**
 * Opening the app in a browser, with Sleeper's data endpoints under test control.
 *
 * The browser's own calls to api.sleeper.app are intercepted rather than
 * allowed out: the tests must not depend on Sleeper being up, and several
 * suites need to choose exactly what those endpoints return. Requests the site
 * makes to its own origin - including /api/profile - are left alone so they
 * reach the real Pages Functions.
 */

/** How long to let the app settle. The feature pass is behind a 750ms timer. */
const BOOT_SETTLE_MS = 5000;

/**
 * The sync endpoints are rate limited per client IP, so every browser context
 * gets its own - otherwise unrelated suites share one bucket and a later one
 * fails for reasons that have nothing to do with what it is testing.
 */
let nextClientIp = 1;
export function freshClientIp() {
    return `10.99.${Math.floor(nextClientIp / 254)}.${(nextClientIp++ % 254) + 1}`;
}

/** A plausible pair of players, enough for the features that index by ID. */
export const PLAYERS = {
    '111': { player_id: '111', full_name: 'Real Back', position: 'RB', team: 'DAL', active: true },
    '222': { player_id: '222', full_name: 'Real Wideout', position: 'WR', team: 'PHI', active: true }
};

export const TRENDING_ADDS = [{ player_id: '111', count: 900 }, { player_id: '222', count: 400 }];

// Drops have to differ from adds, or every player nets to zero and any check on
// the resulting market scale passes for the wrong reason.
export const TRENDING_DROPS = [{ player_id: '222', count: 100 }];

/**
 * Default Sleeper responses: healthy, well-formed, and boring.
 *
 * @param {string} url
 * @returns {string} response body
 */
export function healthySleeper(url) {
    if (url.includes('/state/nfl')) {
        return JSON.stringify({ week: 1, season: '2025', season_type: 'regular' });
    }
    if (url.includes('trending/drop')) return JSON.stringify(TRENDING_DROPS);
    if (url.includes('trending')) return JSON.stringify(TRENDING_ADDS);
    if (url.includes('/projections/')) return '[]';
    if (url.includes('/players/nfl')) return JSON.stringify(PLAYERS);
    return '{}';
}

/**
 * Opens the app in a fresh browser context.
 *
 * @param {import('playwright').Browser} browser
 * @param {object} [options]
 * @param {string} options.baseUrl        Where the site is served.
 * @param {(url: string) => string} [options.sleeper]  Body for a Sleeper URL.
 * @param {(context: import('playwright').BrowserContext) => Promise<void>} [options.beforeLoad]
 *        Runs after routing is installed but before the page is opened - the
 *        place to intercept a script file or an API route.
 * @param {number} [options.settleMs]
 * @param {string} [options.clientIp] Rate-limit bucket; defaults to a fresh one.
 */
export async function openApp(browser, options = {}) {
    const {
        baseUrl,
        sleeper = healthySleeper,
        beforeLoad,
        settleMs = BOOT_SETTLE_MS,
        clientIp = freshClientIp()
    } = options;

    const context = await browser.newContext({
        extraHTTPHeaders: { 'CF-Connecting-IP': clientIp }
    });

    await context.route('**://api.sleeper.app/**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: sleeper(route.request().url())
    }));

    // The other two third parties the app talks to. Nothing under test depends
    // on their content, so they answer empty rather than being left to fail.
    await context.route('**://site.api.espn.com/**', route => route.fulfill({
        status: 200, contentType: 'application/json', body: '{"events":[]}'
    }));
    await context.route('**://api.open-meteo.com/**', route => route.fulfill({
        status: 200, contentType: 'application/json', body: '{}'
    }));

    if (beforeLoad) await beforeLoad(context);

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`${baseUrl}/index.html`);
    await page.waitForTimeout(settleMs);

    return { context, page, pageErrors };
}

/** The state the suites assert on, read out of the live page. */
export function readAppState(page) {
    return page.evaluate(() => {
        const config = window.configManager ? window.configManager.config : null;
        const panel = document.getElementById('configPanel');
        return {
            config,
            sync: window.profileSync ? window.profileSync.state : null,
            syncEnabled: window.profileSync ? window.profileSync.isEnabled : null,
            syncStatusText: document.getElementById('syncStatus')?.textContent || '',
            setupModalShown: panel ? getComputedStyle(panel).display !== 'none' : null,
            status: typeof window.getAppStatus === 'function' ? window.getAppStatus() : null
        };
    });
}

/** Fills the league form and saves it, the way a user would. */
export async function configureLeague(page, league) {
    await page.evaluate(() => window.eventManager.showConfiguration());
    await page.fill('#leagueName', league.leagueName);
    await page.fill('#teamName', league.teamName);
    await page.selectOption('#leagueSize', String(league.leagueSize));
    await page.selectOption('#scoringFormat', league.scoringFormat);
    await page.selectOption('#rosterFormat', league.rosterFormat);
    if (league.draftPosition) await page.selectOption('#draftPosition', String(league.draftPosition));
    if (league.sleeperLeagueId) await page.fill('#sleeperLeagueId', league.sleeperLeagueId);
    await page.evaluate(() => window.eventManager.saveConfiguration());
    await page.waitForTimeout(1500);
}
