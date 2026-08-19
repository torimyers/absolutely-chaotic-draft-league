/**
 * Waiver Wire Manager - AI-Powered Add/Drop Recommendations
 * Helps users identify valuable pickups and players to drop
 */

class WaiverWireManager {
    constructor(configManager) {
        this.configManager = configManager;
        this.sleeperAPI = new SleeperAPI();
        this.currentWeek = null;
        this.trendingPlayers = null;
        this.rosterInfo = null;
        
        console.log('🔄 WaiverWireManager: Initializing waiver wire analysis...');
    }

    async initialize() {
        // Get current NFL week
        await this.loadCurrentWeek();
        
        // Set up UI elements
        this.setupWaiverWireUI();
        
        console.log('✅ WaiverWireManager: Initialization complete');
    }

    async loadCurrentWeek() {
        try {
            const nflState = await this.sleeperAPI.fetchAPI('/state/nfl');
            this.currentWeek = nflState.week;
            console.log(`📅 Current NFL Week: ${this.currentWeek}`);
        } catch (error) {
            console.error('❌ Error loading current week:', error);
            this.currentWeek = 1; // Default fallback
        }
    }

    setupWaiverWireUI() {
        // Find a good place to add waiver wire functionality
        // For now, we'll add it to the team management interface
        const teamPage = document.getElementById('my-team');
        if (!teamPage) return;

        // Add waiver wire section after existing content
        const existingInterface = teamPage.querySelector('#teamManagerInterface');
        if (existingInterface) {
            const waiverWireSection = document.createElement('div');
            waiverWireSection.id = 'waiverWireSection';
            waiverWireSection.innerHTML = `
                <div class="waiver-wire-container" style="margin-top: 2rem;">
                    <div class="section-header">
                        <h3>🔄 Waiver Wire Recommendations</h3>
                        <p>AI-powered add/drop suggestions based on trends and team needs</p>
                    </div>
                    
                    <div class="waiver-actions">
                        <button class="btn btn-primary" onclick="waiverWireManager.loadWaiverRecommendations()" id="loadWaiverBtn">
                            <span>🔍</span> Find Pickups
                        </button>
                        <button class="btn btn-secondary" onclick="waiverWireManager.analyzeDropCandidates()" id="analyzeDropsBtn">
                            <span>📉</span> Analyze Drops
                        </button>
                        <button class="btn btn-outline" onclick="waiverWireManager.showTrendingPlayers()" id="showTrendingBtn">
                            <span>📈</span> Trending Players
                        </button>
                    </div>
                    
                    <div id="waiverRecommendations" class="waiver-recommendations" style="display: none;">
                        <!-- Waiver recommendations will be populated here -->
                    </div>
                </div>
            `;
            
            existingInterface.appendChild(waiverWireSection);
        }
    }

    async loadWaiverRecommendations() {
        const loadBtn = document.getElementById('loadWaiverBtn');
        if (!loadBtn) return;

        loadBtn.disabled = true;
        loadBtn.innerHTML = '<span>⏳</span> Analyzing...';

        try {
            // Get trending adds and drops
            const [trendingAdds, trendingDrops] = await Promise.all([
                this.sleeperAPI.getTrendingPlayers('add', 24, 50),
                this.sleeperAPI.getTrendingPlayers('drop', 24, 25)
            ]);

            // Get all player data for analysis
            const allPlayers = await this.sleeperAPI.getAllPlayers();

            // Generate AI recommendations
            const recommendations = await this.generateWaiverRecommendations(
                trendingAdds, 
                trendingDrops, 
                allPlayers
            );

            this.displayWaiverRecommendations(recommendations);
            
            this.configManager.showNotification('🔍 Waiver wire analysis complete!', 'success');

        } catch (error) {
            console.error('❌ Error loading waiver recommendations:', error);
            this.configManager.showNotification(`❌ Error: ${error.message}`, 'error');
        } finally {
            loadBtn.disabled = false;
            loadBtn.innerHTML = '<span>🔍</span> Find Pickups';
        }
    }

