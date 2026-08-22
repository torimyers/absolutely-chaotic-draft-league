/**
 * The league setup must survive a refresh.
 *
 * Two separate faults used to break this. `#configPanel` shipped without its
 * `hidden` class, so the full-screen setup modal painted over the app on every
 * load and nothing ever closed it for a returning user. And the
 * `<meta name="FANTASY_*">` tags - which carry non-empty defaults - were
 * re-applied after the localStorage restore, silently resetting a saved
 * profile's league size, scoring format, record, ranking and theme every time.
 */

import { openApp, readAppState, configureLeague } from '../helpers/app.mjs';

export const name = 'Persistence across a refresh';

/** A profile using non-default values for everything the meta tags also set. */
const SAVED_PROFILE = {
    leagueName: 'Absolutely Chaotic',
    teamName: 'Tori Team',
    leagueSize: 10,
    scoringFormat: 'PPR',
    rosterFormat: 'Super Flex',
    draftPosition: 3,
    teamRecord: '5-2',
    totalPoints: 1234,
    leagueRanking: 2,
    playoffOdds: 88,
    sleeperLeagueId: '123456789012345678',
    sleeperUsername: 'torimyers',
    learningMode: 'expert',
    themeColor: 'purple',
    isConfigured: true
};

export async function run({ browser, baseUrl, t }) {
    t.describe('A first-time visitor');
    {
        const { context, page } = await openApp(browser, { baseUrl });
        const state = await readAppState(page);
        t.check('is shown the setup modal', state.setupModalShown === true);
        await context.close();
    }

    t.describe('A returning visitor with a saved profile');
    {
        const { context, page } = await openApp(browser, { baseUrl });
        await page.evaluate(profile => {
            localStorage.setItem('fantasyAppConfig', JSON.stringify(profile));
        }, SAVED_PROFILE);
        await page.reload();
        await page.waitForTimeout(4000);

        const state = await readAppState(page);
        t.check('goes straight to the app, with no setup modal', state.setupModalShown === false);

        // Every one of these is also set by a meta tag, which is what used to
        // overwrite them. Checking them individually names the field that broke.
        for (const [key, expected] of Object.entries(SAVED_PROFILE)) {
            if (key === 'isConfigured') continue;
            t.check(`keeps ${key} (${JSON.stringify(expected)})`, state.config[key] === expected, state.config[key]);
        }
        await context.close();
    }

    t.describe('A full round trip through the form');
    {
        const { context, page } = await openApp(browser, { baseUrl });
        await configureLeague(page, {
            leagueName: 'Round Trip League',
            teamName: 'Round Trip Team',
            leagueSize: 10,
            scoringFormat: 'PPR',
            rosterFormat: 'Super Flex',
            sleeperLeagueId: '987654321098765432'
        });
        await page.reload();
        await page.waitForTimeout(4000);

        const state = await readAppState(page);
        t.check('does not re-prompt for the league', state.setupModalShown === false);
        t.equal('keeps the league name', state.config.leagueName, 'Round Trip League');
        t.equal('keeps the team name', state.config.teamName, 'Round Trip Team');
        t.equal('keeps the league size', state.config.leagueSize, 10);
        t.equal('keeps the scoring format', state.config.scoringFormat, 'PPR');
        t.equal('keeps the roster format', state.config.rosterFormat, 'Super Flex');
        t.equal('keeps the Sleeper league ID', state.config.sleeperLeagueId, '987654321098765432');
        await context.close();
    }
}
