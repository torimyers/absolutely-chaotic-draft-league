/**
 * Predictive Analytics
 *
 * Forward-looking, league-wide view built entirely from data the app already
 * pulls from Sleeper. Two distinct predictions:
 *
 *   1. Playoff and championship odds for every team, via Monte Carlo. The
 *      PlayoffSimulator already models a rest-of-season run and a bracket, so
 *      those primitives are reused here rather than reimplemented - the
 *      difference is that this aggregates every team in a single pass instead of
 *      tracking one target team.
 *   2. Breakout predictions, scored from player age, experience, depth-chart
 *      position and how hard the league is adding them.
 */

class PredictiveAnalytics {
    constructor(configManager) {
        this.configManager = configManager;
        this.sleeperAPI = new SleeperAPI();
        this.currentWeek = null;
        this.lastPredictions = null;

        // Enough passes for the odds to settle without blocking the UI for long.
        this.SIMULATION_COUNT = 5000;

        console.log('📈 PredictiveAnalytics: Initializing prediction engine...');
    }

    async initialize() {
        await this.loadCurrentWeek();
        console.log('✅ PredictiveAnalytics: Initialization complete');
    }

    async loadCurrentWeek() {
        try {
            const nflState = await this.sleeperAPI.fetchAPI('/state/nfl');
            this.currentWeek = nflState.week || 1;
        } catch (error) {
            console.error('❌ Error loading current week:', error);
            this.currentWeek = 1;
        }
    }

    // ======================
    // ORCHESTRATION
    // ======================

    async runPredictions() {
        const button = document.getElementById('runPredictionsBtn');
        if (button) {
            button.disabled = true;
            button.innerHTML = '<span>⏳</span> Running simulations...';
        }

        try {
            const leagueId = this.configManager.config.sleeperLeagueId;
            if (!leagueId) {
                throw new Error('Add your Sleeper League ID in configuration first');
            }

            const simulator = window.playoffSimulator;
            if (!simulator) {
                throw new Error('Playoff simulator is not available');
            }

            const leagueData = await this.sleeperAPI.getLeagueData(leagueId);
            if (!leagueData.success) {
                throw new Error(leagueData.error || 'Could not load league data');
            }

            const standings = simulator.calculateCurrentStandings(leagueData.rosters, leagueData.users);
            const structure = simulator.determinePlayoffStructure(leagueData.rosters.length);

            const odds = this.runLeagueSimulation(simulator, standings, structure, this.SIMULATION_COUNT);
            const breakouts = await this.predictBreakouts();
            const myRosterId = this.identifyUserRosterId(leagueData);

            this.lastPredictions = { odds, breakouts, structure, myRosterId };
            this.renderPredictions(odds, breakouts, structure, myRosterId);

            this.configManager.showNotification(
                `📈 ${this.SIMULATION_COUNT.toLocaleString()} seasons simulated`,
                'success'
            );

        } catch (error) {
            console.error('❌ Error running predictions:', error);
            this.renderError(error.message);
            this.configManager.showNotification(`❌ ${error.message}`, 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = '<span>📈</span> Run Predictions';
            }
        }
    }

    /**
     * Plays out the rest of the season many times and records how often each
     * team makes the playoffs and wins it all.
     *
     * The simulator's own aggregate only follows one team, and counts a finish
     * solely in the runs where that team reached the bracket. Aggregating every
     * team here keeps the average finish honest.
     */
    runLeagueSimulation(simulator, standings, structure, numSimulations) {
        const tally = {};
        standings.forEach(team => {
            tally[team.rosterId] = {
                rosterId: team.rosterId,
                teamName: team.teamName,
                wins: team.wins,
                losses: team.losses,
                pointsFor: team.pointsFor,
                avgPointsFor: team.avgPointsFor,
                playoffs: 0,
                titles: 0,
                finals: 0,
                finishSum: 0,
                winsSum: 0,
                byes: 0
            };
        });

        for (let i = 0; i < numSimulations; i++) {
            const season = simulator.simulateRestOfSeason(standings);
            const outcome = this.simulateBracket(season, structure);

            outcome.forEach(team => {
                const record = tally[team.rosterId];
                if (!record) return;

                record.finishSum += team.finalRank;
                record.winsSum += (team.projectedWins !== undefined ? team.projectedWins : team.wins);

                if (team.madePlayoffs) {
                    record.playoffs++;
                    if (team.playoffSeed <= structure.firstRoundByes) record.byes++;
                    if (team.reachedChampionship) record.finals++;
                    if (team.wonChampionship) record.titles++;
                }
            });
        }

        return Object.values(tally).map(record => ({
            rosterId: record.rosterId,
            teamName: record.teamName,
            wins: record.wins,
            losses: record.losses,
            pointsFor: record.pointsFor,
            avgPointsFor: record.avgPointsFor,
            playoffOdds: (record.playoffs / numSimulations) * 100,
            titleOdds: (record.titles / numSimulations) * 100,
            finalsOdds: (record.finals / numSimulations) * 100,
            byeOdds: (record.byes / numSimulations) * 100,
            projectedWins: record.winsSum / numSimulations,
            averageFinish: record.finishSum / numSimulations
        })).sort((a, b) => b.playoffOdds - a.playoffOdds || b.titleOdds - a.titleOdds);
    }