    async generateWaiverRecommendations(trendingAdds, trendingDrops, allPlayers) {
        const scoringFormat = this.configManager.config.scoringFormat || 'Half PPR';
        const isPPR = scoringFormat.includes('PPR');
        
        const recommendations = [];

        // Analyze top trending adds
        for (let i = 0; i < Math.min(trendingAdds.length, 10); i++) {
            const trending = trendingAdds[i];
            const player = allPlayers[trending.player_id];
            
            if (!player) continue;

            const analysis = this.analyzeWaiverPickup(player, trending, isPPR);
            if (analysis.recommendation !== 'avoid') {
                recommendations.push({
                    type: 'pickup',
                    player: {
                        id: trending.player_id,
                        name: `${player.first_name} ${player.last_name}`,
                        position: player.position,
                        team: player.team,
                        injury_status: player.injury_status
                    },
                    priority: analysis.priority,
                    reasoning: analysis.reasoning,
                    addPercentage: trending.count,
                    scoringContext: scoringFormat,
                    confidence: analysis.confidence
                });
            }
        }

        // Sort by priority and confidence
        recommendations.sort((a, b) => {
            const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
            const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
            if (priorityDiff !== 0) return priorityDiff;
            return b.confidence - a.confidence;
        });

        return recommendations.slice(0, 8); // Top 8 recommendations
    }

    analyzeWaiverPickup(player, trending, isPPR) {
        const reasons = [];
        let priority = 'medium';
        let confidence = 60;
        let recommendation = 'consider';

        // Position-specific analysis
        const positionAnalysis = this.getPositionAnalysis(player.position, isPPR);
        confidence += positionAnalysis.adjustment;
        if (positionAnalysis.reasoning) {
            reasons.push(positionAnalysis.reasoning);
        }

        // Trending momentum analysis
        if (trending.count > 1000) {
            priority = 'high';
            confidence += 15;
            reasons.push(`Highly popular pickup (${trending.count.toLocaleString()} adds in 24h)`);
        } else if (trending.count > 500) {
            confidence += 10;
            reasons.push(`Strong pickup momentum (${trending.count.toLocaleString()} adds in 24h)`);
        } else if (trending.count > 100) {
            confidence += 5;
            reasons.push(`Growing interest (${trending.count.toLocaleString()} adds in 24h)`);
        }

        // Injury concerns
        if (player.injury_status) {
            const status = player.injury_status.toLowerCase();
            if (status === 'out') {
                recommendation = 'avoid';
                confidence = 20;
                reasons.push('Currently ruled OUT - avoid until healthy');
                return { recommendation, priority: 'low', reasoning: reasons.join('. '), confidence };
            } else if (status === 'doubtful') {
                confidence -= 20;
                priority = 'low';
                reasons.push('DOUBTFUL status creates uncertainty');
            } else if (status === 'questionable') {
                confidence -= 10;
                reasons.push('QUESTIONABLE - monitor injury reports');
            }
        }

        // Team context analysis
        const teamAnalysis = this.getTeamContextAnalysis(player.team);
        confidence += teamAnalysis.adjustment;
        if (teamAnalysis.reasoning) {
            reasons.push(teamAnalysis.reasoning);
        }

        // PPR-specific insights for skill positions
        if (isPPR && ['RB', 'WR', 'TE'].includes(player.position)) {
            const pprInsight = this.getPPRWaiverInsight(player);
            confidence += pprInsight.adjustment;
            if (pprInsight.reasoning) {
                reasons.push(pprInsight.reasoning);
            }
        }

        // Final priority adjustment based on confidence
        if (confidence >= 80) {
            priority = 'high';
        } else if (confidence <= 40) {
            priority = 'low';
        }

        return {
            recommendation,
            priority,
            reasoning: reasons.join('. '),
            confidence: Math.min(Math.max(confidence, 15), 95)
        };
    }

