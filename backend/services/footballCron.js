import cron from 'node-cron'
import { Match } from '../models/football.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getAllUserSockets } from '../socket/socket.js'
import mongoose from 'mongoose'
import { autoPostTodayMatches, getFootballAccount, fetchMatchDetails } from '../controller/football.js'

// TheSportsDB API configuration (FREE - 30 requests/minute)
// Free API key: 123 (or use premium key from .env)
const getAPIKey = () => process.env.THESPORTSDB_API_KEY || '123' // Default to free key
const API_BASE_URL = 'https://www.thesportsdb.com/api/v1/json'
const CURRENT_SEASON = '2024-2025' // Format: YYYY-YYYY

// Supported leagues and competitions (TheSportsDB league IDs)
// Premier League = 4328, La Liga = 4335, Serie A = 4332
const SUPPORTED_LEAGUES = [
    { id: 4328, name: 'Premier League', country: 'England' },      // Premier League
    { id: 4335, name: 'La Liga', country: 'Spain' },                // La Liga (Spanish)
    { id: 4332, name: 'Serie A', country: 'Italy' }                 // Serie A (Italian)
]

// Helper: Convert TheSportsDB match format to our database format
const convertMatchFormat = (eventData, leagueInfo) => {
    // TheSportsDB uses: strStatus (Live, NotStarted, HalfTime, Finished, etc.)
    const statusStr = eventData.strStatus || 'Not Started'
    
    // Map TheSportsDB status to our format
    let statusShort = 'NS'
    let statusLong = statusStr
    let elapsed = null
    
    if (statusStr.includes('Live') || statusStr.includes('1H') || statusStr.includes('2H')) {
        statusShort = statusStr.includes('1H') ? '1H' : statusStr.includes('2H') ? '2H' : '1H'
        statusLong = statusStr
        // Try to extract elapsed time from status
        const timeMatch = statusStr.match(/(\d+)\s*'/i)
        if (timeMatch) elapsed = parseInt(timeMatch[1])
    } else if (statusStr.includes('Half Time') || statusStr === 'Half Time') {
        statusShort = 'HT'
        statusLong = 'Half Time'
        elapsed = 45
    } else if (statusStr.includes('Finished') || statusStr === 'FT') {
        statusShort = 'FT'
        statusLong = 'Match Finished'
        elapsed = 90
    } else if (statusStr.includes('Postponed') || statusStr === 'Postponed') {
        statusShort = 'POSTP'
        statusLong = 'Postponed'
    } else if (statusStr.includes('Cancelled') || statusStr === 'Cancelled') {
        statusShort = 'CANC'
        statusLong = 'Cancelled'
    }
    
    // Parse score from strScore or intHomeScore/intAwayScore
    let homeScore = null
    let awayScore = null
    if (eventData.strScore) {
        const scoreMatch = eventData.strScore.match(/(\d+)\s*-\s*(\d+)/)
        if (scoreMatch) {
            homeScore = parseInt(scoreMatch[1])
            awayScore = parseInt(scoreMatch[2])
        }
    } else {
        homeScore = eventData.intHomeScore !== null ? parseInt(eventData.intHomeScore) : null
        awayScore = eventData.intAwayScore !== null ? parseInt(eventData.intAwayScore) : null
    }
    
    return {
        fixtureId: eventData.idEvent || eventData.idEvent,
        league: {
            id: eventData.idLeague || leagueInfo?.id || 0,
            name: eventData.strLeague || leagueInfo?.name || 'Unknown League',
            country: eventData.strCountry || leagueInfo?.country || 'Unknown',
            logo: eventData.strBadge || '',
            flag: '',
            season: eventData.strSeason || CURRENT_SEASON
        },
        teams: {
            home: {
                id: eventData.idHomeTeam || 0,
                name: eventData.strHomeTeam || 'Unknown',
                logo: eventData.strHomeTeamBadge || ''
            },
            away: {
                id: eventData.idAwayTeam || 0,
                name: eventData.strAwayTeam || 'Unknown',
                logo: eventData.strAwayTeamBadge || ''
            }
        },
        fixture: {
            date: new Date(eventData.dateEvent + ' ' + (eventData.strTime || '00:00:00')),
            venue: eventData.strVenue || '',
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

// Helper: Fetch from TheSportsDB API
const fetchFromAPI = async (endpoint) => {
    try {
        const apiKey = getAPIKey()
        // TheSportsDB uses API key in URL path: /api/v1/json/{API_KEY}/endpoint.php
        const fullUrl = `${API_BASE_URL}/${apiKey}/${endpoint}`
        console.log('⚽ [fetchFromAPI] Fetching:', fullUrl)
        
        const response = await fetch(fullUrl, {
            method: 'GET'
        })
        
        console.log('⚽ [fetchFromAPI] Response status:', response.status, response.statusText)
        
        // Handle rate limit (429 status)
        if (response.status === 429) {
            console.error('🚫 [fetchFromAPI] RATE LIMIT HIT! (30 requests/minute for free tier)')
            return { success: false, error: 'Rate limit exceeded', rateLimit: true }
        }
        
        const data = await response.json()
        
        if (response.ok && data.events) {
            // TheSportsDB returns { events: [...] } for eventsday.php
            console.log('⚽ [fetchFromAPI] Success! Found', data.events.length, 'events')
            return { success: true, data: data.events }
        } else if (response.ok && Array.isArray(data)) {
            // Some endpoints return array directly
            console.log('⚽ [fetchFromAPI] Success! Found', data.length, 'items')
            return { success: true, data: data }
        } else {
            console.error('⚽ [fetchFromAPI] Error:', data.message || 'Unknown error')
            return { success: false, error: data.message || 'Failed to fetch from API' }
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
        
        // TheSportsDB: Get today's events and filter for live matches
        const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
        const result = await fetchFromAPI(`eventsday.php?d=${today}`)
        
        if (result.rateLimit) {
            console.warn('⚠️ [fetchAndUpdateLiveMatches] Rate limit hit, skipping this update')
            return
        }
        
        if (!result.success || !result.data) {
            console.log('📭 [fetchAndUpdateLiveMatches] No events found for today')
            return
        }
        
        let allLiveMatches = []
        
        // Filter for matches from supported leagues and live status
        const supportedLeagueIds = SUPPORTED_LEAGUES.map(l => l.id.toString())
        const filteredMatches = result.data.filter(event => {
            const leagueId = event.idLeague?.toString()
            const isSupported = supportedLeagueIds.includes(leagueId)
            const isLive = event.strStatus?.includes('Live') || event.strStatus?.includes('1H') || event.strStatus?.includes('2H')
            return isSupported && isLive
        })
        
        if (filteredMatches.length > 0) {
            // Add league info to each match
            filteredMatches.forEach(match => {
                const leagueInfo = SUPPORTED_LEAGUES.find(l => l.id.toString() === match.idLeague?.toString())
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
            const fixtureId = matchData.idEvent || matchData.id
            const previousMatch = await Match.findOne({ fixtureId })
            
            const previousGoalsHome = previousMatch?.goals?.home || 0
            const previousGoalsAway = previousMatch?.goals?.away || 0
            
            // TheSportsDB: Get current score from intHomeScore/intAwayScore
            const currentGoalsHome = matchData.intHomeScore !== null ? parseInt(matchData.intHomeScore) : 0
            const currentGoalsAway = matchData.intAwayScore !== null ? parseInt(matchData.intAwayScore) : 0
            
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
        
        // TheSportsDB: Get all events for today (single API call)
        const result = await fetchFromAPI(`eventsday.php?d=${today}`)
        
        if (result.rateLimit) {
            console.warn(`⚠️ [fetchTodayFixtures] Rate limit hit, skipping`)
            return
        }
        
        if (!result.success || !result.data) {
            console.log('📅 [fetchTodayFixtures] No events found for today')
            return
        }
        
        // Filter for supported leagues
        const supportedLeagueIds = SUPPORTED_LEAGUES.map(l => l.id.toString())
        const filteredEvents = result.data.filter(event => {
            const leagueId = event.idLeague?.toString()
            return supportedLeagueIds.includes(leagueId)
        })
        
        console.log(`📅 [fetchTodayFixtures] Found ${filteredEvents.length} events from supported leagues`)
        
        let totalFetched = 0
        
        for (const eventData of filteredEvents) {
            const leagueInfo = SUPPORTED_LEAGUES.find(l => l.id.toString() === eventData.idLeague?.toString())
            if (leagueInfo) {
                const convertedMatch = convertMatchFormat(eventData, leagueInfo)
                await Match.findOneAndUpdate(
                    { fixtureId: convertedMatch.fixtureId },
                    convertedMatch,
                    { upsert: true, new: true }
                )
                totalFetched++
            }
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
    
    console.log('✅ Football Cron Jobs initialized (TheSportsDB - FREE API)')
    console.log('   - API: TheSportsDB (FREE - 30 requests/minute)')
    console.log('   - Live matches: Smart polling during match hours only')
    console.log('     • Weekends 12:00-22:00 UTC: Every 10 min (~30 calls/day)')
    console.log('     • Weekdays 18:00-22:00 UTC: Every 15 min (~3 calls/day)')
    console.log('     • Off-hours: Hourly check (~12 calls/day)')
    console.log('   - Daily fixtures: 6 AM UTC (1 call/day)')
    console.log('   - Auto-post today\'s matches: 7 AM UTC (1 call)')
    console.log('   - Post refresh: Every 30 minutes (from database, no API calls)')
    console.log('   - Leagues: Premier League (4328), La Liga (4335), Serie A (4332)')
    console.log('   - Total: ~45 calls/day (well under 30 req/min free tier!)')
}

