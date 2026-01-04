import cron from 'node-cron'
import { Match } from '../models/football.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getAllUserSockets } from '../socket/socket.js'
import mongoose from 'mongoose'
import { autoPostTodayMatches, getFootballAccount, fetchMatchDetails } from '../controller/football.js'

// API-Football (RapidAPI) configuration
const API_KEY = process.env.RAPIDAPI_KEY || process.env.FOOTBALL_API_KEY || ''
const API_BASE_URL = 'https://api-football-v1.p.rapidapi.com/v3'
const API_HOST = 'api-football-v1.p.rapidapi.com'
const CURRENT_SEASON = 2024 // Update this yearly

// Supported leagues and competitions (API-Football uses numeric IDs)
// OPTIMIZED FOR FREE TIER (100 calls/day): Only 3 top leagues
const SUPPORTED_LEAGUES = [
    // Top 3 Leagues Only (Free Tier Optimization)
    { id: 39, name: 'Premier League' },      // Premier League
    { id: 140, name: 'La Liga' },            // La Liga (Spanish)
    { id: 135, name: 'Serie A' }             // Serie A (Italian)
    
    // Removed for free tier optimization (can re-add when upgrading):
    // { id: 78, name: 'Bundesliga' },          
    // { id: 61, name: 'Ligue 1' },             
    // { id: 2, name: 'UEFA Champions League' }, 
    // { id: 4, name: 'UEFA European Championship' }, 
    // { id: 1, name: 'FIFA World Cup' }
]

// Helper: Convert API-Football match format to our database format
const convertMatchFormat = (matchData, leagueInfo) => {
    // API-Football status mapping
    // API-Football uses: NS (Not Started), 1H (First Half), HT (Half Time), 2H (Second Half), ET (Extra Time), P (Penalty), FT (Full Time), AET (After Extra Time), PEN (Penalties), BT (Break Time), SUSP (Suspended), INT (Interrupted), PST (Postponed), CANC (Cancelled), ABD (Abandoned), AW (Awarded), WO (Walkover)
    const fixture = matchData.fixture || matchData
    const status = fixture.status || {}
    
    // Map API-Football short status to our format
    let statusShort = status.short || 'NS'
    let statusLong = status.long || 'Not Started'
    let elapsed = status.elapsed || null
    
    // Map status codes
    const statusMap = {
        'NS': { long: 'Not Started', short: 'NS' },
        '1H': { long: 'First Half', short: '1H' },
        'HT': { long: 'Half Time', short: 'HT' },
        '2H': { long: 'Second Half', short: '2H' },
        'ET': { long: 'Extra Time', short: 'ET' },
        'P': { long: 'Penalty', short: 'P' },
        'FT': { long: 'Match Finished', short: 'FT' },
        'AET': { long: 'After Extra Time', short: 'AET' },
        'PEN': { long: 'Penalties', short: 'PEN' },
        'BT': { long: 'Break Time', short: 'BT' },
        'SUSP': { long: 'Suspended', short: 'SUSP' },
        'INT': { long: 'Interrupted', short: 'INT' },
        'PST': { long: 'Postponed', short: 'POSTP' },
        'CANC': { long: 'Cancelled', short: 'CANC' },
        'ABD': { long: 'Abandoned', short: 'ABD' },
        'AW': { long: 'Awarded', short: 'AW' },
        'WO': { long: 'Walkover', short: 'WO' }
    }
    
    const mappedStatus = statusMap[statusShort] || { long: statusLong, short: statusShort }
    
    const teams = matchData.teams || {}
    const goals = matchData.goals || {}
    const league = matchData.league || {}
    
    return {
        fixtureId: fixture.id,
        league: {
            id: league.id || leagueInfo?.id || 0,
            name: league.name || leagueInfo?.name || 'Unknown League',
            country: league.country || 'Unknown',
            logo: league.logo || '',
            flag: league.flag || '',
            season: league.season || CURRENT_SEASON
        },
        teams: {
            home: {
                id: teams.home?.id || 0,
                name: teams.home?.name || 'Unknown',
                logo: teams.home?.logo || ''
            },
            away: {
                id: teams.away?.id || 0,
                name: teams.away?.name || 'Unknown',
                logo: teams.away?.logo || ''
            }
        },
        fixture: {
            date: new Date(fixture.date),
            venue: fixture.venue?.name || '',
            city: fixture.venue?.city || '',
            status: {
                long: mappedStatus.long,
                short: mappedStatus.short,
                elapsed: elapsed
            }
        },
        goals: {
            home: goals.home || null,
            away: goals.away || null
        },
        events: matchData.events || [], // API-Football provides events (goals, cards, etc.)
        lastUpdated: new Date()
    }
}

