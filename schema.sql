-- D1 schema for cross-device profile sync, applied to `fantasy-profiles`.
--
-- The player cache lives in its own database with its own file; see
-- schema-players.sql. They are kept apart because the two have nothing in
-- common and very different write patterns - this one takes a row at a time
-- from real users, that one is rewritten wholesale every day.
--
-- Apply with:
--   wrangler d1 execute fantasy-profiles --remote --file=./schema.sql

-- One row per Sleeper account. The key is Sleeper's own user_id rather than the
-- username the user types: usernames on Sleeper can be changed and the freed
-- name reused, which would silently hand someone else's device the wrong
-- profile. user_id never changes for an account.

CREATE TABLE IF NOT EXISTS profiles (
    -- Sleeper user_id, resolved server-side from the username. Never trusted
    -- straight from the client.
    sleeper_user_id  TEXT PRIMARY KEY,

    -- Most recent username/display name seen for this account. Stored only so
    -- the UI can confirm to the user which account they are synced to.
    sleeper_username TEXT NOT NULL,

    -- The league profile, as a JSON object. Server-side validation restricts
    -- this to a fixed set of known keys and value types, so this column cannot
    -- be used as a general-purpose key-value store.
    config           TEXT NOT NULL,

    -- Client-supplied wall-clock time of the save, epoch milliseconds. Used for
    -- last-write-wins: a write older than the stored row is rejected.
    updated_at       INTEGER NOT NULL,

    -- Server-side receipt time, epoch milliseconds. Independent of the client
    -- clock, so it stays usable for cleanup and abuse investigation.
    written_at       INTEGER NOT NULL
);

-- Supports pruning abandoned profiles by age.
CREATE INDEX IF NOT EXISTS idx_profiles_written_at ON profiles (written_at);
