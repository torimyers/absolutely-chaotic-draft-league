/**
 * Helpers shared by the two schedule routes. Underscore-prefixed, so Pages
 * neither routes nor serves it.
 */

export function json(body, status, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
    });
}

/** Seasons are four digits and near the present; anything else is a typo. */
export function parseSeason(raw) {
    const season = Number.parseInt(raw, 10);
    if (!Number.isInteger(season) || season < 1990 || season > 2100) return null;
    return season;
}

export async function readScheduleMeta(db) {
    const { results } = await db.prepare('SELECT key, value FROM schedule_meta').all();
    const byKey = Object.fromEntries(results.map(r => [r.key, r.value]));

    const generation = Number.parseInt(byKey.current_generation, 10);
    return {
        generation: Number.isInteger(generation) ? generation : null,
        refreshedAt: byKey.refreshed_at || null
    };
}
