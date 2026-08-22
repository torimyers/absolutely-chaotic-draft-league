#!/usr/bin/env node
/**
 * End-to-end test runner.
 *
 * Boots a stub Sleeper and the real site under `wrangler pages dev`, then drives
 * the app in Chromium. Nothing reaches the network: Sleeper, ESPN and Open-Meteo
 * are all intercepted, so a run is the same on a laptop, in CI and offline.
 *
 *   npm test                      # everything
 *   npm test -- sync persistence  # only suites whose name matches
 *   npm test -- --headed          # watch it happen
 *
 * Requires a Chromium for Playwright:  npx playwright install chromium
 * If a browser is already on the machine, point CHROMIUM_EXECUTABLE at it.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdir } from 'node:fs/promises';

import { Checks } from './helpers/checks.mjs';
import { startFakeSleeper, startSite } from './helpers/servers.mjs';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testsDir, '..');

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const verbose = args.includes('--verbose');
const filters = args.filter(arg => !arg.startsWith('--'));

const log = verbose ? text => process.stdout.write(text) : () => {};

async function loadSuites() {
    const files = (await readdir(join(testsDir, 'suites')))
        .filter(file => file.endsWith('.test.mjs'))
        .sort();

    const suites = [];
    for (const file of files) {
        const module = await import(join(testsDir, 'suites', file));
        const suiteName = module.name || file;
        if (filters.length && !filters.some(f => `${file} ${suiteName}`.toLowerCase().includes(f.toLowerCase()))) {
            continue;
        }
        suites.push({ file, name: suiteName, module });
    }
    return suites;
}

async function main() {
    const suites = await loadSuites();

    if (!suites.length) {
        console.error(filters.length
            ? `No suites match ${filters.join(', ')}`
            : 'No suites found in tests/suites');
        process.exit(1);
    }

    // Each suite declares the Sleeper accounts it needs; the stub serves the union.
    const accounts = suites.flatMap(suite => suite.module.sleeperAccounts || []);

    console.log(`\nStarting the stub Sleeper and wrangler (this takes a moment)...`);
    const sleeper = await startFakeSleeper(accounts);
    let site;
    let browser;

    try {
        site = await startSite({ repoRoot, sleeperBaseUrl: sleeper.baseUrl, log });
        browser = await chromium.launch({
            headless: !headed,
            ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {})
        });
        console.log(`Serving ${site.baseUrl}\n`);

        // A second site with no D1 binding, booted only if a suite asks for it -
        // it costs another wrangler startup. This is how the repository ships and
        // how any deployment that has not set sync up behaves.
        let unbound = null;
        const startUnboundSite = async () => {
            if (!unbound) {
                console.log('  (booting a second site with no D1 binding...)');
                unbound = await startSite({
                    repoRoot, sleeperBaseUrl: sleeper.baseUrl, withDatabase: false, log
                });
            }
            return unbound;
        };

        const results = [];
        try {
            for (const suite of suites) {
                console.log(`${suite.name}`);
                const t = new Checks(suite.name);
                try {
                    await suite.module.run({
                        browser, baseUrl: site.baseUrl, sleeper, t, startUnboundSite,
                        // For suites that need to seed a table the site only reads.
                        repoRoot, persistTo: site.persistTo, log
                    });
                } catch (error) {
                    t.check(`the suite ran to completion`, false, error.stack || error.message);
                }
                results.push(t);
                console.log('');
            }
        } finally {
            if (unbound) await unbound.stop().catch(() => {});
        }

        return report(results);

    } finally {
        if (browser) await browser.close().catch(() => {});
        if (site) await site.stop().catch(() => {});
        await sleeper.stop().catch(() => {});
    }
}

function report(results) {
    const passed = results.reduce((sum, r) => sum + r.passed, 0);
    const failures = results.flatMap(r => r.failures.map(f => `${r.suiteName}: ${f}`));

    console.log('─'.repeat(60));
    if (!failures.length) {
        console.log(`${passed} checks passed across ${results.length} suites.`);
        return 0;
    }

    console.log(`${passed} passed, ${failures.length} FAILED:\n`);
    for (const failure of failures) console.log(`  • ${failure}`);
    return 1;
}

main().then(
    code => process.exit(code),
    error => {
        console.error('\nThe test run could not start:\n');
        console.error(error.message);
        if (/Executable doesn't exist|browserType.launch/.test(error.message)) {
            console.error('\nInstall a browser with:  npx playwright install chromium');
            console.error('or point CHROMIUM_EXECUTABLE at one you already have.');
        }
        process.exit(1);
    }
);
