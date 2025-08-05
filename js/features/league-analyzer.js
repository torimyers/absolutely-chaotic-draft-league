/**
 * League Analyzer - Team vs League Comparative Analysis
 * Analyzes user's team performance against other teams in the league
 */

class LeagueAnalyzer {
    constructor(configManager) {
        this.configManager = configManager;
        this.sleeperAPI = new SleeperAPI();
        this.currentWeek = null;
        this.leagueData = null;
        this.userTeam = null;
        this.competitiveAnalysis = null;
        
        console.log('🏆 LeagueAnalyzer: Initializing league comparison analysis...');
    }

    async initialize() {
        // Get current NFL week
        await this.loadCurrentWeek();
        
        console.log('✅ LeagueAnalyzer: Initialization complete');
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

    async analyzeLeagueStandings() {
        try {
            const leagueId = this.configManager.config.sleeperLeagueId;
            if (!leagueId) {
                throw new Error('Please configure your Sleeper League ID first');
            }

            // Load comprehensive league data
            const leagueData = await this.loadLeagueData(leagueId);
            this.leagueData = leagueData;

            // Find user's team
            this.userTeam = await this.identifyUserTeam(leagueData);
            
            // Perform comprehensive analysis
            const analysis = await this.performLeagueAnalysis(leagueData, this.userTeam);
            
            return analysis;

        } catch (error) {
            console.error('❌ Error analyzing league:', error);
            throw error;
        }
    }

    async loadLeagueData(leagueId) {
        try {
            // Load all league data in parallel
            const [league, rosters, users, matchups] = await Promise.all([
                this.sleeperAPI.fetchAPI(`/league/${leagueId}`),
                this.sleeperAPI.fetchAPI(`/league/${leagueId}/rosters`),
                this.sleeperAPI.fetchAPI(`/league/${leagueId}/users`),
                this.loadRecentMatchups(leagueId)
            ]);

            const allPlayers = await this.sleeperAPI.getAllPlayers();

            return {
                league,
                rosters,
                users,
                matchups,
                allPlayers,
                success: true
            };

        } catch (error) {
            console.error('❌ Error loading league data:', error);
            throw new Error(`Failed to load league data: ${error.message}`);
        }
    }

    async loadRecentMatchups(leagueId) {
        try {
            const matchupPromises = [];
            const weeksToLoad = Math.min(this.currentWeek - 1, 4); // Last 4 weeks
            
            for (let week = Math.max(1, this.currentWeek - weeksToLoad); week < this.currentWeek; week++) {
                matchupPromises.push(
                    this.sleeperAPI.fetchAPI(`/league/${leagueId}/matchups/${week}`)
                        .then(data => ({ week, matchups: data }))
                        .catch(() => ({ week, matchups: [] }))
                );
            }

            const matchupData = await Promise.all(matchupPromises);
            return matchupData.filter(data => data.matchups.length > 0);

        } catch (error) {
            console.error('❌ Error loading matchups:', error);
            return [];
        }
    }

    async identifyUserTeam(leagueData) {
        const { rosters, users } = leagueData;
        
        // Try to find user's team by configured username
        const configuredUsername = this.configManager.config.sleeperUsername;
        if (configuredUsername) {
            const user = users.find(u => 
                u.display_name.toLowerCase() === configuredUsername.toLowerCase()
            );
            if (user) {
                const roster = rosters.find(r => r.owner_id === user.user_id);
                if (roster) {
                    return { roster, user };
                }
            }
        }

        // If team manager has current roster, use that
        if (window.teamManager && window.teamManager.currentRoster) {
            return window.teamManager.currentRoster;
        }

        // Fallback: if only one team, assume it's the user's
        if (rosters.length === 1) {
            const user = users.find(u => u.user_id === rosters[0].owner_id);
            return { roster: rosters[0], user };
        }

        throw new Error('Could not identify your team. Please configure your Sleeper username or load your roster in the My Team section.');
    }

    async performLeagueAnalysis(leagueData, userTeam) {
        const analysis = {
            userTeam: await this.analyzeTeamStrengths(userTeam, leagueData),
            leagueRankings: await this.generateLeagueRankings(leagueData),
            competitiveAnalysis: await this.analyzeCompetition(leagueData, userTeam),
            strengthsWeaknesses: await this.identifyStrengthsWeaknesses(leagueData, userTeam),
            tradeTargets: await this.identifyTradeTargets(leagueData, userTeam),
            playoffProjection: this.calculatePlayoffOdds(leagueData, userTeam),
            recommendations: [],
            overallScore: 0
        };

        // Generate strategic recommendations
        analysis.recommendations = this.generateStrategicRecommendations(analysis);
        
        // Calculate overall competitive score
        analysis.overallScore = this.calculateOverallScore(analysis);

        return analysis;
    }

    async analyzeTeamStrengths(userTeam, leagueData) {
        const { roster, user } = userTeam;
        const { allPlayers } = leagueData;
        
        const teamAnalysis = {
            teamName: user?.metadata?.team_name || user?.display_name || 'Your Team',
            record: {
                wins: roster.settings?.wins || 0,
                losses: roster.settings?.losses || 0,
                ties: roster.settings?.ties || 0
            },
            scoring: {
                pointsFor: roster.settings?.fpts || 0,
                pointsAgainst: roster.settings?.fpts_against || 0,
                averageScore: 0
            },
            positionalStrength: {},
            depthAnalysis: {},
            rosterRating: 0
        };

        // Calculate average score
        const totalGames = teamAnalysis.record.wins + teamAnalysis.record.losses + teamAnalysis.record.ties;
        teamAnalysis.scoring.averageScore = totalGames > 0 ? 
            (teamAnalysis.scoring.pointsFor / totalGames).toFixed(1) : 0;

        // Analyze positional strength
        teamAnalysis.positionalStrength = await this.analyzePositionalStrength(roster, allPlayers);
        
        // Analyze roster depth
        teamAnalysis.depthAnalysis = this.analyzeRosterDepth(roster, allPlayers);
        
        // Calculate overall roster rating
        teamAnalysis.rosterRating = this.calculateRosterRating(teamAnalysis);

        return teamAnalysis;
    }

    async analyzePositionalStrength(roster, allPlayers) {
        const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
        const positionalStrength = {};
        
        const scoringFormat = this.configManager.config.scoringFormat || 'Half PPR';
        const isPPR = scoringFormat.includes('PPR');

        for (const position of positions) {
            const positionPlayers = (roster.players || [])
                .map(id => allPlayers[id])
                .filter(player => player && player.position === position);

            if (positionPlayers.length === 0) {
                positionalStrength[position] = {
                    rating: 0,
                    strength: 'Very Weak',
                    count: 0,
                    topPlayer: null,
                    depth: 'None'
                };
                continue;
            }

            // Simulate player values for this position
            const playerValues = positionPlayers.map(player => ({
                player,
                value: this.calculatePlayerValue(player, isPPR)
            })).sort((a, b) => b.value - a.value);

            const topValue = playerValues[0]?.value || 0;
            const averageValue = playerValues.reduce((sum, p) => sum + p.value, 0) / playerValues.length;
            
            let strength = 'Average';
            let rating = 50;
            
            if (topValue >= 85) {
                strength = 'Elite';
                rating = 90;
            } else if (topValue >= 75) {
                strength = 'Strong';
                rating = 75;
            } else if (topValue >= 60) {
                strength = 'Good';
                rating = 65;
            } else if (topValue >= 45) {
                strength = 'Average';
                rating = 50;
            } else if (topValue >= 30) {
                strength = 'Weak';
                rating = 35;
            } else {
                strength = 'Very Weak';
                rating = 20;
            }

            // Adjust for depth
            if (playerValues.length >= 3 && averageValue >= 50) {
                rating += 10;
                strength += ' (Good Depth)';
            } else if (playerValues.length <= 1) {
                rating -= 15;
                strength += ' (No Depth)';
            }

            positionalStrength[position] = {
                rating: Math.min(100, Math.max(0, rating)),
                strength,
                count: positionPlayers.length,
                topPlayer: playerValues[0]?.player ? 
                    `${playerValues[0].player.first_name} ${playerValues[0].player.last_name}` : null,
                depth: this.getDepthDescription(playerValues.length),
                averageValue: averageValue.toFixed(1)
            };
        }

        return positionalStrength;
    }

    calculatePlayerValue(player, isPPR) {
        // Simplified player value calculation
        let baseValue = 50;
        
        // Position-based adjustments
        const positionValues = {
            'QB': 60,
            'RB': isPPR ? 65 : 70,
            'WR': isPPR ? 70 : 60,
            'TE': isPPR ? 55 : 45,
            'K': 40,
            'DEF': 45
        };
        
        baseValue = positionValues[player.position] || 50;
        
        // Experience adjustment
        if (player.years_exp <= 2) baseValue += 5; // Young upside
        else if (player.years_exp >= 10) baseValue -= 10; // Age concern
        
        // Injury adjustment
        if (player.injury_status) {
            if (player.injury_status.toLowerCase() === 'out') baseValue -= 30;
            else if (player.injury_status.toLowerCase() === 'doubtful') baseValue -= 20;
            else if (player.injury_status.toLowerCase() === 'questionable') baseValue -= 10;
        }
        
        // Add some randomization for variety (would use real stats in production)
        baseValue += (Math.random() - 0.5) * 30;
        
        return Math.max(0, Math.min(100, baseValue));
    }

    getDepthDescription(count) {
        if (count >= 4) return 'Excellent';
        if (count === 3) return 'Good';
        if (count === 2) return 'Adequate';
        if (count === 1) return 'Minimal';
        return 'None';
    }

    analyzeRosterDepth(roster, allPlayers) {
        const starters = roster.starters || [];
        const bench = (roster.players || []).filter(id => !starters.includes(id));
        
        return {
            starterCount: starters.length,
            benchCount: bench.length,
            totalRosterSize: (roster.players || []).length,
            benchQuality: this.assessBenchQuality(bench, allPlayers),
            flexibilityScore: this.calculateFlexibilityScore(roster, allPlayers)
        };
    }

    assessBenchQuality(bench, allPlayers) {
        if (bench.length === 0) return 'None';
        
        const benchPlayers = bench.map(id => allPlayers[id]).filter(Boolean);
        const qualityCount = benchPlayers.filter(player => 
            !player.injury_status && player.years_exp <= 8
        ).length;
        
        const qualityRatio = qualityCount / benchPlayers.length;
        
        if (qualityRatio >= 0.7) return 'High';
        if (qualityRatio >= 0.5) return 'Good';
        if (qualityRatio >= 0.3) return 'Average';
        return 'Poor';
    }

    calculateFlexibilityScore(roster, allPlayers) {
        // Calculate how many different lineup combinations are possible
        const players = (roster.players || []).map(id => allPlayers[id]).filter(Boolean);
        const positionCounts = {};
        
        players.forEach(player => {
            positionCounts[player.position] = (positionCounts[player.position] || 0) + 1;
        });
        
        let flexScore = 50;
        
        // Bonus for having multiple options at key positions
        if (positionCounts.RB >= 4) flexScore += 15;
        if (positionCounts.WR >= 5) flexScore += 15;
        if (positionCounts.TE >= 2) flexScore += 10;
        if (positionCounts.QB >= 2) flexScore += 5;
        
        return Math.min(100, flexScore);
    }

    calculateRosterRating(teamAnalysis) {
        const posRatings = Object.values(teamAnalysis.positionalStrength);
        const avgPositionalRating = posRatings.reduce((sum, pos) => sum + pos.rating, 0) / posRatings.length;
        
        let rating = avgPositionalRating;
        
        // Scoring performance adjustment
        const gamesPlayed = teamAnalysis.record.wins + teamAnalysis.record.losses + teamAnalysis.record.ties;
        if (gamesPlayed > 0) {
            const avgScore = parseFloat(teamAnalysis.scoring.averageScore);
            if (avgScore >= 130) rating += 10;
            else if (avgScore >= 115) rating += 5;
            else if (avgScore <= 90) rating -= 10;
            else if (avgScore <= 105) rating -= 5;
        }
        
        // Depth adjustment
        rating += (teamAnalysis.depthAnalysis.flexibilityScore - 50) * 0.2;
        
        return Math.round(Math.min(100, Math.max(0, rating)));
    }

    async generateLeagueRankings(leagueData) {
        const { rosters, users } = leagueData;
        
        const teamRankings = await Promise.all(rosters.map(async (roster) => {
            const user = users.find(u => u.user_id === roster.owner_id);
            const teamAnalysis = await this.analyzeTeamStrengths({ roster, user }, leagueData);
            
            return {
                rosterId: roster.roster_id,
                teamName: teamAnalysis.teamName,
                record: teamAnalysis.record,
                pointsFor: teamAnalysis.scoring.pointsFor,
                pointsAgainst: teamAnalysis.scoring.pointsAgainst,
                averageScore: teamAnalysis.scoring.averageScore,
                rosterRating: teamAnalysis.rosterRating,
                positionalStrength: teamAnalysis.positionalStrength
            };
        }));

        // Sort by various metrics
        const rankings = {
            byRecord: [...teamRankings].sort((a, b) => {
                const aWinPct = a.record.wins / Math.max(1, a.record.wins + a.record.losses + a.record.ties);
                const bWinPct = b.record.wins / Math.max(1, b.record.wins + b.record.losses + b.record.ties);
                return bWinPct - aWinPct;
            }),
            byPointsFor: [...teamRankings].sort((a, b) => b.pointsFor - a.pointsFor),
            byRosterRating: [...teamRankings].sort((a, b) => b.rosterRating - a.rosterRating),
            byAverageScore: [...teamRankings].sort((a, b) => parseFloat(b.averageScore) - parseFloat(a.averageScore))
        };

        return rankings;
    }

    async analyzeCompetition(leagueData, userTeam) {
        const rankings = await this.generateLeagueRankings(leagueData);
        const userRosterId = userTeam.roster.roster_id;
        
        // Find user's position in various rankings
        const userRankings = {
            record: rankings.byRecord.findIndex(team => team.rosterId === userRosterId) + 1,
            pointsFor: rankings.byPointsFor.findIndex(team => team.rosterId === userRosterId) + 1,
            rosterRating: rankings.byRosterRating.findIndex(team => team.rosterId === userRosterId) + 1,
            averageScore: rankings.byAverageScore.findIndex(team => team.rosterId === userRosterId) + 1
        };

        // Identify key competitors
        const competitors = {
            strongestRoster: rankings.byRosterRating[0],
            highestScoring: rankings.byPointsFor[0],
            bestRecord: rankings.byRecord[0],
            directThreats: this.identifyDirectThreats(rankings, userRankings, userRosterId)
        };

        return {
            userRankings,
            competitors,
            leagueSize: leagueData.rosters.length,
            competitiveLevel: this.assessCompetitiveLevel(rankings),
            playoffCutoff: Math.ceil(leagueData.rosters.length / 2)
        };
    }

    identifyDirectThreats(rankings, userRankings, userRosterId) {
        const threats = [];
        
        // Teams within 2 positions in key rankings
        const recordRank = userRankings.record;
        const recordThreats = rankings.byRecord.filter((team, index) => 
            team.rosterId !== userRosterId && 
            Math.abs(index + 1 - recordRank) <= 2
        );
        
        const rosterThreats = rankings.byRosterRating.filter((team, index) => 
            team.rosterId !== userRosterId && 
            Math.abs(index + 1 - userRankings.rosterRating) <= 2
        );

        // Combine and deduplicate
        const allThreats = [...recordThreats, ...rosterThreats];
        const uniqueThreats = allThreats.filter((team, index, self) => 
            self.findIndex(t => t.rosterId === team.rosterId) === index
        );

        return uniqueThreats.slice(0, 3); // Top 3 threats
    }

    assessCompetitiveLevel(rankings) {
        const scores = rankings.byRosterRating.map(team => team.rosterRating);
        const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
        const variance = scores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / scores.length;
        const standardDeviation = Math.sqrt(variance);
        
        if (standardDeviation <= 8) return 'Very Competitive';
        if (standardDeviation <= 12) return 'Competitive';
        if (standardDeviation <= 18) return 'Moderate';
        return 'Wide Skill Gap';
    }

    async identifyStrengthsWeaknesses(leagueData, userTeam) {
        const userAnalysis = await this.analyzeTeamStrengths(userTeam, leagueData);
        const rankings = await this.generateLeagueRankings(leagueData);
        
        const strengths = [];
        const weaknesses = [];
        const opportunities = [];
        
        // Analyze each position relative to league
        Object.entries(userAnalysis.positionalStrength).forEach(([position, data]) => {
            const leagueAvg = this.calculateLeaguePositionalAverage(rankings, position);
            
            if (data.rating >= leagueAvg + 15) {
                strengths.push({
                    area: position,
                    description: `Elite ${position} depth with ${data.topPlayer}`,
                    rating: data.rating,
                    advantage: `+${(data.rating - leagueAvg).toFixed(0)} vs league avg`
                });
            } else if (data.rating <= leagueAvg - 15) {
                weaknesses.push({
                    area: position,
                    description: `Weak ${position} position needs improvement`,
                    rating: data.rating,
                    deficit: `-${(leagueAvg - data.rating).toFixed(0)} vs league avg`
                });
                
                opportunities.push({
                    type: 'Position Upgrade',
                    description: `Target elite ${position} in trades`,
                    priority: 'High',
                    impact: 'Large roster upgrade'
                });
            }
        });

        // Scoring analysis
        const avgLeagueScore = rankings.byAverageScore.reduce((sum, team) => 
            sum + parseFloat(team.averageScore), 0) / rankings.byAverageScore.length;
        
        const userAvg = parseFloat(userAnalysis.scoring.averageScore);
        
        if (userAvg >= avgLeagueScore + 10) {
            strengths.push({
                area: 'Scoring',
                description: 'High-scoring offense',
                rating: 85,
                advantage: `+${(userAvg - avgLeagueScore).toFixed(1)} vs league avg`
            });
        } else if (userAvg <= avgLeagueScore - 10) {
            weaknesses.push({
                area: 'Scoring',
                description: 'Below-average scoring needs improvement',
                rating: 35,
                deficit: `-${(avgLeagueScore - userAvg).toFixed(1)} vs league avg`
            });
        }

        return {
            strengths: strengths.slice(0, 5),
            weaknesses: weaknesses.slice(0, 5),
            opportunities: opportunities.slice(0, 5),
            overallAssessment: this.generateOverallAssessment(strengths, weaknesses, userAnalysis)
        };
    }

    calculateLeaguePositionalAverage(rankings, position) {
        const allRatings = rankings.byRosterRating
            .map(team => team.positionalStrength[position]?.rating || 0)
            .filter(rating => rating > 0);
        
        return allRatings.length > 0 ? 
            allRatings.reduce((sum, rating) => sum + rating, 0) / allRatings.length : 50;
    }

    generateOverallAssessment(strengths, weaknesses, userAnalysis) {
        const strengthCount = strengths.length;
        const weaknessCount = weaknesses.length;
        const rosterRating = userAnalysis.rosterRating;
        
        let assessment = '';
        
        if (rosterRating >= 80) {
            assessment = 'Championship Contender - Elite roster with multiple strengths';
        } else if (rosterRating >= 70) {
            assessment = 'Playoff Team - Strong roster with good depth';
        } else if (rosterRating >= 60) {
            assessment = 'Competitive Team - Solid roster needing key improvements';
        } else if (rosterRating >= 50) {
            assessment = 'Rebuilding Team - Several areas need significant upgrades';
        } else {
            assessment = 'Bottom Tier - Major overhaul needed across multiple positions';
        }
        
        if (strengthCount > weaknessCount) {
            assessment += '. Focus on maximizing existing strengths.';
        } else if (weaknessCount > strengthCount) {
            assessment += '. Priority should be addressing key weaknesses.';
        } else {
            assessment += '. Balanced approach to roster improvements needed.';
        }
        
        return assessment;
    }

    async identifyTradeTargets(leagueData, userTeam) {
        const { rosters, users, allPlayers } = leagueData;
        const userAnalysis = await this.analyzeTeamStrengths(userTeam, leagueData);
        const tradeTargets = [];
        
        // Identify positions of need
        const weakPositions = Object.entries(userAnalysis.positionalStrength)
            .filter(([pos, data]) => data.rating < 60)
            .map(([pos]) => pos);
        
        // Identify positions of strength (potential trade assets)
        const strongPositions = Object.entries(userAnalysis.positionalStrength)
            .filter(([pos, data]) => data.rating > 75 && data.count >= 3)
            .map(([pos]) => pos);
        
        // Analyze other teams for potential trades
        for (const roster of rosters) {
            if (roster.roster_id === userTeam.roster.roster_id) continue;
            
            const owner = users.find(u => u.user_id === roster.owner_id);
            const teamAnalysis = await this.analyzeTeamStrengths({ roster, user: owner }, leagueData);
            
            // Find complementary needs
            const theirWeakPositions = Object.entries(teamAnalysis.positionalStrength)
                .filter(([pos, data]) => data.rating < 60)
                .map(([pos]) => pos);
            
            const theirStrongPositions = Object.entries(teamAnalysis.positionalStrength)
                .filter(([pos, data]) => data.rating > 75 && data.count >= 3)
                .map(([pos]) => pos);
            
            // Check for mutual benefit opportunities
            const mutualBenefit = weakPositions.some(pos => theirStrongPositions.includes(pos)) &&
                                 strongPositions.some(pos => theirWeakPositions.includes(pos));
            
            if (mutualBenefit) {
                const targetPositions = weakPositions.filter(pos => theirStrongPositions.includes(pos));
                const tradeAssets = strongPositions.filter(pos => theirWeakPositions.includes(pos));
                
                tradeTargets.push({
                    team: teamAnalysis.teamName,
                    rosterId: roster.roster_id,
                    mutualBenefit: true,
                    targetPositions,
                    tradeAssets,
                    reasoning: `They need ${tradeAssets.join(', ')} and have excess ${targetPositions.join(', ')}`,
                    tradeType: 'Win-Win',
                    priority: 'High'
                });
            }
        }
        
        return tradeTargets.slice(0, 5);
    }

    calculatePlayoffOdds(leagueData, userTeam) {
        const rankings = this.generateLeagueRankings(leagueData);
        const userRosterId = userTeam.roster.roster_id;
        const leagueSize = leagueData.rosters.length;
        const playoffSpots = Math.ceil(leagueSize / 2);
        
        // Find user's current position
        const recordRanking = rankings.byRecord.findIndex(team => team.rosterId === userRosterId) + 1;
        const rosterRanking = rankings.byRosterRating.findIndex(team => team.rosterId === userRosterId) + 1;
        
        let playoffOdds = 50; // Base 50%
        
        // Adjust based on current record position
        if (recordRanking <= playoffSpots) {
            playoffOdds += 30; // Currently in playoff position
        } else if (recordRanking <= playoffSpots + 2) {
            playoffOdds += 10; // Close to playoffs
        } else {
            playoffOdds -= 20; // Outside playoff race
        }
        
        // Adjust based on roster strength
        if (rosterRanking <= 3) {
            playoffOdds += 20; // Elite roster
        } else if (rosterRanking <= playoffSpots) {
            playoffOdds += 10; // Strong roster
        } else if (rosterRanking > leagueSize - 3) {
            playoffOdds -= 20; // Weak roster
        }
        
        // Adjust based on remaining games (assumes 14-week regular season)
        const currentWeek = this.currentWeek;
        const remainingWeeks = Math.max(0, 14 - currentWeek);
        const volatilityFactor = remainingWeeks * 2; // More games = more opportunity
        
        if (recordRanking > playoffSpots) {
            playoffOdds += volatilityFactor; // More games help if behind
        }
        
        return {
            percentage: Math.min(95, Math.max(5, Math.round(playoffOdds))),
            currentPosition: recordRanking,
            playoffSpots,
            gamesRemaining: remainingWeeks,
            projection: recordRanking <= playoffSpots ? 'Currently In' : 
                       recordRanking <= playoffSpots + 2 ? 'Bubble Team' : 'Outside Looking In'
        };
    }

    generateStrategicRecommendations(analysis) {
        const recommendations = [];
        
        // Trade recommendations
        if (analysis.tradeTargets.length > 0) {
            const topTarget = analysis.tradeTargets[0];
            recommendations.push({
                type: 'Trade',
                priority: 'High',
                action: `Explore trade with ${topTarget.team}`,
                reasoning: topTarget.reasoning,
                impact: 'Address key weaknesses'
            });
        }
        
        // Positional recommendations
        analysis.strengthsWeaknesses.weaknesses.forEach(weakness => {
            if (weakness.area !== 'Scoring') {
                recommendations.push({
                    type: 'Roster Move',
                    priority: 'Medium',
                    action: `Upgrade ${weakness.area} position`,
                    reasoning: `Currently ${weakness.deficit} below league average`,
                    impact: 'Improve weekly scoring consistency'
                });
            }
        });
        
        // Playoff-specific recommendations
        if (analysis.playoffProjection.percentage < 60) {
            recommendations.push({
                type: 'Strategy',
                priority: 'High',
                action: 'Aggressive move needed',
                reasoning: `Only ${analysis.playoffProjection.percentage}% playoff odds`,
                impact: 'Make or break season move'
            });
        } else if (analysis.playoffProjection.percentage > 80) {
            recommendations.push({
                type: 'Strategy',
                priority: 'Low',
                action: 'Maintain current roster',
                reasoning: `Strong ${analysis.playoffProjection.percentage}% playoff odds`,
                impact: 'Avoid unnecessary risks'
            });
        }
        
        return recommendations.slice(0, 6);
    }

    calculateOverallScore(analysis) {
        let score = analysis.userTeam.rosterRating;
        
        // Adjust for competitive position
        const avgRanking = (
            analysis.competitiveAnalysis.userRankings.record +
            analysis.competitiveAnalysis.userRankings.rosterRating +
            analysis.competitiveAnalysis.userRankings.pointsFor
        ) / 3;
        
        const leagueSize = analysis.competitiveAnalysis.leagueSize;
        const rankingPercentile = (leagueSize - avgRanking + 1) / leagueSize * 100;
        
        score = (score + rankingPercentile) / 2;
        
        return Math.round(Math.min(100, Math.max(0, score)));
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LeagueAnalyzer;
}