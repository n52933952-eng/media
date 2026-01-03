import cron from 'node-cron'
import { Match } from '../models/football.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getAllUserSockets } from '../socket/socket.js'
import mongoose from 'mongoose'
import { autoPostTodayMatches, getFootballAccount, fetchMatchDetails } from '../controller/football.js'

// Football-Data.org API configuration
const API_KEY = process.env.FOOTBALL_API_KEY || '5449eacc047c4b529267d309d166d09b'
const API_BASE_URL = 'https://api.football-data.org/v4'

// Supported leagues and competitions (football-data.org uses codes)
const SUPPORTED_LEAGUES = [
    // Top Leagues
    { code: 'PL', name: 'Premier League' },
    { code: 'PD', name: 'La Liga' },
    { code: 'SA', name: 'Serie A' },
    { code: 'BL1', name: 'Bundesliga' },
    { code: 'FL1', name: 'Ligue 1' },
    
    // European Competitions
    { code: 'CL', name: 'UEFA Champions League' },
    { code: 'EC', name: 'UEFA European Championship' },
    
    // International
    { code: 'WC', name: 'FIFA World Cup' }
]

// Helper: Convert football-data.org match format to our database format
const convertMatchFormat = (matchData, leagueInfo) => {
    const statusMap = {
        'SCHEDULED': { long: 'Not Started', short: 'NS', elapsed: null },
        'TIMED': { long: 'Scheduled', short: 'NS', elapsed: null },
        'IN_PLAY': { long: 'Live', short: '1H', elapsed: 45 },
        'PAUSED': { long: 'Half Time', short: 'HT', elapsed: 45 },
        'FINISHED': { long: 'Match Finished', short: 'FT', elapsed: 90 },
        'POSTPONED': { long: 'Postponed', short: 'POSTP', elapsed: null },
        'CANCELLED': { long: 'Cancelled', short: 'CANC', elapsed: null },
        'SUSPENDED': { long: 'Suspended', short: 'SUSP', elapsed: null }
    }
    
    const status = statusMap[matchData.status] || statusMap['SCHEDULED']
    
    return {
        fixtureId: matchData.id,
        league: {
            id: matchData.competition?.id || leagueInfo?.code || 'UNKNOWN',
            name: matchData.competition?.name || leagueInfo?.name || 'Unknown League',
            country: matchData.area?.name || 'Unknown',
            logo: matchData.competition?.emblem || '',
            flag: matchData.area?.flag || '',
            season: matchData.season?.startDate ? new Date(matchData.season.startDate).getFullYear() : 2024
        },
        teams: {
            home: {
                id: matchData.homeTeam?.id || 0,
                name: matchData.homeTeam?.name || 'Unknown',
                logo: matchData.homeTeam?.crest || ''
            },
            away: {
                id: matchData.awayTeam?.id || 0,
                name: matchData.awayTeam?.name || 'Unknown',
                logo: matchData.awayTeam?.crest || ''
            }
        },
        fixture: {
            date: new Date(matchData.utcDate),
            venue: matchData.venue || '',
            city: '',
            status: status
        },
        goals: {
            home: matchData.score?.fullTime?.home || matchData.score?.halfTime?.home || null,
            away: matchData.score?.fullTime?.away || matchData.score?.halfTime?.away || null
        },
        lastUpdated: new Date()
    }
}

