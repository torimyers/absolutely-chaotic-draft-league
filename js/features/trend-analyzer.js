/**
 * Trend Analyzer - Advanced Trend Detection and Pattern Recognition
 * Identifies breakout candidates and declining players using market data
 */

class TrendAnalyzer {
    constructor(configManager) {
        this.configManager = configManager;
        this.sleeperAPI = new SleeperAPI();
        this.trendThresholds = {
            breakout: {
                minAddCount: 500,
                minAddPercentage: 5,
                sustainedWeeks: 2
            },
            declining: {
                minDropCount: 300,
                minDropPercentage: 8,
                consistentDecline: true
            }
        };
        
        console.log('📈 TrendAnalyzer: Initializing trend detection...');
    }

    async analyzeTrends(trendingAdds, trendingDrops, allPlayers) {
        const analysis = {
            breakoutCandidates: [],
            decliningPlayers: [],
            emergingTrends: [],
            marketSentiment: {},
            recommendations: []
        };

        // Analyze breakout candidates from trending adds
        analysis.breakoutCandidates = await this.identifyBreakoutCandidates(trendingAdds, allPlayers);
        
        // Analyze declining players from drops
        analysis.decliningPlayers = await this.identifyDecliningPlayers(trendingDrops, allPlayers);
        
        // Identify emerging trends
        analysis.emergingTrends = this.identifyEmergingTrends(trendingAdds, allPlayers);
        
        // Calculate market sentiment
        analysis.marketSentiment = this.calculateMarketSentiment(trendingAdds, trendingDrops, allPlayers);
        
        // Generate actionable recommendations
        analysis.recommendations = this.generateTrendRecommendations(analysis);

        return analysis;
    }

    async identifyBreakoutCandidates(trendingAdds, allPlayers) {
        const candidates = [];
        
        for (const trend of trendingAdds.slice(0, 20)) {
            const player = allPlayers[trend.player_id];
            if (!player) continue;

            const breakoutAnalysis = this.analyzeBreakoutPotential(player, trend);
            
            if (breakoutAnalysis.isBreakoutCandidate) {
                candidates.push({
                    player: {
                        name: `${player.first_name} ${player.last_name}`,
                        position: player.position,
                        team: player.team,
                        id: player.player_id
                    },
                    trendData: {
                        addCount: trend.count,
                        addPercentage: this.calculateAddPercentage(trend.count)
                    },
                    breakoutScore: breakoutAnalysis.breakoutScore,
                    catalysts: breakoutAnalysis.catalysts,
                    riskFactors: breakoutAnalysis.riskFactors,
                    timeframe: breakoutAnalysis.timeframe,
                    confidence: breakoutAnalysis.confidence,
                    reasoning: breakoutAnalysis.reasoning
                });
            }
        }

        // Sort by breakout score
        return candidates.sort((a, b) => b.breakoutScore - a.breakoutScore).slice(0, 8);
    }

    analyzeBreakoutPotential(player, trend) {
        let breakoutScore = 50; // Base score
        const catalysts = [];
        const riskFactors = [];
        let confidence = 60;

        // Add momentum analysis
        if (trend.count > 2000) {
            breakoutScore += 25;
            catalysts.push('Extremely high pickup momentum');
            confidence += 15;
        } else if (trend.count > 1000) {
            breakoutScore += 15;
            catalysts.push('Strong pickup momentum');
            confidence += 10;
        } else if (trend.count > 500) {
            breakoutScore += 8;
            catalysts.push('Moderate pickup momentum');
            confidence += 5;
        }

        // Position-specific analysis
        const positionAnalysis = this.getPositionBreakoutFactors(player.position);
        breakoutScore += positionAnalysis.scoreModifier;
        catalysts.push(...positionAnalysis.catalysts);

        // Experience factor
        if (player.years_exp <= 2) {
            breakoutScore += 12;
            catalysts.push('Young player with upside potential');
        } else if (player.years_exp >= 8) {
            breakoutScore -= 8;
            riskFactors.push('Veteran player - limited ceiling');
        }

        // Team context (simulated - would use real data)
        const teamContext = this.getTeamBreakoutContext(player.team);
        breakoutScore += teamContext.scoreModifier;
        if (teamContext.catalyst) catalysts.push(teamContext.catalyst);
        if (teamContext.risk) riskFactors.push(teamContext.risk);

        // Injury status
        if (player.injury_status) {
            breakoutScore -= 15;
            confidence -= 20;
            riskFactors.push(`Currently ${player.injury_status} - injury concerns`);
        }

        // Determine timeframe and reasoning
        const timeframe = this.getBreakoutTimeframe(breakoutScore, trend.count);
        const reasoning = this.generateBreakoutReasoning(player, catalysts, riskFactors);

        return {
            isBreakoutCandidate: breakoutScore >= 65 && !player.injury_status,
            breakoutScore: Math.min(100, Math.max(0, breakoutScore)),
            catalysts,
            riskFactors,
            timeframe,
            confidence: Math.min(95, Math.max(25, confidence)),
            reasoning
        };
    }

