/**
 * Player Stats Index
 *
 * One place that turns Sleeper's stats and projections endpoints into the
 * numbers the analysis features need: a per-player point total, a positional
 * value scale, week-by-week game logs, and team-level offensive output.
 *
 * Several features used to invent these with Math.random(), which made the same
 * roster score differently on every click. Everything here is derived from real
 * data or reported as absent - there is no fallback that makes a number up.
 */

class PlayerStats {
    constructor(api) {
        this.api = api || new SleeperAPI();
        this.reset();
    }

    reset() {
        this.ready = false;
        this.loading = null;
        this.source = null;          // 'stats' (games played) or 'projections'
        this.season = null;
        this.currentWeek = null;
        this.seasonType = null;
        this.scoringFormat = null;
        this.rosterFormat = 'Standard';
        this.teams = 12;
        this.seasonPoints = new Map();   // player_id -> points for the season
        this.weeks = [];                 // [{ week, points: Map }] most recent last
        this.baselines = {};             // position -> { elite, replacement, starterAvg }
        this.teamOffense = new Map();    // NFL team -> { points, rank, of }
        this.allPlayers = null;
    }

    /** One index for the whole page - every feature reads the same numbers. */
    static shared() {
        if (!PlayerStats.instance) PlayerStats.instance = new PlayerStats();
        return PlayerStats.instance;
    }

    /**
     * Starters a league of this size demands at each position. The player at
     * this rank is replacement level: freely available, so his production is
     * the zero point that positional value is measured from.
     *
     * Matches PickAdvisor.getReplacementRank so the draft board and the season
     * analysis do not disagree about who counts as a starter.
     */
    static replacementRank(position, teams, rosterFormat) {
        const t = teams || 12;

        // A Super Flex or 2QB league starts close to two quarterbacks per team,
        // so the replacement-level QB is far deeper in the pool - roughly the
        // 22nd rather than the 12th in a 12-team league. Leaving it at one per
        // team is what makes QB value collapse in these formats.
        const twoQB = rosterFormat === 'Super Flex' || rosterFormat === '2QB';
        const qbRank = rosterFormat === '2QB'
            ? t * 2                     // both slots are mandatory
            : twoQB
                ? Math.round(t * 1.8)   // most, not all, teams start a second QB
                : t;

        return {
            QB: qbRank,
            RB: Math.round(t * 2.5),
            WR: Math.round(t * 2.5),
            TE: t,
            K: t,
            DEF: t
        }[position] || t;
    }

    /** Loads once and shares the in-flight promise with concurrent callers. */
    async ensureLoaded(options = {}) {
        if (this.ready && !options.force) return this;
        if (this.loading && !options.force) return this.loading;

        this.loading = this.load(options)
            .catch(error => {
                console.warn('⚠️ PlayerStats: load failed, features will report no data:', error.message);
                return this;
            })
            .finally(() => { this.loading = null; });

        return this.loading;
    }

    async load(options = {}) {
        const state = await this.api.getNFLState().catch(() => null);

        this.season = String(options.season || state?.season || new Date().getFullYear());
        this.currentWeek = options.week || state?.week || 1;
        this.seasonType = state?.season_type || 'regular';
        this.scoringFormat = options.scoringFormat || 'Half PPR';
        this.rosterFormat = options.rosterFormat || 'Standard';
        this.teams = options.teams || 12;
        this.allPlayers = options.allPlayers || await this.api.getAllPlayers().catch(() => null);

        // Regular-season games have to have been played for actuals to exist.
        // In August they have not, so the season is described by projections and
        // every consumer is told which it is looking at.
        const regularSeasonUnderway = this.seasonType === 'regular' && this.currentWeek > 1;

        let seasonLine = null;
        if (regularSeasonUnderway) {
            seasonLine = await this.api.getSeasonStats(this.season);
            if (this.pointsFromLines(seasonLine).size) this.source = 'stats';
        }

        if (this.source !== 'stats') {
            seasonLine = await this.api.getSeasonProjections(this.season);
            if (this.pointsFromLines(seasonLine).size) this.source = 'projections';
        }

        this.seasonPoints = this.source ? this.pointsFromLines(seasonLine) : new Map();

        if (this.source === 'stats') {
            this.weeks = await this.loadWeeks(options.weeksBack || 8);
        }

        this.baselines = this.computeBaselines();
        this.teamOffense = this.computeTeamOffense();
        this.ready = true;

        console.log(
            this.source
                ? `📊 PlayerStats: ${this.seasonPoints.size} players from ${this.season} ${this.source}` +
                  (this.weeks.length ? `, ${this.weeks.length} weeks of game logs` : '')
                : `📊 PlayerStats: no stats or projections available for ${this.season}`
        );

        return this;
    }

    /** The trailing window of weeks that have actually been played. */
    async loadWeeks(weeksBack) {
        const lastPlayed = this.currentWeek - 1;
        if (lastPlayed < 1) return [];

        const from = Math.max(1, lastPlayed - weeksBack + 1);
        const requests = [];
        for (let week = from; week <= lastPlayed; week++) {
            requests.push(
                this.api.getWeeklyStats(this.season, week)
                    .then(lines => ({ week, points: this.pointsFromLines(lines) }))
                    .catch(() => ({ week, points: new Map() }))
            );
        }

        const loaded = await Promise.all(requests);
        return loaded.filter(entry => entry.points.size > 0);
    }

    /**
     * Sleeper publishes each scoring format as its own field, so the league's
     * format is read directly rather than approximated with a multiplier.
     */
    pointsFromLines(lines) {
        const points = new Map();
        if (!lines) return points;

        Object.keys(lines).forEach(playerId => {
            const value = SleeperAPI.pointsForFormat(lines[playerId], this.scoringFormat);
            if (typeof value === 'number') points.set(String(playerId), value);
        });

        return points;
    }

