import cron from 'node-cron'
import { Match } from '../models/football.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import Follow from '../models/follow.js'
import { getIO, getAllUserSockets, getUserSocketMap } from '../socket/socket.js'
import mongoose from 'mongoose'
import { autoPostTodayMatches, getFootballAccount, fetchMatchDetails } from '../controller/football.js'
import { 
    getCachedLiveMatches, 
    setCachedLiveMatches,
    getCachedMatchDetails,
    setCachedMatchDetails,
    getCacheStats
} from './footballCache.js'

// football-data.org API configuration
// API token from www.football-data.org
const getAPIKey = () => '5449eacc047c4b529267d309d166d09b'
const API_BASE_URL = 'https://api.football-data.org/v4'
const CURRENT_SEASON = new Date().getFullYear()

// Supported leagues and competitions (football-data.org competition codes)
const SUPPORTED_LEAGUES = [
    { id: 'PL', name: 'Premier League', country: 'England' },
    { id: 'PD', name: 'La Liga', country: 'Spain' },
    { id: 'SA', name: 'Serie A', country: 'Italy' },
    { id: 'BL1', name: 'Bundesliga', country: 'Germany' },
    { id: 'FL1', name: 'Ligue 1', country: 'France' },
    { id: 'CL', name: 'UEFA Champions League', country: 'Europe' }
]

// football-data.org competition numeric IDs for common competitions (used when `competition.code` is missing)
// Source: football-data.org v4 competition IDs
const COMPETITION_ID_TO_CODE = {
    2021: 'PL',  // Premier League
    2014: 'PD',  // La Liga
    2019: 'SA',  // Serie A
    2002: 'BL1', // Bundesliga
    2015: 'FL1', // Ligue 1
    2001: 'CL'   // UEFA Champions League
}

const getCompetitionCode = (matchData) => {
    const comp = matchData?.competition || matchData?.league || {}
    const code = comp.code || comp.id || comp.leagueCode
    if (typeof code === 'string') return code
    if (typeof code === 'number') return COMPETITION_ID_TO_CODE[code] || null
    if (typeof comp?.id === 'number') return COMPETITION_ID_TO_CODE[comp.id] || null
    return null
}

// Status code mapping
const STATUS_MAP = {
    'SCHEDULED': { short: 'NS', long: 'Not Started' },
    'LIVE': { short: '1H', long: 'First Half' },
    'IN_PLAY': { short: '2H', long: 'Second Half' },
    'PAUSED': { short: 'HT', long: 'Half Time' },
    'FINISHED': { short: 'FT', long: 'Full Time' },
    'POSTPONED': { short: 'POSTP', long: 'Postponed' },
    'SUSPENDED': { short: 'SUSP', long: 'Suspended' },
    'CANCELLED': { short: 'CANC', long: 'Cancelled' }
}

