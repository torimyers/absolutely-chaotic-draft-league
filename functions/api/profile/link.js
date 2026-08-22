/**
 * POST /api/profile/link
 *
 * Turns a Sleeper username into the stable user_id that profiles are keyed on.
 *
 * The lookup happens here rather than in the browser so the client cannot
 * invent an ID: every key in the profiles table belongs to an account that
 * really exists on Sleeper. That is the only check standing between this
 * endpoint and an open key-value store - it deliberately is NOT authentication.
 * Anyone who knows a username can link to that profile, which is the trade-off
 * this sync design accepts in exchange for having no passwords.
 *
 * Body:    { "username": "torimyers" }
 * Returns: { "userId": "12345...", "username": "torimyers", "displayName": "Tori" }
 */

import { json, notAllowed, readJsonBody } from '../../../lib/http.js';

const SLEEPER_USER_URL = 'https://api.sleeper.app/v1/user/';

/** Sleeper usernames are short and alphanumeric-ish; reject anything else early. */
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

export async function onRequestPost(context) {
    const body = await readJsonBody(context.request);
    if (!body.ok) return json({ error: body.error }, 400);

    const username = typeof body.value.username === 'string' ? body.value.username.trim() : '';

    if (!username) {
        return json({ error: 'A Sleeper username is required' }, 400);
    }

    if (!USERNAME_PATTERN.test(username)) {
        return json({ error: 'That does not look like a Sleeper username' }, 400);
    }

    let response;
    try {
        response = await fetch(SLEEPER_USER_URL + encodeURIComponent(username), {
            headers: { accept: 'application/json' }
        });
    } catch (error) {
        return json({ error: 'Could not reach Sleeper. Try again in a moment.' }, 502);
    }

    if (!response.ok) {
        return json({ error: 'Could not reach Sleeper. Try again in a moment.' }, 502);
    }

    // Sleeper answers 200 with a literal `null` body for a username that does
    // not exist, so a successful status is not enough on its own.
    let user;
    try {
        user = await response.json();
    } catch (error) {
        user = null;
    }

    if (!user || !user.user_id) {
        return json({ error: `No Sleeper account found for "${username}"` }, 404);
    }

    return json({
        userId: String(user.user_id),
        username: user.username || username,
        displayName: user.display_name || user.username || username
    });
}

export const onRequestGet = notAllowed(['POST']);
export const onRequestPut = notAllowed(['POST']);
export const onRequestDelete = notAllowed(['POST']);
export const onRequestPatch = notAllowed(['POST']);