// Helper: Fetch from API-Football (RapidAPI)
const fetchFromAPI = async (endpoint) => {
    try {
        if (!API_KEY) {
            console.error('⚠️ [fetchFromAPI] RAPIDAPI_KEY not set! Please set RAPIDAPI_KEY environment variable')
            return { success: false, error: 'API key not configured' }
        }
        
        const headers = {
            'x-rapidapi-key': API_KEY,
            'x-rapidapi-host': API_HOST
        }
        
        const fullUrl = `${API_BASE_URL}${endpoint}`
        console.log('⚽ [fetchFromAPI] Fetching:', fullUrl)
        
        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: headers
        })
        
        console.log('⚽ [fetchFromAPI] Response status:', response.status, response.statusText)
        
        // Log rate limit headers if available
        const rateLimit = response.headers.get('x-ratelimit-requests-limit')
        const rateRemaining = response.headers.get('x-ratelimit-requests-remaining')
        const rateReset = response.headers.get('x-ratelimit-requests-reset')
        
        if (rateLimit && rateRemaining !== null) {
            const remainingPercent = ((parseInt(rateRemaining) / parseInt(rateLimit)) * 100).toFixed(1)
            console.log(`📊 [fetchFromAPI] Rate Limit: ${rateRemaining}/${rateLimit} (${remainingPercent}% remaining)`)
            
            // Warn if low on requests
            if (parseInt(rateRemaining) < 10) {
                console.warn(`⚠️ [fetchFromAPI] WARNING: Low on API requests! Only ${rateRemaining} remaining`)
            }
        }
        
        const data = await response.json()
        
        // Handle rate limit errors
        if (response.status === 429) {
            const errorMsg = data.message || 'Rate limit exceeded'
            const waitTime = data.errors?.requests || 'unknown'
            console.error(`🚫 [fetchFromAPI] RATE LIMIT HIT! ${errorMsg}. Wait time: ${waitTime}`)
            console.error(`🚫 [fetchFromAPI] Rate limit details: Limit=${rateLimit}, Remaining=${rateRemaining}, Reset=${rateReset}`)
            return { success: false, error: errorMsg, rateLimit: true }
        }
        
        if (response.ok && data.response) {
            // API-Football returns { response: [...], results: number, paging: {...} }
            console.log('⚽ [fetchFromAPI] Success! Found', data.response.length, 'matches (results:', data.results, ')')
            return { success: true, data: data.response, results: data.results }
        } else {
            console.error('⚽ [fetchFromAPI] Error:', data.message || data.errors || 'Unknown error')
            if (data.errors) {
                console.error('⚽ [fetchFromAPI] Error details:', JSON.stringify(data.errors, null, 2))
            }
            return { success: false, error: data.message || JSON.stringify(data.errors) || 'Failed to fetch from API' }
        }
    } catch (error) {
        console.error('⚽ [fetchFromAPI] Fetch Error:', error.message)
        console.error('⚽ [fetchFromAPI] Error stack:', error.stack)
        return { success: false, error: error.message }
    }
}

// getFootballAccount is imported from '../controller/football.js' - no need to redeclare

