/**
 * One broken feature must not take the rest of the app with it.
 *
 * Every manager used to be constructed inside a single try block, with
 * EventManager - which owns every click handler on the page - built last, after
 * nine feature initialisers. The first one to throw skipped all the rest,
 * EventManager included, and the app came up with nothing responding to clicks
 * while the console reported only that "some features may not work correctly".
 *
 * The fault is injected at the module level rather than through a malformed API
 * payload, because sleeper-api.js now guarantees its response shapes and no
 * payload breaks a manager any more. What is under test here is the isolation
 * itself, so the failure needs to be unconditional.
 */

import { openApp, readAppState } from '../helpers/app.mjs';

export const name = 'Startup resilience';

/** Serves a TradeAnalyzer whose initialize() always throws. */
const BREAK_TRADE_ANALYZER = context => context.route('**/js/features/trade-analyzer.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `class TradeAnalyzer {
               constructor() {}
               async initialize() { throw new Error('injected failure'); }
           }`
}));

const EVERY_MANAGER = [
    'configManager', 'navigationManager', 'learningManager', 'draftTracker',
    'teamManager', 'waiverWireManager', 'performanceAnalytics', 'leagueAnalyzer',
    'tradeAnalyzer', 'playoffSimulator', 'eventManager', 'profileSync'
];

export async function run({ browser, baseUrl, t }) {
    t.describe('A healthy startup');
    {
        const { context, page } = await openApp(browser, { baseUrl });
        const state = await readAppState(page);
        t.equal('reports nothing as failed', state.status.failedManagers, []);
        for (const manager of EVERY_MANAGER) {
            t.check(`starts ${manager}`, state.status[manager] === true);
        }
        await context.close();
    }

    t.describe('When one feature throws while starting');
    {
        const { context, page } = await openApp(browser, { baseUrl, beforeLoad: BREAK_TRADE_ANALYZER });
        const state = await readAppState(page);

        t.check('the fault really was injected', state.status.tradeAnalyzer === false);
        t.equal('exactly one thing is reported as failed', state.status.failedManagers, ['Trade analyzer']);

        // The managers constructed after the broken one used to be skipped too.
        t.check('EventManager still starts', state.status.eventManager === true);
        t.check('the playoff simulator still starts', state.status.playoffSimulator === true);
        t.check('the weather analyser still starts', state.status.weatherAnalyzer === true);
        t.check('the season predictions still start', state.status.predictiveAnalytics === true);

        // The symptom that actually reached the user: a page that ignores clicks.
        const opensPanel = await page.evaluate(async () => {
            document.getElementById('configPanel').classList.add('hidden');
            const button = document.querySelector('[data-action="show-configuration"]');
            if (!button) return 'no such button';
            button.click();
            await new Promise(resolve => setTimeout(resolve, 400));
            return getComputedStyle(document.getElementById('configPanel')).display !== 'none';
        });
        t.check('clicking still opens the config panel', opensPanel === true, opensPanel);

        // Nav links are wired both by NavigationManager directly and through
        // EventManager's delegation, so this is a check that navigation works at
        // all after a feature failed - the config panel above is the one that
        // isolates EventManager, since nothing else handles that action.
        const navigated = await page.evaluate(async () => {
            const link = document.querySelector('.nav-link[data-page="live-draft"]');
            if (!link) return 'no such link';
            link.click();
            await new Promise(resolve => setTimeout(resolve, 400));
            return document.getElementById('live-draft')?.classList.contains('active');
        });
        t.check('navigating to another page still works', navigated === true, navigated);

        await context.close();
    }
}
