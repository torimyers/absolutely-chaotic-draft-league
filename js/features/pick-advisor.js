/**
 * Pick Advisor
 *
 * Decides what to recommend when you are on the clock.
 *
 * Ranking by average draft position answers "who is generally taken next",
 * which is not the same question as "who is worth the most to my team right
 * now". A quarterback ranked 40th overall is barely better than the quarterback
 * you could take in the twelfth round; a running back ranked 40th may be
 * markedly better than anything left at the position. Value over replacement
 * captures that difference, and it is what drives the board recommendation here.
 *
 * Four signals combine:
 *   - VOR, from projected points against a league-wide replacement level
 *   - tier cliffs, so a last-player-in-tier is flagged before the drop
 *   - positional runs in the live pick feed, so a thinning position is visible
 *   - the gap between projection and ADP, which is where bargains live
 *
 * Points come from Sleeper's own projections when they are available, selected
 * for the league's scoring format. When they are not - the endpoint is
 * undocumented and may be empty before a season starts - the anchored curves
 * below are used instead. Every valued player records which source was used, and
 * a position falls back wholesale rather than mixing the two, since measured and
 * modelled points are not on the same scale and the difference between them
 * would otherwise read as value.
 *
 * The curves are calibrated to typical half-PPR season totals. They are honest
 * about relative shape - the steep early running-back decline, the flat
 * quarterback middle - without pretending to forecast any individual player.
 */

class PickAdvisor {
    constructor(configManager) {
        this.configManager = configManager;
    }

    // ======================
    // PROJECTION CURVES
    // ======================

    /**
     * Season point anchors by positional rank, roughly half-PPR. The shape is
     * what matters: running backs and receivers fall away steeply through the
     * early ranks, quarterbacks and tight ends are flat after the elite few.
     */
    getPointAnchors() {
        return {
            QB:  [[1, 385], [6, 340], [12, 300], [18, 270], [24, 250], [36, 210]],
            RB:  [[1, 330], [6, 265], [12, 230], [18, 200], [24, 180], [36, 145], [48, 115]],
            WR:  [[1, 310], [6, 260], [12, 230], [18, 208], [24, 190], [36, 158], [48, 130]],
            TE:  [[1, 250], [3, 205], [6, 175], [12, 150], [18, 128], [24, 110]],
            K:   [[1, 145], [12, 130], [24, 118]],
            DEF: [[1, 150], [12, 128], [24, 110]]
        };
    }

    /** Linear interpolation between anchors, flat beyond the ends. */
    projectedPoints(position, positionalRank) {
        const anchors = this.getPointAnchors()[position];
        if (!anchors) return 0;

        const rank = Math.max(1, positionalRank);

        if (rank <= anchors[0][0]) return anchors[0][1];

        for (let i = 0; i < anchors.length - 1; i++) {
            const [r1, p1] = anchors[i];
            const [r2, p2] = anchors[i + 1];
            if (rank <= r2) {
                const t = (rank - r1) / (r2 - r1);
                return p1 + (p2 - p1) * t;
            }
        }

        // Past the last anchor, keep declining at the final observed slope.
        const [rLast, pLast] = anchors[anchors.length - 1];
        const [rPrev, pPrev] = anchors[anchors.length - 2];
        const slope = (pLast - pPrev) / (rLast - rPrev);
        return Math.max(40, pLast + slope * (rank - rLast));
    }

    /**
     * Scoring format shifts value between positions rather than within them.
     * Reception-heavy positions gain in PPR; nothing else moves much.
     */
    getFormatMultiplier(position, scoringFormat) {
        const format = (scoringFormat || 'Half PPR').toLowerCase();

        if (format.includes('half')) {
            return { WR: 1.04, TE: 1.05, RB: 1.01 }[position] || 1;
        }
        if (format.includes('ppr')) {
            return { WR: 1.08, TE: 1.10, RB: 1.02 }[position] || 1;
        }
        return 1; // Standard
    }

    /**
     * The rank at which a position stops being startable, which is where
     * "replacement level" sits. Flex demand is shared between running backs and
     * receivers, so both replacement lines sit deeper than their starter counts.
     */
    getReplacementRank(position, teams) {
        const t = teams || 12;
        return {
            QB: t,
            RB: Math.round(t * 2.5),
            WR: Math.round(t * 2.5),
            TE: t,
            K: t,
            DEF: t
        }[position] || t;
    }