    /**
     * Plays a real single-elimination bracket, so exactly one team wins each
     * simulated season and the title odds across the league sum to 100%.
     *
     * The simulator's own playoff pass rolls each seed's advancement
     * independently, which is fine for reading one team in isolation but leaves
     * a large share of seasons with no champion at all once you aggregate every
     * team - so the league-wide view needs its own bracket.
     */
    simulateBracket(seasonStandings, structure) {
        const field = seasonStandings.slice(0, structure.playoffTeams)
            .map((team, index) => ({ ...team, playoffSeed: index + 1, madePlayoffs: true }));

        const missed = seasonStandings.slice(structure.playoffTeams)
            .map((team, index) => ({
                ...team,
                madePlayoffs: false,
                reachedChampionship: false,
                wonChampionship: false,
                finalRank: structure.playoffTeams + index + 1
            }));

        if (!field.length) return missed;

        // Byes sit out the opening round; everyone else pairs highest against lowest.
        let alive = field.slice(0, structure.firstRoundByes);
        let playing = field.slice(structure.firstRoundByes);
        const eliminated = [];
        let finalists = [];

        while (alive.length + playing.length > 1) {
            const winners = [];

            for (let i = 0, j = playing.length - 1; i < j; i++, j--) {
                const [winner, loser] = this.playMatchup(playing[i], playing[j]);
                winners.push(winner);
                eliminated.push(loser);
            }

            // An odd team out advances by default rather than being dropped.
            if (playing.length % 2 === 1) {
                winners.push(playing[Math.floor(playing.length / 2)]);
            }

            // Reseed the survivors for the next round.
            playing = [...alive, ...winners].sort((a, b) => a.playoffSeed - b.playoffSeed);
            alive = [];

            if (playing.length === 2) {
                finalists = [...playing];
                const [champion, runnerUp] = this.playMatchup(playing[0], playing[1]);
                eliminated.push(runnerUp);
                playing = [champion];
            }
        }

        const champion = playing[0];
        const finalistIds = new Set(finalists.map(t => t.rosterId));

        // Losers are ranked by the round they went out in, best seed first.
        eliminated.reverse();

        const ranked = [
            { ...champion, reachedChampionship: true, wonChampionship: true, finalRank: 1 },
            ...eliminated.map((team, index) => ({
                ...team,
                reachedChampionship: finalistIds.has(team.rosterId),
                wonChampionship: false,
                finalRank: index + 2
            }))
        ];

        return [...ranked, ...missed];
    }

    /**
     * Decides one playoff game. Scoring average drives the edge, damped so a
     * strong team is a favourite rather than a certainty - fantasy weeks are
     * high-variance and even the best roster loses often enough to matter.
     */
    playMatchup(teamA, teamB) {
        const strengthA = Math.max(1, teamA.avgPointsFor || 100);
        const strengthB = Math.max(1, teamB.avgPointsFor || 100);

        const edge = (strengthA - strengthB) / (strengthA + strengthB);
        const probA = Math.max(0.25, Math.min(0.75, 0.5 + edge * 1.5));

        return Math.random() < probA ? [teamA, teamB] : [teamB, teamA];
    }

    identifyUserRosterId(leagueData) {
        if (window.teamManager && window.teamManager.currentRoster) {
            return window.teamManager.currentRoster.roster.roster_id;
        }

        const username = this.configManager.config.sleeperUsername;
        if (username) {
            const user = (leagueData.users || []).find(
                u => u.display_name && u.display_name.toLowerCase() === username.toLowerCase()
            );
            if (user) {
                const roster = (leagueData.rosters || []).find(r => r.owner_id === user.user_id);
                if (roster) return roster.roster_id;
            }
        }

        return null;
    }

    // ======================
    // BREAKOUT PREDICTION
    // ======================