// Helper: Convert football-data.org match format to our database format
const convertMatchFormat = (matchData) => {
    const competition = matchData.competition || {}
    const area = competition.area || {}
    
    // Map football-data.org status to our internal format
    const apiStatus = matchData.status || 'SCHEDULED'
    const statusMapping = STATUS_MAP[apiStatus] || STATUS_MAP['SCHEDULED']
    const statusShort = statusMapping.short
    const statusLong = statusMapping.long
    
    // Calculate elapsed time for live matches
    let elapsed = null
    if (apiStatus === 'LIVE' || apiStatus === 'IN_PLAY') {
        const matchStart = new Date(matchData.utcDate)
        const now = new Date()
        const diffMs = now - matchStart
        const diffMinutes = Math.floor(diffMs / (1000 * 60))
        elapsed = Math.max(0, Math.min(diffMinutes, 90))
    } else if (apiStatus === 'PAUSED') {
        elapsed = 45
    }
    
    // Get scores
    const score = matchData.score || {}
    const fullTime = score.fullTime || {}
    const homeScore = fullTime.home !== null && fullTime.home !== undefined ? fullTime.home : null
    const awayScore = fullTime.away !== null && fullTime.away !== undefined ? fullTime.away : null
    
    // Ensure fixtureId is always a number (football-data.org API returns numbers)
    // Handle case where it might be a string (e.g., from database or conversion)
    const fixtureId = typeof matchData.id === 'string' 
        ? parseInt(matchData.id, 10) 
        : Number(matchData.id)
    
    if (isNaN(fixtureId)) {
        console.warn(`⚠️ [convertMatchFormat] Invalid fixtureId from matchData.id: ${matchData.id}`)
    }
    
    return {
        fixtureId: fixtureId,
        league: {
            id: competition.id || competition.code || '',
            name: competition.name || 'Unknown League',
            country: area.name || 'Unknown',
            logo: competition.emblem || '',
            flag: area.flag || '',
            season: CURRENT_SEASON
        },
        teams: {
            home: {
                id: matchData.homeTeam?.id || 0,
                name: matchData.homeTeam?.name || 'Unknown Team',
                logo: matchData.homeTeam?.crest || ''
            },
            away: {
                id: matchData.awayTeam?.id || 0,
                name: matchData.awayTeam?.name || 'Unknown Team',
                logo: matchData.awayTeam?.crest || ''
            }
        },
        fixture: {
            date: new Date(matchData.utcDate || matchData.date || new Date()),
            venue: matchData.venue || '',
            city: '',
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

// Helper: Fetch from football-data.org API
const fetchFromAPI = async (endpoint) => {
    try {
        const apiKey = getAPIKey()
        if (!apiKey) {
            console.error('⚽ [fetchFromAPI] No API key configured!')
            return { success: false, error: 'API key not configured', rateLimit: false }
        }
        
        const fullUrl = `${API_BASE_URL}${endpoint}`
        console.log('⚽ [fetchFromAPI] Fetching:', fullUrl)
        
        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
                'X-Auth-Token': apiKey
            }
        })
        
        console.log('⚽ [fetchFromAPI] Response status:', response.status, response.statusText)
        
        if (response.status === 429) {
            console.error('🚫 [fetchFromAPI] RATE LIMIT HIT!')
            return { success: false, error: 'Rate limit exceeded', rateLimit: true }
        }
        
        if (response.status === 401) {
            console.error('🔑 [fetchFromAPI] Authentication failed!')
            return { success: false, error: 'API key authentication failed', rateLimit: false }
        }
        
        const data = await response.json()
        
        // Check for API errors
        if (data.errorCode || data.message) {
            const errorMsg = data.message || `Error ${data.errorCode || 'Unknown'}`
            console.error('⚽ [fetchFromAPI] API Error:', errorMsg)
            if (errorMsg.toLowerCase().includes('rate limit') || errorMsg.toLowerCase().includes('quota')) {
                return { success: false, error: errorMsg, rateLimit: true }
            }
            return { success: false, error: errorMsg }
        }
        
        if (response.ok && data) {
            const matches = data.matches || (Array.isArray(data) ? data : [data])
            console.log('⚽ [fetchFromAPI] Success! Found', matches.length, 'items')
            return { success: true, data: matches }
        } else {
            const errorMsg = data.message || `HTTP ${response.status}: ${response.statusText}`
            console.error('⚽ [fetchFromAPI] Error:', errorMsg, 'Status:', response.status)
            return { success: false, error: errorMsg }
        }
    } catch (error) {
        console.error('⚽ [fetchFromAPI] Fetch Error:', error.message)
        return { success: false, error: error.message }
    }
}

// getFootballAccount is imported from '../controller/football.js' - no need to redeclare

