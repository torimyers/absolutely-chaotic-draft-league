/**
 * Playoff Simulator - Advanced Playoff Probability and Scenario Planning
 * Provides comprehensive playoff odds, scenario analysis, and championship probability calculations
 */

class PlayoffSimulator {
    constructor(configManager) {
        this.configManager = configManager;
        this.sleeperAPI = new SleeperAPI();
        this.currentWeek = null;
        this.leagueData = null;
        this.simulationCache = new Map();
        this.seasonLength = 14; // Standard regular season length
        this.playoffWeeks = 3; // Weeks 15-17
        
        console.log('🏆 PlayoffSimulator: Initializing playoff probability calculator...');
    }

    async initialize() {
        // Load current NFL week
        await this.loadCurrentWeek();
        
        console.log('✅ PlayoffSimulator: Initialization complete');
    }

    async loadCurrentWeek() {
        try {
            const nflState = await this.sleeperAPI.fetchAPI('/state/nfl');
            this.currentWeek = nflState.week;
            console.log(`📅 Current NFL Week: ${this.currentWeek}`);
        } catch (error) {
            console.error('❌ Error loading current week:', error);
            this.currentWeek = 1;
        }
    }

    async runPlayoffSimulation(leagueData, targetTeam, numSimulations = 10000) {
        try {
            console.log(`🎲 Running ${numSimulations} playoff simulations...`);
            
            this.leagueData = leagueData;
            const { rosters, users } = leagueData;
            
            // Calculate current standings
            const standings = this.calculateCurrentStandings(rosters, users);
            
            // Determine playoff structure
            const playoffStructure = this.determinePlayoffStructure(rosters.length);
            
            // Run simulations
            const simResults = await this.runSeasonSimulations(
                standings, playoffStructure, targetTeam, numSimulations
            );
            
            // Generate scenario analysis
            const scenarios = this.generateScenarios(standings, targetTeam, playoffStructure);
            
            // Calculate championship odds
            const championshipOdds = this.calculateChampionshipOdds(simResults, targetTeam);
            
            return {
                currentWeek: this.currentWeek,
                seasonLength: this.seasonLength,
                remainingGames: Math.max(0, this.seasonLength - this.currentWeek + 1),
                standings,
                playoffStructure,
                simulations: {
                    total: numSimulations,
                    results: simResults
                },
                playoffOdds: simResults.playoffOdds,
                championshipOdds,
                scenarios,
                keyInsights: this.generateKeyInsights(simResults, scenarios, targetTeam),
                recommendations: this.generatePlayoffRecommendations(simResults, scenarios, targetTeam)
            };

        } catch (error) {
            console.error('❌ Error running playoff simulation:', error);
            throw error;
        }
    }