    getPositionBreakoutFactors(position) {
        const factors = {
            'RB': {
                scoreModifier: 10,
                catalysts: ['RB scarcity creates opportunity', 'Potential for heavy workload']
            },
            'WR': {
                scoreModifier: 8,
                catalysts: ['Target share opportunity', 'Big-play potential']
            },
            'TE': {
                scoreModifier: 12,
                catalysts: ['TE position has limited depth', 'Red zone target potential']
            },
            'QB': {
                scoreModifier: 5,
                catalysts: ['Streaming opportunity based on matchups']
            },
            'K': {
                scoreModifier: -10,
                catalysts: []
            },
            'DEF': {
                scoreModifier: 0,
                catalysts: ['Matchup-based streaming value']
            }
        };

        return factors[position] || { scoreModifier: 0, catalysts: [] };
    }

    getTeamBreakoutContext(team) {
        // Simulated team contexts - would use real offensive metrics
        const contexts = [
            { scoreModifier: 8, catalyst: 'High-volume passing offense creates opportunities' },
            { scoreModifier: 5, catalyst: 'Improved offensive line provides stability' },
            { scoreModifier: -3, risk: 'Struggling offense limits upside' },
            { scoreModifier: 10, catalyst: 'New offensive coordinator unlocking potential' },
            { scoreModifier: 0, catalyst: null, risk: null }
        ];

        return contexts[Math.floor(Math.random() * contexts.length)];
    }

    getBreakoutTimeframe(breakoutScore, addCount) {
        if (breakoutScore >= 85 && addCount > 2000) return 'immediate';
        if (breakoutScore >= 75) return '1-2 weeks';
        if (breakoutScore >= 65) return '2-4 weeks';
        return 'season-long';
    }

    generateBreakoutReasoning(player, catalysts, riskFactors) {
        let reasoning = `${player.first_name} ${player.last_name} showing breakout potential due to: `;
        reasoning += catalysts.slice(0, 2).join(', ');
        
        if (riskFactors.length > 0) {
            reasoning += `. Risk factors include: ${riskFactors.slice(0, 2).join(', ')}`;
        }

        return reasoning;
    }

    async identifyDecliningPlayers(trendingDrops, allPlayers) {
        const declining = [];
        
        for (const trend of trendingDrops.slice(0, 15)) {
            const player = allPlayers[trend.player_id];
            if (!player) continue;

            const declineAnalysis = this.analyzeDecline(player, trend);
            
            if (declineAnalysis.isDeclining) {
                declining.push({
                    player: {
                        name: `${player.first_name} ${player.last_name}`,
                        position: player.position,
                        team: player.team,
                        id: player.player_id
                    },
                    trendData: {
                        dropCount: trend.count,
                        dropPercentage: this.calculateDropPercentage(trend.count)
                    },
                    declineScore: declineAnalysis.declineScore,
                    concerns: declineAnalysis.concerns,
                    severity: declineAnalysis.severity,
                    actionable: declineAnalysis.actionable,
                    reasoning: declineAnalysis.reasoning
                });
            }
        }

        return declining.sort((a, b) => b.declineScore - a.declineScore).slice(0, 6);
    }

    analyzeDecline(player, trend) {
        let declineScore = 50;
        const concerns = [];
        let severity = 'moderate';

        // Drop momentum
        if (trend.count > 1500) {
            declineScore += 30;
            concerns.push('Massive drop momentum');
            severity = 'severe';
        } else if (trend.count > 800) {
            declineScore += 20;
            concerns.push('High drop volume');
            severity = 'high';
        } else if (trend.count > 400) {
            declineScore += 10;
            concerns.push('Moderate drop volume');
        }

        // Injury factor
        if (player.injury_status) {
            declineScore += 25;
            concerns.push(`Injury concern: ${player.injury_status}`);
            if (player.injury_status.toLowerCase() === 'out') {
                severity = 'severe';
            }
        }

        // Age factor
        if (player.years_exp >= 10) {
            declineScore += 10;
            concerns.push('Age-related decline possible');
        }

        // Position-specific concerns
        if (player.position === 'RB' && player.years_exp >= 6) {
            declineScore += 15;
            concerns.push('RB wear and tear concerns');
        }

        const reasoning = `${player.first_name} ${player.last_name} showing decline signals: ${concerns.slice(0, 2).join(', ')}`;

        return {
            isDeclining: declineScore >= 65,
            declineScore: Math.min(100, declineScore),
            concerns,
            severity,
            actionable: declineScore >= 75,
            reasoning
        };
    }