    getPositionAnalysis(position, isPPR) {
        const positionInsights = {
            'QB': {
                adjustment: 5,
                reasoning: 'Streaming QB based on matchups can provide weekly upside'
            },
            'RB': {
                adjustment: 10,
                reasoning: 'RB scarcity makes any potential starter valuable'
            },
            'WR': {
                adjustment: isPPR ? 8 : 5,
                reasoning: isPPR ? 'WR depth important in PPR scoring' : 'WR depth provides injury insurance'
            },
            'TE': {
                adjustment: isPPR ? 12 : 8,
                reasoning: isPPR ? 'TE streaming crucial in PPR formats' : 'TE position has limited reliable options'
            },
            'K': {
                adjustment: -5,
                reasoning: 'Kickers highly unpredictable - stream based on matchups only'
            },
            'DEF': {
                adjustment: 0,
                reasoning: 'Stream defenses based on weekly matchups and opponent turnovers'
            }
        };

        return positionInsights[position] || { adjustment: 0, reasoning: '' };
    }

    getTeamContextAnalysis(team) {
        // Placeholder team analysis - would be more sophisticated with real data
        const teamContexts = [
            { adjustment: 8, reasoning: 'High-powered offense creates multiple scoring opportunities' },
            { adjustment: 5, reasoning: 'Solid offensive line provides stable foundation' },
            { adjustment: -3, reasoning: 'Struggling offense limits overall ceiling' },
            { adjustment: 3, reasoning: 'Improving offensive coordinator could unlock potential' },
            { adjustment: 0, reasoning: 'Average offensive situation with standard expectations' }
        ];

        // Return random context for demo (would be data-driven in production)
        return teamContexts[Math.floor(Math.random() * teamContexts.length)];
    }

    getPPRWaiverInsight(player) {
        // Estimate reception potential for PPR value
        const pprInsights = {
            'RB': {
                highCatchingThreshold: 40,
                adjustment: 8,
                reasoning: 'Pass-catching upside adds significant PPR value'
            },
            'WR': {
                highCatchingThreshold: 60,
                adjustment: 6,
                reasoning: 'Target volume creates consistent PPR floor'
            },
            'TE': {
                highCatchingThreshold: 30,
                adjustment: 10,
                reasoning: 'TE reception volume highly valuable in PPR'
            }
        };

        const insight = pprInsights[player.position];
        if (!insight) return { adjustment: 0, reasoning: '' };

        // Simplified logic - would use actual target data in production
        return {
            adjustment: insight.adjustment,
            reasoning: insight.reasoning
        };
    }

    displayWaiverRecommendations(recommendations) {
        const container = document.getElementById('waiverRecommendations');
        if (!container) return;

        container.innerHTML = `
            <div class="recommendations-header">
                <h4>🎯 Top Waiver Wire Pickups (Week ${this.currentWeek})</h4>
                <p>AI-ranked recommendations with detailed analysis</p>
            </div>
            
            <div class="waiver-grid">
                ${recommendations.map(rec => `
                    <div class="waiver-card priority-${rec.priority}">
                        <div class="waiver-header">
                            <div class="player-info">
                                <div class="player-name">${rec.player.name}</div>
                                <div class="player-details">${rec.player.position} - ${rec.player.team}</div>
                                ${rec.player.injury_status ? `<div class="injury-tag">${rec.player.injury_status}</div>` : ''}
                            </div>
                            <div class="priority-badge ${rec.priority}">
                                ${rec.priority.toUpperCase()}
                            </div>
                        </div>
                        
                        <div class="waiver-stats">
                            <div class="stat">
                                <span class="stat-label">Adds (24h):</span>
                                <span class="stat-value">${rec.addPercentage.toLocaleString()}</span>
                            </div>
                            <div class="stat">
                                <span class="stat-label">Confidence:</span>
                                <span class="stat-value">${rec.confidence}%</span>
                            </div>
                            <div class="stat">
                                <span class="stat-label">Format:</span>
                                <span class="stat-value">${rec.scoringContext}</span>
                            </div>
                        </div>
                        
                        <div class="waiver-reasoning">
                            <strong>📝 Analysis:</strong> ${rec.reasoning}
                        </div>
                        
                        <div class="waiver-actions">
                            <button class="btn btn-sm btn-outline" onclick="waiverWireManager.getPlayerDetails('${rec.player.id}')">
                                📊 View Stats
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        container.style.display = 'block';
    }