    // ======================
    // VALUATION
    // ======================

    /**
     * Replacement level for each position, measured across every projected
     * player rather than only those still available.
     *
     * It is a property of the league's roster requirements, not of the board:
     * the twelfth-best quarterback is the replacement whether or not he has been
     * taken. Deriving it from the shrinking available pool would make it drift
     * upward all draft, and once the pool is shallower than the replacement rank
     * it collapses onto the worst player left, understating everyone's value.
     */
    computeReplacementBaselines(allPlayers, projections, teams, scoringFormat) {
        if (!projections || !allPlayers || !allPlayers.length) return null;

        const pointsByPosition = {};

        allPlayers.forEach(player => {
            const line = projections[String(player.id)];
            if (!line) return;

            const pts = (typeof SleeperAPI !== 'undefined' && SleeperAPI.pointsForFormat)
                ? SleeperAPI.pointsForFormat(line, scoringFormat)
                : line.pts_half_ppr;

            if (typeof pts !== 'number' || !(pts > 0)) return;

            const pos = player.position;
            if (!pointsByPosition[pos]) pointsByPosition[pos] = [];
            pointsByPosition[pos].push(pts);
        });

        const baselines = {};
        Object.entries(pointsByPosition).forEach(([pos, points]) => {
            points.sort((a, b) => b - a);
            const rank = this.getReplacementRank(pos, teams);
            // Too few projected players to locate the line honestly.
            if (points.length < rank) return;
            baselines[pos] = points[rank - 1];
        });

        return Object.keys(baselines).length ? baselines : null;
    }

    /**
     * Scores every available player. Uses Sleeper's projection for a player when
     * one exists, and falls back to the modelled curve when it does not, marking
     * which was used on each result.
     */
    valuePlayers(availablePlayers, options) {
        const { teams, scoringFormat, projections, replacementBaselines } = options;
        const byPosition = {};

        availablePlayers.forEach(player => {
            const pos = player.position;
            if (!byPosition[pos]) byPosition[pos] = [];
            byPosition[pos].push(player);
        });

        // A real projection for a specific player beats a curve fitted to the
        // position in general, so it is used whenever one exists. Coverage is
        // decided per position: mixing measured and modelled points inside one
        // position would rank them against different scales.
        const projectedFor = (player) => {
            if (!projections) return null;
            const line = projections[String(player.id)];
            if (!line) return null;
            const pts = (typeof SleeperAPI !== 'undefined' && SleeperAPI.pointsForFormat)
                ? SleeperAPI.pointsForFormat(line, scoringFormat)
                : (line.pts_half_ppr != null ? line.pts_half_ppr : null);
            return typeof pts === 'number' && pts > 0 ? pts : null;
        };

        const valued = [];

        Object.entries(byPosition).forEach(([pos, players]) => {
            const projected = new Map();
            players.forEach(p => {
                const pts = projectedFor(p);
                if (pts !== null) projected.set(String(p.id), pts);
            });

            // Only trust projections for a position when most of its players have
            // one; a thin sample would rank a projected player against a modelled
            // one and call the difference value.
            const usingProjections = players.length > 0
                && projected.size / players.length >= 0.6;

            if (usingProjections) {
                // Rank by what they are projected to score, not by draft order.
                players.sort((a, b) =>
                    (projected.get(String(b.id)) || 0) - (projected.get(String(a.id)) || 0));
            } else {
                players.sort((a, b) => (a.adp || 999) - (b.adp || 999));
            }

            const multiplier = usingProjections ? 1 : this.getFormatMultiplier(pos, scoringFormat);
            const replacementRank = this.getReplacementRank(pos, teams);

            // Replacement level is the player actually sitting at that rank when
            // projections are available, rather than a point on a generic curve.
            let replacementPoints;
            if (usingProjections && replacementBaselines && typeof replacementBaselines[pos] === 'number') {
                // League-wide baseline: the correct definition.
                replacementPoints = replacementBaselines[pos];
            } else if (usingProjections) {
                // No baseline supplied - fall back to the deepest available
                // player, which understates value but never invents it.
                const ranked = players
                    .map(p => projected.get(String(p.id)))
                    .filter(v => typeof v === 'number');
                const index = Math.min(ranked.length - 1, Math.max(0, replacementRank - 1));
                replacementPoints = ranked.length ? ranked[index] : 0;
            } else {
                replacementPoints = this.projectedPoints(pos, replacementRank) * multiplier;
            }

            players.forEach((player, index) => {
                const positionalRank = index + 1;
                const measured = usingProjections ? projected.get(String(player.id)) : null;
                const points = (typeof measured === 'number')
                    ? measured
                    : this.projectedPoints(pos, positionalRank) * multiplier;

                valued.push({
                    ...player,
                    positionalRank,
                    projectedPoints: Math.round(points),
                    replacementPoints: Math.round(replacementPoints),
                    vor: Math.round(points - replacementPoints),
                    projectionSource: (typeof measured === 'number') ? 'sleeper' : 'model'
                });
            });
        });

        return valued.sort((a, b) => b.vor - a.vor);
    }

