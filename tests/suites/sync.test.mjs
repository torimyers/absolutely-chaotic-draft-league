/**
 * Cross-device sync, driven through the UI on two independent browsers.
 *
 * The point of the feature is that a league configured on a laptop shows up on
 * a phone after typing nothing but a Sleeper username, so that is what this
 * exercises end to end: real clicks, the real Pages Functions, real D1.
 *
 * It uses its own Sleeper account so it neither depends on nor disturbs what
 * the API suite leaves in the database.
 */

import { openApp, readAppState, configureLeague } from '../helpers/app.mjs';

export const name = 'Cross-device sync';

const USERNAME = 'syncuser';

export const sleeperAccounts = [
    { user_id: '123123123123', username: USERNAME, display_name: 'Sync User' }
];

const LEAGUE = {
    leagueName: 'Absolutely Chaotic',
    teamName: 'Tori Team',
    leagueSize: 10,
    scoringFormat: 'PPR',
    rosterFormat: 'Super Flex',
    draftPosition: 3,
    sleeperLeagueId: '987654321098'
};

/** Turns sync on through the panel, the way a user does. */
async function enableSync(page, username) {
    await page.evaluate(() => window.eventManager.showConfiguration());
    await page.fill('#syncUsername', username);
    await page.click('#syncEnableBtn');
    await page.waitForTimeout(2500);
}

export async function run({ browser, baseUrl, t }) {
    // --- The laptop: configure a league, then link the account ---
    const laptop = await openApp(browser, { baseUrl });
    await configureLeague(laptop.page, LEAGUE);
    await enableSync(laptop.page, USERNAME);

    t.describe('The device that turns sync on');
    {
        const state = await readAppState(laptop.page);
        t.check('reports sync as on', state.syncEnabled === true, state.sync);
        t.equal('links to the resolved Sleeper user_id', state.sync?.userId, '123123123123');
        t.check('names the account in the status line', state.syncStatusText.includes(USERNAME), state.syncStatusText);
    }

    t.describe('What reached the server');
    {
        const response = await fetch(`${baseUrl}/api/profile?userId=123123123123`);
        const stored = await response.json();
        t.equal('the profile was created', response.status, 200);
        t.equal('with the league name', stored.config?.leagueName, LEAGUE.leagueName);
        t.equal('the league size', stored.config?.leagueSize, LEAGUE.leagueSize);
        t.equal('the scoring format', stored.config?.scoringFormat, LEAGUE.scoringFormat);
        t.equal('the roster format', stored.config?.rosterFormat, LEAGUE.rosterFormat);
        t.equal('and the Sleeper league ID', stored.config?.sleeperLeagueId, LEAGUE.sleeperLeagueId);
        t.check('but not the draft plan', stored.config?.draftPlan === undefined, stored.config?.draftPlan);
    }

    // --- The phone: a clean browser that has only the username ---
    const phone = await openApp(browser, { baseUrl });

    t.describe('A second device before syncing');
    {
        const state = await readAppState(phone.page);
        t.check('is unconfigured, so it shows the setup modal', state.setupModalShown === true);
        t.check('and has no league of its own', !state.config.leagueName, state.config.leagueName);
    }

    await enableSync(phone.page, USERNAME);

    t.describe('The second device after typing just the username');
    {
        const state = await readAppState(phone.page);
        t.equal('picks up the league name', state.config.leagueName, LEAGUE.leagueName);
        t.equal('the team name', state.config.teamName, LEAGUE.teamName);
        t.equal('the league size', state.config.leagueSize, LEAGUE.leagueSize);
        t.equal('the scoring format', state.config.scoringFormat, LEAGUE.scoringFormat);
        t.equal('the roster format', state.config.rosterFormat, LEAGUE.rosterFormat);
        t.equal('and the Sleeper league ID', state.config.sleeperLeagueId, LEAGUE.sleeperLeagueId);
    }

    await phone.page.reload();
    await phone.page.waitForTimeout(4500);

    t.describe('The second device after a reload');
    {
        const state = await readAppState(phone.page);
        t.check('does not re-prompt for the league', state.setupModalShown === false);
        t.equal('still has the league', state.config.leagueName, LEAGUE.leagueName);
        t.check('and is still syncing', state.syncEnabled === true);
    }

    // --- An edit on one device reaches the other ---
    await laptop.page.evaluate(() => window.eventManager.showConfiguration());
    await laptop.page.fill('#teamName', 'Renamed On The Laptop');
    await laptop.page.evaluate(() => window.eventManager.saveConfiguration());
    await laptop.page.waitForTimeout(2000);
    await phone.page.reload();
    await phone.page.waitForTimeout(4500);

    t.describe('An edit made on the first device');
    {
        const state = await readAppState(phone.page);
        t.equal('shows up on the second', state.config.teamName, 'Renamed On The Laptop');
    }

    // --- Turning sync off must not cost the user their league ---
    await phone.page.evaluate(() => window.eventManager.showConfiguration());
    await phone.page.click('#syncDisableBtn');
    await phone.page.waitForTimeout(800);
    await phone.page.reload();
    await phone.page.waitForTimeout(4000);

    t.describe('Turning sync off');
    {
        const state = await readAppState(phone.page);
        t.check('leaves sync off after a reload', state.syncEnabled === false);
        t.equal('keeps the league in the browser', state.config.leagueName, LEAGUE.leagueName);
        t.check('and still does not re-prompt', state.setupModalShown === false);
    }

    t.describe('When the sync backend is unreachable');
    {
        // The local setup is the source of truth, so a failing backend must be
        // invisible: no error state, no lost league, no setup modal.
        const offline = await openApp(browser, {
            baseUrl,
            beforeLoad: async context => {
                await context.route('**/api/profile**', route => route.abort());
            }
        });
        await offline.page.evaluate(profile => {
            localStorage.setItem('fantasyProfileSync', JSON.stringify({
                enabled: true, userId: '123123123123', username: 'syncuser', lastSyncedAt: 1
            }));
            localStorage.setItem('fantasyAppConfig', JSON.stringify(profile));
        }, { ...LEAGUE, isConfigured: true });
        await offline.page.reload();
        await offline.page.waitForTimeout(4500);

        const state = await readAppState(offline.page);
        t.equal('the local league still loads', state.config.leagueName, LEAGUE.leagueName);
        t.check('the setup modal stays closed', state.setupModalShown === false);
        t.check('and the page did not throw', offline.pageErrors.length === 0, offline.pageErrors);
        await offline.context.close();
    }

    await laptop.context.close();
    await phone.context.close();
}