// Helper: Update feed post when matches finish (check database for finished matches)
const updateFeedPostWhenMatchesFinish = async () => {
    try {
        const footballAccount = await getFootballAccount()
        if (!footballAccount) return
        
        const now = new Date()
        const todayStart = new Date(now.setHours(0, 0, 0, 0))
        const todayEnd = new Date(now.setHours(23, 59, 59, 999))
        
        // Find today's feed post
        const todayPost = await Post.findOne({
            postedBy: footballAccount._id,
            footballData: { $exists: true, $ne: null },
            createdAt: { 
                $gte: todayStart,
                $lte: todayEnd
            }
        }).sort({ createdAt: -1 })
        
        if (!todayPost) return
        
        let matchDataArray = []
        try {
            matchDataArray = JSON.parse(todayPost.footballData || '[]')
        } catch (e) {
            console.error('Failed to parse football data:', e)
            return
        }
        
        if (matchDataArray.length === 0) return
        
        // Check each match in post to see if it finished in database
        const updatedMatches = []
        let hasChanges = false
        
        for (const match of matchDataArray) {
            const homeName = match.homeTeam?.name || match.homeTeam
            const awayName = match.awayTeam?.name || match.awayTeam
            
            // Find match in database
            const dbMatch = await Match.findOne({
                'teams.home.name': homeName,
                'teams.away.name': awayName,
                'fixture.date': { $gte: todayStart, $lte: todayEnd }
            })
            
            if (dbMatch) {
                const status = dbMatch.fixture?.status?.short
                const finishedStatuses = ['FT', 'AET', 'PEN', 'CANC', 'POSTP', 'SUSP']
                const isFinished = finishedStatuses.includes(status)
                
                // Only keep live matches
                if (!isFinished) {
                    updatedMatches.push({
                        ...match,
                        score: {
                            home: dbMatch.goals?.home ?? 0,
                            away: dbMatch.goals?.away ?? 0
                        },
                        status: {
                            short: dbMatch.fixture?.status?.short,
                            long: dbMatch.fixture?.status?.long,
                            elapsed: dbMatch.fixture?.status?.elapsed
                        }
                    })
                } else {
                    hasChanges = true
                    console.log(`  🏁 Match finished in feed post: ${homeName} vs ${awayName} (${status})`)
                }
            } else {
                // Match not found, keep it for now
                updatedMatches.push(match)
            }
        }
        
        // If matches finished, update or delete post
        if (hasChanges) {
            if (updatedMatches.length === 0) {
                // All matches finished, delete post and create "no matches" post
                console.log('  🏁 All matches finished, deleting feed post and creating "no matches" post...')
                await Post.findByIdAndDelete(todayPost._id)
                
                // Create "no matches" post
                const { autoPostTodayMatches } = await import('../controller/football.js')
                await autoPostTodayMatches()
            } else {
                // Some matches finished, update post with remaining live matches
                todayPost.footballData = JSON.stringify(updatedMatches)
                await todayPost.save()
                
                // Emit socket event
                const io = getIO()
                if (io) {
                    const freshFootballAccount = await User.findById(footballAccount._id).select('followers')
                    const followerIds = freshFootballAccount?.followers?.map(f => f.toString()) || []
                    const socketMap = await getAllUserSockets()
                    
                    followerIds.forEach(followerId => {
                        const socketData = socketMap[followerId]
                        if (socketData && socketData.socketId) {
                            io.to(socketData.socketId).emit('footballMatchUpdate', {
                                postId: todayPost._id.toString(),
                                matchData: updatedMatches,
                                updatedAt: new Date()
                            })
                        }
                    })
                }
                
                console.log(`  ✅ Updated feed post: Removed finished matches, ${updatedMatches.length} live matches remaining`)
            }
        }
    } catch (error) {
        console.error('❌ Error updating feed post when matches finish:', error)
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
        
        // Emit to followers (using scalable Follow collection)
        const io = getIO()
        if (io) {
            // Use scalable Follow collection instead of footballAccount.followers array
            const followerDocs = await Follow.find({ followeeId: footballAccount._id }).select('followerId').limit(5000).lean()
            const followerIds = followerDocs.map(doc => doc.followerId.toString())
            
            if (followerIds.length > 0) {
                const userSocketMap = getUserSocketMap()
                const onlineFollowers = []
                
                followerIds.forEach(followerId => {
                    const socketData = userSocketMap[followerId]
                    if (socketData && socketData.socketId) {
                        onlineFollowers.push(socketData.socketId)
                    }
                })
                
                if (onlineFollowers.length > 0) {
                    io.to(onlineFollowers).emit("newPost", newPost)
                    console.log(`✅ Emitted match update to ${onlineFollowers.length} online followers (out of ${followerIds.length} total)`)
                } else {
                    console.log(`📭 No online followers for match update (${followerIds.length} total followers, 0 online)`)
                }
            } else {
                console.log(`📭 No followers found for Football account`)
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
        const isDev = process.env.NODE_ENV !== 'production'
        if (isDev) {
            console.log('⚽ [fetchAndUpdateLiveMatches] Fetching live matches...')
        }
        
        // Get date range for today
        const now = new Date()
        const todayStart = new Date(now.setHours(0, 0, 0, 0))
        const todayEnd = new Date(now.setHours(23, 59, 59, 999))
        
        // IMPROVED: Detect finished matches by comparing database with /matches?status=LIVE response
        // This is much more efficient than checking each match individually!
        
        // NOW: Fetch currently live matches from API (with caching)
        // Check cache first to avoid unnecessary API calls
        let cachedMatches = getCachedLiveMatches()
        
        if (cachedMatches) {
            // Only log cache hits in dev (less noisy)
            if (isDev) {
                console.log('📦 Using cached live matches (saving API call!)')
            }
            // Use cached data but still update database and feed post
            // This reduces API calls while keeping data fresh
        } else if (isDev) {
            console.log('🌐 Cache miss - fetching from API...')
        }
        
        // Only fetch from API if cache is expired or doesn't exist
        let result = { success: false, data: null }
        if (!cachedMatches) {
            result = await fetchFromAPI('/matches?status=LIVE')
            
            if (result.rateLimit) {
                console.warn('⚠️ [fetchAndUpdateLiveMatches] Rate limit hit, skipping this update')
                // Try to use database matches as fallback
                const dbMatches = await Match.find({
                    'fixture.date': { $gte: todayStart, $lte: todayEnd },
                    'fixture.status.short': { $in: ['1H', '2H', 'HT', 'ET', 'P', 'BT'] }
                }).limit(10)
                
                if (dbMatches.length > 0) {
                    console.log(`📦 [fetchAndUpdateLiveMatches] Using ${dbMatches.length} database matches as fallback`)
                    // Database matches are already in our format, just use them directly
                    result = { success: true, data: dbMatches }
                } else {
                    return
                }
            }
            
            if (!result.success || !result.data) {
                if (isDev) {
                    console.log('📭 No live matches found in API')
                }
                // Check if we need to update feed post (remove finished matches)
                await updateFeedPostWhenMatchesFinish()
                return
            }
            
            // Cache the API response for 30 seconds
            setCachedLiveMatches(result.data)
        } else {
            // Use cached data but convert to same format
            result = { success: true, data: cachedMatches }
        }
        
        // Filter for supported leagues only.
        // IMPORTANT: football-data.org sometimes returns `competition.id` (number) and sometimes `competition.code` (string).
        // We accept both by mapping known numeric IDs -> codes.
        const supportedLeagueCodes = new Set(SUPPORTED_LEAGUES.map(l => l.id))
        const filteredMatches = result.data.filter(match => {
            const compCode = getCompetitionCode(match)
            return !!compCode && supportedLeagueCodes.has(compCode)
        })
        
        if (isDev && filteredMatches.length > 0) {
            console.log(`📊 Found ${filteredMatches.length} live matches`)
        }
        
        // Get all fixture IDs from live matches to detect finished ones
        const liveFixtureIds = new Set()
        for (const matchData of filteredMatches) {
            const fixtureId = matchData.id || matchData.fixtureId
            if (fixtureId) {
                liveFixtureIds.add(fixtureId)
            }
        }
        
        // Detect finished matches: If match was in database as live but NOT in live API response, it finished
        // This is MUCH more efficient than checking each match individually with API calls!
        const previouslyLiveMatches = await Match.find({
            'fixture.date': { $gte: todayStart, $lte: todayEnd },
            'fixture.status.short': { $in: ['1H', '2H', 'HT', 'ET', 'P', 'BT', 'LIVE', 'IN_PLAY', 'PAUSED'] }
        })
        
        for (const dbMatch of previouslyLiveMatches) {
            // If match was live but not in current live response, it finished
            // Ensure fixtureId is a number for comparison
            const dbFixtureId = typeof dbMatch.fixtureId === 'string' 
                ? parseInt(dbMatch.fixtureId, 10) 
                : Number(dbMatch.fixtureId)
            
            if (isNaN(dbFixtureId)) {
                console.warn(`⚠️ [fetchAndUpdateLiveMatches] Invalid dbMatch.fixtureId: ${dbMatch.fixtureId}, skipping`)
                continue
            }
            
            if (!liveFixtureIds.has(dbFixtureId)) {
                console.log(`  🏁 Match finished (not in live response): ${dbMatch.teams?.home?.name} vs ${dbMatch.teams?.away?.name}`)
                
                // Update database status to FT
                await Match.findOneAndUpdate(
                    { fixtureId: dbFixtureId },
                    { 
                        'fixture.status.short': 'FT',
                        'fixture.status.long': 'Full Time',
                        'fixture.status.elapsed': 90
                    }
                )
            }
        }
        
        // Process live matches and update database/feed post
        for (const matchData of filteredMatches) {
            // Get previous state
            const convertedMatch = convertMatchFormat(matchData)
            
            // Ensure fixtureId is a number (not a string/ObjectId)
            const fixtureIdNum = typeof convertedMatch.fixtureId === 'string' 
                ? parseInt(convertedMatch.fixtureId, 10) 
                : Number(convertedMatch.fixtureId)
            
            if (isNaN(fixtureIdNum)) {
                console.warn(`⚠️ [fetchAndUpdateLiveMatches] Invalid fixtureId: ${convertedMatch.fixtureId}, skipping match`)
                continue
            }
            
            const previousMatch = await Match.findOne({ fixtureId: fixtureIdNum })
            
            const previousGoalsHome = previousMatch?.goals?.home || 0
            const previousGoalsAway = previousMatch?.goals?.away || 0
            const currentGoalsHome = convertedMatch.goals?.home || 0
            const currentGoalsAway = convertedMatch.goals?.away || 0
            
            // IMPORTANT: Don't fetch events/scorers for live matches (only for finished)
            convertedMatch.events = []
            
            // Ensure convertedMatch has numeric fixtureId
            const matchToSave = {
                ...convertedMatch,
                fixtureId: fixtureIdNum
            }
            
            const updatedMatch = await Match.findOneAndUpdate(
                { fixtureId: fixtureIdNum },
                matchToSave,
                { upsert: true, new: true }
            )
            
            // Check what changed
            const scoreChanged = (currentGoalsHome !== previousGoalsHome) || (currentGoalsAway !== previousGoalsAway)
            const statusChanged = previousMatch?.fixture?.status?.short !== updatedMatch.fixture?.status?.short
            const elapsedChanged = previousMatch?.fixture?.status?.elapsed !== updatedMatch.fixture?.status?.elapsed
            
            // Always update database for elapsed time changes, but only emit socket for score/status changes
            // This prevents the post from moving to top on every time update
            const shouldEmitSocket = scoreChanged || statusChanged
            
            if (scoreChanged || statusChanged || elapsedChanged) {
                console.log(`  🔔 Match update: ${updatedMatch.teams?.home?.name} vs ${updatedMatch.teams?.away?.name}`)
                if (scoreChanged) {
                    console.log(`     Score: ${previousGoalsHome}-${previousGoalsAway} → ${currentGoalsHome}-${currentGoalsAway}`)
                }
                if (elapsedChanged && !scoreChanged && !statusChanged) {
                    console.log(`     Time: ${previousMatch?.fixture?.status?.elapsed || '?'}' → ${updatedMatch.fixture?.status?.elapsed || '?'}' (silent update)`)
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
                            const finishedStatuses = ['FT', 'FINISHED', 'AET', 'PEN', 'CANC', 'POSTP', 'SUSP']
                            const liveMatchesOnly = matchDataArray.filter(m => {
                                const status = m.status?.short || m.status
                                return !finishedStatuses.includes(status)
                            })
                            
                            // If all matches finished, delete the post or create "no matches" post
                            if (liveMatchesOnly.length === 0) {
                                console.log('  🏁 All matches finished, deleting feed post...')
                                await Post.findByIdAndDelete(todayPost._id)
                                
                                // Create "no matches" post
                                const { autoPostTodayMatches } = await import('../controller/football.js')
                                await autoPostTodayMatches()
                            } else {
                                todayPost.footballData = JSON.stringify(liveMatchesOnly)
                                await todayPost.save()
                                
                                // Emit socket event to update frontend ONLY if score or status changed
                                // This prevents post from moving to top on every time update
                                if (shouldEmitSocket) {
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
                                        
                                        console.log(`  ✅ Emitted match update to ${onlineCount} online followers (score/status changed)`)
                                    }
                                } else {
                                    // Silent update - just saved to database, no socket emit
                                    // Client-side timer will handle elapsed time updates
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Update feed post (removes finished matches from post)
        // This uses database comparison, not API calls
        await updateFeedPostWhenMatchesFinish()
        
        // Emit real-time update to Football page (live, upcoming, finished matches)
        await emitFootballPageUpdate()
        
    } catch (error) {
        console.error('❌ Error in fetchAndUpdateLiveMatches:', error)
    }
}

// Export function to emit real-time updates to Football page
export const emitFootballPageUpdate = async () => {
    try {
        const io = getIO()
        if (!io) {
            console.error('⚠️ [emitFootballPageUpdate] Socket.IO not available - make sure socket is initialized before cron jobs start!')
            return
        }
        
        // Check if socket is actually connected (keep this check - it's useful)
        const clientCount = io.engine?.clientsCount || 0
        
        // Only log detailed info in development
        const isDev = process.env.NODE_ENV !== 'production'
        if (isDev && clientCount > 0) {
            console.log(`📡 [emitFootballPageUpdate] Broadcasting to ${clientCount} clients`)
        }
        
        // Fetch live matches (today)
        const today = new Date().toISOString().split('T')[0]
        const todayStart = new Date(today)
        todayStart.setHours(0, 0, 0, 0)
        const todayEnd = new Date(todayStart)
        todayEnd.setHours(23, 59, 59, 999)
        
        const liveMatches = await Match.find({
            'fixture.status.short': { $in: ['1H', '2H', 'HT', 'ET', 'P', 'LIVE', 'IN_PLAY', 'PAUSED'] },
            'fixture.date': { $gte: todayStart, $lt: todayEnd }
        })
        .sort({ 'fixture.date': -1 })
        .limit(50)
        .lean()
        
        // Fetch upcoming matches (next 7 days)
        const nextWeek = new Date()
        nextWeek.setDate(nextWeek.getDate() + 7)
        const upcomingMatches = await Match.find({
            'fixture.status.short': { $in: ['NS', 'SCHEDULED'] },
            'fixture.date': { $gte: new Date(), $lt: nextWeek }
        })
        .sort({ 'fixture.date': 1 })
        .limit(50)
        .lean()
        
        // Fetch finished matches (last 3 days)
        const threeDaysAgo = new Date()
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
        const finishedMatches = await Match.find({
            'fixture.status.short': { $in: ['FT', 'FINISHED'] },
            'fixture.date': { $gte: threeDaysAgo, $lt: new Date() }
        })
        .sort({ 'fixture.date': -1 })
        .limit(50)
        .lean()
        
        // Fetch events for finished matches if missing (lazy load - only first 10 to avoid delays)
        const finishedToProcess = finishedMatches.slice(0, 10)
        for (const match of finishedToProcess) {
            if (!match.events || match.events.length === 0) {
                try {
                    const matchDetails = await fetchMatchDetails(match.fixtureId, true)
                    if (matchDetails && matchDetails.events && matchDetails.events.length > 0) {
                        match.events = matchDetails.events
                        // Save to database for future queries
                        await Match.findByIdAndUpdate(match._id, { events: matchDetails.events })
                    }
                } catch (error) {
                    // Silent fail - events will be fetched on-demand when user views match
                }
            }
        }
        
        const data = {
            live: liveMatches,
            upcoming: upcomingMatches,
            finished: finishedMatches,
            updatedAt: new Date()
        }
        
        // Broadcast to all connected users (no filtering needed - public data)
        // IMPORTANT: Always emit even when using cached data (cache only affects API calls, not socket emissions)
        io.emit('footballPageUpdate', data)
        
        // Only log success in development (errors always logged)
        // Note: isDev already declared at top of function
        if (isDev && clientCount > 0) {
            console.log(`✅ Broadcasted: ${liveMatches.length} live, ${upcomingMatches.length} upcoming, ${finishedMatches.length} finished`)
        }
        
    } catch (error) {
        // Always log errors (important for debugging)
        console.error('❌ [emitFootballPageUpdate] Error:', error.message)
        if (process.env.NODE_ENV !== 'production') {
            console.error('   Stack:', error.stack)
        }
    }
}

// 2. Fetch today's fixtures (runs once daily)
const fetchTodayFixtures = async () => {
    try {
        console.log('📅 [fetchTodayFixtures] Starting to fetch fixtures...')
        
        const todayDate = new Date()
        const today = todayDate.toISOString().split('T')[0] // YYYY-MM-DD
        console.log('📅 [fetchTodayFixtures] Today\'s date:', today)
        
        // Fetch for past 3 days (finished) and next 7 days (upcoming) to populate database
        const startDate = new Date(todayDate)
        startDate.setDate(startDate.getDate() - 3) // 3 days ago
        const startDateStr = startDate.toISOString().split('T')[0]
        
        const endDate = new Date(todayDate)
        endDate.setDate(endDate.getDate() + 7) // 7 days ahead
        const endDateStr = endDate.toISOString().split('T')[0]
        
        console.log(`📅 [fetchTodayFixtures] Fetching fixtures from ${startDateStr} to ${endDateStr} (10-day range)`)
        
        const supportedLeagueIds = SUPPORTED_LEAGUES.map(l => l.id)
        let totalFetched = 0
        
        // Fetch fixtures for each supported league
        for (const league of SUPPORTED_LEAGUES) {
            // football-data.org: /competitions/{code}/matches?dateFrom={date}&dateTo={date}
            const endpoint = `/competitions/${league.id}/matches?dateFrom=${startDateStr}&dateTo=${endDateStr}`
            const result = await fetchFromAPI(endpoint)
            
            if (result.rateLimit) {
                console.warn(`⚠️ [fetchTodayFixtures] Rate limit hit, skipping`)
                break
            }
            
            if (result.success && result.data) {
                console.log(`📅 [fetchTodayFixtures] Found ${result.data.length} fixtures for ${league.name}`)
                
                for (const matchData of result.data) {
                    const convertedMatch = convertMatchFormat(matchData)
                    
                    // Ensure fixtureId is a number
                    const fixtureIdNum = typeof convertedMatch.fixtureId === 'string' 
                        ? parseInt(convertedMatch.fixtureId, 10) 
                        : Number(convertedMatch.fixtureId)
                    
                    if (isNaN(fixtureIdNum)) {
                        console.warn(`⚠️ [fetchTodayFixtures] Invalid fixtureId: ${convertedMatch.fixtureId}, skipping match`)
                        continue
                    }
                    
                    // Ensure convertedMatch has numeric fixtureId
                    const matchToSave = {
                        ...convertedMatch,
                        fixtureId: fixtureIdNum
                    }
                    
                    const updatedMatch = await Match.findOneAndUpdate(
                        { fixtureId: fixtureIdNum },
                        matchToSave,
                        { upsert: true, new: true }
                    )
                    totalFetched++
                    // Log first few matches to verify database updates
                    if (totalFetched <= 3) {
                        console.log(`  ✅ [fetchTodayFixtures] Saved match to DB: ${convertedMatch.teams?.home?.name} vs ${convertedMatch.teams?.away?.name} (${convertedMatch.fixture?.status?.short})`)
                    }
                }
            }
            
            // Rate limit protection: Wait 7 seconds between league requests (10 req/min = 6 sec between, use 7 for safety)
            await new Promise(resolve => setTimeout(resolve, 7000))
        }
        
        console.log(`✅ [fetchTodayFixtures] Fetched ${totalFetched} fixtures (past 3 days + next 7 days)`)
        
        // Verify database has matches
        const dbMatchCount = await Match.countDocuments({
            'fixture.date': { 
                $gte: new Date(startDateStr),
                $lte: new Date(endDateStr)
            }
        })
        console.log(`✅ [fetchTodayFixtures] Database now has ${dbMatchCount} matches in date range`)
        
        // Emit real-time update to Football page after fetching fixtures
        console.log(`📡 [fetchTodayFixtures] Emitting footballPageUpdate to clients...`)
        await emitFootballPageUpdate()
        
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
    
    // OPTIMIZED FOR FOOTBALL-DATA.ORG FREE TIER (10 requests/minute = 600/hour = 14,400/day max)
    // Strategy: Longer cache (60s) + Smart polling = Maximum API savings
    // Cache TTL (60s) means cache refreshes every minute
    // Weekend matches (Saturday & Sunday): Poll every 2 minutes during 12:00-22:00 UTC
    // With cache: ~10 hours × 30 calls/hour = 300 calls for 2 days = ~150 calls/day average
    // BUT: Cache serves all users, so actual API usage = ~150 calls/day (well under limit!)
    // Only log detailed debug info in development
    const isDev = process.env.NODE_ENV !== 'production'
    
    // IMPORTANT: football-data.org free tier = 10 requests/minute
    // So we can poll every 6 seconds maximum, but we'll be more conservative
    // Poll every 2 minutes during match hours (30 requests/hour = safe)
    cron.schedule('*/2 12-22 * * 6,0', async () => {
        if (isDev) {
            const timestamp = new Date().toLocaleString('en-US', { timeZone: 'UTC' })
            console.log(`⚽ [CRON] Running live match update (weekend: every 2 min) - ${timestamp} UTC`)
        }
        await fetchAndUpdateLiveMatches()
    })
    
    // Weekday evening matches (Mon-Fri): Poll every 2 minutes during 18:00-22:00 UTC
    cron.schedule('*/2 18-22 * * 1-5', async () => {
        if (isDev) {
            const timestamp = new Date().toLocaleString('en-US', { timeZone: 'UTC' })
            console.log(`⚽ [CRON] Running live match update (weekday: every 2 min) - ${timestamp} UTC`)
        }
        await fetchAndUpdateLiveMatches()
    })
    
    // Off-hours check: Every 10 minutes during non-match hours
    cron.schedule('*/10 0-11,23 * * *', async () => {
        if (isDev) {
            const timestamp = new Date().toLocaleString('en-US', { timeZone: 'UTC' })
            console.log(`⚽ [CRON] Running live match update (off-hours: every 10 min) - ${timestamp} UTC`)
        }
        await fetchAndUpdateLiveMatches()
    })
    
    // Total: ~150 (weekends) + ~30 (weekdays) + ~144 (off-hours) = ~324 calls/day
    // Plus daily fixtures (~6 leagues × 1 call) = ~330 calls/day total
    // This is well under the 14,400/day free tier limit! ✅
    
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
    
    console.log('✅ Football Cron Jobs initialized (football-data.org)')
    console.log('   - API: football-data.org (api.football-data.org/v4)')
    console.log('   - Live matches: Smart polling during match hours only')
    console.log('     • Weekends 12:00-22:00 UTC: Every 2 min (~300 calls/day)')
    console.log('     • Weekdays 18:00-22:00 UTC: Every 2 min (~60 calls/day)')
    console.log('     • Off-hours: Every 10 min (~144 calls/day)')
    console.log('   - Daily fixtures: 6 AM UTC (~6 calls/day)')
    console.log('   - Auto-post today\'s matches: 7 AM UTC (1 call)')
    console.log('   - Post refresh: Every 30 minutes (from database, no API calls)')
    console.log('   - Leagues: Premier League (PL), La Liga (PD), Serie A (SA), Bundesliga (BL1), Ligue 1 (FL1), Champions League (CL)')
    console.log('   - Total: ~330 calls/day (well under 14,400/day free tier limit)')
}

