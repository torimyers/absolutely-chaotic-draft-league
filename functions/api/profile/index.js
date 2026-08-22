/**
 * GET  /api/profile?userId=...  - read a synced league profile
 * PUT  /api/profile             - write one
 *
 * Profiles are keyed on a Sleeper user_id resolved by /api/profile/link. There
 * is no password and no session: knowing a Sleeper username is enough to read
 * or overwrite that profile. Only low-sensitivity league settings are stored
 * here - league ID, team name, scoring format and the like, all of which are
 * already public on Sleeper for anyone in the league.
 *
 * Requires a D1 binding named DB. See schema.sql.
 */

import { json, notAllowed, readJsonBody } from '../../../lib/http.js';
import { isSleeperUserId, sanitizeConfig } from '../../../lib/profile-schema.js';

const SLEEPER_USER_URL = 'https://api.sleeper.app/v1/user/';

/**
 * How far ahead of the server a client's clock may be before its timestamp is
 * distrusted. Without this a device with a wrong clock could write a timestamp
 * years in the future and permanently block every later save.
 */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function missingBinding() {
    return json(
        { error: 'Profile sync is not configured on this deployment' },
        503
    );
}

export async function onRequestGet(context) {
    const db = context.env.DB;
    if (!db) return missingBinding();

    const userId = new URL(context.request.url).searchParams.get('userId');

    if (!isSleeperUserId(userId || '')) {
        return json({ error: 'A valid userId is required' }, 400);
    }

    let row;
    try {
        row = await db
            .prepare('SELECT sleeper_username, config, updated_at FROM profiles WHERE sleeper_user_id = ?')
            .bind(userId.trim())
            .first();
    } catch (error) {
        return json({ error: 'Could not read your profile' }, 500);
    }

    if (!row) {
        return json({ error: 'No profile saved for this Sleeper account yet' }, 404);
    }

    let config;
    try {
        config = JSON.parse(row.config);
    } catch (error) {
        // A row we cannot parse is a row we cannot honour; treat it as absent
        // rather than handing the client something it will choke on.
        return json({ error: 'No profile saved for this Sleeper account yet' }, 404);
    }

    return json({
        userId: userId.trim(),
        username: row.sleeper_username,
        config,
        updatedAt: row.updated_at
    });
}

export async function onRequestPut(context) {
    const db = context.env.DB;
    if (!db) return missingBinding();

    const body = await readJsonBody(context.request);
    if (!body.ok) return json({ error: body.error }, 400);

    const { userId, username, config, updatedAt } = body.value;

    if (!isSleeperUserId(userId || '')) {
        return json({ error: 'A valid userId is required' }, 400);
    }

    const cleaned = sanitizeConfig(config);
    if (!cleaned.ok) return json({ error: cleaned.error }, 400);

    const now = Date.now();
    const clientTime = Number(updatedAt);
    // A missing or absurd client timestamp falls back to server time rather than
    // failing the save - the user should not lose a profile to a bad clock.
    const stamp = Number.isFinite(clientTime) && clientTime > 0 && clientTime <= now + MAX_CLOCK_SKEW_MS
        ? Math.round(clientTime)
        : now;

    const id = userId.trim();

    let existing;
    try {
        existing = await db
            .prepare('SELECT sleeper_username, updated_at FROM profiles WHERE sleeper_user_id = ?')
            .bind(id)
            .first();
    } catch (error) {
        return json({ error: 'Could not save your profile' }, 500);
    }

    // Creating a row is the only path that can add a new key to the table, so
    // that is where the account has to be proven real. An existing row was
    // vetted when it was created, so updates skip the round trip to Sleeper.
    let resolvedUsername = typeof username === 'string' ? username.trim().slice(0, 64) : '';

    if (!existing) {
        const verified = await verifySleeperUser(id);
        if (!verified.ok) return json({ error: verified.error }, verified.status);
        resolvedUsername = verified.username;
    } else if (!resolvedUsername) {
        resolvedUsername = existing.sleeper_username;
    }

    // Last write wins, but an out-of-order or replayed save must not undo a
    // newer one. Equal timestamps are allowed through so a re-save of the same
    // second is not silently dropped.
    if (existing && stamp < existing.updated_at) {
        return json({
            error: 'A newer profile is already saved for this account',
            updatedAt: existing.updated_at
        }, 409);
    }

    try {
        await db
            .prepare(
                `INSERT INTO profiles (sleeper_user_id, sleeper_username, config, updated_at, written_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(sleeper_user_id) DO UPDATE SET
                     sleeper_username = excluded.sleeper_username,
                     config           = excluded.config,
                     updated_at       = excluded.updated_at,
                     written_at       = excluded.written_at`
            )
            .bind(id, resolvedUsername, JSON.stringify(cleaned.config), stamp, now)
            .run();
    } catch (error) {
        return json({ error: 'Could not save your profile' }, 500);
    }

    return json({ userId: id, username: resolvedUsername, updatedAt: stamp });
}

/** Confirms a user_id belongs to a real Sleeper account. */
async function verifySleeperUser(userId) {
    let response;
    try {
        response = await fetch(SLEEPER_USER_URL + encodeURIComponent(userId), {
            headers: { accept: 'application/json' }
        });
    } catch (error) {
        return { ok: false, error: 'Could not reach Sleeper. Try again in a moment.', status: 502 };
    }

    if (!response.ok) {
        return { ok: false, error: 'Could not reach Sleeper. Try again in a moment.', status: 502 };
    }

    let user;
    try {
        user = await response.json();
    } catch (error) {
        user = null;
    }

    if (!user || String(user.user_id) !== String(userId)) {
        return { ok: false, error: 'That Sleeper account does not exist', status: 404 };
    }

    return { ok: true, username: user.username || user.display_name || '' };
}

export const onRequestPost = notAllowed(['GET', 'PUT']);
export const onRequestDelete = notAllowed(['GET', 'PUT']);
export const onRequestPatch = notAllowed(['GET', 'PUT']);
