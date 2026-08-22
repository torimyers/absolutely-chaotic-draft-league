/**
 * A fixed-window rate limiter built on the D1 database sync already needs.
 *
 * Cloudflare's WAF rate-limiting rules are the usual place for this, but they
 * are not available on every plan, and these endpoints have no authentication -
 * leaving them unlimited is not an option. Doing it in the Function costs one
 * extra D1 write per request and works on any plan.
 *
 * Fixed windows, not a sliding log: a client can send up to 2x the limit across
 * a window boundary. That is a fine trade for one indexed upsert per request,
 * and the limits here are set for "stop abuse", not "shape traffic precisely".
 *
 * Counters are per Cloudflare location rather than global, since D1 reads may be
 * served by a replica. Again: fine for the job, and the same caveat applies to
 * the WAF rules this replaces.
 */

/** Fails open rather than 500ing when the counter cannot be read or written. */
const ALLOWED = { allowed: true, retryAfter: 0 };

/**
 * Records a request against a bucket and says whether it is over the limit.
 *
 * @param {D1Database} db
 * @param {string} scope        Which endpoint is being limited, e.g. 'link'.
 * @param {string} client       Caller identity, normally their IP.
 * @param {object} options
 * @param {number} options.limit          Requests allowed per window.
 * @param {number} options.windowSeconds  Window length.
 * @param {number} [options.now]          Epoch ms; injectable for tests.
 * @returns {Promise<{allowed: boolean, retryAfter: number}>}
 */
export async function recordRequest(db, scope, client, { limit, windowSeconds, now = Date.now() }) {
    if (!db) return ALLOWED;

    const windowMs = windowSeconds * 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const expiresAt = windowStart + windowMs;

    // The window start is part of the key, so a new window is a new row and the
    // count never has to be reset in place.
    const bucket = `${scope}:${client}:${windowStart}`;

    let count;
    try {
        const row = await db
            .prepare(
                `INSERT INTO rate_limits (bucket, count, expires_at)
                 VALUES (?, 1, ?)
                 ON CONFLICT(bucket) DO UPDATE SET count = count + 1
                 RETURNING count`
            )
            .bind(bucket, expiresAt)
            .first();
        count = row ? row.count : 1;
    } catch (error) {
        // Most likely the table is missing because an existing deployment has
        // not re-run schema.sql. Losing the limiter is bad; losing sync itself
        // over a missing counter table would be worse.
        console.warn('Rate limiter unavailable, allowing request:', error.message);
        return ALLOWED;
    }

    // Opportunistic cleanup, once per client per window rather than on every
    // request, so expired rows cannot accumulate forever.
    if (count === 1) {
        try {
            await db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now).run();
        } catch (error) {
            // Not worth failing a request over.
        }
    }

    if (count > limit) {
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((expiresAt - now) / 1000)) };
    }

    return ALLOWED;
}

/**
 * Who to count a request against.
 *
 * `CF-Connecting-IP` is set by Cloudflare at the edge and overwrites anything
 * the client sent, so it cannot be spoofed in production. Off Cloudflare - local
 * dev, tests - it may be absent, and everything then shares one bucket.
 */
export function clientKey(request) {
    return request.headers.get('CF-Connecting-IP')
        || request.headers.get('X-Forwarded-For')?.split(',')[0].trim()
        || 'unknown';
}

/**
 * Per-endpoint limits, per minute per IP.
 *
 * Sized so a real session never comes close: configuring a league is a couple of
 * writes, and a page load is one read. Linking is the tightest because it is the
 * only path that makes this deployment call Sleeper.
 */
export const LIMITS = {
    link: { limit: 10, windowSeconds: 60 },
    read: { limit: 60, windowSeconds: 60 },
    write: { limit: 20, windowSeconds: 60 }
};