// Auto-post match update
const autoPostMatchUpdate = async (match, updateType) => {
    try {
        const footballAccount = await getFootballAccount()
        if (!footballAccount) return
        
        // Check if already posted this update
        if (updateType === 'start' && match.postedToFeed) return
        
        // Generate post text
        let postText = ''
        
        if (updateType === 'start') {
            postText = `⚽ KICK OFF!\n\n${match.teams.home.name} vs ${match.teams.away.name}\n\n📺 ${match.league.name}\n🏟️ ${match.fixture.venue || 'Stadium'}`
        } else if (updateType === 'goal') {
            postText = `⚽ GOAL!\n\n${match.teams.home.name} ${match.goals.home} - ${match.goals.away} ${match.teams.away.name}\n\n📺 ${match.league.name}\n⏱️ ${match.fixture.status.elapsed}'`
        } else if (updateType === 'finish') {
            postText = `🏁 FULL TIME\n\n${match.teams.home.name} ${match.goals.home} - ${match.goals.away} ${match.teams.away.name}\n\n📺 ${match.league.name}`
        }
        
        // Create post
        const newPost = new Post({
            postedBy: footballAccount._id,
            text: postText
        })
        
        await newPost.save()
        await newPost.populate("postedBy", "username profilePic name")
        
        // Update match
        if (updateType === 'start') {
            match.postedToFeed = true
            match.postId = newPost._id
            await match.save()
        }
        
        // Emit to followers
        // Fetch fresh account data to get updated followers list
        const freshFootballAccount = await User.findById(footballAccount._id).select('followers')
        const io = getIO()
        
        if (io && freshFootballAccount && freshFootballAccount.followers && freshFootballAccount.followers.length > 0) {
            const userSocketMap = getUserSocketMap()
            const onlineFollowers = []
            
            freshFootballAccount.followers.forEach(followerId => {
                const followerIdStr = followerId.toString()
                if (userSocketMap[followerIdStr]) {
                    onlineFollowers.push(userSocketMap[followerIdStr].socketId)
                }
            })
            
            if (onlineFollowers.length > 0) {
                io.to(onlineFollowers).emit("newPost", newPost)
                console.log(`✅ Emitted match update to ${onlineFollowers.length} online followers`)
            }
        }
        
        console.log(`✅ Auto-posted: ${updateType} for ${match.teams.home.name} vs ${match.teams.away.name}`)
        
    } catch (error) {
        console.error('❌ Error auto-posting match update:', error)
    }
}