    async analyzeDropCandidates() {
        const dropBtn = document.getElementById('analyzeDropsBtn');
        if (!dropBtn) return;

        dropBtn.disabled = true;
        dropBtn.innerHTML = '<span>⏳</span> Analyzing...';

        try {
            // Same precondition the analytics features use - the roster is loaded
            // once in My Team and shared from there.
            if (!window.teamManager || !window.teamManager.currentRoster) {
                throw new Error('Please load your roster in the My Team section first');
            }

            const roster = window.teamManager.currentRoster.roster;
            const allPlayers = await this.sleeperAPI.getAllPlayers();

            // How often the rest of the league is dropping each player is the one
            // genuinely external signal available here, so weight it heavily.
            const trendingDrops = await this.sleeperAPI.getTrendingPlayers('drop', 24, 200);
            const dropCounts = {};
            trendingDrops.forEach(t => { dropCounts[t.player_id] = t.count; });

            const candidates = this.generateDropCandidates(roster, allPlayers, dropCounts);
            this.displayDropCandidates(candidates);

            this.configManager.showNotification(
                `📉 Reviewed ${candidates.reviewed} rostered players - ${candidates.list.length} drop candidate${candidates.list.length === 1 ? '' : 's'} found`,
                'success'
            );

        } catch (error) {
            console.error('❌ Error analyzing drop candidates:', error);
            this.configManager.showNotification(`❌ Error: ${error.message}`, 'error');
        } finally {
            dropBtn.disabled = false;
            dropBtn.innerHTML = '<span>📉</span> Analyze Drops';
        }
    }

    generateDropCandidates(roster, allPlayers, dropCounts) {
        const starters = new Set(roster.starters || []);
        const playerIds = (roster.players || []).filter(id => id && id !== '0');

        // Count how deep the roster already is at each position so surplus depth
        // can be called out as a reason to cut.
        const positionCounts = {};
        playerIds.forEach(id => {
            const p = allPlayers[id];
            if (p && p.position) {
                positionCounts[p.position] = (positionCounts[p.position] || 0) + 1;
            }
        });

        const list = [];

        playerIds.forEach(id => {
            const player = allPlayers[id];
            if (!player) return;

            const evaluation = this.evaluateDropCandidate(
                player,
                dropCounts[id] || 0,
                { isStarter: starters.has(id), positionCount: positionCounts[player.position] || 0 }
            );

            if (evaluation.score > 0) {
                list.push({
                    id,
                    name: `${player.first_name} ${player.last_name}`,
                    position: player.position || 'N/A',
                    team: player.team || 'FA',
                    isStarter: starters.has(id),
                    ...evaluation
                });
            }
        });

        list.sort((a, b) => b.score - a.score);

        return { list: list.slice(0, 8), reviewed: playerIds.length };
    }