    calculateCurrentStandings(rosters, users) {
        const standings = rosters.map(roster => {
            const user = users.find(u => u.user_id === roster.owner_id);
            const wins = roster.settings?.wins || 0;
            const losses = roster.settings?.losses || 0;
            const ties = roster.settings?.ties || 0;
            const pointsFor = roster.settings?.fpts || 0;
            const pointsAgainst = roster.settings?.fpts_against || 0;
            
            const gamesPlayed = wins + losses + ties;
            const winPercentage = gamesPlayed > 0 ? wins / gamesPlayed : 0;
            const avgPointsFor = gamesPlayed > 0 ? pointsFor / gamesPlayed : 0;
            const avgPointsAgainst = gamesPlayed > 0 ? pointsAgainst / gamesPlayed : 0;
            
            return {
                rosterId: roster.roster_id,
                teamName: user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`,
                wins,
                losses,
                ties,
                gamesPlayed,
                winPercentage,
                pointsFor,
                pointsAgainst,
                avgPointsFor,
                avgPointsAgainst,
                strengthOfSchedule: this.calculateStrengthOfSchedule(roster, rosters),
                projectedWins: this.projectSeasonWins(roster, rosters)
            };
        });

        // Sort by wins, then points for
        return standings.sort((a, b) => {
            if (a.wins !== b.wins) return b.wins - a.wins;
            return b.pointsFor - a.pointsFor;
        });
    }

    calculateStrengthOfSchedule(roster, allRosters) {
        // Simplified SOS calculation (would use actual matchup data in production)
        const avgOpponentRecord = allRosters
            .filter(r => r.roster_id !== roster.roster_id)
            .reduce((sum, r) => {
                const wins = r.settings?.wins || 0;
                const games = (r.settings?.wins || 0) + (r.settings?.losses || 0) + (r.settings?.ties || 0);
                return sum + (games > 0 ? wins / games : 0);
            }, 0) / Math.max(1, allRosters.length - 1);
        
        return avgOpponentRecord;
    }

    projectSeasonWins(roster, allRosters) {
        const currentWins = roster.settings?.wins || 0;
        const gamesPlayed = (roster.settings?.wins || 0) + (roster.settings?.losses || 0) + (roster.settings?.ties || 0);
        const remainingGames = Math.max(0, this.seasonLength - gamesPlayed);
        
        if (remainingGames === 0) return currentWins;
        
        // Simple projection based on current win rate and strength
        const currentWinRate = gamesPlayed > 0 ? currentWins / gamesPlayed : 0.5;
        const avgPointsFor = gamesPlayed > 0 ? (roster.settings?.fpts || 0) / gamesPlayed : 100;
        const leagueAvgScore = this.calculateLeagueAverageScore(allRosters);
        
        // Adjust win rate based on scoring performance
        let projectedWinRate = currentWinRate;
        if (avgPointsFor > leagueAvgScore * 1.1) {
            projectedWinRate = Math.min(0.8, projectedWinRate + 0.1);
        } else if (avgPointsFor < leagueAvgScore * 0.9) {
            projectedWinRate = Math.max(0.2, projectedWinRate - 0.1);
        }
        
        const projectedAdditionalWins = remainingGames * projectedWinRate;
        return Math.round((currentWins + projectedAdditionalWins) * 10) / 10;
    }

    calculateLeagueAverageScore(rosters) {
        const totalPoints = rosters.reduce((sum, r) => sum + (r.settings?.fpts || 0), 0);
        const totalGames = rosters.reduce((sum, r) => {
            return sum + (r.settings?.wins || 0) + (r.settings?.losses || 0) + (r.settings?.ties || 0);
        }, 0);
        
        return totalGames > 0 ? totalPoints / totalGames : 100;
    }

    determinePlayoffStructure(leagueSize) {
        let playoffTeams, firstRoundByes;
        
        if (leagueSize <= 8) {
            playoffTeams = 4;
            firstRoundByes = 0;
        } else if (leagueSize <= 10) {
            playoffTeams = 4;
            firstRoundByes = 0;
        } else if (leagueSize <= 12) {
            playoffTeams = 6;
            firstRoundByes = 2;
        } else {
            playoffTeams = 6;
            firstRoundByes = 2;
        }
        
        return {
            leagueSize,
            playoffTeams,
            firstRoundByes,
            playoffFormat: firstRoundByes > 0 ? 'Top 2 get byes' : 'No byes',
            rounds: [
                { round: 1, teams: playoffTeams - firstRoundByes, description: 'Wild Card' },
                { round: 2, teams: playoffTeams / 2, description: 'Semifinals' },
                { round: 3, teams: 2, description: 'Championship' }
            ]
        };
    }

    async runSeasonSimulations(standings, playoffStructure, targetTeam, numSimulations) {
        const results = {
            playoffAppearances: 0,
            championshipAppearances: 0,
            championships: 0,
            averageFinish: 0,
            finishDistribution: {},
            playoffOdds: 0,
            championshipOdds: 0,
            seedDistribution: {},
            scenarioOutcomes: {}
        };

        const targetRosterId = targetTeam.roster.roster_id;
        let totalFinish = 0;

        for (let sim = 0; sim < numSimulations; sim++) {
            const seasonResult = this.simulateRestOfSeason(standings);
            const playoffResult = this.simulatePlayoffs(seasonResult, playoffStructure);
            
            const targetTeamResult = playoffResult.find(t => t.rosterId === targetRosterId);
            
            if (targetTeamResult) {
                totalFinish += targetTeamResult.finalRank;
                
                // Track finish distribution
                const finish = targetTeamResult.finalRank;
                results.finishDistribution[finish] = (results.finishDistribution[finish] || 0) + 1;
                
                // Track playoff appearances
                if (targetTeamResult.madePlayoffs) {
                    results.playoffAppearances++;
                    
                    // Track seed distribution
                    const seed = targetTeamResult.playoffSeed;
                    results.seedDistribution[seed] = (results.seedDistribution[seed] || 0) + 1;
                    
                    // Track championship game appearances
                    if (targetTeamResult.reachedChampionship) {
                        results.championshipAppearances++;
                        
                        // Track championships
                        if (targetTeamResult.wonChampionship) {
                            results.championships++;
                        }
                    }
                }
            }
        }

        // Calculate percentages
        results.playoffOdds = (results.playoffAppearances / numSimulations) * 100;
        results.championshipOdds = (results.championships / numSimulations) * 100;
        results.averageFinish = totalFinish / numSimulations;

        // Convert distributions to percentages
        Object.keys(results.finishDistribution).forEach(finish => {
            results.finishDistribution[finish] = (results.finishDistribution[finish] / numSimulations) * 100;
        });

        Object.keys(results.seedDistribution).forEach(seed => {
            results.seedDistribution[seed] = (results.seedDistribution[seed] / results.playoffAppearances) * 100;
        });

        return results;
    }

    simulateRestOfSeason(standings) {
        const remainingWeeks = Math.max(0, this.seasonLength - this.currentWeek + 1);
        if (remainingWeeks === 0) return standings;

        return standings.map(team => {
            const additionalWins = this.simulateRemainingGames(team, remainingWeeks);
            
            return {
                ...team,
                projectedWins: team.wins + additionalWins,
                projectedLosses: team.losses + (remainingWeeks - additionalWins),
                finalWinPercentage: (team.wins + additionalWins) / this.seasonLength
            };
        }).sort((a, b) => {
            if (a.projectedWins !== b.projectedWins) return b.projectedWins - a.projectedWins;
            return b.pointsFor - a.pointsFor; // Tiebreaker
        });
    }

    simulateRemainingGames(team, remainingWeeks) {
        let wins = 0;
        const baseWinProb = Math.max(0.1, Math.min(0.9, team.winPercentage || 0.5));
        
        // Adjust based on scoring performance
        let adjustedWinProb = baseWinProb;
        if (team.avgPointsFor > 115) adjustedWinProb += 0.1;
        else if (team.avgPointsFor < 95) adjustedWinProb -= 0.1;
        
        adjustedWinProb = Math.max(0.1, Math.min(0.9, adjustedWinProb));
        
        for (let week = 0; week < remainingWeeks; week++) {
            if (Math.random() < adjustedWinProb) {
                wins++;
            }
        }
        
        return wins;
    }

    simulatePlayoffs(seasonStandings, playoffStructure) {
        const playoffTeams = seasonStandings.slice(0, playoffStructure.playoffTeams);
        
        return playoffTeams.map((team, index) => {
            const seed = index + 1;
            let reachedChampionship = false;
            let wonChampionship = false;
            
            // Simulate playoff run based on seed and team strength
            const playoffAdvanceProb = this.calculatePlayoffAdvanceProb(team, seed, playoffStructure);
            
            if (seed <= 2 && playoffStructure.firstRoundByes > 0) {
                // First round bye
                if (Math.random() < playoffAdvanceProb.semifinals) {
                    if (Math.random() < playoffAdvanceProb.championship) {
                        reachedChampionship = true;
                        if (Math.random() < playoffAdvanceProb.win) {
                            wonChampionship = true;
                        }
                    }
                }
            } else {
                // Play from first round
                if (Math.random() < playoffAdvanceProb.wildcard) {
                    if (Math.random() < playoffAdvanceProb.semifinals) {
                        if (Math.random() < playoffAdvanceProb.championship) {
                            reachedChampionship = true;
                            if (Math.random() < playoffAdvanceProb.win) {
                                wonChampionship = true;
                            }
                        }
                    }
                }
            }
            
            return {
                ...team,
                madePlayoffs: true,
                playoffSeed: seed,
                reachedChampionship,
                wonChampionship,
                finalRank: wonChampionship ? 1 : reachedChampionship ? 2 : seed + 2
            };
        }).concat(
            // Non-playoff teams
            seasonStandings.slice(playoffStructure.playoffTeams).map((team, index) => ({
                ...team,
                madePlayoffs: false,
                finalRank: playoffStructure.playoffTeams + index + 1
            }))
        );
    }

    calculatePlayoffAdvanceProb(team, seed, playoffStructure) {
        // Base probabilities by seed
        const baseProbabilities = {
            1: { wildcard: 0.85, semifinals: 0.75, championship: 0.65, win: 0.55 },
            2: { wildcard: 0.80, semifinals: 0.70, championship: 0.60, win: 0.50 },
            3: { wildcard: 0.70, semifinals: 0.55, championship: 0.45, win: 0.40 },
            4: { wildcard: 0.65, semifinals: 0.50, championship: 0.40, win: 0.35 },
            5: { wildcard: 0.50, semifinals: 0.35, championship: 0.25, win: 0.20 },
            6: { wildcard: 0.45, semifinals: 0.30, championship: 0.20, win: 0.15 }
        };
        
        let probs = baseProbabilities[seed] || baseProbabilities[6];
        
        // Adjust based on team performance
        const performanceMultiplier = team.avgPointsFor > 115 ? 1.15 : 
                                    team.avgPointsFor < 95 ? 0.85 : 1.0;
        
        return {
            wildcard: Math.min(0.95, probs.wildcard * performanceMultiplier),
            semifinals: Math.min(0.90, probs.semifinals * performanceMultiplier),
            championship: Math.min(0.85, probs.championship * performanceMultiplier),
            win: Math.min(0.80, probs.win * performanceMultiplier)
        };
    }

    calculateChampionshipOdds(simResults, targetTeam) {
        return {
            current: simResults.championshipOdds,
            comparison: this.compareToLeagueAverage(simResults.championshipOdds, this.leagueData?.rosters?.length || 12),
            factors: this.identifyChampionshipFactors(targetTeam, simResults),
            pathway: this.identifyChampionshipPathway(simResults)
        };
    }

    compareToLeagueAverage(teamOdds, leagueSize) {
        const leagueAverage = 100 / leagueSize;
        const ratio = teamOdds / leagueAverage;
        
        if (ratio >= 2.0) return 'Much Higher';
        if (ratio >= 1.5) return 'Higher';
        if (ratio >= 0.8) return 'Average';
        if (ratio >= 0.5) return 'Lower';
        return 'Much Lower';
    }

    identifyChampionshipFactors(targetTeam, simResults) {
        const factors = [];
        
        if (simResults.playoffOdds > 80) {
            factors.push('Strong playoff probability');
        }
        
        if (simResults.averageFinish <= 3) {
            factors.push('Consistently high finish');
        }
        
        // Analyze seed distribution
        const topSeeds = (simResults.seedDistribution[1] || 0) + (simResults.seedDistribution[2] || 0);
        if (topSeeds > 40) {
            factors.push('Likely to earn playoff bye');
        }
        
        return factors;
    }

    identifyChampionshipPathway(simResults) {
        const topSeedProb = simResults.seedDistribution[1] || 0;
        const byeSeedProb = (simResults.seedDistribution[1] || 0) + (simResults.seedDistribution[2] || 0);
        
        if (topSeedProb > 30) {
            return 'Most likely as #1 seed with bye week advantage';
        } else if (byeSeedProb > 40) {
            return 'Strong chance with first-round bye';
        } else {
            return 'Would need to win as wild card team';
        }
    }

    generateScenarios(standings, targetTeam, playoffStructure) {
        const targetRosterId = targetTeam.roster.roster_id;
        const currentTeam = standings.find(t => t.rosterId === targetRosterId);
        const currentRank = standings.findIndex(t => t.rosterId === targetRosterId) + 1;
        
        const scenarios = [];
        
        // Scenario 1: What happens if they win out?
        scenarios.push({
            title: 'Win Remaining Games',
            description: 'If you win all remaining regular season games',
            probability: this.calculateScenarioProb(currentTeam, 'win_out'),
            outcome: this.calculateWinOutOutcome(currentTeam, standings, playoffStructure),
            impact: 'Maximizes playoff chances and seeding'
        });
        
        // Scenario 2: What happens if they lose out?
        scenarios.push({
            title: 'Lose Remaining Games',
            description: 'If you lose all remaining regular season games',
            probability: this.calculateScenarioProb(currentTeam, 'lose_out'),
            outcome: this.calculateLoseOutOutcome(currentTeam, standings, playoffStructure),
            impact: 'Likely eliminates playoff chances'
        });
        
        // Scenario 3: What do they need for playoffs?
        const clinchScenario = this.calculateClinchScenario(standings, targetRosterId, playoffStructure);
        scenarios.push({
            title: 'Playoff Clinch',
            description: clinchScenario.description,
            probability: clinchScenario.probability,
            outcome: 'Guaranteed playoff berth',
            impact: 'Secures postseason opportunity'
        });
        
        // Scenario 4: What about other teams?
        const competitorAnalysis = this.analyzeCompetitors(standings, targetRosterId, playoffStructure);
        scenarios.push({
            title: 'Competitor Analysis',
            description: 'How other teams affect your playoff chances',
            probability: null,
            outcome: competitorAnalysis,
            impact: 'Shows external factors beyond your control'
        });
        
        return scenarios;
    }

    calculateScenarioProb(team, scenario) {
        const remainingGames = Math.max(0, this.seasonLength - team.gamesPlayed);
        const winProb = Math.max(0.1, Math.min(0.9, team.winPercentage || 0.5));
        
        if (scenario === 'win_out') {
            return Math.pow(winProb, remainingGames) * 100;
        } else if (scenario === 'lose_out') {
            return Math.pow(1 - winProb, remainingGames) * 100;
        }
        
        return 0;
    }

    calculateWinOutOutcome(currentTeam, standings, playoffStructure) {
        const remainingGames = Math.max(0, this.seasonLength - currentTeam.gamesPlayed);
        const maxWins = currentTeam.wins + remainingGames;
        
        // Count how many teams could potentially have more wins
        const betterTeams = standings.filter(team => {
            const theirRemaining = Math.max(0, this.seasonLength - team.gamesPlayed);
            const theirMaxWins = team.wins + theirRemaining;
            return theirMaxWins > maxWins;
        }).length;
        
        const projectedSeed = Math.max(1, betterTeams + 1);
        const madePlayoffs = projectedSeed <= playoffStructure.playoffTeams;
        
        return {
            projectedWins: maxWins,
            projectedSeed: madePlayoffs ? projectedSeed : null,
            madePlayoffs,
            description: madePlayoffs ? 
                `Likely ${projectedSeed} seed with ${maxWins} wins` :
                `${maxWins} wins may not be enough for playoffs`
        };
    }

    calculateLoseOutOutcome(currentTeam, standings, playoffStructure) {
        const finalWins = currentTeam.wins;
        
        // Count how many teams will likely have fewer wins
        const worseTeams = standings.filter(team => {
            return team.projectedWins < finalWins;
        }).length;
        
        const projectedSeed = standings.length - worseTeams;
        const madePlayoffs = projectedSeed <= playoffStructure.playoffTeams;
        
        return {
            projectedWins: finalWins,
            projectedSeed: madePlayoffs ? projectedSeed : null,
            madePlayoffs,
            description: madePlayoffs ? 
                `Could still make playoffs as ${projectedSeed} seed` :
                `${finalWins} wins likely eliminates playoff chances`
        };
    }

    calculateClinchScenario(standings, targetRosterId, playoffStructure) {
        const currentTeam = standings.find(t => t.rosterId === targetRosterId);
        const remainingGames = Math.max(0, this.seasonLength - currentTeam.gamesPlayed);
        
        if (remainingGames === 0) {
            const currentRank = standings.findIndex(t => t.rosterId === targetRosterId) + 1;
            return {
                description: 'Season complete',
                probability: currentRank <= playoffStructure.playoffTeams ? 100 : 0
            };
        }
        
        // Calculate minimum wins needed to guarantee playoffs
        const playoffBubbleTeams = standings.slice(playoffStructure.playoffTeams - 1, playoffStructure.playoffTeams + 3);
        const maxPossibleWinsOfBubbleTeam = Math.max(...playoffBubbleTeams.map(team => 
            team.wins + Math.max(0, this.seasonLength - team.gamesPlayed)
        ));
        
        const winsNeededToClinch = Math.max(0, maxPossibleWinsOfBubbleTeam - currentTeam.wins + 1);
        const gamesNeededToWin = Math.min(remainingGames, winsNeededToClinch);
        
        const clinchProb = this.calculateBinomialProb(remainingGames, gamesNeededToWin, currentTeam.winPercentage || 0.5);
        
        return {
            description: `Need ${gamesNeededToWin} more wins in ${remainingGames} games to guarantee playoffs`,
            probability: clinchProb * 100
        };
    }

    calculateBinomialProb(n, k, p) {
        if (k > n) return 0;
        if (k === 0) return Math.pow(1-p, n);
        if (k === n) return Math.pow(p, n);
        
        // Simplified calculation for demonstration
        let prob = 0;
        for (let i = k; i <= n; i++) {
            prob += this.binomialCoeff(n, i) * Math.pow(p, i) * Math.pow(1-p, n-i);
        }
        return prob;
    }

    binomialCoeff(n, k) {
        if (k > n) return 0;
        if (k === 0 || k === n) return 1;
        
        let result = 1;
        for (let i = 1; i <= k; i++) {
            result = result * (n - i + 1) / i;
        }
        return result;
    }

    analyzeCompetitors(standings, targetRosterId, playoffStructure) {
        const currentRank = standings.findIndex(t => t.rosterId === targetRosterId) + 1;
        const playoffLine = playoffStructure.playoffTeams;
        
        const analysis = {
            teamsAhead: currentRank - 1,
            teamsBehind: standings.length - currentRank,
            keyCompetitors: []
        };
        
        // Identify key competitors (teams within 2 spots of playoff line)
        const competitorRange = [
            Math.max(0, playoffLine - 2),
            Math.min(standings.length - 1, playoffLine + 2)
        ];
        
        for (let i = competitorRange[0]; i <= competitorRange[1]; i++) {
            const team = standings[i];
            if (team.rosterId !== targetRosterId) {
                analysis.keyCompetitors.push({
                    teamName: team.teamName,
                    rank: i + 1,
                    record: `${team.wins}-${team.losses}`,
                    remainingGames: Math.max(0, this.seasonLength - team.gamesPlayed),
                    projectedWins: team.projectedWins,
                    threat: i < currentRank - 1 ? 'Ahead of you' : 
                            i === currentRank - 1 ? 'Direct competitor' : 'Behind you'
                });
            }
        }
        
        return analysis;
    }

    generateKeyInsights(simResults, scenarios, targetTeam) {
        const insights = [];
        
        // Playoff probability insight
        if (simResults.playoffOdds > 75) {
            insights.push({
                type: 'positive',
                title: 'Strong Playoff Position',
                description: `${simResults.playoffOdds.toFixed(1)}% chance to make playoffs - you're in good shape!`
            });
        } else if (simResults.playoffOdds > 50) {
            insights.push({
                type: 'neutral',
                title: 'Playoff Race Tight',
                description: `${simResults.playoffOdds.toFixed(1)}% playoff odds - every game matters now`
            });
        } else {
            insights.push({
                type: 'negative',
                title: 'Playoff Push Needed',
                description: `${simResults.playoffOdds.toFixed(1)}% playoff odds - need strong finish to make it`
            });
        }
        
        // Championship insight
        if (simResults.championshipOdds > 15) {
            insights.push({
                type: 'positive',
                title: 'Championship Contender',
                description: `${simResults.championshipOdds.toFixed(1)}% championship odds - legitimate title threat`
            });
        } else if (simResults.championshipOdds > 8) {
            insights.push({
                type: 'neutral',
                title: 'Dark Horse Candidate',
                description: `${simResults.championshipOdds.toFixed(1)}% championship odds - could make noise in playoffs`
            });
        }
        
        // Seeding insight
        const topSeedProb = simResults.seedDistribution[1] || 0;
        const byeProb = (simResults.seedDistribution[1] || 0) + (simResults.seedDistribution[2] || 0);
        
        if (topSeedProb > 25) {
            insights.push({
                type: 'positive',
                title: 'Top Seed Potential',
                description: `${topSeedProb.toFixed(1)}% chance for #1 seed and playoff bye`
            });
        } else if (byeProb > 40) {
            insights.push({
                type: 'neutral',
                title: 'Bye Week Candidate',
                description: `${byeProb.toFixed(1)}% chance for first-round bye`
            });
        }
        
        return insights;
    }

