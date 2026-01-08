import cron from 'node-cron'
import { Match } from '../models/football.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getAllUserSockets } from '../socket/socket.js'
import mongoose from 'mongoose'
import { autoPostTodayMatches, getFootballAccount, fetchMatchDetails } from '../controller/football.js'

// API-Football configuration
const getAPIKey = () => process.env.FOOTBALL_API_KEY || 'f3ebe896455cab31fc80e859716411df'
const API_BASE_URL = 'https://v3.football.api-sports.io'
const CURRENT_SEASON = new Date().getFullYear()

// Supported leagues and competitions (API-Football league IDs)
const SUPPORTED_LEAGUES = [
    { id: 39, name: 'Premier League', country: 'England' },
    { id: 140, name: 'La Liga', country: 'Spain' },
    { id: 135, name: 'Serie A', country: 'Italy' },
    { id: 78, name: 'Bundesliga', country: 'Germany' },
    { id: 61, name: 'Ligue 1', country: 'France' },
    { id: 2, name: 'UEFA Champions League', country: 'Europe' }
]

// Helper: Convert API-Football match format to our database format
const convertMatchFormat = (fixtureData) => {
    const fixture = fixtureData.fixture
    const league = fixtureData.league
    const teams = fixtureData.teams
    const goals = fixtureData.goals
    const score = fixtureData.score
    
    const statusShort = fixture.status.short || 'NS'
    const statusLong = fixture.status.long || 'Not Started'
    const elapsed = fixture.status.elapsed || null
    
    const homeScore = goals?.home !== null && goals?.home !== undefined 
        ? goals.home 
        : (score?.fulltime?.home !== null && score?.fulltime?.home !== undefined 
            ? score.fulltime.home 
            : null)
    const awayScore = goals?.away !== null && goals?.away !== undefined 
        ? goals.away 
        : (score?.fulltime?.away !== null && score?.fulltime?.away !== undefined 
            ? score.fulltime.away 
            : null)
    
    return {
        fixtureId: fixture.id,
        league: {
            id: league.id,
            name: league.name,
            country: league.country,
            logo: league.logo || '',
            flag: league.flag || '',
            season: league.season
        },
        teams: {
            home: {
                id: teams.home.id,
                name: teams.home.name,
                logo: teams.home.logo || ''
            },
            away: {
                id: teams.away.id,
                name: teams.away.name,
                logo: teams.away.logo || ''
            }
        },
        fixture: {
            date: new Date(fixture.date),
            venue: fixture.venue?.name || '',
            city: fixture.venue?.city || '',
            status: {
                long: statusLong,
                short: statusShort,
                elapsed: elapsed
            }
        },
        goals: {
            home: homeScore,
            away: awayScore
        },
        events: [],
        lastUpdated: new Date()
    }
}