    /**
     * Splits a position's available players into tiers wherever the drop in
     * value between consecutive players is unusually large. Being last in a tier
     * is the moment waiting actually costs you something.
     */
    computeTiers(valuedAtPosition) {
        if (!valuedAtPosition.length) return [];

        const sorted = [...valuedAtPosition].sort((a, b) => a.positionalRank - b.positionalRank);

        // Cliffs are measured on ADP, not on projected points. Positional rank
        // here is the player's index in the available pool, so the points curve
        // is smooth by construction and contains no cliffs to find. The gap the
        // market has left between two adjacent available players is the real
        // signal: three backs going inside ten picks and the next at forty is a
        // tier break, however evenly the curve is sampled.
        const gaps = [];
        for (let i = 0; i < sorted.length - 1; i++) {
            gaps.push((sorted[i + 1].adp || 999) - (sorted[i].adp || 999));
        }

        if (!gaps.length) return [sorted];

        const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const cliff = Math.max(meanGap * 1.8, 8);

        const tiers = [];
        let current = [sorted[0]];

        for (let i = 0; i < sorted.length - 1; i++) {
            if (gaps[i] >= cliff) {
                tiers.push(current);
                current = [];
            }
            current.push(sorted[i + 1]);
        }
        tiers.push(current);

        return tiers;
    }

    /**
     * Reads the live pick feed for positional runs. A run matters because it
     * removes the option you were counting on having next time round.
     */
    detectRuns(picks, teams, playerLookup) {
        const window = Math.max(6, Math.round((teams || 12) * 0.75));
        const recent = picks.slice(-window);
        const counts = {};

        recent.forEach(pick => {
            const player = playerLookup(pick);
            const pos = player && player.position;
            if (pos) counts[pos] = (counts[pos] || 0) + 1;
        });

        const runs = [];
        Object.entries(counts).forEach(([pos, count]) => {
            if (!['RB', 'WR', 'QB', 'TE'].includes(pos)) return;
            const share = count / Math.max(1, recent.length);
            if (count >= 3 && share >= 0.4) {
                runs.push({ position: pos, count, window: recent.length, share });
            }
        });

        return runs.sort((a, b) => b.count - a.count);
    }

    // ======================
    // RECOMMENDATIONS
    // ======================