    generatePlayoffRecommendations(simResults, scenarios, targetTeam) {
        const recommendations = [];
        
        if (simResults.playoffOdds < 60) {
            recommendations.push({
                priority: 'High',
                action: 'Make Aggressive Moves',
                reasoning: 'Playoff odds below 60% - time for bold roster decisions',
                impact: 'Could significantly improve playoff chances'
            });
        }
        
        if (simResults.playoffOdds > 80 && simResults.championshipOdds < 10) {
            recommendations.push({
                priority: 'Medium',
                action: 'Upgrade for Championship Run',
                reasoning: 'Likely to make playoffs but championship odds low',
                impact: 'Optimize roster for playoff performance'
            });
        }
        
        const winOutScenario = scenarios.find(s => s.title === 'Win Remaining Games');
        if (winOutScenario && winOutScenario.probability < 20 && simResults.playoffOdds < 70) {
            recommendations.push({
                priority: 'High',
                action: 'Focus on Consistency',
                reasoning: 'Low probability of winning out - need reliable weekly scores',
                impact: 'Maximize chances in must-win games'
            });
        }
        
        return recommendations;
    }

    async displayPlayoffSimulation() {
        const container = document.createElement('div');
        container.className = 'playoff-simulator-container';
        container.innerHTML = `
            <div class="playoff-simulator-header">
                <h3>🏆 Playoff Probability & Scenario Planning</h3>
                <p>Advanced simulation and championship odds analysis</p>
            </div>

            <div class="simulation-controls">
                <div class="control-group">
                    <label>Number of Simulations:</label>
                    <select id="simulationCount">
                        <option value="1000">1,000 (Fast)</option>
                        <option value="5000">5,000 (Balanced)</option>
                        <option value="10000" selected>10,000 (Accurate)</option>
                        <option value="25000">25,000 (Precise)</option>
                    </select>
                </div>
                <button class="btn btn-primary" onclick="window.playoffSimulator.runSimulation()">
                    🎲 Run Simulation
                </button>
            </div>

            <div class="simulation-results" id="simulationResults" style="display: none;">
                <!-- Results will be populated here -->
            </div>
        `;

        return container;
    }

