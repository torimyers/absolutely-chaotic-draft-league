-- D1 schema for the cached NFL schedule, applied to `fantasy-schedule`.
--
-- Every visitor was fetching the same 16 fixtures from ESPN, per week, for a
-- season that is fixed months in advance. Holding it here spends that once.
--
-- It also removes the last piece of hardcoded season data in the app. Bye weeks
-- used to be a literal table that said 2024 in a comment; a bye is simply a week
-- in which a team has no game, so it is derived from these rows instead of
-- maintained by hand every August.
--
-- Its own database rather than a table in `fantasy-players`: different upstream
-- (ESPN, not Sleeper), different cadence (weekly, not daily), and a `games`
-- table inside something called `fantasy-players` is the kind of misnaming that
-- rots.
--
-- Apply with:
--   wrangler d1 execute fantasy-schedule --remote --file=./schema-schedule.sql

-- Generation-versioned exactly like the player cache: a refresh writes a whole
-- new generation, publishes it by flipping schedule_meta.current_generation, and
-- only then drops the old one. D1 makes a batch a transaction but not a sequence
-- of them, so this is what stops a half-written season being served.
CREATE TABLE IF NOT EXISTS games (
  generation    INTEGER NOT NULL,
  season        INTEGER NOT NULL,
  week          INTEGER NOT NULL,
  game_id       TEXT    NOT NULL,
  kickoff       TEXT,             -- ISO 8601, as ESPN gives it
  home_team     TEXT    NOT NULL, -- normalised to Sleeper's abbreviations
  away_team     TEXT    NOT NULL,
  home_name     TEXT,
  away_name     TEXT,
  venue_name    TEXT,
  venue_city    TEXT,
  venue_indoor  INTEGER,          -- ESPN's flag; does not distinguish a dome
                                  -- from a retractable roof, which is why the
                                  -- roof table stays in the client
  PRIMARY KEY (generation, game_id)
);

-- Reads are always scoped to one generation and one season, and then either to
-- a week (fixtures) or to every week (deriving byes).
CREATE INDEX IF NOT EXISTS idx_games_gen_season_week ON games (generation, season, week);
CREATE INDEX IF NOT EXISTS idx_games_gen_season_home ON games (generation, season, home_team);
CREATE INDEX IF NOT EXISTS idx_games_gen_season_away ON games (generation, season, away_team);

CREATE TABLE IF NOT EXISTS schedule_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