    /**
     * Produces the on-the-clock shortlist.
     *
     * The plan and the board are deliberately reported separately. A plan made
     * before the draft cannot know who fell to you; the board cannot know what
     * you were trying to build. Showing both, with the gap between them stated,
     * leaves the judgement where it belongs.
     */
    recommend(input) {
        const {
            availablePlayers = [],
            picks = [],
            planTargets = [],
            planBackups = [],
            roster = { counts: {} },
            teams = 12,
            scoringFormat = 'Half PPR',
            playerLookup = () => null,
            projections = null,
            replacementBaselines = null
        } = input;

        if (!availablePlayers.length) return [];

        const valued = this.valuePlayers(availablePlayers, {
            teams, scoringFormat, projections, replacementBaselines
        });
        const byId = new Map(valued.map(p => [String(p.id), p]));
        const runs = this.detectRuns(picks, teams, playerLookup);

        const tiersByPosition = {};
        ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
            tiersByPosition[pos] = this.computeTiers(valued.filter(p => p.position === pos));
        });

        const recommendations = [];
        const used = new Set();

        // The board: highest value over replacement, full stop.
        const boardPick = valued[0];
        if (boardPick) {
            used.add(String(boardPick.id));
            recommendations.push({
                player: boardPick,
                strategy: '📊 Best value on the board',
                reasoning: this.describeValue(boardPick, roster, tiersByPosition, runs),
                confidence: this.confidenceFor(boardPick, valued)
            });
        }

        // The plan: your pre-draft intent, with the cost of following it stated.
        const planPick = [...planTargets, ...planBackups]
            .map(p => byId.get(String(p.id)))
            .find(p => p && !used.has(String(p.id)));

        if (planPick) {
            used.add(String(planPick.id));
            const gap = boardPick ? boardPick.vor - planPick.vor : 0;
            recommendations.push({
                player: planPick,
                strategy: planTargets.some(t => String(t.id) === String(planPick.id))
                    ? '📋 Your plan'
                    : '📋 Your plan (backup)',
                reasoning: this.describePlan(planPick, gap, boardPick),
                confidence: Math.max(55, this.confidenceFor(planPick, valued) - Math.min(25, Math.round(gap / 4)))
            });
        }

        // The board and the plan agreeing is itself worth saying.
        if (boardPick && planTargets.some(t => String(t.id) === String(boardPick.id))) {
            recommendations[0].strategy = '📊📋 Board and plan agree';
            recommendations[0].confidence = Math.min(97, recommendations[0].confidence + 5);
        }

        // A third option driven by scarcity: the position being drained, or the
        // best player about to fall off a tier cliff. Positions already covered
        // above are skipped - three variations of "take a running back" fills the
        // shortlist without widening the choice.
        const covered = new Set(recommendations.map(r => r.player.position));
        const scarcityPick = this.findScarcityPick(valued, runs, tiersByPosition, used, roster, covered);
        if (scarcityPick) {
            used.add(String(scarcityPick.player.id));
            covered.add(scarcityPick.player.position);
            recommendations.push(scarcityPick);
        }

        // Backfill, preferring a position not yet on the shortlist so the three
        // options represent real alternatives rather than a ranked run.
        const backfill = (preferNewPosition) => {
            for (const candidate of valued) {
                if (recommendations.length >= 3) return;
                if (used.has(String(candidate.id))) continue;
                if (preferNewPosition && covered.has(candidate.position)) continue;

                used.add(String(candidate.id));
                covered.add(candidate.position);
                recommendations.push({
                    player: candidate,
                    strategy: preferNewPosition ? '🔀 Best at another position' : '➕ Next best value',
                    reasoning: this.describeValue(candidate, roster, tiersByPosition, runs),
                    confidence: this.confidenceFor(candidate, valued)
                });
            }
        };

        backfill(true);
        backfill(false); // if every position is already covered, fall back to raw value

        return recommendations.slice(0, 3);
    }

    findScarcityPick(valued, runs, tiersByPosition, used, roster, covered = new Set()) {
        // A run on a position you still need is the most urgent signal available.
        for (const run of runs) {
            if (covered.has(run.position)) continue;

            const need = (roster.counts && roster.counts[run.position]) || 0;
            const limit = { RB: 5, WR: 5, QB: 2, TE: 2 }[run.position] || 2;
            if (need >= limit) continue;

            const atPosition = valued.filter(p => p.position === run.position);
            const candidate = atPosition.find(p => !used.has(String(p.id)));

            if (candidate) {
                // Only claim "best left" when nothing better at the position has
                // already been listed above this one.
                const isBestRemaining = atPosition[0] && String(atPosition[0].id) === String(candidate.id);
                const description = isBestRemaining
                    ? `${candidate.name} is the best ${run.position} left`
                    : `${candidate.name} is the next ${run.position} after the one listed above`;

                return {
                    player: candidate,
                    strategy: `🏃 ${run.position} run in progress`,
                    reasoning: `${run.count} of the last ${run.window} picks were ${run.position}s. ` +
                        `${description} (${candidate.vor >= 0 ? '+' : ''}${candidate.vor} over replacement). ` +
                        `Waiting a round here usually costs more than it saves.`,
                    confidence: isBestRemaining ? 80 : 72
                };
            }
        }

        // Otherwise, flag someone who is the last of their tier.
        for (const pos of ['RB', 'WR', 'TE', 'QB']) {
            if (covered.has(pos)) continue;

            const tiers = tiersByPosition[pos] || [];
            const topTier = tiers[0];
            if (!topTier || topTier.length === 0 || topTier.length > 2) continue;

            const candidate = topTier.find(p => !used.has(String(p.id)));
            if (candidate) {
                const nextTier = tiers[1] && tiers[1][0];
                const drop = nextTier ? candidate.projectedPoints - nextTier.projectedPoints : 0;
                return {
                    player: candidate,
                    strategy: `⛰️ Last of the ${pos} tier`,
                    reasoning: `Only ${topTier.length} player${topTier.length === 1 ? '' : 's'} left at this ${pos} tier` +
                        (drop > 0 ? `, and the next tier down projects about ${Math.round(drop)} fewer points.` : '.') +
                        ` Take the cliff into account before passing.`,
                    confidence: 78
                };
            }
        }

        return null;
    }

    describeValue(player, roster, tiersByPosition, runs) {
        const have = (roster.counts && roster.counts[player.position]) || 0;
        const parts = [];

        parts.push(`${player.vor >= 0 ? '+' : ''}${player.vor} points over a replacement ${player.position} ` +
            `(${player.projectedPoints} projected vs ${player.replacementPoints} for the waiver-level starter)`);

        parts.push(`${player.position}${have === 1 ? '' : 's'} on your roster: ${have}`);

        const tiers = tiersByPosition[player.position] || [];
        if (tiers[0] && tiers[0].some(p => String(p.id) === String(player.id)) && tiers[0].length <= 3) {
            parts.push(`only ${tiers[0].length} left in this tier`);
        }

        const run = runs.find(r => r.position === player.position);
        if (run) {
            parts.push(`${run.count} of the last ${run.window} picks were ${run.position}s`);
        }

        const falling = this.describeValueGap(player);
        if (falling) parts.push(falling);

        return parts.join('. ') + '.';
    }

    /**
     * Projections say how good a player will be; ADP says when the room takes
     * them. The gap between the two is the bargain, and it is only computable
     * once real projections are in play - a modelled curve derived from rank
     * would just be restating the rank.
     */
    describeValueGap(player) {
        if (player.projectionSource !== 'sleeper') return null;
        if (typeof player.adp !== 'number' || player.adp >= 999) return null;

        // Where the market is taking them, in rounds, against where they rank.
        const marketRound = Math.ceil(player.adp / 12);
        const valueRound = Math.ceil(player.positionalRank * 2.2 / 12);
        const roundsFallen = marketRound - valueRound;

        if (roundsFallen >= 2) {
            return `projects like a round ${Math.max(1, valueRound)} player but is going around round ${marketRound} - falling value`;
        }
        if (roundsFallen <= -2) {
            return `going around round ${marketRound}, earlier than the projection supports`;
        }
        return null;
    }

    describePlan(player, gap, boardPick) {
        if (!boardPick || gap <= 0) {
            return `Your planned target, and nothing on the board beats them right now ` +
                `(${player.vor >= 0 ? '+' : ''}${player.vor} over replacement).`;
        }
        if (gap < 10) {
            return `Your planned target. ${boardPick.name} grades marginally higher ` +
                `(${gap} points of value), which is inside the noise - sticking to the plan is defensible.`;
        }
        return `Your planned target, but ${boardPick.name} is worth about ${gap} more points over replacement. ` +
            `That is a real gap; take the plan only if you have a reason the board cannot see.`;
    }

    confidenceFor(player, valued) {
        const best = valued[0];
        if (!best || best.vor <= 0) return 70;
        const ratio = player.vor / best.vor;
        return Math.max(60, Math.min(95, Math.round(60 + ratio * 35)));
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PickAdvisor;
}