    async runSimulation() {
        const simulationBtn = document.querySelector('.playoff-simulator-container .btn-primary');
        const resultsContainer = document.getElementById('simulationResults');
        const simulationCount = parseInt(document.getElementById('simulationCount').value);

        if (!simulationBtn || !resultsContainer) return;

        try {
            // Show loading state
            simulationBtn.disabled = true;
            simulationBtn.innerHTML = '⏳ Running Simulation...';
            
            resultsContainer.innerHTML = `
                <div class="simulation-loading">
                    <div class="icon">🎲</div>
                    <p>Running ${simulationCount.toLocaleString()} playoff simulations...</p>
                    <p>This may take a few moments...</p>
                </div>
            `;
            resultsContainer.style.display = 'block';

            // Get league data (would normally load from Sleeper API)
            const leagueData = await this.loadLeagueDataForSimulation();
            
            // Find user's team
            const userTeam = await this.identifyUserTeam(leagueData);
            
            // Run the simulation
            const results = await this.runPlayoffSimulation(leagueData, userTeam, simulationCount);
            
            // Display results
            this.displaySimulationResults(results, resultsContainer);

        } catch (error) {
            console.error('❌ Error running simulation:', error);
            resultsContainer.innerHTML = `
                <div class="simulation-loading">
                    <div class="icon">❌</div>
                    <p>Error running simulation: ${error.message}</p>
                    <p>Please try again or check your league configuration.</p>
                </div>
            `;
        } finally {
            simulationBtn.disabled = false;
            simulationBtn.innerHTML = '🎲 Run Simulation';
        }
    }

