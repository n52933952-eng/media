import { Match, League } from '../models/football.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getUserSocketMap } from '../socket/socket.js'

// TheSportsDB API configuration (FREE - 30 requests/minute)
// Free API key: 123 (or use premium key from .env)
const getAPIKey = () => process.env.THESPORTSDB_API_KEY || '123' // Default to free key
const API_BASE_URL = 'https://www.thesportsdb.com/api/v1/json'
const CURRENT_SEASON = '2024-2025' // Format: YYYY-YYYY

// Supported leagues and competitions (TheSportsDB league IDs)
// Premier League = 4328, La Liga = 4335, Serie A = 4332
// We'll match by both ID and name for flexibility
const SUPPORTED_LEAGUES = [
    { id: 4328, name: 'Premier League', country: 'England', searchNames: ['premier league', 'english premier league', 'epl'] },
    { id: 4335, name: 'La Liga', country: 'Spain', searchNames: ['la liga', 'spanish la liga', 'primera division'] },
    { id: 4332, name: 'Serie A', country: 'Italy', searchNames: ['serie a', 'italian serie a'] }
]

// Helper: Fetch match details with events (scorers) - TheSportsDB
export const fetchMatchDetails = async (matchId) => {
    try {
        const apiKey = getAPIKey()
        console.log(`  🔍 Fetching match details for ID: ${matchId}`)
        
        // TheSportsDB: Lookup event and timeline
        const eventUrl = `${API_BASE_URL}/${apiKey}/lookupevent.php?id=${matchId}`
        const timelineUrl = `${API_BASE_URL}/${apiKey}/lookuptimeline.php?id=${matchId}`
        
        const [eventResponse, timelineResponse] = await Promise.all([
            fetch(eventUrl),
            fetch(timelineUrl)
        ])
        
        if (!eventResponse.ok) {
            console.error(`  ❌ Failed to fetch match ${matchId}:`, eventResponse.status, eventResponse.statusText)
            if (eventResponse.status === 429) {
                console.error(`  🚫 Rate limit exceeded for match ${matchId}`)
            }
            return []
        }
        
        const eventData = await eventResponse.json()
        let timelineData = null
        
        if (timelineResponse.ok) {
            timelineData = await timelineResponse.json()
        }
        
        if (!eventData.event || eventData.event.length === 0) {
            console.log(`  ⚠️ No match data found for ID: ${matchId}`)
            return []
        }
        
        const events = []
        
        // TheSportsDB timeline contains events (goals, cards, etc.)
        if (timelineData && timelineData.event) {
            const goalEvents = timelineData.event.filter(e => 
                e.strEvent?.includes('Goal') || e.strEvent?.toLowerCase().includes('goal')
            )
            
            console.log(`  ⚽ Found ${goalEvents.length} goals in match`)
            
            // Convert to our format
            goalEvents.forEach(event => {
                const timeMatch = event.strTime?.match(/(\d+)/)
                events.push({
                    time: timeMatch ? parseInt(timeMatch[1]) : 0,
                    type: 'Goal',
                    detail: event.strEvent || 'Normal Goal',
                    player: event.strPlayer || 'Unknown',
                    team: event.strTeam || 'Unknown Team'
                })
            })
            
            events.forEach(event => {
                console.log(`    ✅ ${event.player} (${event.team}) ${event.time}'`)
            })
        }
        
        return events
    } catch (error) {
        console.error(`  ❌ Error fetching match ${matchId}:`, error.message)
        console.error(`  ❌ Stack:`, error.stack)
        return []
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
        
        // Handle rate limit (429 status) - 30 requests/minute for free tier
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

// Helper: Get or create football system account
export const getFootballAccount = async () => {
    try {
        let footballAccount = await User.findOne({ username: 'Football' })
        
        if (!footballAccount) {
            // Create system football account
            footballAccount = new User({
                name: 'Football Live',
                username: 'Football',
                email: 'football@system.app',
                password: Math.random().toString(36), // Random password (won't be used)
                bio: '⚽ Live football scores, fixtures & updates from top leagues worldwide 🏆',
                profilePic: 'https://cdn-icons-png.flaticon.com/512/53/53283.png' // Football icon
            })
            await footballAccount.save()
            console.log('✅ Football system account created')
        }
        
        return footballAccount
    } catch (error) {
        console.error('Error getting football account:', error)
        return null
    }
}

// 1. Fetch and store live matches
export const fetchLiveMatches = async (req, res) => {
    try {
        const result = await fetchFromAPI('/fixtures?live=all')
        
        if (!result.success) {
            return res.status(500).json({ error: result.error })
        }
        
        const liveMatches = result.data
        let updatedCount = 0
        
        console.log(`⚽ [fetchLiveMatches] Fetched ${liveMatches.length} live matches`)
        if (liveMatches.length > 0) {
            console.log('⚽ [fetchLiveMatches] Sample match structure:')
            console.log('  Keys:', Object.keys(liveMatches[0]))
            console.log('  Has events?', liveMatches[0].events ? 'YES' : 'NO')
            if (liveMatches[0].events) {
                console.log('  Events count:', liveMatches[0].events.length)
            }
        }
        
        // Store/update each match in database
        for (const match of liveMatches) {
            await Match.findOneAndUpdate(
                { fixtureId: match.fixture.id },
                {
                    fixtureId: match.fixture.id,
                    league: {
                        id: match.league.id,
                        name: match.league.name,
                        country: match.league.country,
                        logo: match.league.logo,
                        flag: match.league.flag,
                        season: match.league.season
                    },
                    teams: {
                        home: {
                            id: match.teams.home.id,
                            name: match.teams.home.name,
                            logo: match.teams.home.logo
                        },
                        away: {
                            id: match.teams.away.id,
                            name: match.teams.away.name,
                            logo: match.teams.away.logo
                        }
                    },
                    fixture: {
                        date: new Date(match.fixture.date),
                        venue: match.fixture.venue?.name,
                        city: match.fixture.venue?.city,
                        status: {
                            long: match.fixture.status.long,
                            short: match.fixture.status.short,
                            elapsed: match.fixture.status.elapsed
                        }
                    },
                    goals: {
                        home: match.goals.home,
                        away: match.goals.away
                    },
                    events: match.events || [], // Store match events (goals, cards, etc.)
                    lastUpdated: new Date()
                },
                { upsert: true, new: true }
            )
            updatedCount++
        }
        
        res.status(200).json({ 
            message: `Updated ${updatedCount} live matches`,
            matches: liveMatches.length
        })
        
    } catch (error) {
        console.error('Error fetching live matches:', error)
        res.status(500).json({ error: error.message })
    }
}

// 2. Fetch fixtures (upcoming matches) for specific date range
export const fetchFixtures = async (req, res) => {
    try {
        const { date } = req.query // Format: YYYY-MM-DD (optional, defaults to today)
        
        // Fetch fixtures for all supported leagues
        const allFixtures = []
        
        for (const league of SUPPORTED_LEAGUES) {
            const endpoint = date 
                ? `/fixtures?league=${league.id}&date=${date}&season=2024`
                : `/fixtures?league=${league.id}&next=10&season=2024`
            
            const result = await fetchFromAPI(endpoint)
            
            if (result.success) {
                allFixtures.push(...result.data)
            }
        }
        
        // Store fixtures in database
        let storedCount = 0
        for (const match of allFixtures) {
            await Match.findOneAndUpdate(
                { fixtureId: match.fixture.id },
                {
                    fixtureId: match.fixture.id,
                    league: {
                        id: match.league.id,
                        name: match.league.name,
                        country: match.league.country,
                        logo: match.league.logo,
                        flag: match.league.flag,
                        season: match.league.season
                    },
                    teams: {
                        home: {
                            id: match.teams.home.id,
                            name: match.teams.home.name,
                            logo: match.teams.home.logo
                        },
                        away: {
                            id: match.teams.away.id,
                            name: match.teams.away.name,
                            logo: match.teams.away.logo
                        }
                    },
                    fixture: {
                        date: new Date(match.fixture.date),
                        venue: match.fixture.venue?.name,
                        city: match.fixture.venue?.city,
                        status: {
                            long: match.fixture.status.long,
                            short: match.fixture.status.short,
                            elapsed: match.fixture.status.elapsed
                        }
                    },
                    goals: {
                        home: match.goals.home,
                        away: match.goals.away
                    },
                    events: match.events || [], // Store match events (goals, cards, etc.)
                    lastUpdated: new Date()
                },
                { upsert: true, new: true }
            )
            storedCount++
        }
        
        res.status(200).json({ 
            message: `Fetched ${storedCount} fixtures`,
            fixtures: allFixtures.length
        })
        
    } catch (error) {
        console.error('Error fetching fixtures:', error)
        res.status(500).json({ error: error.message })
    }
}

// 3. Get matches from database (cached)
export const getMatches = async (req, res) => {
    try {
        const { status, date, leagueId } = req.query
        
        console.log('⚽ [getMatches] Request received:', { status, date, leagueId })
        
        const query = {}
        
        // Filter by status (live, finished, not started)
        if (status) {
            if (status === 'live') {
                query['fixture.status.short'] = { $in: ['1H', '2H', 'HT', 'ET', 'P'] }
                console.log('⚽ [getMatches] Filtering for LIVE matches')
            } else if (status === 'finished') {
                query['fixture.status.short'] = 'FT'
                console.log('⚽ [getMatches] Filtering for FINISHED matches')
            } else if (status === 'upcoming') {
                query['fixture.status.short'] = 'NS'
                console.log('⚽ [getMatches] Filtering for UPCOMING matches')
            }
        }
        
        // Filter by date
        if (date) {
            const startDate = new Date(date)
            let endDate = new Date(date)
            
            // For finished matches, look at past 3 days too
            if (status === 'finished') {
                startDate.setDate(startDate.getDate() - 3)
                endDate.setDate(endDate.getDate() + 1)
            } else {
                endDate.setDate(endDate.getDate() + 1)
            }
            
            query['fixture.date'] = {
                $gte: startDate,
                $lt: endDate
            }
            console.log('⚽ [getMatches] Filtering by date:', { date, startDate, endDate, status })
        } else if (status === 'finished') {
            // If no date specified but looking for finished, get last 3 days
            const endDate = new Date()
            const startDate = new Date()
            startDate.setDate(startDate.getDate() - 3)
            
            query['fixture.date'] = {
                $gte: startDate,
                $lt: endDate
            }
            console.log('⚽ [getMatches] No date specified, fetching finished matches from last 3 days')
        } else if (status === 'upcoming') {
            // If no date specified but looking for upcoming, get next 7 days from now
            const startDate = new Date()
            const endDate = new Date()
            endDate.setDate(endDate.getDate() + 7)
            
            query['fixture.date'] = {
                $gte: startDate,
                $lt: endDate
            }
            console.log('⚽ [getMatches] No date specified, fetching upcoming matches for next 7 days')
        }
        
        // Filter by league
        if (leagueId) {
            query['league.id'] = parseInt(leagueId)
            console.log('⚽ [getMatches] Filtering by league:', leagueId)
        }
        
        console.log('⚽ [getMatches] MongoDB query:', JSON.stringify(query, null, 2))
        
        // Check total matches in database first
        const totalMatches = await Match.countDocuments({})
        console.log('⚽ [getMatches] Total matches in database:', totalMatches)
        
        // Sort: upcoming matches ascending (closest first), finished/live matches descending (most recent first)
        const sortOrder = status === 'upcoming' ? 1 : -1
        
        const matches = await Match.find(query)
            .sort({ 'fixture.date': sortOrder })
            .limit(50)
        
        console.log('⚽ [getMatches] Found matches:', matches.length)
        
        // Group matches by league to see what we have
        const matchesByLeague = {}
        matches.forEach(match => {
            const leagueName = match.league?.name || 'Unknown'
            matchesByLeague[leagueName] = (matchesByLeague[leagueName] || 0) + 1
        })
        console.log('⚽ [getMatches] Matches by league:', matchesByLeague)
        
        if (matches.length > 0) {
            console.log('⚽ [getMatches] Sample matches:')
            matches.slice(0, 3).forEach((match, idx) => {
                console.log(`  ${idx + 1}. ${match.league?.name || 'Unknown'}: ${match.teams?.home?.name} vs ${match.teams?.away?.name} (${match.fixture?.status?.short})`)
            })
        } else {
            console.log('⚽ [getMatches] No matches found with query. Checking if database has any matches at all...')
            const anyMatch = await Match.findOne({})
            if (anyMatch) {
                console.log('⚽ [getMatches] Database has matches, but query returned none. Sample match in DB:', {
                    fixtureId: anyMatch.fixtureId,
                    league: anyMatch.league?.name,
                    status: anyMatch.fixture?.status?.short,
                    date: anyMatch.fixture?.date
                })
            } else {
                console.log('⚽ [getMatches] Database is empty - no matches have been fetched yet!')
            }
        }
        
        res.status(200).json({ matches })
        
    } catch (error) {
        console.error('⚽ [getMatches] Error getting matches:', error)
        res.status(500).json({ error: error.message })
    }
}

// 4. Fetch league standings
export const fetchStandings = async (req, res) => {
    try {
        const { leagueId } = req.params
        
        const result = await fetchFromAPI(`/standings?league=${leagueId}&season=2024`)
        
        if (!result.success) {
            return res.status(500).json({ error: result.error })
        }
        
        const standingsData = result.data[0]?.league?.standings[0]
        
        if (!standingsData) {
            return res.status(404).json({ error: 'No standings found' })
        }
        
        // Store in database
        const standings = standingsData.map(team => ({
            rank: team.rank,
            team: {
                id: team.team.id,
                name: team.team.name,
                logo: team.team.logo
            },
            points: team.points,
            played: team.all.played,
            win: team.all.win,
            draw: team.all.draw,
            lose: team.all.lose,
            goalsFor: team.all.goals.for,
            goalsAgainst: team.all.goals.against,
            goalsDiff: team.goalsDiff
        }))
        
        await League.findOneAndUpdate(
            { leagueId: parseInt(leagueId) },
            {
                leagueId: parseInt(leagueId),
                name: result.data[0].league.name,
                country: result.data[0].league.country,
                logo: result.data[0].league.logo,
                flag: result.data[0].league.flag,
                season: result.data[0].league.season,
                standings: standings,
                lastUpdated: new Date()
            },
            { upsert: true, new: true }
        )
        
        res.status(200).json({ standings })
        
    } catch (error) {
        console.error('Error fetching standings:', error)
        res.status(500).json({ error: error.message })
    }
}

// 5. Get cached standings
export const getStandings = async (req, res) => {
    try {
        const { leagueId } = req.params
        
        const league = await League.findOne({ leagueId: parseInt(leagueId) })
        
        if (!league) {
            return res.status(404).json({ error: 'League not found' })
        }
        
        res.status(200).json({ league })
        
    } catch (error) {
        console.error('Error getting standings:', error)
        res.status(500).json({ error: error.message })
    }
}

// 6. Auto-post match update to feed
export const postMatchUpdate = async (req, res) => {
    try {
        const { fixtureId, updateType } = req.body // updateType: 'start', 'goal', 'finish'
        
        const match = await Match.findOne({ fixtureId })
        
        if (!match) {
            return res.status(404).json({ error: 'Match not found' })
        }
        
        // Get football system account
        const footballAccount = await getFootballAccount()
        
        if (!footballAccount) {
            return res.status(500).json({ error: 'Football account not found' })
        }
        
        // Generate post text based on update type
        let postText = ''
        
        if (updateType === 'start') {
            postText = `⚽ KICK OFF!\n${match.teams.home.name} vs ${match.teams.away.name}\n📺 ${match.league.name}\n🏟️ ${match.fixture.venue || 'Stadium'}`
        } else if (updateType === 'goal') {
            postText = `⚽ GOAL!\n${match.teams.home.name} ${match.goals.home} - ${match.goals.away} ${match.teams.away.name}\n📺 ${match.league.name}\n⏱️ ${match.fixture.status.elapsed}'`
        } else if (updateType === 'finish') {
            postText = `🏁 FULL TIME\n${match.teams.home.name} ${match.goals.home} - ${match.goals.away} ${match.teams.away.name}\n📺 ${match.league.name}`
        }
        
        // Create post
        const newPost = new Post({
            postedBy: footballAccount._id,
            text: postText
        })
        
        await newPost.save()
        await newPost.populate("postedBy", "username profilePic name")
        
        // Update match with post ID
        match.postedToFeed = true
        match.postId = newPost._id
        await match.save()
        
        // Emit to followers of football account
        const io = getIO()
        if (io && footballAccount.followers && footballAccount.followers.length > 0) {
            const userSocketMap = getUserSocketMap()
            const onlineFollowers = []
            
            footballAccount.followers.forEach(followerId => {
                const followerIdStr = followerId.toString()
                if (userSocketMap[followerIdStr]) {
                    onlineFollowers.push(userSocketMap[followerIdStr].socketId)
                }
            })
            
            if (onlineFollowers.length > 0) {
                io.to(onlineFollowers).emit("newPost", newPost)
            }
        }
        
        res.status(200).json({ 
            message: 'Match update posted',
            post: newPost
        })
        
    } catch (error) {
        console.error('Error posting match update:', error)
        res.status(500).json({ error: error.message })
    }
}

// 7. Get supported leagues
export const getSupportedLeagues = async (req, res) => {
    try {
        res.status(200).json({ leagues: SUPPORTED_LEAGUES })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
}

// 8. Manual trigger to fetch fixtures (for testing)
export const manualFetchFixtures = async (req, res) => {
    try {
        console.log('⚽ [manualFetchFixtures] Manual trigger received')
        
        const today = new Date()
        
        // Fetch for past 3 days (for finished matches) and next 7 days (for upcoming)
        const startDate = new Date(today)
        startDate.setDate(startDate.getDate() - 3) // 3 days ago
        const startDateStr = startDate.toISOString().split('T')[0]
        
        const endDate = new Date(today)
        endDate.setDate(endDate.getDate() + 7) // 7 days ahead
        const endDateStr = endDate.toISOString().split('T')[0]
        
        console.log('⚽ [manualFetchFixtures] Fetching fixtures from', startDateStr, 'to', endDateStr)
        console.log('⚽ [manualFetchFixtures] This will include:')
        console.log('   - Past 3 days (finished matches)')
        console.log('   - Today (live/upcoming/finished)')
        console.log('   - Next 7 days (upcoming matches)')
        console.log('⚽ [manualFetchFixtures] Using TheSportsDB API (eventsday.php for each date)')
        
        // TheSportsDB: Loop through each date and fetch events for that day
        const supportedLeagueIds = SUPPORTED_LEAGUES.map(l => l.id.toString())
        const supportedLeagueNames = SUPPORTED_LEAGUES.flatMap(l => [l.name.toLowerCase(), ...(l.searchNames || [])])
        
        let totalFetched = 0
        const results = []
        const dateResults = {}
        
        // Generate array of dates to fetch
        const datesToFetch = []
        const currentDate = new Date(startDate)
        while (currentDate <= endDate) {
            datesToFetch.push(new Date(currentDate).toISOString().split('T')[0])
            currentDate.setDate(currentDate.getDate() + 1)
        }
        
        console.log(`⚽ [manualFetchFixtures] Fetching ${datesToFetch.length} dates...`)
        
        // Fetch events for each date (with rate limit protection)
        for (let i = 0; i < datesToFetch.length; i++) {
            const dateStr = datesToFetch[i]
            console.log(`⚽ [manualFetchFixtures] [${i + 1}/${datesToFetch.length}] Fetching events for ${dateStr}...`)
            
            // TheSportsDB: eventsday.php?d=YYYY-MM-DD
            const endpoint = `eventsday.php?d=${dateStr}`
            const result = await fetchFromAPI(endpoint)
            
            if (result.rateLimit) {
                console.warn(`🚫 [manualFetchFixtures] Rate limit hit on date ${dateStr}, stopping fetch`)
                break
            }
            
            if (result.success && result.data && result.data.length > 0) {
                // Filter for supported leagues (by ID or name)
                const filteredEvents = result.data.filter(event => {
                    const leagueId = event.idLeague?.toString()
                    const leagueName = (event.strLeague || '').toLowerCase()
                    const isSupportedById = supportedLeagueIds.includes(leagueId)
                    const isSupportedByName = supportedLeagueNames.some(name => leagueName.includes(name))
                    return isSupportedById || isSupportedByName
                })
                
                console.log(`  ✅ Found ${filteredEvents.length} matches from supported leagues on ${dateStr}`)
                
                // Save each match to database
                for (const eventData of filteredEvents) {
                    const leagueInfo = SUPPORTED_LEAGUES.find(l => {
                        const leagueId = eventData.idLeague?.toString()
                        const leagueName = (eventData.strLeague || '').toLowerCase()
                        return l.id.toString() === leagueId || 
                               l.name.toLowerCase() === leagueName ||
                               (l.searchNames || []).some(name => leagueName.includes(name))
                    })
                    
                    if (leagueInfo) {
                        const convertedMatch = convertMatchFormat(eventData, leagueInfo)
                        
                        await Match.findOneAndUpdate(
                            { fixtureId: convertedMatch.fixtureId },
                            convertedMatch,
                            { upsert: true, new: true }
                        )
                        totalFetched++
                        
                        // Track by league
                        const leagueName = leagueInfo.name
                        if (!dateResults[leagueName]) {
                            dateResults[leagueName] = 0
                        }
                        dateResults[leagueName]++
                    }
                }
            } else {
                console.log(`  📭 No events found for ${dateStr}`)
            }
            
            // Rate limit protection: Wait 2 seconds between requests (30 req/min = 1 req per 2 sec)
            if (i < datesToFetch.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000))
            }
        }
        
        // Format results
        for (const league of SUPPORTED_LEAGUES) {
            results.push({
                league: league.name,
                id: league.id,
                matches: dateResults[league.name] || 0
            })
        }
        
        console.log(`✅ [manualFetchFixtures] COMPLETE! Total matches fetched: ${totalFetched}`)
        console.log(`📊 [manualFetchFixtures] Results by league:`, results)
        
        res.status(200).json({ 
            message: `Fetched ${totalFetched} matches from ${results.filter(r => r.matches > 0).length} leagues`,
            totalFetched,
            leaguesFetched: results.filter(r => r.matches > 0).length,
            results
        })
        
    } catch (error) {
        console.error('❌ [manualFetchFixtures] Error:', error)
        res.status(500).json({ error: error.message })
    }
}

// 9. Auto-post today's matches (called by cron or manually)
export const autoPostTodayMatches = async () => {
    try {
        console.log('⚽ [autoPostTodayMatches] Starting auto-post for today\'s matches...')
        
        // Get Football system account
        const footballAccount = await getFootballAccount()
        if (!footballAccount) {
            console.error('❌ [autoPostTodayMatches] Football account not found!')
            return { success: false, error: 'Football account not found' }
        }
        
        // Check if post already exists for today (duplicate prevention)
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        const todayEnd = new Date(todayStart)
        todayEnd.setHours(23, 59, 59, 999)
        
        // Delete ALL old football posts (older than today) to keep feed clean
        // This ensures users always see fresh matches, not yesterday's matches
        const deletedOldPosts = await Post.deleteMany({
            postedBy: footballAccount._id,
            createdAt: { $lt: todayStart }
        })
        
        if (deletedOldPosts.deletedCount > 0) {
            console.log(`🗑️ [autoPostTodayMatches] Deleted ${deletedOldPosts.deletedCount} old football posts from previous days`)
        }
        
        // Cleanup duplicate "no matches" posts from today - keep only the most recent one
        const duplicateNoMatchesPosts = await Post.find({
            postedBy: footballAccount._id,
            text: { $regex: /Football Live|No live matches/i },
            footballData: { $exists: false },
            createdAt: { 
                $gte: todayStart,
                $lte: todayEnd
            }
        }).sort({ createdAt: -1 }) // Sort by newest first
        
        if (duplicateNoMatchesPosts.length > 1) {
            // Keep the most recent one, delete the rest
            const postsToDelete = duplicateNoMatchesPosts.slice(1) // Skip the first (newest)
            const idsToDelete = postsToDelete.map(p => p._id)
            await Post.deleteMany({ _id: { $in: idsToDelete } })
            console.log(`🧹 [autoPostTodayMatches] Cleaned up ${duplicateNoMatchesPosts.length - 1} duplicate "no matches" posts, kept the most recent one`)
        }
        
        // Check if post exists for today (either with footballData OR text-only "no matches" post)
        const existingPost = await Post.findOne({
            postedBy: footballAccount._id,
            $or: [
                { footballData: { $exists: true, $ne: null } }, // Posts with match data
                { 
                    text: { $regex: /Football Live|No live matches/i }, // "No matches" posts
                    footballData: { $exists: false } // No footballData
                }
            ],
            createdAt: { 
                $gte: todayStart,
                $lte: todayEnd
            }
        })
        
        // Track if we found a "no matches" post (needed later when checking for live matches)
        let noMatchesPostToDelete = null
        
        // If post exists for today, check if it needs refresh
        if (existingPost) {
            // Check if it's a "no matches" post (no footballData)
            const isNoMatchesPost = !existingPost.footballData || existingPost.footballData === null || existingPost.footballData === ''
            
            if (isNoMatchesPost) {
                // For "no matches" posts: We'll check if there are live matches below
                // If there ARE live matches, we need to replace the "no matches" post
                // If there are NO live matches, we'll check the age and decide
                noMatchesPostToDelete = existingPost
                console.log(`🔄 [autoPostTodayMatches] Found "no matches" post, will check for live matches...`)
                // Don't return yet - continue to check for live matches below
                // If matches found, we'll delete this post and create new one
                // If no matches, we'll check age and decide
            } else {
                // Post has match data - check if it needs refresh
                try {
                    const existingMatchData = JSON.parse(existingPost.footballData || '[]')
                    const hasLiveMatches = existingMatchData.some(match => 
                        ['1H', '2H', 'HT', 'LIVE', 'ET', 'P', 'BT'].includes(match.status?.short)
                    )
                    
                    // Check if post was last updated more than 10 minutes ago (for refresh)
                    // Use updatedAt instead of createdAt to avoid issues when createdAt is modified
                    const lastUpdated = existingPost.updatedAt || existingPost.createdAt
                    const postAge = new Date() - new Date(lastUpdated)
                    const tenMinutesInMs = 10 * 60 * 1000
                    const isPostStale = postAge > tenMinutesInMs
                    
                    // Only refresh if: no live matches OR post hasn't been updated in 10+ minutes
                    if (!hasLiveMatches || isPostStale) {
                        // No live matches or post is stale, delete it and create fresh one
                        console.log(`🔄 [autoPostTodayMatches] Refreshing post with matches (hasLiveMatches: ${hasLiveMatches}, isStale: ${isPostStale})...`)
                        await Post.findByIdAndDelete(existingPost._id)
                    } else {
                        // Post exists with live matches and was recently updated, skip creating new one
                        // Real-time updates will handle score changes
                        console.log('✅ [autoPostTodayMatches] Post already exists for today with live matches, skipping...')
                        return { success: true, message: 'Post already exists for today with live matches', postId: existingPost._id }
                    }
                } catch (e) {
                    // If parsing fails, delete old post and create fresh one
                    console.log('🔄 [autoPostTodayMatches] Error parsing existing post data, refreshing...')
                    await Post.findByIdAndDelete(existingPost._id)
                }
            }
        }
        
        // Double-check: Make sure no post was created between our check and now (race condition prevention)
        // Only do this if we didn't already delete a "no matches" post above (we'll check for matches first)
        const doubleCheckPost = await Post.findOne({
            postedBy: footballAccount._id,
            $or: [
                { footballData: { $exists: true, $ne: null } },
                { 
                    text: { $regex: /Football Live|No live matches/i },
                    footballData: { $exists: false }
                }
            ],
            createdAt: { 
                $gte: todayStart,
                $lte: todayEnd
            }
        })
        
        if (doubleCheckPost) {
            console.log('✅ [autoPostTodayMatches] Post was created by another process, skipping duplicate creation')
            return { success: true, message: 'Post already exists (double-check)', postId: doubleCheckPost._id }
        }
        
        console.log('✅ [autoPostTodayMatches] Creating new post for today...')
        
        // Get today's matches: ONLY LIVE matches (currently happening)
        // TheSportsDB: Get today's events and filter for live matches
        const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
        const result = await fetchFromAPI(`eventsday.php?d=${today}`)
        
        // If API call successful, save matches to database
        if (result.success && result.data) {
            // Filter for matches from supported leagues and live status
            const supportedLeagueIds = SUPPORTED_LEAGUES.map(l => l.id.toString())
            const filteredMatches = result.data.filter(event => {
                const leagueId = event.idLeague?.toString()
                const isSupported = supportedLeagueIds.includes(leagueId)
                const isLive = event.strStatus?.includes('Live') || event.strStatus?.includes('1H') || event.strStatus?.includes('2H')
                return isSupported && isLive
            })
            
            if (filteredMatches.length > 0) {
                // Process and save matches to database
                for (const eventData of filteredMatches) {
                    const leagueInfo = SUPPORTED_LEAGUES.find(l => l.id.toString() === eventData.idLeague?.toString())
                    if (leagueInfo) {
                        const convertedMatch = convertMatchFormat(eventData, leagueInfo)
                        await Match.findOneAndUpdate(
                            { fixtureId: convertedMatch.fixtureId },
                            convertedMatch,
                            { upsert: true, new: true }
                        )
                    }
                }
                console.log(`✅ [autoPostTodayMatches] Saved ${filteredMatches.length} live matches to database`)
            }
        } else if (result.rateLimit) {
            console.warn('⚠️ [autoPostTodayMatches] Rate limit hit, will use existing database matches')
        }
        
        // Always query database for live matches (either from API above or from previous fetches)
        const now = new Date()
        let matches = await Match.find({
            'fixture.date': { $gte: todayStart },
            'fixture.status.short': { 
                $in: ['1H', '2H', 'HT', 'ET', 'P', 'BT']  // Only LIVE matches
            }
        })
        .sort({ 'fixture.date': 1 })
        .limit(10)
        
        // Filter out old matches
        matches = matches.filter(match => {
            const matchDate = new Date(match.fixture.date)
            const hoursAgo = (now - matchDate) / (1000 * 60 * 60)
            if (hoursAgo > 2.5) {
                console.log(`  ⚠️ [autoPostTodayMatches] Excluding old match: ${match.teams?.home?.name} vs ${match.teams?.away?.name} (${hoursAgo.toFixed(1)}h ago)`)
                return false
            }
            return true
        })
        
        console.log('⚽ [autoPostTodayMatches] Found matches:', matches.length)
        
        // If we found a "no matches" post earlier AND now we have live matches, delete it
        if (noMatchesPostToDelete && matches.length > 0) {
            console.log(`🔄 [autoPostTodayMatches] Live matches started! Deleting "no matches" post to create new post with matches...`)
            await Post.findByIdAndDelete(noMatchesPostToDelete._id)
            noMatchesPostToDelete = null // Clear it so we don't check again below
        }
        
        if (matches.length === 0) {
            console.log('⚠️ [autoPostTodayMatches] No LIVE matches found - will create "no matches" post')
            // No live matches - check if "no matches" post already exists
            if (noMatchesPostToDelete) {
                // We found one earlier, check its age
                const postAge = new Date() - new Date(noMatchesPostToDelete.createdAt)
                const sixHoursInMs = 6 * 60 * 60 * 1000
                const isPostOld = postAge > sixHoursInMs
                
                if (isPostOld) {
                    // Post is old, delete it and create fresh one
                    console.log(`🔄 [autoPostTodayMatches] "No matches" post is old (${(postAge / (60 * 60 * 1000)).toFixed(1)}h), refreshing...`)
                    await Post.findByIdAndDelete(noMatchesPostToDelete._id)
                    // Continue to create new "no matches" post below
                } else {
                    // Post is recent, keep it
                    console.log('✅ [autoPostTodayMatches] "No matches" post already exists for today (recent), skipping...')
                    return { 
                        success: true, 
                        message: 'No matches post already exists for today', 
                        postId: noMatchesPostToDelete._id,
                        noMatches: true
                    }
                }
            } else {
                // Double-check if any "no matches" post exists
                const existingNoMatchesPost = await Post.findOne({
                    postedBy: footballAccount._id,
                    text: { $regex: /Football Live|No live matches/i },
                    footballData: { $exists: false },
                    createdAt: { 
                        $gte: todayStart,
                        $lte: todayEnd
                    }
                })
                
                if (existingNoMatchesPost) {
                    console.log('✅ [autoPostTodayMatches] "No matches" post already exists for today, skipping...')
                    return { 
                        success: true, 
                        message: 'No matches post already exists for today', 
                        postId: existingNoMatchesPost._id,
                        noMatches: true
                    }
                }
            }
            
            // No live matches found - create a post saying so
            const noMatchesPost = new Post({
                postedBy: footballAccount._id,
                text: `⚽ Football Live\n\nNo live matches happening right now.\n\n📅 Check back later for live updates!`
            })
            
            await noMatchesPost.save()
            await noMatchesPost.populate("postedBy", "username profilePic name")
            
            console.log('✅ [autoPostTodayMatches] Created "no matches" post:', noMatchesPost._id)
            
            // Emit to followers
            try {
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
                        io.to(onlineFollowers).emit("newPost", noMatchesPost)
                        console.log('✅ [autoPostTodayMatches] Emitted to followers')
                    }
                }
            } catch (emitError) {
                console.error('❌ [autoPostTodayMatches] Socket emit error:', emitError)
            }
            
            return { success: true, postId: noMatchesPost._id, noMatches: true }
        }
        
        // Store matches as JSON structure for visual rendering
        const matchData = matches.map(match => ({
            homeTeam: {
                name: match.teams.home.name,
                logo: match.teams.home.logo
            },
            awayTeam: {
                name: match.teams.away.name,
                logo: match.teams.away.logo
            },
            score: {
                home: match.goals?.home,
                away: match.goals?.away
            },
            status: {
                short: match.fixture?.status?.short,
                long: match.fixture?.status?.long,
                elapsed: match.fixture?.status?.elapsed
            },
            events: (match.events || [])
                .filter(e => e.type === 'Goal' || e.detail?.includes('Card'))
                .map(e => ({
                    time: e.time?.elapsed || e.time,
                    type: e.type,
                    detail: e.detail,
                    player: e.player?.name || e.player,
                    team: e.team?.name || e.team
                })),
            league: {
                name: match.league.name,
                logo: match.league.logo
            },
            time: new Date(match.fixture.date).toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: true
            }),
            date: match.fixture.date
        }))
        
        // Create the post with JSON data
        const newPost = new Post({
            postedBy: footballAccount._id,
            text: `⚽ Today's Live Matches ⚽\n\nMatches happening right now with live score updates!`,
            footballData: JSON.stringify(matchData)
        })
        
        console.log('📝 [autoPostTodayMatches] Creating post with', matches.length, 'live matches...')
        await newPost.save()
        console.log('💾 [autoPostTodayMatches] Saved post to database:', newPost._id)
        
        await newPost.populate("postedBy", "username profilePic name")
        console.log('✅ [autoPostTodayMatches] Created post with matches:', newPost._id, 'postedBy:', newPost.postedBy?.username, 'hasFootballData:', !!newPost.footballData)
        
        // Verify post was actually saved
        const verifyPost = await Post.findById(newPost._id)
        if (verifyPost) {
            console.log('✅ [autoPostTodayMatches] Verified: Post exists in database')
        } else {
            console.error('❌ [autoPostTodayMatches] ERROR: Post was NOT saved to database!')
        }
        
        // Emit to followers
        try {
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
                    console.log(`✅ [autoPostTodayMatches] Emitted to ${onlineFollowers.length} online followers`)
                }
            }
        } catch (emitError) {
            console.error('❌ [autoPostTodayMatches] Socket emit error:', emitError)
        }
        
        console.log(`✅ [autoPostTodayMatches] Posted ${matches.length} matches to feed`)
        
        return { success: true, postId: newPost._id, matchesPosted: matches.length }
        
    } catch (error) {
        console.error('❌ [autoPostTodayMatches] Error:', error)
        return { success: false, error: error.message }
    }
}