// Helper: Fetch from Football-Data.org API
const fetchFromAPI = async (endpoint) => {
    try {
        const headers = {}
        if (API_KEY) {
            headers['X-Auth-Token'] = API_KEY
        }
        
        const fullUrl = `${API_BASE_URL}${endpoint}`
        console.log('⚽ [fetchFromAPI] Fetching:', fullUrl)
        console.log('⚽ [fetchFromAPI] API Key present:', API_KEY ? 'Yes' : 'NO!')
        
        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: headers
        })
        
        console.log('⚽ [fetchFromAPI] Response status:', response.status, response.statusText)
        
        const data = await response.json()
        console.log('⚽ [fetchFromAPI] Response data keys:', Object.keys(data))
        
        if (response.ok && data.matches) {
            console.log('⚽ [fetchFromAPI] Success! Found', data.matches.length, 'matches')
            return { success: true, data: data.matches }
        } else {
            console.error('⚽ [fetchFromAPI] Error:', data.message || data.error || 'Unknown error')
            console.error('⚽ [fetchFromAPI] Full error response:', JSON.stringify(data, null, 2))
            return { success: false, error: data.message || data.error || 'Failed to fetch from API' }
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
        
        // Fetch matches from last 2 days to today + 1 day (to catch matches that started yesterday or today)
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        
        const dateFrom = yesterday.toISOString().split('T')[0]
        const dateTo = tomorrow.toISOString().split('T')[0]
        
        let allLiveMatches = []
        
        // Fetch matches from all leagues and filter for live ones
        for (const league of SUPPORTED_LEAGUES) {
            const result = await fetchFromAPI(`/competitions/${league.code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`)
            
            if (result.success && result.data) {
                // Filter for live matches (IN_PLAY, PAUSED, LIVE)
                // BUT exclude matches that are likely finished (have fullTime scores or are too old)
                const liveMatches = result.data.filter(m => {
                    // Must have live status
                    const hasLiveStatus = m.status === 'IN_PLAY' || m.status === 'PAUSED' || m.status === 'LIVE'
                    if (!hasLiveStatus) return false
                    
                    // Exclude if match has fullTime scores (means it's finished, API just hasn't updated status)
                    const hasFullTimeScore = (m.score?.fullTime?.home !== null && m.score?.fullTime?.home !== undefined) ||
                                           (m.score?.fullTime?.away !== null && m.score?.fullTime?.away !== undefined)
                    if (hasFullTimeScore && m.status !== 'PAUSED') {
                        // If it has fullTime score and not paused (half-time), it's likely finished
                        // Check if match date is more than 2 hours ago
                        const matchDate = new Date(m.utcDate)
                        const now = new Date()
                        const hoursAgo = (now - matchDate) / (1000 * 60 * 60)
                        
                        // If match started more than 2.5 hours ago, it's likely finished
                        if (hoursAgo > 2.5) {
                            console.log(`  ⚠️ Excluding likely finished match: ${m.homeTeam?.name} vs ${m.awayTeam?.name} (${hoursAgo.toFixed(1)}h ago, has fullTime score)`)
                            return false
                        }
                    }
                    
                    return true
                })
                if (liveMatches.length > 0) {
                    console.log(`⚽ [fetchAndUpdateLiveMatches] Found ${liveMatches.length} live matches in ${league.name}`)
                    allLiveMatches.push(...liveMatches.map(m => ({ ...m, leagueInfo: league })))
                }
            }
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
        
        if (allLiveMatches.length === 0) {
            console.log('📭 [fetchAndUpdateLiveMatches] No live matches at the moment')
            return
        }
        
        console.log(`📊 [fetchAndUpdateLiveMatches] Found ${allLiveMatches.length} total live matches`)
        
        for (const matchData of allLiveMatches) {
            // Get previous state
            const previousMatch = await Match.findOne({ fixtureId: matchData.id })
            
            const previousGoalsHome = previousMatch?.goals?.home || 0
            const previousGoalsAway = previousMatch?.goals?.away || 0
            
            // Get current score - prioritize fullTime, fallback to halfTime, then live score
            const currentGoalsHome = matchData.score?.fullTime?.home ?? 
                                     matchData.score?.halfTime?.home ?? 
                                     matchData.score?.regular?.home ??
                                     matchData.score?.live?.home ?? 0
            const currentGoalsAway = matchData.score?.fullTime?.away ?? 
                                     matchData.score?.halfTime?.away ?? 
                                     matchData.score?.regular?.away ??
                                     matchData.score?.live?.away ?? 0
            
            // Fetch detailed match info to get accurate elapsed time
            let detailedMatch = matchData
            try {
                const detailResult = await fetchFromAPI(`/matches/${matchData.id}`)
                if (detailResult.success && detailResult.data) {
                    detailedMatch = detailResult.data
                    console.log(`  📊 [fetchAndUpdateLiveMatches] Fetched details for match ${matchData.id}, status: ${detailedMatch.status}, elapsed: ${detailedMatch.minute || 'N/A'}`)
                }
            } catch (error) {
                console.log(`  ⚠️ [fetchAndUpdateLiveMatches] Could not fetch details for match ${matchData.id}, using basic data`)
            }
            
            // Convert and update match in database
            const convertedMatch = convertMatchFormat(detailedMatch, matchData.leagueInfo)
            
            // Update with actual elapsed time if available
            if (detailedMatch.minute) {
                const elapsed = parseInt(detailedMatch.minute) || null
                if (elapsed !== null) {
                    // Determine status based on elapsed time
                    if (elapsed <= 45) {
                        convertedMatch.fixture.status.short = '1H'
                        convertedMatch.fixture.status.elapsed = elapsed
                    } else if (elapsed <= 90) {
                        convertedMatch.fixture.status.short = '2H'
                        convertedMatch.fixture.status.elapsed = elapsed
                    } else if (elapsed === 45) {
                        convertedMatch.fixture.status.short = 'HT'
                        convertedMatch.fixture.status.elapsed = 45
                    }
                }
            }
            
            convertedMatch.goals.home = currentGoalsHome
            convertedMatch.goals.away = currentGoalsAway
            
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
                        
                        // Update the match in the post data
                        const matchIndex = matchData.findIndex(m => 
                            m.homeTeam?.name === updatedMatch.teams?.home?.name &&
                            m.awayTeam?.name === updatedMatch.teams?.away?.name
                        )
                        
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
            console.log(`📅 [fetchTodayFixtures] Fetching fixtures for ${league.name} (${league.code})...`)
            const result = await fetchFromAPI(`/competitions/${league.code}/matches?dateFrom=${today}&dateTo=${today}`)
            
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
            
            // Small delay to avoid rate limiting (free tier: 10 requests/minute)
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
    
    // Job 1: Fetch live matches every 2 minutes (24/7)
    cron.schedule('*/2 * * * *', async () => {
        console.log('⚽ [CRON] Running live match update...')
        await fetchAndUpdateLiveMatches()
    })
    
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
    
    // Job 6: Refresh post every 10 minutes to ensure users see latest live matches
    cron.schedule('*/10 * * * *', async () => {
        console.log('🔄 [CRON] Refreshing Football post with latest live matches...')
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
    
    console.log('✅ Football Cron Jobs initialized')
    console.log('   - Live matches: Every 2 minutes')
    console.log('   - Daily fixtures: 6 AM UTC')
    console.log('   - Auto-post today\'s matches: 7 AM UTC')
    console.log('   - Startup fetch: Running in 5 seconds...')
}