    // Scores how droppable a rostered player is. Higher score = safer to cut.
    evaluateDropCandidate(player, leagueDropCount, context) {
        const reasons = [];
        let score = 0;

        const status = (player.injury_status || '').toLowerCase();
        if (status === 'ir' || status === 'pup' || status === 'out') {
            score += 35;
            reasons.push(`Ruled ${player.injury_status.toUpperCase()} - occupying a roster spot without producing`);
        } else if (status === 'doubtful') {
            score += 18;
            reasons.push('DOUBTFUL for the upcoming week');
        } else if (status === 'questionable') {
            score += 5;
            reasons.push('QUESTIONABLE - monitor before locking lineups');
        }

        // A player with no NFL team cannot score at all.
        if (!player.team) {
            score += 40;
            reasons.push('Not on an NFL roster - no path to points');
        }

        if (player.status && player.status !== 'Active' && player.team) {
            score += 15;
            reasons.push(`Roster status is "${player.status}" rather than Active`);
        }

        if (leagueDropCount > 2000) {
            score += 25;
            reasons.push(`League-wide sell signal (${leagueDropCount.toLocaleString()} drops in 24h)`);
        } else if (leagueDropCount > 500) {
            score += 15;
            reasons.push(`Being dropped widely (${leagueDropCount.toLocaleString()} drops in 24h)`);
        } else if (leagueDropCount > 100) {
            score += 8;
            reasons.push(`Some managers are moving on (${leagueDropCount.toLocaleString()} drops in 24h)`);
        }

        // Buried on the depth chart means the touches are going elsewhere.
        if (player.depth_chart_order && player.depth_chart_order >= 3) {
            score += 12;
            reasons.push(`Listed #${player.depth_chart_order} on the depth chart`);
        }

        const surplus = this.getPositionSurplus(player.position, context.positionCount);
        if (surplus > 0) {
            score += surplus * 6;
            reasons.push(`You roster ${context.positionCount} ${player.position}s - ${surplus} more than a typical lineup needs`);
        }

        // Starters are load-bearing; require a much stronger case before suggesting a cut.
        if (context.isStarter) {
            score -= 25;
            if (score > 0) {
                reasons.push('Currently in your starting lineup - line up a replacement first');
            }
        }

        return {
            score: Math.max(0, score),
            severity: score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low',
            reasoning: reasons.length ? reasons.join('. ') : 'No standout concerns',
            leagueDropCount
        };
    }

    getPositionSurplus(position, count) {
        // Roughly what a 12-team lineup carries before a position becomes dead weight.
        const typical = { QB: 2, RB: 5, WR: 5, TE: 2, K: 1, DEF: 1 };
        const limit = typical[position];
        if (!limit) return 0;
        return Math.max(0, count - limit);
    }

