/**
 * The shape of a synced league profile, and the rules for validating one.
 *
 * This lives outside `functions/` so it creates no route of its own, and is
 * imported by the Pages Functions that read and write profiles.
 *
 * Everything here exists to keep the profiles table from becoming a
 * general-purpose key-value store for anyone who finds the endpoint: only the
 * keys below are stored, each is type- and range-checked, and unknown keys are
 * dropped rather than rejected so an older client can still sync against a
 * newer schema.
 */

/** Hard ceiling on a serialised profile, before it ever reaches the database. */
export const MAX_CONFIG_BYTES = 4096;

const SCORING_FORMATS = ['Standard', 'Half PPR', 'PPR'];
const ROSTER_FORMATS = ['Standard', 'Super Flex', '2QB'];
const LEARNING_MODES = ['beginner', 'intermediate', 'expert'];

/** A Sleeper ID as it appears in their API: a long run of digits. */
const ID_PATTERN = /^\d{6,32}$/;

const str = (max) => (value) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

const int = (min, max) => (value) => {
    const n = typeof value === 'number' ? value : parseInt(value, 10);
    if (!Number.isFinite(n)) return undefined;
    const rounded = Math.round(n);
    return rounded < min || rounded > max ? undefined : rounded;
};

const num = (min, max) => (value) => {
    const n = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(n)) return undefined;
    return n < min || n > max ? undefined : n;
};

const oneOf = (allowed) => (value) => (allowed.includes(value) ? value : undefined);

const bool = (value) => (typeof value === 'boolean' ? value : undefined);

/** A Sleeper league or draft ID, or an explicit empty value. */
const sleeperId = (value) => {
    if (value === null || value === '') return value;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (trimmed === '') return '';
    return ID_PATTERN.test(trimmed) ? trimmed : undefined;
};

/**
 * Every key that syncs, and how to check it. Season stats are included because
 * they are part of what the user sees on the dashboard; they are refreshed from
 * Sleeper anyway, so a stale synced value only ever shows briefly.
 */
const FIELDS = {
    leagueName: str(80),
    teamName: str(80),
    leagueSize: int(4, 20),
    scoringFormat: oneOf(SCORING_FORMATS),
    rosterFormat: oneOf(ROSTER_FORMATS),
    draftPosition: int(1, 20),

    teamRecord: str(12),
    totalPoints: num(-10000, 100000),
    leagueRanking: int(1, 20),
    playoffOdds: num(0, 100),

    sleeperLeagueId: sleeperId,
    sleeperDraftId: sleeperId,
    sleeperUsername: str(64),

    learningMode: oneOf(LEARNING_MODES),
    themeColor: str(24),

    isConfigured: bool,
    draftCompleted: bool,
    isMockDraft: bool
};

/** The keys a client should send. Exported so the browser sends nothing extra. */
export const SYNCED_KEYS = Object.keys(FIELDS);

/**
 * Reduces an arbitrary object to a storable profile.
 *
 * Unknown keys and values that fail their check are dropped silently: a single
 * bad field should not cost the user the rest of their setup, and a stricter
 * rule would break older clients the moment a field changes.
 *
 * @returns {{ ok: true, config: object } | { ok: false, error: string }}
 */
export function sanitizeConfig(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, error: 'config must be an object' };
    }

    const config = {};
    for (const [key, check] of Object.entries(FIELDS)) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
        const cleaned = check(input[key]);
        if (cleaned !== undefined) config[key] = cleaned;
    }

    if (Object.keys(config).length === 0) {
        return { ok: false, error: 'config contained no recognised settings' };
    }

    const serialised = JSON.stringify(config);
    if (new TextEncoder().encode(serialised).length > MAX_CONFIG_BYTES) {
        return { ok: false, error: 'config is too large' };
    }

    return { ok: true, config };
}

/** True for a plausible Sleeper user_id. */
export function isSleeperUserId(value) {
    return typeof value === 'string' && ID_PATTERN.test(value.trim());
}