// Helper: Fetch from API-Football API
const fetchFromAPI = async (endpoint) => {
    try {
        const apiKey = getAPIKey()
        const fullUrl = `${API_BASE_URL}${endpoint}`
        console.log('⚽ [fetchFromAPI] Fetching:', fullUrl)
        
        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
                'x-apisports-key': apiKey
            }
        })
        
        console.log('⚽ [fetchFromAPI] Response status:', response.status, response.statusText)
        
        if (response.status === 429) {
            console.error('🚫 [fetchFromAPI] RATE LIMIT HIT!')
            return { success: false, error: 'Rate limit exceeded', rateLimit: true }
        }
        
        const data = await response.json()
        
        if (response.ok && data.response) {
            console.log('⚽ [fetchFromAPI] Success! Found', data.response.length, 'items')
            return { success: true, data: data.response }
        } else {
            const errorMsg = data.errors?.[0]?.message || data.message || 'Unknown error'
            console.error('⚽ [fetchFromAPI] Error:', errorMsg)
            return { success: false, error: errorMsg }
        }
    } catch (error) {
        console.error('⚽ [fetchFromAPI] Fetch Error:', error.message)
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
        
        // API-Football: Get all live matches
        const result = await fetchFromAPI('/fixtures?live=all')
        
        if (result.rateLimit) {
            console.warn('⚠️ [fetchAndUpdateLiveMatches] Rate limit hit, skipping this update')
            return
        }
        
        if (!result.success || !result.data) {
            console.log('📭 [fetchAndUpdateLiveMatches] No live matches found')
            return
        }
        
        // Filter for supported leagues only
        const supportedLeagueIds = SUPPORTED_LEAGUES.map(l => l.id)
        const filteredMatches = result.data.filter(match => 
            supportedLeagueIds.includes(match.league.id)
        )
        
        if (filteredMatches.length === 0) {
            console.log('📭 [fetchAndUpdateLiveMatches] No live matches at the moment')
            return
        }
        
        console.log(`📊 [fetchAndUpdateLiveMatches] Found ${filteredMatches.length} live matches`)
        
        for (const matchData of filteredMatches) {
            // Get previous state
            const convertedMatch = convertMatchFormat(matchData)
            const previousMatch = await Match.findOne({ fixtureId: convertedMatch.fixtureId })
            
            const previousGoalsHome = previousMatch?.goals?.home || 0
            const previousGoalsAway = previousMatch?.goals?.away || 0
            const currentGoalsHome = convertedMatch.goals?.home || 0
            const currentGoalsAway = convertedMatch.goals?.away || 0
            
            // IMPORTANT: Don't fetch events/scorers for live matches (only for finished)
            convertedMatch.events = []
            
            const updatedMatch = await Match.findOneAndUpdate(
                { fixtureId: convertedMatch.fixtureId },
                convertedMatch,
                { upsert: true, new: true }
            )
            
            // Check what changed
            const scoreChanged = (currentGoalsHome !== previousGoalsHome) || (currentGoalsAway !== previousGoalsAway)
            const statusChanged = previousMatch?.fixture?.status?.short !== updatedMatch.fixture?.status?.short
            const elapsedChanged = previousMatch?.fixture?.status?.elapsed !== updatedMatch.fixture?.status?.elapsed
            
            if (scoreChanged || statusChanged || elapsedChanged) {
                console.log(`  🔔 Match update: ${updatedMatch.teams?.home?.name} vs ${updatedMatch.teams?.away?.name}`)
                if (scoreChanged) {
                    console.log(`     Score: ${previousGoalsHome}-${previousGoalsAway} → ${currentGoalsHome}-${currentGoalsAway}`)
                }
                
                // Update post if it exists
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
                        let matchDataArray = []
                        try {
                            matchDataArray = JSON.parse(todayPost.footballData)
                        } catch (e) {
                            console.error('Failed to parse football data:', e)
                        }
                        
                        const matchIndex = matchDataArray.findIndex(m => {
                            const homeName1 = m.homeTeam?.name || m.homeTeam
                            const awayName1 = m.awayTeam?.name || m.awayTeam
                            return homeName1 === updatedMatch.teams?.home?.name && awayName1 === updatedMatch.teams?.away?.name
                        })
                        
                        if (matchIndex !== -1) {
                            matchDataArray[matchIndex] = {
                                ...matchDataArray[matchIndex],
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
                            
                            // Filter out finished matches - only keep live matches
                            const finishedStatuses = ['FT', 'AET', 'PEN', 'CANC', 'POSTP', 'SUSP']
                            const liveMatchesOnly = matchDataArray.filter(m => {
                                const status = m.status?.short || m.status
                                return !finishedStatuses.includes(status)
                            })
                            
                            todayPost.footballData = JSON.stringify(liveMatchesOnly)
                            await todayPost.save()
                            
                            // Emit socket event to update frontend
                            const io = getIO()
                            if (io) {
                                const freshFootballAccount = await User.findById(footballAccount._id).select('followers')
                                const followerIds = freshFootballAccount?.followers?.map(f => f.toString()) || []
                                const socketMap = await getAllUserSockets()
                                let onlineCount = 0
                                
                                followerIds.forEach(followerId => {
                                    const socketData = socketMap[followerId]
                                    if (socketData && socketData.socketId) {
                                        io.to(socketData.socketId).emit('footballMatchUpdate', {
                                            postId: todayPost._id.toString(),
                                            matchData: liveMatchesOnly,
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
        
        const supportedLeagueIds = SUPPORTED_LEAGUES.map(l => l.id)
        let totalFetched = 0
        
        // Fetch fixtures for each supported league
        for (const league of SUPPORTED_LEAGUES) {
            const endpoint = `/fixtures?league=${league.id}&date=${today}&season=${CURRENT_SEASON}`
            const result = await fetchFromAPI(endpoint)
            
            if (result.rateLimit) {
                console.warn(`⚠️ [fetchTodayFixtures] Rate limit hit, skipping`)
                break
            }
            
            if (result.success && result.data) {
                console.log(`📅 [fetchTodayFixtures] Found ${result.data.length} fixtures for ${league.name}`)
                
                for (const matchData of result.data) {
                    const convertedMatch = convertMatchFormat(matchData)
                    await Match.findOneAndUpdate(
                        { fixtureId: convertedMatch.fixtureId },
                        convertedMatch,
                        { upsert: true, new: true }
                    )
                    totalFetched++
                }
            }
            
            // Rate limit protection: Wait 1 second between league requests
            await new Promise(resolve => setTimeout(resolve, 1000))
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
    
    console.log('✅ Football Cron Jobs initialized (API-Football)')
    console.log('   - API: API-Football (v3.football.api-sports.io)')
    console.log('   - Live matches: Smart polling during match hours only')
    console.log('     • Weekends 12:00-22:00 UTC: Every 10 min (~30 calls/day)')
    console.log('     • Weekdays 18:00-22:00 UTC: Every 15 min (~3 calls/day)')
    console.log('     • Off-hours: Hourly check (~12 calls/day)')
    console.log('   - Daily fixtures: 6 AM UTC (1 call/day)')
    console.log('   - Auto-post today\'s matches: 7 AM UTC (1 call)')
    console.log('   - Post refresh: Every 30 minutes (from database, no API calls)')
    console.log('   - Leagues: Premier League (39), La Liga (140), Serie A (135), Bundesliga (78), Ligue 1 (61), Champions League (2)')
    console.log('   - Total: ~45 calls/day')
}