    identifyEmergingTrends(trendingAdds, allPlayers) {
        const trends = [];

        // Position-based trends
        const positionCounts = {};
        trendingAdds.slice(0, 30).forEach(trend => {
            const player = allPlayers[trend.player_id];
            if (player) {
                positionCounts[player.position] = (positionCounts[player.position] || 0) + trend.count;
            }
        });

        // Identify hot positions
        Object.entries(positionCounts).forEach(([position, count]) => {
            if (count > 3000) {
                trends.push({
                    type: 'position_surge',
                    position,
                    description: `${position} position showing high pickup activity`,
                    significance: 'high',
                    implication: `Consider ${position} depth and streaming options`
                });
            }
        });

        // Team-based trends
        const teamCounts = {};
        trendingAdds.slice(0, 20).forEach(trend => {
            const player = allPlayers[trend.player_id];
            if (player) {
                teamCounts[player.team] = (teamCounts[player.team] || 0) + 1;
            }
        });

        // Identify hot teams
        Object.entries(teamCounts).forEach(([team, playerCount]) => {
            if (playerCount >= 3) {
                trends.push({
                    type: 'team_interest',
                    team,
                    description: `Multiple ${team} players trending`,
                    significance: 'medium',
                    implication: `Monitor ${team} offense for opportunities`
                });
            }
        });

        return trends.slice(0, 5);
    }

    calculateMarketSentiment(trendingAdds, trendingDrops, allPlayers) {
        const sentiment = {
            overall: 'neutral',
            byPosition: {},
            volatility: 'moderate',
            confidence: 70
        };

        // Calculate overall sentiment
        const totalAdds = trendingAdds.reduce((sum, trend) => sum + trend.count, 0);
        const totalDrops = trendingDrops.reduce((sum, trend) => sum + trend.count, 0);
        
        const addDropRatio = totalAdds / (totalDrops || 1);
        
        if (addDropRatio > 1.5) {
            sentiment.overall = 'optimistic';
            sentiment.confidence += 10;
        } else if (addDropRatio < 0.8) {
            sentiment.overall = 'pessimistic';
            sentiment.confidence += 10;
        }

        // Position sentiment
        ['QB', 'RB', 'WR', 'TE'].forEach(position => {
            const positionAdds = trendingAdds.filter(trend => {
                const player = allPlayers[trend.player_id];
                return player && player.position === position;
            }).reduce((sum, trend) => sum + trend.count, 0);

            const positionDrops = trendingDrops.filter(trend => {
                const player = allPlayers[trend.player_id];
                return player && player.position === position;
            }).reduce((sum, trend) => sum + trend.count, 0);

            const ratio = positionAdds / (positionDrops || 1);
            
            if (ratio > 1.3) {
                sentiment.byPosition[position] = 'bullish';
            } else if (ratio < 0.7) {
                sentiment.byPosition[position] = 'bearish';
            } else {
                sentiment.byPosition[position] = 'neutral';
            }
        });

        return sentiment;
    }

    generateTrendRecommendations(analysis) {
        const recommendations = [];

        // High-priority breakout candidates
        const topBreakouts = analysis.breakoutCandidates.slice(0, 3);
        topBreakouts.forEach(candidate => {
            if (candidate.confidence >= 75) {
                recommendations.push({
                    type: 'pickup',
                    priority: 'high',
                    player: candidate.player.name,
                    action: 'Add immediately',
                    reasoning: `Strong breakout signals with ${candidate.confidence}% confidence`
                });
            }
        });

        // Declining players to consider dropping
        const severeDeclining = analysis.decliningPlayers.filter(p => p.severity === 'severe');
        severeDeclining.forEach(player => {
            recommendations.push({
                type: 'drop',
                priority: 'medium',
                player: player.player.name,
                action: 'Consider dropping',
                reasoning: `Severe decline indicators - ${player.concerns.slice(0, 2).join(', ')}`
            });
        });

        // Market timing recommendations
        if (analysis.marketSentiment.overall === 'optimistic') {
            recommendations.push({
                type: 'strategy',
                priority: 'low',
                action: 'Be aggressive on waivers',
                reasoning: 'Market sentiment is optimistic - good time for speculative adds'
            });
        }

        return recommendations.slice(0, 8);
    }

    calculateAddPercentage(addCount) {
        // Simplified calculation - would use actual league data
        return Math.min(100, (addCount / 50)).toFixed(1);
    }

    calculateDropPercentage(dropCount) {
        // Simplified calculation - would use actual league data
        return Math.min(100, (dropCount / 30)).toFixed(1);
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TrendAnalyzer;
}