    async loadLeagueDataForSimulation() {
        // This would load actual league data from Sleeper API
        // For now, return demo data
        if (window.leagueAnalyzer && window.leagueAnalyzer.leagueData) {
            return window.leagueAnalyzer.leagueData;
        }

        // Generate demo league data if real data not available
        return this.generateDemoLeagueData();
    }

    generateDemoLeagueData() {
        const demoRosters = [];
        const demoUsers = [];
        
        for (let i = 1; i <= 12; i++) {
            demoUsers.push({
                user_id: `user_${i}`,
                display_name: `Team ${i}`,
                metadata: { team_name: `Fantasy Team ${i}` }
            });
            
            const wins = Math.floor(Math.random() * 10) + 1;
            const losses = Math.floor(Math.random() * (14 - wins));
            const pointsFor = Math.floor(Math.random() * 500) + 1200;
            
            demoRosters.push({
                roster_id: i,
                owner_id: `user_${i}`,
                players: [`player_${i}_1`, `player_${i}_2`], // Demo player IDs
                starters: [`player_${i}_1`],
                settings: {
                    wins,
                    losses,
                    ties: 0,
                    fpts: pointsFor,
                    fpts_against: Math.floor(Math.random() * 500) + 1200
                }
            });
        }

        return {
            league: { name: 'Demo League', total_rosters: 12 },
            rosters: demoRosters,
            users: demoUsers,
            allPlayers: {}
        };
    }

