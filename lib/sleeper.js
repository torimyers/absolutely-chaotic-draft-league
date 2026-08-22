/**
 * Where the profile Functions reach Sleeper.
 *
 * Lives outside `functions/` so it creates no route of its own.
 */

const DEFAULT_BASE = 'https://api.sleeper.app/v1';

/**
 * Builds the URL for a Sleeper user lookup, by username or by user_id.
 *
 * The base is overridable through a `SLEEPER_API_BASE` binding so the test
 * suite can point the Functions at a local stub and stay hermetic - otherwise
 * every run of the account-verification paths would depend on Sleeper being up
 * and on a real account continuing to exist.
 *
 * Only a deployer can set a binding, and anything missing or not http(s) falls
 * back to the real API, so a production deployment that sets nothing - which is
 * every one of them - talks to Sleeper exactly as before.
 */
export function sleeperUserUrl(env, usernameOrId) {
    const configured = env && typeof env.SLEEPER_API_BASE === 'string'
        ? env.SLEEPER_API_BASE.trim()
        : '';

    const base = /^https?:\/\//i.test(configured)
        ? configured.replace(/\/+$/, '')
        : DEFAULT_BASE;

    return `${base}/user/${encodeURIComponent(usernameOrId)}`;
}