// 10. Manual trigger to post today's matches (for testing)
// Restore/create Football system account
export const restoreFootballAccount = async (req, res) => {
    try {
        let footballAccount = await User.findOne({ username: 'Football' })
        
        if (!footballAccount) {
            console.log('📦 Creating Football system account...')
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
            
            return res.status(200).json({
                message: 'Football account created successfully',
                account: {
                    _id: footballAccount._id,
                    name: footballAccount.name,
                    username: footballAccount.username,
                    bio: footballAccount.bio,
                    profilePic: footballAccount.profilePic
                }
            })
        } else {
            return res.status(200).json({
                message: 'Football account already exists',
                account: {
                    _id: footballAccount._id,
                    name: footballAccount.name,
                    username: footballAccount.username,
                    bio: footballAccount.bio,
                    profilePic: footballAccount.profilePic
                }
            })
        }
    } catch (error) {
        console.error('❌ Error restoring Football account:', error)
        res.status(500).json({ error: error.message })
    }
}

export const manualPostTodayMatches = async (req, res) => {
    try {
        console.log('⚽ [manualPostTodayMatches] Manual post trigger received')
        console.log('⚽ [manualPostTodayMatches] User:', req.user ? req.user.username : 'Not authenticated')
        
        // Get Football system account
        const footballAccount = await getFootballAccount()
        if (!footballAccount) {
            console.error('❌ [manualPostTodayMatches] Football account not found!')
            return res.status(404).json({ error: 'Football account not found' })
        }
        
        // Use the auto-post function (reuse logic)
        const result = await autoPostTodayMatches()
        
        if (!result.success) {
            return res.status(500).json({ error: result.error })
        }
        
        // If post was created, emit it directly to the user who triggered it (if authenticated)
        // This ensures the post appears immediately in their feed after following
        if (result.postId && req.user) {
            try {
                const post = await Post.findById(result.postId).populate("postedBy", "username profilePic name")
                if (post) {
                    const { getIO, getUserSocketMap } = await import('../socket/socket.js')
                    const io = getIO()
                    if (io) {
                        const userSocketMap = getUserSocketMap()
                        const userSocketData = userSocketMap[req.user._id.toString()]
                        
                        if (userSocketData && userSocketData.socketId) {
                            io.to(userSocketData.socketId).emit("newPost", post)
                            console.log(`✅ [manualPostTodayMatches] Emitted post directly to user ${req.user.username}`)
                        } else {
                            console.log(`⚠️ [manualPostTodayMatches] User ${req.user.username} not online, post will appear on next feed refresh`)
                        }
                    }
                }
            } catch (emitError) {
                console.error('❌ [manualPostTodayMatches] Error emitting post to user:', emitError)
            }
        }
        
        res.status(200).json({
            message: result.noMatches 
                ? 'No live or upcoming matches in the next 24 hours'
                : `Posted ${result.matchesPosted || 0} matches to feed`,
            postId: result.postId,
            matchesPosted: result.matchesPosted || 0,
            posted: true,
            noMatches: result.noMatches || false,
            post: result.postId ? await Post.findById(result.postId).populate("postedBy", "username profilePic name") : null
        })
        
    } catch (error) {
        console.error('❌ [manualPostTodayMatches] Error:', error)
        res.status(500).json({ error: error.message })
    }
}