    async identifyUserTeam(leagueData) {
        // Use the first team as the user's team for demo
        return {
            roster: leagueData.rosters[0],
            user: leagueData.users[0]
        };
    }

    displaySimulationResults(results, container) {
        container.innerHTML = `
            <div class="results-header">
                <h4>🎯 Simulation Results</h4>
                <div class="simulation-meta">
                    Based on ${results.simulations.total.toLocaleString()} simulations | 
                    Week ${results.currentWeek} of ${results.seasonLength} | 
                    ${results.remainingGames} games remaining
                </div>
            </div>

            <div class="season-status">
                <h4>📅 Current Season Status</h4>
                <div class="season-info">
                    <div class="season-stat">
                        <div class="season-stat-value">${results.currentWeek}</div>
                        <div class="season-stat-label">Current Week</div>
                    </div>
                    <div class="season-stat">
                        <div class="season-stat-value">${results.remainingGames}</div>
                        <div class="season-stat-label">Games Left</div>
                    </div>
                    <div class="season-stat">
                        <div class="season-stat-value">${results.playoffStructure.playoffTeams}</div>
                        <div class="season-stat-label">Playoff Spots</div>
                    </div>
                    <div class="season-stat">
                        <div class="season-stat-value">${results.playoffStructure.firstRoundByes}</div>
                        <div class="season-stat-label">First Round Byes</div>
                    </div>
                </div>
            </div>

            <div class="key-metrics">
                <div class="metric-card playoff-odds">
                    <div class="metric-value">${results.playoffOdds.toFixed(1)}%</div>
                    <div class="metric-label">Playoff Probability</div>
                    <div class="metric-comparison">${results.championshipOdds.comparison} than league average</div>
                </div>
                <div class="metric-card championship-odds">
                    <div class="metric-value">${results.championshipOdds.current.toFixed(1)}%</div>
                    <div class="metric-label">Championship Odds</div>
                    <div class="metric-comparison">${results.championshipOdds.pathway}</div>
                </div>
                <div class="metric-card average-finish">
                    <div class="metric-value">${results.simulations.results.averageFinish.toFixed(1)}</div>
                    <div class="metric-label">Average Finish</div>
                    <div class="metric-comparison">Out of ${results.playoffStructure.leagueSize} teams</div>
                </div>
            </div>

            <div class="probability-distributions">
                <div class="distributions-header">
                    <h4>📊 Probability Distributions</h4>
                </div>
                <div class="distribution-grid">
                    <div class="distribution-card">
                        <div class="distribution-title">Final Standing Distribution</div>
                        <div class="distribution-bars">
                            ${Object.entries(results.simulations.results.finishDistribution)
                                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                                .slice(0, 8)
                                .map(([finish, percentage]) => `
                                    <div class="distribution-item">
                                        <div class="distribution-label">${this.getOrdinalSuffix(finish)} place</div>
                                        <div class="distribution-bar">
                                            <div class="distribution-fill" style="width: ${percentage}%"></div>
                                        </div>
                                        <div class="distribution-percentage">${percentage.toFixed(1)}%</div>
                                    </div>
                                `).join('')}
                        </div>
                    </div>
                    
                    <div class="distribution-card">
                        <div class="distribution-title">Playoff Seed Distribution</div>
                        <div class="distribution-bars">
                            ${Object.entries(results.simulations.results.seedDistribution)
                                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                                .map(([seed, percentage]) => `
                                    <div class="distribution-item">
                                        <div class="distribution-label">#${seed} seed</div>
                                        <div class="distribution-bar">
                                            <div class="distribution-fill" style="width: ${percentage}%"></div>
                                        </div>
                                        <div class="distribution-percentage">${percentage.toFixed(1)}%</div>
                                    </div>
                                `).join('')}
                        </div>
                    </div>
                </div>
            </div>

            <div class="scenario-analysis">
                <h4>🎯 Scenario Analysis</h4>
                <div class="scenarios-grid">
                    ${results.scenarios.map(scenario => `
                        <div class="scenario-card ${this.getScenarioClass(scenario)}">
                            <div class="scenario-header">
                                <div class="scenario-title">${scenario.title}</div>
                                ${scenario.probability !== null ? 
                                    `<div class="scenario-probability">${scenario.probability.toFixed(1)}%</div>` : 
                                    ''
                                }
                            </div>
                            <div class="scenario-description">${scenario.description}</div>
                            <div class="scenario-outcome">
                                <div class="scenario-outcome-title">Expected Outcome:</div>
                                <div class="scenario-outcome-details">${this.formatScenarioOutcome(scenario.outcome)}</div>
                            </div>
                            <div class="scenario-impact">${scenario.impact}</div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="key-insights">
                <h4>💡 Key Insights</h4>
                <div class="insights-grid">
                    ${results.keyInsights.map(insight => `
                        <div class="insight-card ${insight.type}">
                            <div class="insight-header">
                                <div class="insight-icon">${this.getInsightIcon(insight.type)}</div>
                                <div class="insight-title">${insight.title}</div>
                            </div>
                            <div class="insight-description">${insight.description}</div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="playoff-recommendations">
                <h4>🎯 Strategic Recommendations</h4>
                <div class="recommendations-list">
                    ${results.recommendations.map(rec => `
                        <div class="recommendation-card priority-${rec.priority.toLowerCase()}">
                            <div class="recommendation-header">
                                <div class="recommendation-action">${rec.action}</div>
                                <div class="recommendation-priority priority-${rec.priority.toLowerCase()}">${rec.priority}</div>
                            </div>
                            <div class="recommendation-reasoning">${rec.reasoning}</div>
                            <div class="recommendation-impact">${rec.impact}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    getOrdinalSuffix(num) {
        const number = parseInt(num);
        if (number === 1) return '1st';
        if (number === 2) return '2nd';
        if (number === 3) return '3rd';
        return `${number}th`;
    }

    getScenarioClass(scenario) {
        if (scenario.title.includes('Win')) return 'positive';
        if (scenario.title.includes('Lose')) return 'negative';
        return 'neutral';
    }

    formatScenarioOutcome(outcome) {
        if (typeof outcome === 'string') return outcome;
        if (typeof outcome === 'object' && outcome.description) return outcome.description;
        if (typeof outcome === 'object' && outcome.keyCompetitors) {
            return `${outcome.keyCompetitors.length} key competitors identified`;
        }
        return 'Scenario analysis complete';
    }

    getInsightIcon(type) {
        switch (type) {
            case 'positive': return '✅';
            case 'negative': return '⚠️';
            case 'neutral': return 'ℹ️';
            default: return '💡';
        }
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlayoffSimulator;
}