    /**
     * Looks for players the league is starting to move on before the breakout is
     * obvious. Age and depth-chart position matter more than raw add count: a
     * 23-year-old who just moved to WR1 is a different proposition from a
     * 31-year-old getting added because someone ahead of them is hurt.
     */
    async predictBreakouts() {
        try {
            const [trending, allPlayers] = await Promise.all([
                this.sleeperAPI.getTrendingPlayers('add', 24, 60),
                this.sleeperAPI.getAllPlayers()
            ]);

            const scored = trending
                .map(entry => {
                    const player = allPlayers[entry.player_id];
                    if (!player) return null;

                    const evaluation = this.scoreBreakout(player, entry.count);
                    if (evaluation.likelihood < 35) return null;

                    return {
                        id: entry.player_id,
                        name: `${player.first_name} ${player.last_name}`,
                        position: player.position || 'N/A',
                        team: player.team || 'FA',
                        age: player.age,
                        adds: entry.count,
                        ...evaluation
                    };
                })
                .filter(Boolean)
                .sort((a, b) => b.likelihood - a.likelihood);

            return scored.slice(0, 6);
        } catch (error) {
            console.warn('⚠️ Breakout prediction unavailable:', error);
            return [];
        }
    }

    scoreBreakout(player, addCount) {
        const reasons = [];
        let likelihood = 30;

        // Skill positions are where breakouts actually show up in fantasy points.
        if (['RB', 'WR', 'TE'].includes(player.position)) {
            likelihood += 8;
        } else if (player.position === 'QB') {
            likelihood += 4;
        } else {
            likelihood -= 15;
        }

        if (player.age && player.age <= 24) {
            likelihood += 16;
            reasons.push(`Only ${player.age} - young enough for a bigger role to stick`);
        } else if (player.age && player.age <= 27) {
            likelihood += 6;
            reasons.push(`Age ${player.age}, still inside his prime`);
        } else if (player.age && player.age >= 30) {
            likelihood -= 12;
            reasons.push(`Age ${player.age} - more likely a short-term fill-in than a breakout`);
        }

        if (player.years_exp === 0) {
            likelihood += 8;
            reasons.push('Rookie whose role is still being defined');
        } else if (player.years_exp === 1 || player.years_exp === 2) {
            likelihood += 12;
            reasons.push(`Year ${player.years_exp + 1} player - the most common breakout window`);
        }

        if (player.depth_chart_order === 1) {
            likelihood += 14;
            reasons.push(`Listed first on the depth chart at ${player.depth_chart_position || player.position}`);
        } else if (player.depth_chart_order === 2) {
            likelihood += 6;
            reasons.push('Second on the depth chart - one change away from the lead role');
        } else if (player.depth_chart_order >= 4) {
            likelihood -= 15;
            reasons.push(`Buried at #${player.depth_chart_order} on the depth chart`);
        }

        if (addCount > 5000) {
            likelihood += 12;
            reasons.push(`Being added everywhere (${addCount.toLocaleString()} in 24h) - the window to get him cheap is closing`);
        } else if (addCount > 1000) {
            likelihood += 8;
            reasons.push(`Strong add volume (${addCount.toLocaleString()} in 24h)`);
        } else if (addCount > 200) {
            likelihood += 4;
            reasons.push(`Early interest building (${addCount.toLocaleString()} adds in 24h)`);
        }

        if (player.injury_status) {
            likelihood -= 20;
            reasons.push(`Currently ${player.injury_status.toUpperCase()} - the upside is on hold`);
        }

        if (!player.team) {
            likelihood -= 50;
            reasons.push('Not on an NFL roster');
        }

        likelihood = Math.max(0, Math.min(95, likelihood));

        return {
            likelihood: Math.round(likelihood),
            tier: likelihood >= 70 ? 'strong' : likelihood >= 55 ? 'promising' : 'speculative',
            reasoning: reasons.length ? reasons.join('. ') : 'Trending up without a clear driver yet'
        };
    }

    // ======================
    // RENDERING
    // ======================

    getContainer() {
        return document.getElementById('predictive-analytics-container');
    }

    renderError(message) {
        const container = this.getContainer();
        if (!container) return;

        container.innerHTML = `
            <div class="card">
                <div class="empty-state">
                    <div class="icon">📈</div>
                    <h3>Predictions unavailable</h3>
                    <p>${message}</p>
                    <button class="btn btn-primary" data-action="run-predictions" id="runPredictionsBtn" style="margin-top: 15px;">
                        <span>📈</span> Run Predictions
                    </button>
                </div>
            </div>
        `;
    }