// 1. Fetch live matches and update database
const fetchAndUpdateLiveMatches = async () => {
    try {
        console.log('⚽ [fetchAndUpdateLiveMatches] Fetching live matches...')
        
        // API-Football: Use live=all to get all live matches across all leagues
        // This is more efficient than querying each league separately
        const result = await fetchFromAPI('/fixtures?live=all')
        
        if (result.rateLimit) {
            console.warn('⚠️ [fetchAndUpdateLiveMatches] Rate limit hit, skipping this update')
            return
        }
        
        if (!result.success || !result.data) {
            console.log('📭 [fetchAndUpdateLiveMatches] No live matches at the moment')
            return
        }
        
        let allLiveMatches = []
        
        // Filter for matches from supported leagues
        const supportedLeagueIds = SUPPORTED_LEAGUES.map(l => l.id)
        const filteredMatches = result.data.filter(m => {
            const leagueId = m.league?.id
            return supportedLeagueIds.includes(leagueId)
        })
        
        if (filteredMatches.length > 0) {
            // Add league info to each match
            filteredMatches.forEach(match => {
                const leagueInfo = SUPPORTED_LEAGUES.find(l => l.id === match.league?.id)
                if (leagueInfo) {
                    allLiveMatches.push({ ...match, leagueInfo })
                }
            })
            console.log(`⚽ [fetchAndUpdateLiveMatches] Found ${allLiveMatches.length} live matches from supported leagues`)
        }
        
        if (allLiveMatches.length === 0) {
            console.log('📭 [fetchAndUpdateLiveMatches] No live matches at the moment')
            return
        }
        
        console.log(`📊 [fetchAndUpdateLiveMatches] Found ${allLiveMatches.length} total live matches`)
        
        for (const matchData of allLiveMatches) {
            // Get previous state
            const fixtureId = matchData.fixture?.id || matchData.id
            const previousMatch = await Match.findOne({ fixtureId })
            
            const previousGoalsHome = previousMatch?.goals?.home || 0
            const previousGoalsAway = previousMatch?.goals?.away || 0
            
            // API-Football: Get current score from goals object
            const currentGoalsHome = matchData.goals?.home ?? 0
            const currentGoalsAway = matchData.goals?.away ?? 0
            
            // Convert and update match in database
            const convertedMatch = convertMatchFormat(matchData, matchData.leagueInfo)
            
            const updatedMatch = await Match.findOneAndUpdate(
                { fixtureId: convertedMatch.fixtureId },
                convertedMatch,
                { upsert: true, new: true }
            )
            
            // Check what changed
            const scoreChanged = (currentGoalsHome !== previousGoalsHome) || (currentGoalsAway !== previousGoalsAway)
            const statusChanged = previousMatch?.fixture?.status?.short !== updatedMatch.fixture?.status?.short
            const elapsedChanged = previousMatch?.fixture?.status?.elapsed !== updatedMatch.fixture?.status?.elapsed
            
            // Always update post if score, status, or elapsed time changed (for real-time updates)
            if (scoreChanged || statusChanged || elapsedChanged) {
                console.log(`  🔔 Match update detected: ${updatedMatch.teams?.home?.name} vs ${updatedMatch.teams?.away?.name}`)
                if (scoreChanged) {
                    console.log(`     Score: ${previousGoalsHome}-${previousGoalsAway} → ${currentGoalsHome}-${currentGoalsAway}`)
                }
                if (statusChanged) {
                    console.log(`     Status: ${previousMatch?.fixture?.status?.short || 'N/A'} → ${updatedMatch.fixture?.status?.short}`)
                }
                if (elapsedChanged) {
                    console.log(`     Elapsed: ${previousMatch?.fixture?.status?.elapsed || 'N/A'}' → ${updatedMatch.fixture?.status?.elapsed || 'N/A'}'`)
                }
            } else {
                console.log(`  ✓ Match unchanged: ${updatedMatch.teams?.home?.name} vs ${updatedMatch.teams?.away?.name} (${currentGoalsHome}-${currentGoalsAway})`)
            }
            
            // Always update post if there are changes (score, status, or elapsed time)
            if (scoreChanged || statusChanged || elapsedChanged) {
                console.log(`  🔔 Match updated: ${updatedMatch.teams?.home?.name} vs ${updatedMatch.teams?.away?.name}`)
                console.log(`     Score: ${previousGoalsHome}-${previousGoalsAway} → ${currentGoalsHome}-${currentGoalsAway}`)
                
                // Find the "Today's Top Matches" post for this match
                const footballAccount = await getFootballAccount()
                if (footballAccount) {
                    const todayPost = await Post.findOne({
                        postedBy: footballAccount._id,
                        footballData: { $exists: true, $ne: null },
                        createdAt: { 
                            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
                            $lte: new Date(new Date().setHours(23, 59, 59, 999))
                        }
                    }).sort({ createdAt: -1 })
                    
                    if (todayPost) {
                        // Parse existing match data
                        let matchData = []
                        try {
                            matchData = JSON.parse(todayPost.footballData)
                        } catch (e) {
                            console.error('Failed to parse football data:', e)
                        }
                        
                        // Update the match in the post data (find by team names)
                        const matchIndex = matchData.findIndex(m => {
                            const homeName1 = m.homeTeam?.name || m.homeTeam
                            const awayName1 = m.awayTeam?.name || m.awayTeam
                            const homeName2 = updatedMatch.teams?.home?.name
                            const awayName2 = updatedMatch.teams?.away?.name
                            return homeName1 === homeName2 && awayName1 === awayName2
                        })
                        
                        if (matchIndex !== -1) {
                            matchData[matchIndex] = {
                                ...matchData[matchIndex],
                                score: {
                                    home: updatedMatch.goals?.home ?? 0,
                                    away: updatedMatch.goals?.away ?? 0
                                },
                                status: {
                                    short: updatedMatch.fixture?.status?.short,
                                    long: updatedMatch.fixture?.status?.long,
                                    elapsed: updatedMatch.fixture?.status?.elapsed
                                }
                            }
                            
                            // Filter out finished matches (FT, AET, PEN) - only keep live matches
                            const finishedStatuses = ['FT', 'AET', 'PEN', 'CANC', 'POSTP', 'SUSP']
                            const liveMatchesOnly = matchData.filter(m => {
                                const status = m.status?.short || m.status
                                return !finishedStatuses.includes(status)
                            })
                            
                            // Update post in database with only live matches
                            todayPost.footballData = JSON.stringify(liveMatchesOnly)
                            // Don't update createdAt - use updatedAt timestamp instead to avoid duplicate detection issues
                            // The post will still move to top via socket update in frontend
                            await todayPost.save()
                            
                            // Update matchData for socket emission
                            matchData = liveMatchesOnly
                            
                            // Emit socket event to update frontend
                            const io = getIO()
                            if (io) {
                                // Get all followers of Football account
                                const freshFootballAccount = await User.findById(footballAccount._id).select('followers')
                                const followerIds = freshFootballAccount?.followers?.map(f => f.toString()) || []
                                
                                // Emit to all online followers
                                const socketMap = await getAllUserSockets()
                                let onlineCount = 0
                                
                                followerIds.forEach(followerId => {
                                    const socketData = socketMap[followerId]
                                    if (socketData && socketData.socketId) {
                                        io.to(socketData.socketId).emit('footballMatchUpdate', {
                                            postId: todayPost._id.toString(),
                                            matchData: matchData,
                                            updatedAt: new Date()
                                        })
                                        onlineCount++
                                    }
                                })
                                
                                console.log(`  ✅ Emitted match update to ${onlineCount} online followers`)
                            }
                        }
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Error in fetchAndUpdateLiveMatches:', error)
    }
}

// 2. Fetch today's fixtures (runs once daily)
const fetchTodayFixtures = async () => {
    try {
        console.log('📅 [fetchTodayFixtures] Starting to fetch today\'s fixtures...')
        
        const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
        console.log('📅 [fetchTodayFixtures] Today\'s date:', today)
        console.log('📅 [fetchTodayFixtures] Supported leagues:', SUPPORTED_LEAGUES)
        
        let totalFetched = 0
        
        for (const league of SUPPORTED_LEAGUES) {
            console.log(`📅 [fetchTodayFixtures] Fetching fixtures for ${league.name} (ID: ${league.id})...`)
            
            // API-Football: /fixtures?league={id}&season={year}&date={date}
            const result = await fetchFromAPI(`/fixtures?league=${league.id}&season=${CURRENT_SEASON}&date=${today}`)
            
            if (result.rateLimit) {
                console.warn(`⚠️ [fetchTodayFixtures] Rate limit hit for ${league.name}, skipping remaining leagues`)
                break
            }
            
            console.log(`📅 [fetchTodayFixtures] League ${league.name} result:`, {
                success: result.success,
                matchesFound: result.data?.length || 0,
                error: result.error
            })
            
            if (result.success && result.data && result.data.length > 0) {
                for (const matchData of result.data) {
                    const convertedMatch = convertMatchFormat(matchData, league)
                    await Match.findOneAndUpdate(
                        { fixtureId: convertedMatch.fixtureId },
                        convertedMatch,
                        { upsert: true, new: true }
                    )
                    totalFetched++
                }
            }
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 7000)) // 7 seconds between requests
        }
        
        console.log(`✅ Fetched ${totalFetched} fixtures for today`)
        
    } catch (error) {
        console.error('❌ Error in fetchTodayFixtures:', error)
    }
}

// 3. Initialize cron jobs
export const initializeFootballCron = () => {
    console.log('⚽ Initializing Football Cron Jobs...')
    
    // Job 1: Smart Polling - Only during match hours (OPTIMIZED FOR FREE TIER)
    // Premier League, La Liga, Serie A match hours:
    // - Weekends (Sat-Sun): 12:00-22:00 UTC (peak hours)
    // - Weekdays: 18:00-22:00 UTC (evening matches)
    // - Off-hours: Don't poll (or very rarely)
    
    // Weekend matches (Saturday & Sunday): Poll every 10 minutes during 12:00-22:00 UTC
    // This gives us: 10 hours × 6 calls/hour = 60 calls for 2 days = ~30 calls/day average
    cron.schedule('*/10 12-22 * * 6,0', async () => {
        console.log('⚽ [CRON] Running live match update (weekend match hours: every 10 min)...')
        await fetchAndUpdateLiveMatches()
    })
    
    // Weekday evening matches (Mon-Fri): Poll every 15 minutes during 18:00-22:00 UTC
    // This gives us: 4 hours × 4 calls/hour = 16 calls for 5 days = ~3 calls/day average
    cron.schedule('*/15 18-22 * * 1-5', async () => {
        console.log('⚽ [CRON] Running live match update (weekday evenings: every 15 min)...')
        await fetchAndUpdateLiveMatches()
    })
    
    // Off-hours check: Once per hour (just in case) during non-match hours
    // This gives us: ~12 calls/day (when matches unlikely)
    cron.schedule('0 0-11,23 * * *', async () => {
        console.log('⚽ [CRON] Running live match update (off-hours check: hourly)...')
        await fetchAndUpdateLiveMatches()
    })
    
    // Total: ~45 calls/day (well under 100 free tier limit!)
    
    // Job 2: Fetch today's fixtures once at 6 AM UTC
    cron.schedule('0 6 * * *', async () => {
        console.log('📅 [CRON] Running daily fixtures fetch...')
        await fetchTodayFixtures()
    })
    
    // Job 5: Auto-create post for today's matches at 7 AM UTC (after fixtures are fetched at 6 AM)
    cron.schedule('0 7 * * *', async () => {
        console.log('📅 [CRON] Auto-creating post for today\'s matches...')
        await autoPostTodayMatches()
    })
    
    // Job 6: Refresh post every 30 minutes (FREE TIER: matches live fetch interval)
    // This reuses already-fetched data from database, no extra API calls
    cron.schedule('*/30 * * * *', async () => {
        console.log('🔄 [CRON] Refreshing Football post with latest live matches (from database)...')
        await autoPostTodayMatches()
    })
    
    // Job 3: Create football account if not exists (runs once on startup)
    setTimeout(async () => {
        await getFootballAccount()
    }, 3000)
    
    // Job 4: Fetch fixtures immediately on startup (for testing/development)
    setTimeout(async () => {
        console.log('⚽ [STARTUP] Fetching today\'s fixtures immediately...')
        await fetchTodayFixtures()
        
        // Also create post on startup if it doesn't exist for today
        console.log('⚽ [STARTUP] Checking if post exists for today...')
        await autoPostTodayMatches()
    }, 5000)
    
    console.log('✅ Football Cron Jobs initialized (FREE TIER - SMART POLLING)')
    console.log('   - Live matches: Smart polling during match hours only')
    console.log('     • Weekends 12:00-22:00 UTC: Every 10 min (~30 calls/day)')
    console.log('     • Weekdays 18:00-22:00 UTC: Every 15 min (~3 calls/day)')
    console.log('     • Off-hours: Hourly check (~12 calls/day)')
    console.log('   - Daily fixtures: 6 AM UTC (3 calls/day)')
    console.log('   - Auto-post today\'s matches: 7 AM UTC (1 call)')
    console.log('   - Post refresh: Every 30 minutes (from database, no API calls)')
    console.log('   - Leagues: Premier League, La Liga, Serie A only')
    console.log('   - Total: ~45-50 calls/day (well under 100 free tier limit!)')
}