    /**
     * Per position, the two anchors that a 0-100 value scale needs: what a
     * replacement-level starter produces, and what an elite one does.
     */
    computeBaselines() {
        const byPosition = {};

        this.seasonPoints.forEach((points, playerId) => {
            const player = this.allPlayers?.[playerId];
            const position = player?.position;
            if (!position || points <= 0) return;
            (byPosition[position] = byPosition[position] || []).push(points);
        });

        const baselines = {};
        Object.entries(byPosition).forEach(([position, points]) => {
            points.sort((a, b) => b - a);

            const replacementRank = PlayerStats.replacementRank(position, this.teams, this.rosterFormat);
            // The elite anchor is the AVERAGE of the top tier, not one player's
            // total. Anchoring on a single player let everyone above him pin at
            // 100, which collapsed the top of every position into a tie.
            const eliteCount = Math.max(3, Math.round(this.teams / 4));

            if (points.length < replacementRank) return;

            const replacement = points[replacementRank - 1];
            const eliteTier = points.slice(0, Math.min(eliteCount, points.length));
            const elite = eliteTier.reduce((sum, p) => sum + p, 0) / eliteTier.length;
            if (!(elite > replacement)) return;

            const starters = points.slice(0, replacementRank);
            baselines[position] = {
                elite,
                replacement,
                starterAvg: starters.reduce((sum, p) => sum + p, 0) / starters.length,
                pool: points.length
            };
        });

        return baselines;
    }

    /** Total offensive fantasy production by NFL team, ranked. */
    computeTeamOffense() {
        const totals = new Map();
        const offensive = new Set(['QB', 'RB', 'WR', 'TE']);

        this.seasonPoints.forEach((points, playerId) => {
            const player = this.allPlayers?.[playerId];
            if (!player?.team || !offensive.has(player.position) || points <= 0) return;
            totals.set(player.team, (totals.get(player.team) || 0) + points);
        });

        const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
        const offense = new Map();
        ranked.forEach(([team, points], index) => {
            offense.set(team, { points, rank: index + 1, of: ranked.length });
        });

        return offense;
    }

    // ======================
    // LOOKUPS
    // ======================

    hasData() {
        return this.ready && this.seasonPoints.size > 0;
    }

    /** True once real games are being measured rather than forecasts. */
    isActual() {
        return this.source === 'stats';
    }

    /** How the numbers should be described in the UI. */
    describeSource() {
        if (!this.source) return 'no data';
        return this.source === 'stats'
            ? `${this.season} season stats`
            : `${this.season} projections`;
    }

    pointsFor(playerId) {
        const value = this.seasonPoints.get(String(playerId));
        return typeof value === 'number' ? value : null;
    }

    /**
     * Positional value on a 0-100 scale: replacement level sits at 50 and the
     * elite anchor at 100, so the number means something league-relative
     * instead of being a bare point total.
     */
    valueFor(player) {
        if (!player) return null;

        const points = this.pointsFor(player.player_id);
        if (points === null) return null;

        const baseline = this.baselines[player.position];
        if (!baseline) return null;

        const span = baseline.elite - baseline.replacement;
        const value = 50 + 50 * ((points - baseline.replacement) / span);
        return Math.max(0, Math.min(100, value));
    }

    /** Every played week this player recorded a stat line in. */
    weeklyFor(playerId) {
        const id = String(playerId);
        return this.weeks
            .filter(entry => entry.points.has(id))
            .map(entry => ({ week: entry.week, points: entry.points.get(id) }));
    }

    /**
     * Recent form against the player's own season. Needs at least four played
     * games to say anything - below that a single big week is the whole trend.
     */
    trendFor(playerId) {
        const games = this.weeklyFor(playerId);
        if (games.length < 4) return null;

        const split = Math.floor(games.length / 2);
        const mean = list => list.reduce((sum, g) => sum + g.points, 0) / list.length;

        const earlier = mean(games.slice(0, split));
        const recent = mean(games.slice(split));
        if (earlier <= 0) return null;

        const ratio = recent / earlier;
        return {
            direction: ratio > 1.15 ? 'improving' : ratio < 0.85 ? 'declining' : 'stable',
            recentAvg: recent,
            earlierAvg: earlier,
            ratio,
            games: games.length
        };
    }

    /**
     * Where a player's offense ranks in real fantasy production. Replaces the
     * randomly drawn "high-powered offense" blurbs that used to be attached to
     * whichever team happened to come up.
     */
    teamContextFor(team) {
        const entry = team ? this.teamOffense.get(team) : null;
        if (!entry || entry.of < 8) return null;

        const percentile = 1 - (entry.rank - 1) / Math.max(1, entry.of - 1);
        const adjustment = Math.round((percentile - 0.5) * 16); // -8 to +8

        // Say plainly whether this is measured or forecast - the two carry very
        // different weight in August.
        const basis = this.isActual() ? 'ranks' : 'projects';
        const place = `#${entry.rank} of ${entry.of}`;

        let reasoning;
        if (entry.rank <= Math.ceil(entry.of / 4)) {
            reasoning = `${team} ${basis} ${place} in offensive fantasy production - volume and scoring chances are there`;
        } else if (entry.rank > entry.of - Math.ceil(entry.of / 4)) {
            reasoning = `${team} ${basis} ${place} on offense, which caps the ceiling`;
        } else {
            reasoning = `${team} ${basis} ${place} on offense - middle of the pack`;
        }

        return { adjustment, reasoning, rank: entry.rank, of: entry.of, points: entry.points };
    }
}

PlayerStats.instance = null;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlayerStats;
}