    renderPredictions(odds, breakouts, structure, myRosterId) {
        const container = this.getContainer();
        if (!container) return;

        const me = odds.find(o => o.rosterId === myRosterId);

        container.innerHTML = `
            <div class="prediction-header">
                <div>
                    <h3>📈 Season Predictions</h3>
                    <p>
                        ${this.SIMULATION_COUNT.toLocaleString()} simulated seasons from week
                        ${this.currentWeek} · top ${structure.playoffTeams} make the playoffs${
                            structure.firstRoundByes ? `, top ${structure.firstRoundByes} get byes` : ''
                        }
                    </p>
                </div>
                <button class="btn btn-outline" data-action="run-predictions" id="runPredictionsBtn">
                    <span>🔄</span> Re-run
                </button>
            </div>

            ${me ? `
                <div class="prediction-mine">
                    <h4>Your team: ${me.teamName}</h4>
                    <div class="prediction-mine-stats">
                        <div class="metric-card">
                            <div class="metric-value">${me.playoffOdds.toFixed(1)}%</div>
                            <div class="metric-label">Playoff odds</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value">${me.titleOdds.toFixed(1)}%</div>
                            <div class="metric-label">Title odds</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value">${me.projectedWins.toFixed(1)}</div>
                            <div class="metric-label">Projected wins</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value">${this.ordinal(Math.round(me.averageFinish))}</div>
                            <div class="metric-label">Average finish</div>
                        </div>
                    </div>
                    <p class="prediction-verdict">${this.describeOutlook(me, structure, odds.length)}</p>
                </div>
            ` : `
                <div class="weather-notice">
                    💡 Add your Sleeper display name in configuration, or load your roster in
                    <strong>My Team</strong>, and your own team will be highlighted here.
                </div>
            `}

            <h4 class="prediction-section-title">🏆 Championship odds by team</h4>
            <div class="prediction-table-wrap">
                <table class="prediction-table">
                    <thead>
                        <tr>
                            <th>Team</th>
                            <th>Record</th>
                            <th>Proj. wins</th>
                            <th>Playoffs</th>
                            <th>Title</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${odds.map(team => `
                            <tr class="${team.rosterId === myRosterId ? 'is-mine' : ''}">
                                <td>${team.teamName}${team.rosterId === myRosterId ? ' <span class="you-flag">YOU</span>' : ''}</td>
                                <td>${team.wins}-${team.losses}</td>
                                <td>${team.projectedWins.toFixed(1)}</td>
                                <td>
                                    <div class="odds-bar">
                                        <div class="odds-fill playoffs" style="width: ${Math.max(1, team.playoffOdds).toFixed(1)}%"></div>
                                        <span>${team.playoffOdds.toFixed(1)}%</span>
                                    </div>
                                </td>
                                <td>
                                    <div class="odds-bar">
                                        <div class="odds-fill title" style="width: ${Math.max(1, team.titleOdds).toFixed(1)}%"></div>
                                        <span>${team.titleOdds.toFixed(1)}%</span>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <h4 class="prediction-section-title">🚀 Breakout candidates</h4>
            ${breakouts.length ? `
                <div class="breakout-grid">
                    ${breakouts.map(b => `
                        <div class="breakout-card tier-${b.tier}">
                            <div class="breakout-head">
                                <div>
                                    <strong>${b.name}</strong>
                                    <span class="breakout-meta">${b.position} · ${b.team}${b.age ? ` · ${b.age}y` : ''}</span>
                                </div>
                                <span class="breakout-score">${b.likelihood}%</span>
                            </div>
                            <p class="breakout-reason">${b.reasoning}</p>
                        </div>
                    `).join('')}
                </div>
            ` : `
                <p class="prediction-empty">
                    No strong breakout signals in the last 24 hours of league-wide adds.
                </p>
            `}

            <div class="weather-education">
                <h4>💡 How to read these</h4>
                <p>
                    The odds come from simulating the rest of the season thousands of times using each
                    team's win rate and scoring average, then playing out the bracket. They are not a
                    prediction of any single week - a 20% title chance still happens one time in five.
                    Early in the season the sample is small, so treat the numbers as directional and
                    watch how they move week to week rather than fixating on today's figure.
                </p>
                <p>
                    Breakout likelihood weighs age, experience and depth-chart position above raw
                    popularity, because add volume alone mostly tells you what already happened.
                </p>
            </div>
        `;
    }

    describeOutlook(me, structure, leagueSize) {
        const odds = me.playoffOdds;

        if (odds >= 90) {
            return `You are close to a lock for the playoffs. From here the thing that matters is seeding - ${
                structure.firstRoundByes ? `a top-${structure.firstRoundByes} finish buys a bye` : 'a higher seed means an easier bracket'
            } - so weigh moves by how much they raise your ceiling, not your floor.`;
        }
        if (odds >= 65) {
            return 'You are in decent shape but not safe. This is the point where a single injury swings the season, so depth at your thinnest position is worth more than an upgrade at your strongest.';
        }
        if (odds >= 35) {
            return 'Genuinely on the bubble. Small edges decide this - winning the waiver wire and setting the optimal lineup each week is worth more than any single trade.';
        }
        if (odds >= 10) {
            return 'You need things to break your way. Playing for upside now beats playing safe: variance is your friend when the median outcome misses the playoffs.';
        }
        return `A long shot at ${odds.toFixed(1)}%. If your league has keepers or dynasty rules, this is the point to sell veterans for next year. If not, swing for high-ceiling players and hope.`;
    }

    ordinal(n) {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PredictiveAnalytics;
}