    displayDropCandidates(candidates) {
        const container = document.getElementById('waiverRecommendations');
        if (!container) return;

        if (!candidates.list.length) {
            container.innerHTML = `
                <div class="waiver-header">
                    <h4>📉 Drop Candidates</h4>
                    <p>Reviewed all ${candidates.reviewed} players on your roster</p>
                </div>
                <div class="empty-state">
                    <div class="icon">✅</div>
                    <h3>No obvious cuts</h3>
                    <p>
                        Nobody on your roster is injured, teamless, buried on a depth chart or being
                        dropped across the league. If you need a spot, the surplus at your deepest
                        position is the place to look.
                    </p>
                </div>
            `;
            container.style.display = 'block';
            return;
        }

        container.innerHTML = `
            <div class="waiver-header">
                <h4>📉 Drop Candidates</h4>
                <p>Ranked by how safely you can cut them - reviewed ${candidates.reviewed} rostered players</p>
            </div>

            <div class="waiver-recommendations-grid">
                ${candidates.list.map(c => `
                    <div class="waiver-recommendation priority-${c.severity}">
                        <div class="waiver-player-header">
                            <div class="player-info">
                                <h5>${c.name} ${c.isStarter ? '<span class="starter-flag">STARTER</span>' : ''}</h5>
                                <span class="player-meta">${c.position} - ${c.team}</span>
                            </div>
                            <span class="priority-badge priority-${c.severity}">${c.severity.toUpperCase()}</span>
                        </div>

                        <div class="waiver-stats">
                            <div class="stat">
                                <span class="stat-label">Drop score:</span>
                                <span class="stat-value">${c.score}</span>
                            </div>
                            <div class="stat">
                                <span class="stat-label">League drops (24h):</span>
                                <span class="stat-value">${c.leagueDropCount.toLocaleString()}</span>
                            </div>
                        </div>

                        <div class="waiver-reasoning">
                            <strong>📝 Why:</strong> ${c.reasoning}
                        </div>

                        <div class="waiver-actions">
                            <button class="btn btn-sm btn-outline" onclick="waiverWireManager.getPlayerDetails('${c.id}')">
                                📊 View Stats
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="waiver-education">
                <strong>💡 Why this matters:</strong> Roster spots are a resource. A player who is
                out, teamless or buried behind two others cannot score for you, so holding them costs
                you the waiver pickup you could have made instead. Cut from surplus depth before you
                cut from a position you start every week.
            </div>
        `;

        container.style.display = 'block';
    }

    async showTrendingPlayers() {
        const showBtn = document.getElementById('showTrendingBtn');
        if (!showBtn) return;

        showBtn.disabled = true;
        showBtn.innerHTML = '<span>⏳</span> Loading...';

        try {
            const trending = await this.sleeperAPI.getTrendingPlayers('add', 24, 20);
            const allPlayers = await this.sleeperAPI.getAllPlayers();
            
            this.displayTrendingPlayers(trending, allPlayers);
            
        } catch (error) {
            console.error('❌ Error loading trending players:', error);
            this.configManager.showNotification(`❌ Error: ${error.message}`, 'error');
        } finally {
            showBtn.disabled = false;
            showBtn.innerHTML = '<span>📈</span> Trending Players';
        }
    }

    displayTrendingPlayers(trending, allPlayers) {
        const container = document.getElementById('waiverRecommendations');
        if (!container) return;

        container.innerHTML = `
            <div class="trending-header">
                <h4>📈 Most Added Players (Last 24 Hours)</h4>
                <p>See what other managers are picking up</p>
            </div>
            
            <div class="trending-grid">
                ${trending.slice(0, 15).map((trend, index) => {
                    const player = allPlayers[trend.player_id];
                    if (!player) return '';
                    
                    return `
                        <div class="trending-item">
                            <div class="trending-rank">#${index + 1}</div>
                            <div class="trending-player">
                                <div class="player-name">${player.first_name} ${player.last_name}</div>
                                <div class="player-details">${player.position} - ${player.team}</div>
                            </div>
                            <div class="trending-count">
                                ${trend.count.toLocaleString()} adds
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        container.style.display = 'block';
    }

    async getPlayerDetails(playerId) {
        try {
            const allPlayers = await this.sleeperAPI.getAllPlayers();
            const player = allPlayers[playerId];

            if (!player) {
                throw new Error('Player not found in the Sleeper database');
            }

            // Where this player sits in league-wide add/drop activity gives the
            // detail view something the static profile cannot.
            const [adds, drops] = await Promise.all([
                this.sleeperAPI.getTrendingPlayers('add', 24, 200),
                this.sleeperAPI.getTrendingPlayers('drop', 24, 200)
            ]);

            const addEntry = adds.find(t => t.player_id === playerId);
            const dropEntry = drops.find(t => t.player_id === playerId);

            this.showPlayerDetailModal(player, {
                adds: addEntry ? addEntry.count : 0,
                drops: dropEntry ? dropEntry.count : 0,
                addRank: addEntry ? adds.indexOf(addEntry) + 1 : null,
                dropRank: dropEntry ? drops.indexOf(dropEntry) + 1 : null
            });

        } catch (error) {
            console.error('❌ Error loading player details:', error);
            this.configManager.showNotification(`❌ Error: ${error.message}`, 'error');
        }
    }

    showPlayerDetailModal(player, trending) {
        const existing = document.getElementById('playerDetailModal');
        if (existing) existing.remove();

        const name = `${player.first_name} ${player.last_name}`;
        const heightFeet = player.height && !String(player.height).includes('-')
            ? `${Math.floor(player.height / 12)}'${player.height % 12}"`
            : (player.height || '—');

        const rows = [
            ['Position', player.position || '—'],
            ['NFL team', player.team || 'Free agent'],
            ['Age', player.age || '—'],
            ['Experience', player.years_exp === 0 ? 'Rookie' : (player.years_exp ? `${player.years_exp} yrs` : '—')],
            ['Height / weight', `${heightFeet} / ${player.weight ? player.weight + ' lb' : '—'}`],
            ['College', player.college || '—'],
            ['Depth chart', player.depth_chart_order ? `#${player.depth_chart_order} at ${player.depth_chart_position || player.position}` : '—'],
            ['Roster status', player.status || '—'],
            ['Injury', player.injury_status ? `${player.injury_status}${player.injury_body_part ? ' (' + player.injury_body_part + ')' : ''}` : 'Healthy']
        ];

        const netMomentum = trending.adds - trending.drops;

        const modal = document.createElement('div');
        modal.id = 'playerDetailModal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.85); z-index: 1001;
            display: flex; align-items: center; justify-content: center;
        `;

        modal.innerHTML = `
            <div class="modal-content" style="background: var(--modal-bg); border-radius: 12px; width: 90%; max-width: 560px; max-height: 85vh; overflow: hidden; display: flex; flex-direction: column;">
                <div class="modal-header" style="padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="margin: 0; color: var(--text-primary);">${name}</h3>
                        <div style="font-size: 0.875rem; color: var(--text-secondary);">${player.position || '—'} · ${player.team || 'Free agent'}</div>
                    </div>
                    <button onclick="waiverWireManager.closePlayerDetailModal()" aria-label="Close"
                            style="background: none; border: none; color: var(--text-secondary); font-size: 1.5rem; cursor: pointer; line-height: 1;">&times;</button>
                </div>

                <div style="padding: 1rem 1.5rem; overflow-y: auto;">
                    <h4 style="margin: 0 0 0.5rem; color: var(--text-primary);">📈 League activity (last 24h)</h4>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.25rem;">
                        <div class="metric-card">
                            <div class="metric-value">${trending.adds.toLocaleString()}</div>
                            <div class="metric-label">Adds${trending.addRank ? ` (#${trending.addRank})` : ''}</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value">${trending.drops.toLocaleString()}</div>
                            <div class="metric-label">Drops${trending.dropRank ? ` (#${trending.dropRank})` : ''}</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value" style="color: ${netMomentum >= 0 ? '#2ecc71' : '#ef4444'};">
                                ${netMomentum >= 0 ? '+' : ''}${netMomentum.toLocaleString()}
                            </div>
                            <div class="metric-label">Net momentum</div>
                        </div>
                    </div>

                    <h4 style="margin: 0 0 0.5rem; color: var(--text-primary);">📋 Player profile</h4>
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                        ${rows.map(([label, value]) => `
                            <tr>
                                <td style="padding: 0.4rem 0; color: var(--text-secondary); width: 45%;">${label}</td>
                                <td style="padding: 0.4rem 0; color: var(--text-primary); font-weight: 500;">${value}</td>
                            </tr>
                        `).join('')}
                    </table>

                    <div class="waiver-education" style="margin-top: 1.25rem;">
                        <strong>💡 Reading this:</strong> ${this.getMomentumInsight(netMomentum, trending)}
                    </div>
                </div>
            </div>
        `;

        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closePlayerDetailModal();
        });

        this._detailEscapeHandler = (e) => {
            if (e.key === 'Escape') this.closePlayerDetailModal();
        };
        document.addEventListener('keydown', this._detailEscapeHandler);

        document.body.appendChild(modal);
    }

    getMomentumInsight(netMomentum, trending) {
        if (trending.adds === 0 && trending.drops === 0) {
            return 'Nobody is moving on this player right now. That is not automatically bad - it usually means the situation has not changed recently.';
        }
        if (netMomentum > 1000) {
            return 'Managers are adding this player far faster than they are dropping them, which normally follows an injury ahead of them or a breakout game. Expect the waiver price to be high.';
        }
        if (netMomentum > 0) {
            return 'Slightly more adds than drops. Interest is building but the league has not committed yet, so you may still get them cheaply.';
        }
        if (netMomentum > -1000) {
            return 'More managers are dropping than adding. Check whether something changed in their role before you spend a claim.';
        }
        return 'This player is being dropped across the league. Something has usually gone wrong - a lost job, an injury, or a bye-week cut.';
    }

    closePlayerDetailModal() {
        const modal = document.getElementById('playerDetailModal');
        if (modal) modal.remove();
        if (this._detailEscapeHandler) {
            document.removeEventListener('keydown', this._detailEscapeHandler);
            this._detailEscapeHandler = null;
        }
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WaiverWireManager;
}