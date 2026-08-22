-- D1 schema.
--
-- One database serves both features, under the single `DB` binding: a second
-- database would mean a second binding, a second create step and a second thing
-- to forget when setting the site up. The two halves are independent - profiles
-- is user data written a row at a time, the player cache is a public list
-- rewritten wholesale every day - so table names are prefixed rather than
-- generic to keep them from growing into each other.
--
-- Apply with:
--   wrangler d1 execute fantasy-profiles --remote --file=./schema.sql


-- ---------------------------------------------------------------------------
-- Cross-device profile sync
-- ---------------------------------------------------------------------------
--
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


-- ---------------------------------------------------------------------------
-- Cached NFL player database
-- ---------------------------------------------------------------------------
--
-- Sleeper asks that /players/nfl be called at most once a day. Holding the
-- result here means that budget is spent once for the whole league rather than
-- once per browser profile, and lets the app be served a trimmed subset -
-- roughly 20 of the 45 fields Sleeper returns - instead of the full ~5 MB.

-- Rows carry the generation that wrote them. A refresh inserts a whole new
-- generation, flips player_cache_meta.current_generation, and only then deletes
-- the old one, so a refresh that dies halfway through cannot leave readers
-- looking at a half-written table. D1 makes each batch a transaction, but a
-- multi-batch write is not atomic on its own - this is what makes it safe.
CREATE TABLE IF NOT EXISTS players (
  generation           INTEGER NOT NULL,
  player_id            TEXT    NOT NULL,
  first_name           TEXT,
  last_name            TEXT,
  full_name            TEXT,
  position             TEXT,
  fantasy_positions    TEXT,   -- JSON array, as stored by Sleeper
  team                 TEXT,
  age                  INTEGER,
  years_exp            INTEGER,
  status               TEXT,
  active               INTEGER,
  injury_status        TEXT,
  injury_body_part     TEXT,
  depth_chart_order    INTEGER,
  depth_chart_position TEXT,
  search_rank          INTEGER,
  college              TEXT,
  height               TEXT,
  weight               TEXT,
  birth_date           TEXT,
  PRIMARY KEY (generation, player_id)
);

-- Both indexes lead with generation because every read is scoped to one.
CREATE INDEX IF NOT EXISTS idx_players_gen_rank ON players (generation, search_rank);
CREATE INDEX IF NOT EXISTS idx_players_gen_position ON players (generation, position);

-- Prefixed rather than a bare `meta`: this database has another feature in it,
-- and a table that generic would be claimed twice sooner or later.
CREATE TABLE IF NOT EXISTS player_cache_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
