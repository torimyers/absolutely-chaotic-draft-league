/**
 * The two servers a test run needs: a stub standing in for Sleeper, and the
 * real site under `wrangler pages dev`.
 *
 * The site is served by wrangler rather than a plain static server so the tests
 * exercise what actually ships - the Pages Functions, the D1 binding, the
 * `_routes.json` scoping and the `_redirects` catch-all all take part.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The repository's wrangler.toml deliberately ships with no D1 binding: naming a
 * database that is missing from the account makes a Pages deployment fail, and
 * sync is optional. The binding the API tests need lives in a test-only config
 * instead.
 *
 * `wrangler d1 execute` reads that config to resolve the database by name.
 * `wrangler pages dev` refuses a custom --config path, so it is handed the same
 * ID on the command line. Local D1 files are keyed by the ID, so the two agree.
 */
const TEST_CONFIG = 'tests/wrangler.test.toml';
const TEST_DB_NAME = 'fantasy-profiles-test';
const TEST_DB_ID = 'fantasy-profiles-test-local';

const WRANGLER_START_TIMEOUT_MS = 120_000;

/** Asks the OS for a free port, so parallel runs and busy dev boxes do not clash. */
export function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

/**
 * Stands in for the one Sleeper endpoint the Pages Functions call:
 * `/v1/user/{usernameOrId}`.
 *
 * Real Sleeper answers 200 with a literal `null` body for an account that does
 * not exist, which is the case the Functions have to get right, so the stub
 * reproduces that rather than returning a 404.
 *
 * @param {Array<{user_id: string, username: string, display_name?: string}>} accounts
 */
export async function startFakeSleeper(accounts = []) {
    const byKey = new Map();
    for (const account of accounts) {
        const record = {
            user_id: String(account.user_id),
            username: account.username,
            display_name: account.display_name || account.username
        };
        byKey.set(record.user_id, record);
        byKey.set(record.username.toLowerCase(), record);
    }

    const requests = [];

    const server = createServer((req, res) => {
        requests.push(req.url);
        const match = /^\/v1\/user\/([^/?]+)/.exec(req.url || '');
        res.setHeader('content-type', 'application/json');

        if (!match) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'unexpected path', path: req.url }));
            return;
        }

        const key = decodeURIComponent(match[1]).toLowerCase();
        res.statusCode = 200;
        res.end(JSON.stringify(byKey.get(key) || byKey.get(decodeURIComponent(match[1])) || null));
    });

    const port = await freePort();
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));

    return {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        requests,
        async stop() {
            await new Promise(resolve => server.close(resolve));
        }
    };
}

/**
 * Boots `wrangler pages dev` against the repository root.
 *
 * D1 state goes to a throwaway directory so a run never touches the developer's
 * own `.wrangler/` store, and the schema is applied to that same directory
 * first.
 *
 * `withDatabase: false` boots the site with no D1 binding at all, which is how
 * the repository ships and how any deployment that has not set sync up behaves.
 */
export async function startSite({ repoRoot, sleeperBaseUrl, withDatabase = true, log = () => {} }) {
    const persistTo = await mkdtemp(join(tmpdir(), 'accd-tests-'));

    if (withDatabase) {
        await runWrangler(
            repoRoot,
            [
                'd1', 'execute', TEST_DB_NAME,
                '--config', TEST_CONFIG,
                '--local', '--persist-to', persistTo,
                '--yes', '--file=./schema.sql'
            ],
            log
        );
    }

    const port = await freePort();
    const child = spawn(
        process.execPath,
        [
            wranglerBin(repoRoot),
            'pages', 'dev', '.',
            '--port', String(port),
            // Omitted deliberately when withDatabase is false, to reproduce a
            // deployment where sync was never set up.
            ...(withDatabase ? ['--d1', `DB=${TEST_DB_ID}`] : []),
            '--persist-to', persistTo,
            '--binding', `SLEEPER_API_BASE=${sleeperBaseUrl}`
        ],
        { cwd: repoRoot, env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    child.stdout.on('data', d => log(String(d)));
    child.stderr.on('data', d => log(String(d)));

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForReady(baseUrl, child);

    return {
        baseUrl,
        persistTo,
        async stop() {
            child.kill('SIGTERM');
            await new Promise(resolve => {
                const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
                child.once('exit', () => { clearTimeout(timer); resolve(); });
            });
            await rm(persistTo, { recursive: true, force: true }).catch(() => {});
        }
    };
}

function wranglerBin(repoRoot) {
    return join(repoRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
}

function runWrangler(repoRoot, args, log) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [wranglerBin(repoRoot), ...args], {
            cwd: repoRoot,
            env: { ...process.env, CI: '1' },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        child.stdout.on('data', d => { output += d; log(String(d)); });
        child.stderr.on('data', d => { output += d; log(String(d)); });
        child.on('error', reject);
        child.on('exit', code => code === 0
            ? resolve(output)
            : reject(new Error(`wrangler ${args[0]} ${args[1] || ''} exited ${code}\n${output}`)));
    });
}

/**
 * Polls until the site answers. Wrangler needs to download and boot workerd on
 * a cold machine, so the timeout is generous; a crashed child short-circuits it
 * rather than making the run sit here for two minutes.
 */
async function waitForReady(baseUrl, child) {
    const deadline = Date.now() + WRANGLER_START_TIMEOUT_MS;
    let exited = false;
    child.once('exit', code => { exited = code; });

    while (Date.now() < deadline) {
        if (exited !== false) {
            throw new Error(`wrangler pages dev exited (${exited}) before becoming ready`);
        }
        try {
            const response = await fetch(`${baseUrl}/index.html`);
            if (response.ok) return;
        } catch (error) {
            // Not listening yet.
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(`wrangler pages dev did not start within ${WRANGLER_START_TIMEOUT_MS}ms`);
}
