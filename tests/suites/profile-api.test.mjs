/**
 * The sync endpoints, driven directly rather than through the browser.
 *
 * These endpoints have no authentication by design, so the checks that keep
 * them from becoming an open key-value store - the Sleeper account
 * verification, the field whitelist, the ordering rule - are the ones worth
 * pinning down.
 *
 * The Functions talk to the fake Sleeper from tests/helpers/servers.mjs via the
 * SLEEPER_API_BASE binding, so the account-verification paths are covered
 * without depending on Sleeper being up.
 */

export const name = 'Profile sync API';

export const sleeperAccounts = [
    { user_id: '555000111222', username: 'torimyers', display_name: 'Tori' },
    { user_id: '777000333444', username: 'leaguemate', display_name: 'League Mate' }
];

const KNOWN_ID = '555000111222';
const UNKNOWN_BUT_WELL_FORMED_ID = '999888777666';

export async function run({ baseUrl, t }) {
    const call = async (path, init) => {
        const response = await fetch(`${baseUrl}${path}`, init);
        let body = null;
        try { body = await response.json(); } catch (error) { body = null; }
        return { status: response.status, body };
    };
    const putProfile = (payload) => call('/api/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
    });

    t.describe('Resolving a username to an account');
    {
        const ok = await call('/api/profile/link', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'torimyers' })
        });
        t.equal('a real username resolves', ok.status, 200);
        t.equal('to the stable user_id', ok.body?.userId, KNOWN_ID);
        t.equal('and carries the display name', ok.body?.displayName, 'Tori');

        const missing = await call('/api/profile/link', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'nobody' })
        });
        // Sleeper answers 200 with a null body for an unknown account, so this
        // only passes if the Function inspects the body rather than the status.
        t.equal('an unknown username is a 404, not a bad link', missing.status, 404);

        const blank = await call('/api/profile/link', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
        });
        t.equal('a missing username is rejected', blank.status, 400);

        const nasty = await call('/api/profile/link', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: '../../etc/passwd' })
        });
        t.equal('a path-traversal username is rejected', nasty.status, 400);

        const wrongMethod = await call('/api/profile/link');
        t.equal('GET is not allowed on link', wrongMethod.status, 405);
    }

    t.describe('Creating a profile');
    {
        const unknown = await putProfile({
            userId: UNKNOWN_BUT_WELL_FORMED_ID,
            config: { leagueName: 'Invented' },
            updatedAt: Date.now()
        });
        // This is the check that keeps the table keyed to real accounts.
        t.equal('a userId with no Sleeper account is refused', unknown.status, 404);

        const created = await putProfile({
            userId: KNOWN_ID,
            username: 'torimyers',
            config: { leagueName: 'Chaotic', leagueSize: 10, scoringFormat: 'PPR' },
            updatedAt: 1_700_000_000_000
        });
        t.equal('a verified account is stored', created.status, 200);

        const read = await call(`/api/profile?userId=${KNOWN_ID}`);
        t.equal('and reads back', read.status, 200);
        t.equal('with the league name', read.body?.config?.leagueName, 'Chaotic');
        t.equal('and the username resolved server-side', read.body?.username, 'torimyers');
    }

    t.describe('Validating what gets stored');
    {
        const written = await putProfile({
            userId: KNOWN_ID,
            config: {
                leagueName: 'Validated',
                draftPosition: 4,
                scoringFormat: 'Bogus',        // not one of the three formats
                leagueSize: 999,               // outside 4-20
                junkKey: 'should never persist'
            },
            updatedAt: 1_700_000_001_000
        });
        t.equal('a write with some bad fields still succeeds', written.status, 200);

        const read = await call(`/api/profile?userId=${KNOWN_ID}`);
        t.check('the unknown key is dropped', read.body?.config?.junkKey === undefined, read.body?.config?.junkKey);
        t.check('the invalid enum is dropped', read.body?.config?.scoringFormat === undefined, read.body?.config?.scoringFormat);
        t.check('the out-of-range number is dropped', read.body?.config?.leagueSize === undefined, read.body?.config?.leagueSize);
        t.equal('the valid fields survive', read.body?.config?.draftPosition, 4);

        const empty = await putProfile({
            userId: KNOWN_ID, config: { nothingRecognised: 1 }, updatedAt: Date.now()
        });
        t.equal('a write with nothing recognisable is rejected', empty.status, 400);

        const huge = await putProfile({
            userId: KNOWN_ID, config: { leagueName: 'x'.repeat(20_000) }, updatedAt: Date.now()
        });
        t.check('an oversized body is rejected', huge.status === 400, huge.status);
    }

    t.describe('Ordering between devices');
    {
        const stale = await putProfile({
            userId: KNOWN_ID, config: { leagueName: 'Stale' }, updatedAt: 1_600_000_000_000
        });
        t.equal('an older write loses to the newer one', stale.status, 409);
        t.check('and the winning timestamp comes back', typeof stale.body?.updatedAt === 'number', stale.body?.updatedAt);

        const read = await call(`/api/profile?userId=${KNOWN_ID}`);
        t.equal('the stored profile is untouched', read.body?.config?.leagueName, 'Validated');

        const future = await putProfile({
            userId: KNOWN_ID,
            config: { leagueName: 'Bad Clock' },
            updatedAt: Date.now() + 5 * 365 * 24 * 60 * 60 * 1000
        });
        t.equal('a wildly future timestamp is still accepted', future.status, 200);
        t.check('but clamped, so later saves are not locked out',
            future.body?.updatedAt < Date.now() + 60_000, future.body?.updatedAt);
    }

    t.describe('Malformed requests');
    {
        t.equal('a missing userId is rejected', (await call('/api/profile')).status, 400);
        t.equal('a non-numeric userId is rejected',
            (await call('/api/profile?userId=1%20OR%201%3D1')).status, 400);
        t.equal('an unknown account reads as 404',
            (await call(`/api/profile?userId=${UNKNOWN_BUT_WELL_FORMED_ID}`)).status, 404);
        t.equal('DELETE is not allowed', (await call('/api/profile', { method: 'DELETE' })).status, 405);
        t.equal('a body that is not JSON is rejected',
            (await call('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: 'not json' })).status, 400);
    }

    t.describe('Routing');
    {
        const page = await fetch(`${baseUrl}/index.html`);
        t.equal('the static site still serves', page.status, 200);
        // `_redirects` has a `/* -> /index.html` catch-all; the API must win.
        const apiResponse = await fetch(`${baseUrl}/api/profile?userId=${KNOWN_ID}`);
        t.check('the API is not swallowed by the SPA catch-all',
            (apiResponse.headers.get('content-type') || '').includes('application/json'),
            apiResponse.headers.get('content-type'));
        t.check('sync responses are not cacheable',
            (apiResponse.headers.get('cache-control') || '').includes('no-store'),
            apiResponse.headers.get('cache-control'));
    }
}
