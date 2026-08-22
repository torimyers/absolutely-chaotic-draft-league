-- D1 schema for the cached NFL player database, applied to `fantasy-players`.
--
-- Sleeper asks that /players/nfl be called at most once a day. Holding the
-- result here means that budget is spent once for the whole league rather than
-- once per browser profile, and lets the app be served a trimmed subset -
-- roughly 20 of the 45 fields Sleeper returns - instead of the full ~5 MB.
--
-- Its own database rather than a table alongside profiles: this one is bulk
-- rewritten by workers/player-sync every day, and that job has no business
-- holding a connection to user data.
--
-- Apply with:
--   wrangler d1 execute fantasy-players --remote --file=./schema-players.sql

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

-- Prefixed rather than a bare `meta` so it still reads correctly next to the
-- data it describes, and so a future table in here cannot quietly claim the
-- generic name.
CREATE TABLE IF NOT EXISTS player_cache_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
