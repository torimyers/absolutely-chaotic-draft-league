/**
 * Small response helpers shared by the profile Pages Functions.
 *
 * Lives outside `functions/` so it does not become a route of its own.
 */

/** Sync responses are per-user and must never be held by a cache or the CDN. */
const NO_STORE = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // The API is same-origin only; nothing should be embedding these responses.
    'x-content-type-options': 'nosniff'
};

export function json(body, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...NO_STORE, ...extraHeaders }
    });
}

/** A handler that refuses a method, naming the ones that are allowed. */
export function notAllowed(allowed) {
    return () => json(
        { error: `Method not allowed. Use ${allowed.join(' or ')}.` },
        405,
        { allow: allowed.join(', ') }
    );
}

/**
 * Reads a JSON request body with a hard size limit, so a malformed or hostile
 * request cannot make the worker parse megabytes.
 *
 * @returns {Promise<{ ok: true, value: any } | { ok: false, error: string }>}
 */
export async function readJsonBody(request, maxBytes = 8192) {
    const declared = request.headers.get('content-length');
    if (declared && Number(declared) > maxBytes) {
        return { ok: false, error: 'Request body is too large' };
    }

    let text;
    try {
        text = await request.text();
    } catch (error) {
        return { ok: false, error: 'Could not read request body' };
    }

    if (new TextEncoder().encode(text).length > maxBytes) {
        return { ok: false, error: 'Request body is too large' };
    }

    if (!text.trim()) {
        return { ok: false, error: 'Request body is empty' };
    }

    try {
        return { ok: true, value: JSON.parse(text) };
    } catch (error) {
        return { ok: false, error: 'Request body is not valid JSON' };
    }
}
