import cron from 'node-cron'
import { Match } from '../models/football.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getUserSocketMap } from '../socket/socket.js'
import mongoose from 'mongoose'
import { autoPostTodayMatches } from '../controller/football.js'

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

// Get football system account
const getFootballAccount = async () => {
    try {
        let footballAccount = await User.findOne({ username: 'Football' })
        
        if (!footballAccount) {
            footballAccount = new User({
                name: 'Football Live',
                username: 'Football',
                email: 'football@system.app',
                password: Math.random().toString(36),
                bio: '⚽ Live football scores, fixtures & updates from top leagues worldwide 🏆',
                profilePic: 'https://cdn-icons-png.flaticon.com/512/53/53283.png'
            })
            await footballAccount.save()
            console.log('✅ Football system account created')
        }
        
        return footballAccount
    } catch (error) {
        console.error('❌ Error getting football account:', error)
        return null
    }
}

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
        
        const today = new Date().toISOString().split('T')[0]
        let allLiveMatches = []
        
        // Fetch matches from all leagues and filter for live ones
        for (const league of SUPPORTED_LEAGUES) {
            const result = await fetchFromAPI(`/competitions/${league.code}/matches?dateFrom=${today}&dateTo=${today}`)
            
            if (result.success && result.data) {
                // Filter for live matches (IN_PLAY, PAUSED)
                const liveMatches = result.data.filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED')
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
            const currentGoalsHome = matchData.score?.fullTime?.home || matchData.score?.halfTime?.home || 0
            const currentGoalsAway = matchData.score?.fullTime?.away || matchData.score?.halfTime?.away || 0
            
            // Convert and update match in database
            const convertedMatch = convertMatchFormat(matchData, matchData.leagueInfo)
            convertedMatch.goals.home = currentGoalsHome
            convertedMatch.goals.away = currentGoalsAway
            
            const updatedMatch = await Match.findOneAndUpdate(
                { fixtureId: convertedMatch.fixtureId },
                convertedMatch,
                { upsert: true, new: true }
            )
            
            // Emit real-time update to frontend if score or status changed
            const scoreChanged = (currentGoalsHome !== previousGoalsHome) || (currentGoalsAway !== previousGoalsAway)
            const statusChanged = previousMatch?.fixture?.status?.short !== updatedMatch.fixture?.status?.short
            
            if (scoreChanged || statusChanged) {
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
                            
                            // Update post in database
                            todayPost.footballData = JSON.stringify(matchData)
                            await todayPost.save()
                            
                            // Emit socket event to update frontend
                            const io = getIO()
                            if (io) {
                                // Get all followers of Football account
                                const freshFootballAccount = await User.findById(footballAccount._id).select('followers')
                                const followerIds = freshFootballAccount?.followers?.map(f => f.toString()) || []
                                
                                // Emit to all online followers
                                const socketMap = getUserSocketMap()
                                let onlineCount = 0
                                
                                followerIds.forEach(followerId => {
                                    const socketId = socketMap.get(followerId)
                                    if (socketId) {
                                        io.to(socketId).emit('footballMatchUpdate', {
                                            postId: todayPost._id.toString(),
                                            matchData: matchData
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

