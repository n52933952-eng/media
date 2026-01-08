import { Match, League } from '../models/football.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getUserSocketMap } from '../socket/socket.js'

// API-Football configuration
// Get API key from environment variable (from dashboard.api-football.com)
const getAPIKey = () => process.env.FOOTBALL_API_KEY || 'f3ebe896455cab31fc80e859716411df'
const API_BASE_URL = 'https://v3.football.api-sports.io'
const CURRENT_SEASON = new Date().getFullYear() // Current year (e.g., 2025)

// Supported leagues and competitions (API-Football league IDs)
// Premier League = 39, La Liga = 140, Serie A = 135, Bundesliga = 78, Ligue 1 = 61
const SUPPORTED_LEAGUES = [
    { id: 39, name: 'Premier League', country: 'England' },
    { id: 140, name: 'La Liga', country: 'Spain' },
    { id: 135, name: 'Serie A', country: 'Italy' },
    { id: 78, name: 'Bundesliga', country: 'Germany' },
    { id: 61, name: 'Ligue 1', country: 'France' },
    { id: 2, name: 'UEFA Champions League', country: 'Europe' }
]

// Helper: Fetch match details with events (scorers, cards, substitutions) - API-Football
// Fetches events for both live and finished matches
// NOW WITH CACHING to reduce API calls!
export const fetchMatchDetails = async (fixtureId, includeEvents = true) => {
    try {
        // Import cache module once (reuse throughout function)
        const cacheModule = await import('../services/footballCache.js')
        
        // Check cache first (saves API calls!)
        const cachedDetails = cacheModule.getCachedMatchDetails(fixtureId)
        
        if (cachedDetails) {
            console.log(`  📦 [Cache] Using cached match details for fixture ${fixtureId} (saving API call!)`)
            return cachedDetails
        }
        
        const apiKey = getAPIKey()
        console.log(`  🔍 Fetching match details for fixture ID: ${fixtureId} (cache miss)`)
        
        // API-Football: Get fixture details with events
        const fixtureUrl = `${API_BASE_URL}/fixtures?id=${fixtureId}`
        
        const fixtureResponse = await fetch(fixtureUrl, {
            method: 'GET',
            headers: {
                'x-apisports-key': apiKey
            }
        })
        
        if (!fixtureResponse.ok) {
            console.error(`  ❌ Failed to fetch fixture ${fixtureId}:`, fixtureResponse.status, fixtureResponse.statusText)
            if (fixtureResponse.status === 429) {
                console.error(`  🚫 Rate limit exceeded for fixture ${fixtureId}`)
            }
            return { events: [], elapsedTime: null }
        }
        
        const fixtureData = await fixtureResponse.json()
        
        if (!fixtureData.response || fixtureData.response.length === 0) {
            console.log(`  ⚠️ No fixture data found for ID: ${fixtureId}`)
            return { events: [], elapsedTime: null }
        }
        
        const matchInfo = fixtureData.response[0]
        const fixture = matchInfo.fixture
        const events = []
        
        // Extract elapsed time from fixture status
        let elapsedTime = fixture.status.elapsed || null
        
        // Fetch events (goals, cards, substitutions) if requested
        if (includeEvents && matchInfo.events && matchInfo.events.length > 0) {
            matchInfo.events.forEach(event => {
                const eventType = event.type
                const time = event.time?.elapsed || event.time?.extra || 0
                
                if (eventType === 'Goal') {
                    events.push({
                        time: time,
                        type: 'Goal',
                        detail: event.detail || 'Normal Goal',
                        player: event.player?.name || 'Unknown',
                        team: event.team?.name || 'Unknown Team'
                    })
                } else if (eventType === 'Card') {
                    const isRed = event.detail === 'Red Card'
                    events.push({
                        time: time,
                        type: 'Card',
                        detail: isRed ? 'Red Card' : 'Yellow Card',
                        player: event.player?.name || 'Unknown',
                        team: event.team?.name || 'Unknown Team'
                    })
                } else if (eventType === 'subst') {
                    events.push({
                        time: time,
                        type: 'Substitution',
                        detail: 'Substitution',
                        player: event.player?.name || 'Unknown',
                        team: event.team?.name || 'Unknown Team',
                        playerOut: event.assist?.name || null
                    })
                }
            })
            
            const goals = events.filter(e => e.type === 'Goal')
            const cards = events.filter(e => e.type === 'Card')
            const subs = events.filter(e => e.type === 'Substitution')
            
            console.log(`  ⚽ Found ${goals.length} goals, ${cards.length} cards, ${subs.length} substitutions`)
        }
        
        // Sort events by time
        events.sort((a, b) => a.time - b.time)
        
        const result = { events, elapsedTime }
        
        // Cache the result for 5 minutes (scorers don't change often) - reuse cacheModule from top
        cacheModule.setCachedMatchDetails(fixtureId, result)
        
        return result
    } catch (error) {
        console.error(`  ❌ Error fetching fixture ${fixtureId}:`, error.message)
        console.error(`  ❌ Stack:`, error.stack)
        return { events: [], elapsedTime: null }
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
        
        // Handle rate limit (429 status)
        if (response.status === 429) {
            console.error('🚫 [fetchFromAPI] RATE LIMIT HIT!')
            return { success: false, error: 'Rate limit exceeded', rateLimit: true }
        }
        
        const data = await response.json()
        
        // Check for API errors in response (API-Football returns errors in data.errors array)
        if (data.errors && data.errors.length > 0) {
            const errorMsg = data.errors[0].message || 'API error'
            console.error('⚽ [fetchFromAPI] API Error:', errorMsg)
            
            // Check if it's a rate limit/quota error
            const errorLower = errorMsg.toLowerCase()
            if (errorLower.includes('rate limit') || errorLower.includes('quota') || errorLower.includes('limit exceeded')) {
                console.error('🚫 [fetchFromAPI] Rate limit/quota exceeded!')
                return { success: false, error: errorMsg, rateLimit: true }
            }
            
            // Check if it's an authentication error
            if (errorLower.includes('api key') || errorLower.includes('authentication') || errorLower.includes('unauthorized')) {
                console.error('🔑 [fetchFromAPI] API key issue! Check your FOOTBALL_API_KEY in .env')
                return { success: false, error: 'API key authentication failed', rateLimit: false }
            }
            
            return { success: false, error: errorMsg }
        }
        
        if (response.ok && data.response) {
            // API-Football returns { response: [...] }
            console.log('⚽ [fetchFromAPI] Success! Found', data.response.length, 'items')
            return { success: true, data: data.response }
        } else {
            const errorMsg = data.message || data.errors?.[0]?.message || `HTTP ${response.status}: ${response.statusText}`
            console.error('⚽ [fetchFromAPI] Error:', errorMsg, 'Status:', response.status)
            return { success: false, error: errorMsg }
        }
    } catch (error) {
        console.error('⚽ [fetchFromAPI] Fetch Error:', error.message)
        console.error('⚽ [fetchFromAPI] Error stack:', error.stack)
        return { success: false, error: error.message }
    }
}

// Helper: Convert API-Football match format to our database format
const convertMatchFormat = (fixtureData) => {
    const fixture = fixtureData.fixture
    const league = fixtureData.league
    const teams = fixtureData.teams
    const goals = fixtureData.goals
    const score = fixtureData.score
    
    // Map API-Football status to our format
    // API-Football status: short (NS, 1H, HT, 2H, ET, P, FT, AET, PEN, SUSP, INT, CANC, ABAN, WO, AWARDED)
    const statusShort = fixture.status.short || 'NS'
    const statusLong = fixture.status.long || 'Not Started'
    const elapsed = fixture.status.elapsed || null
    
    // Get scores (use fulltime score, fallback to halftime, then null)
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
    
    // Extract events if available (for finished matches)
    const events = []
    if (fixtureData.events && Array.isArray(fixtureData.events)) {
        fixtureData.events.forEach(event => {
            const eventType = event.type
            const time = event.time?.elapsed || event.time?.extra || 0
            
            if (eventType === 'Goal') {
                events.push({
                    time: time,
                    type: 'Goal',
                    detail: event.detail || 'Normal Goal',
                    player: event.player?.name || 'Unknown',
                    team: event.team?.name || 'Unknown Team'
                })
            } else if (eventType === 'Card') {
                const isRed = event.detail === 'Red Card'
                events.push({
                    time: time,
                    type: 'Card',
                    detail: isRed ? 'Red Card' : 'Yellow Card',
                    player: event.player?.name || 'Unknown',
                    team: event.team?.name || 'Unknown Team'
                })
            } else if (eventType === 'subst') {
                events.push({
                    time: time,
                    type: 'Substitution',
                    detail: 'Substitution',
                    player: event.player?.name || 'Unknown',
                    team: event.team?.name || 'Unknown Team',
                    playerOut: event.assist?.name || null
                })
            }
        })
    }
    
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
        events: events,
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
        // API-Football: Get all live matches
        const result = await fetchFromAPI('/fixtures?live=all')
        
        if (!result.success) {
            return res.status(500).json({ error: result.error })
        }
        
        const liveMatches = result.data
        let updatedCount = 0
        
        console.log(`⚽ [fetchLiveMatches] Fetched ${liveMatches.length} live matches`)
        
        // Filter for supported leagues only
        const supportedLeagueIds = SUPPORTED_LEAGUES.map(l => l.id)
        const filteredMatches = liveMatches.filter(match => 
            supportedLeagueIds.includes(match.league.id)
        )
        
        console.log(`⚽ [fetchLiveMatches] Filtered to ${filteredMatches.length} matches from supported leagues`)
        
        // Store/update each match in database
        for (const matchData of filteredMatches) {
            const convertedMatch = convertMatchFormat(matchData)
            
            // For live matches, don't include events (they're updated in real-time)
            convertedMatch.events = []
            
            await Match.findOneAndUpdate(
                { fixtureId: convertedMatch.fixtureId },
                convertedMatch,
                { upsert: true, new: true }
            )
            updatedCount++
        }
        
        res.status(200).json({ 
            message: `Updated ${updatedCount} live matches`,
            matches: filteredMatches.length
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
                ? `/fixtures?league=${league.id}&date=${date}&season=${CURRENT_SEASON}`
                : `/fixtures?league=${league.id}&next=10&season=${CURRENT_SEASON}`
            
            const result = await fetchFromAPI(endpoint)
            
            if (result.success && result.data) {
                allFixtures.push(...result.data)
            }
        }
        
        // Store fixtures in database
        let storedCount = 0
        for (const matchData of allFixtures) {
            const convertedMatch = convertMatchFormat(matchData)
            
            // For upcoming matches, no events yet
            if (convertedMatch.fixture.status.short === 'NS') {
                convertedMatch.events = []
            }
            
            await Match.findOneAndUpdate(
                { fixtureId: convertedMatch.fixtureId },
                convertedMatch,
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
        
        let matches = await Match.find(query)
            .sort({ 'fixture.date': sortOrder })
            .limit(50)
        
        console.log('⚽ [getMatches] Found matches:', matches.length)
        
        // For finished matches: Fetch timeline data (scorers, cards, substitutions) if not already fetched
        if (status === 'finished') {
            for (const match of matches) {
                // Only fetch if events array is empty or missing
                if (!match.events || match.events.length === 0) {
                    try {
                        const matchDetails = await fetchMatchDetails(match.fixtureId, true)
                        if (matchDetails && matchDetails.events && matchDetails.events.length > 0) {
                            match.events = matchDetails.events
                            // Save updated match to database
                            await Match.findByIdAndUpdate(match._id, { events: matchDetails.events })
                            console.log(`  ✅ Fetched ${matchDetails.events.length} events for finished match ${match.fixtureId}`)
                        }
                    } catch (error) {
                        console.log(`  ⚠️ Could not fetch timeline for match ${match.fixtureId}:`, error.message)
                    }
                }
            }
        }
        
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
        console.log('⚽ [manualFetchFixtures] ========== MANUAL FETCH TRIGGERED ==========')
        console.log('⚽ [manualFetchFixtures] Using API-Football')
        
        const today = new Date()
        
        // Fetch for past 3 days (for finished matches) and next 7 days (for upcoming)
        const startDate = new Date(today)
        startDate.setDate(startDate.getDate() - 3) // 3 days ago
        const startDateStr = startDate.toISOString().split('T')[0]
        
        const endDate = new Date(today)
        endDate.setDate(endDate.getDate() + 7) // 7 days ahead
        const endDateStr = endDate.toISOString().split('T')[0]
        
        console.log('⚽ [manualFetchFixtures] Fetching fixtures from', startDateStr, 'to', endDateStr)
        
        const supportedLeagueIds = SUPPORTED_LEAGUES.map(l => l.id)
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
        
        // Fetch fixtures for each date and each league (with rate limit protection)
        for (let i = 0; i < datesToFetch.length; i++) {
            const dateStr = datesToFetch[i]
            console.log(`⚽ [manualFetchFixtures] [${i + 1}/${datesToFetch.length}] Fetching fixtures for ${dateStr}...`)
            
            // Fetch for all supported leagues on this date
            for (const league of SUPPORTED_LEAGUES) {
                const endpoint = `/fixtures?league=${league.id}&date=${dateStr}&season=${CURRENT_SEASON}`
                const result = await fetchFromAPI(endpoint)
                
                if (result.rateLimit) {
                    console.warn(`🚫 [manualFetchFixtures] Rate limit hit, stopping fetch`)
                    break
                }
                
                if (result.success && result.data && result.data.length > 0) {
                    console.log(`  ✅ Found ${result.data.length} matches for ${league.name} on ${dateStr}`)
                    
                    // Save each match to database
                    for (const matchData of result.data) {
                        const convertedMatch = convertMatchFormat(matchData)
                        
                        // For finished matches: Fetch events (scorers, cards, substitutions)
                        const isFinished = convertedMatch.fixture?.status?.short === 'FT' || 
                                          convertedMatch.fixture?.status?.short === 'AET' ||
                                          convertedMatch.fixture?.status?.short === 'PEN'
                        
                        if (isFinished && (!convertedMatch.events || convertedMatch.events.length === 0)) {
                            try {
                                // Fetch events for finished matches (scorers, cards, substitutions)
                                const matchDetails = await fetchMatchDetails(convertedMatch.fixtureId, true)
                                if (matchDetails && matchDetails.events && matchDetails.events.length > 0) {
                                    convertedMatch.events = matchDetails.events
                                    console.log(`    ✅ Fetched ${matchDetails.events.length} events for finished match ${convertedMatch.fixtureId}`)
                                }
                            } catch (error) {
                                console.log(`    ⚠️ Could not fetch events for match ${convertedMatch.fixtureId}:`, error.message)
                            }
                        }
                        
                        await Match.findOneAndUpdate(
                            { fixtureId: convertedMatch.fixtureId },
                            convertedMatch,
                            { upsert: true, new: true }
                        )
                        totalFetched++
                        
                        // Track by league
                        if (!dateResults[league.name]) {
                            dateResults[league.name] = 0
                        }
                        dateResults[league.name]++
                    }
                }
                
                // Rate limit protection: Wait 1 second between league requests
                await new Promise(resolve => setTimeout(resolve, 1000))
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
        
        // Check if post exists for today OR yesterday (old "no matches" posts might be from yesterday)
        const yesterdayStart = new Date(todayStart)
        yesterdayStart.setDate(yesterdayStart.getDate() - 1)
        
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
                $gte: yesterdayStart, // Check yesterday and today
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
        // Check yesterday and today for old "no matches" posts
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
                $gte: yesterdayStart, // Check yesterday and today
                $lte: todayEnd
            }
        })
        
        if (doubleCheckPost) {
            console.log('✅ [autoPostTodayMatches] Post was created by another process, skipping duplicate creation')
            return { success: true, message: 'Post already exists (double-check)', postId: doubleCheckPost._id }
        }
        
        console.log('✅ [autoPostTodayMatches] Creating new post for today...')
        
        // FIRST: Check all matches in database that were live today - they might have finished
        // This ensures we detect finished matches even if they're not in the feed post
        const checkNow = new Date()
        const dbTodayStart = new Date(checkNow.setHours(0, 0, 0, 0))
        const dbTodayEnd = new Date(checkNow.setHours(23, 59, 59, 999))
        
        const previouslyLiveMatches = await Match.find({
            'fixture.date': { $gte: dbTodayStart, $lte: dbTodayEnd },
            'fixture.status.short': { $in: ['1H', '2H', 'HT', 'ET', 'P', 'BT'] }
        }).limit(20) // Check up to 20 matches
        
        console.log(`🔍 [autoPostTodayMatches] Checking ${previouslyLiveMatches.length} previously live matches in database to see if they finished...`)
        
        // Check each match against API to see current status
        for (const dbMatch of previouslyLiveMatches) {
            try {
                const apiKey = getAPIKey()
                const fixtureUrl = `${API_BASE_URL}/fixtures?id=${dbMatch.fixtureId}`
                
                const fixtureResponse = await fetch(fixtureUrl, {
                    method: 'GET',
                    headers: { 'x-apisports-key': apiKey }
                })
                
                if (fixtureResponse.ok) {
                    const fixtureData = await fixtureResponse.json()
                    if (fixtureData.response && fixtureData.response.length > 0) {
                        const matchData = fixtureData.response[0]
                        const convertedMatch = convertMatchFormat(matchData)
                        
                        const status = convertedMatch.fixture.status.short
                        const finishedStatuses = ['FT', 'AET', 'PEN', 'CANC', 'POSTP', 'SUSP']
                        const isFinished = finishedStatuses.includes(status)
                        const wasLive = ['1H', '2H', 'HT', 'ET', 'P', 'BT'].includes(dbMatch.fixture.status.short)
                        
                        if (wasLive && isFinished) {
                            console.log(`  🏁 Match finished: ${convertedMatch.teams.home.name} vs ${convertedMatch.teams.away.name} (${status}) - Score: ${convertedMatch.goals?.home ?? 0}-${convertedMatch.goals?.away ?? 0}`)
                            
                            // Fetch events for finished match (scorers, cards, etc.)
                            const matchDetails = await fetchMatchDetails(dbMatch.fixtureId, true)
                            if (matchDetails && matchDetails.events && matchDetails.events.length > 0) {
                                convertedMatch.events = matchDetails.events
                                console.log(`    ⚽ Fetched ${matchDetails.events.length} events (scorers)`)
                            }
                            
                            // Update database with finished match
                            await Match.findOneAndUpdate(
                                { fixtureId: convertedMatch.fixtureId },
                                convertedMatch,
                                { upsert: true, new: true }
                            )
                        }
                    }
                }
                
                // Rate limit protection
                await new Promise(resolve => setTimeout(resolve, 500))
            } catch (error) {
                console.log(`  ⚠️ Error checking match ${dbMatch.fixtureId}:`, error.message)
            }
        }
        
        // Get today's matches: ONLY LIVE matches (currently happening)
        // API-Football: Get all live matches
        const result = await fetchFromAPI('/fixtures?live=all')
        
        // If API call successful, save matches to database
        if (result.success && result.data) {
            // Filter for matches from supported leagues
            const supportedLeagueIds = SUPPORTED_LEAGUES.map(l => l.id)
            const filteredMatches = result.data.filter(match => 
                supportedLeagueIds.includes(match.league.id)
            )
            
            if (filteredMatches.length > 0) {
                // Process and save matches to database
                for (const matchData of filteredMatches) {
                    const convertedMatch = convertMatchFormat(matchData)
                    // For live matches, don't include events (they're updated in real-time)
                    convertedMatch.events = []
                    await Match.findOneAndUpdate(
                        { fixtureId: convertedMatch.fixtureId },
                        convertedMatch,
                        { upsert: true, new: true }
                    )
                }
                console.log(`✅ [autoPostTodayMatches] Saved ${filteredMatches.length} live matches to database`)
            }
        } else if (result.rateLimit) {
            console.warn('⚠️ [autoPostTodayMatches] Rate limit hit, will use existing database matches')
        }
        
        // Always query database for live matches (either from API above or from previous fetches)
        // Reuse 'now' from above, create new one only if needed
        const currentTime = new Date()
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
            const hoursAgo = (currentTime - matchDate) / (1000 * 60 * 60)
            if (hoursAgo > 2.5) {
                console.log(`  ⚠️ [autoPostTodayMatches] Excluding old match: ${match.teams?.home?.name} vs ${match.teams?.away?.name} (${hoursAgo.toFixed(1)}h ago)`)
                return false
            }
            return true
        })
        
        console.log('⚽ [autoPostTodayMatches] Found matches:', matches.length)
        
        // If we have live matches, delete ANY old "no matches" posts (from today or yesterday)
        if (matches.length > 0) {
            // Find and delete all old "no matches" posts
            const oldNoMatchesPosts = await Post.find({
                postedBy: footballAccount._id,
                text: { $regex: /Football Live|No live matches/i },
                footballData: { $exists: false },
                createdAt: { 
                    $gte: yesterdayStart,
                    $lte: todayEnd
                }
            })
            
            if (oldNoMatchesPosts.length > 0) {
                console.log(`🔄 [autoPostTodayMatches] Found ${oldNoMatchesPosts.length} old "no matches" post(s), deleting them...`)
                for (const oldPost of oldNoMatchesPosts) {
                    await Post.findByIdAndDelete(oldPost._id)
                }
            }
            
            // Also delete the one we found earlier if it exists
            if (noMatchesPostToDelete) {
                await Post.findByIdAndDelete(noMatchesPostToDelete._id)
                noMatchesPostToDelete = null
            }
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
                // Double-check if any "no matches" post exists (check yesterday and today)
                const existingNoMatchesPost = await Post.findOne({
                    postedBy: footballAccount._id,
                    text: { $regex: /Football Live|No live matches/i },
                    footballData: { $exists: false },
                    createdAt: { 
                        $gte: yesterdayStart, // Check yesterday and today
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
            date: match.fixture.date, // Match start time - used for calculating elapsed time
            startTime: match.fixture.date // Alias for clarity
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

// Helper: Force check all matches in feed post against API to detect finished matches
export const forceCheckFeedPostMatches = async () => {
    try {
        const footballAccount = await getFootballAccount()
        if (!footballAccount) {
            console.log('❌ [forceCheckFeedPostMatches] Football account not found')
            return
        }
        
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
        
        if (!todayPost) {
            console.log('📭 [forceCheckFeedPostMatches] No feed post found - will check database for live matches')
            // No feed post exists, but there might be live matches in database
            // Check database for live matches that should be in feed post
            const liveMatchesInDB = await Match.find({
                'fixture.date': { $gte: todayStart, $lte: todayEnd },
                'fixture.status.short': { $in: ['1H', '2H', 'HT', 'ET', 'P', 'BT'] }
            }).limit(10)
            
            if (liveMatchesInDB.length > 0) {
                console.log(`  ⚠️ Found ${liveMatchesInDB.length} live matches in database but no feed post - checking their status...`)
                // Check each match against API to see if they finished
                for (const dbMatch of liveMatchesInDB) {
                    try {
                        const apiKey = getAPIKey()
                        const fixtureUrl = `${API_BASE_URL}/fixtures?id=${dbMatch.fixtureId}`
                        
                        const fixtureResponse = await fetch(fixtureUrl, {
                            method: 'GET',
                            headers: { 'x-apisports-key': apiKey }
                        })
                        
                        if (fixtureResponse.ok) {
                            const fixtureData = await fixtureResponse.json()
                            if (fixtureData.response && fixtureData.response.length > 0) {
                                const matchData = fixtureData.response[0]
                                const convertedMatch = convertMatchFormat(matchData)
                                
                                const status = convertedMatch.fixture.status.short
                                const finishedStatuses = ['FT', 'AET', 'PEN', 'CANC', 'POSTP', 'SUSP']
                                const isFinished = finishedStatuses.includes(status)
                                
                                // Update database with current status
                                await Match.findOneAndUpdate(
                                    { fixtureId: convertedMatch.fixtureId },
                                    convertedMatch,
                                    { upsert: true, new: true }
                                )
                                
                                if (isFinished) {
                                    console.log(`  🏁 Match finished: ${convertedMatch.teams.home.name} vs ${convertedMatch.teams.away.name} (${status})`)
                                    // Fetch events for finished match
                                    const matchDetails = await fetchMatchDetails(dbMatch.fixtureId, true)
                                    if (matchDetails && matchDetails.events && matchDetails.events.length > 0) {
                                        convertedMatch.events = matchDetails.events
                                        await Match.findOneAndUpdate(
                                            { fixtureId: convertedMatch.fixtureId },
                                            { events: convertedMatch.events },
                                            { upsert: true, new: true }
                                        )
                                    }
                                }
                            }
                        }
                        await new Promise(resolve => setTimeout(resolve, 500))
                    } catch (error) {
                        console.log(`  ⚠️ Error checking match ${dbMatch.fixtureId}:`, error.message)
                    }
                }
                
                // After checking all matches, call autoPostTodayMatches to create/update feed post
                console.log('  🔄 Calling autoPostTodayMatches to create/update feed post...')
                await autoPostTodayMatches()
            }
            return
        }
        
        let matchDataArray = []
        try {
            matchDataArray = JSON.parse(todayPost.footballData || '[]')
        } catch (e) {
            console.error('❌ [forceCheckFeedPostMatches] Failed to parse football data:', e)
            return
        }
        
        if (matchDataArray.length === 0) {
            console.log('📭 [forceCheckFeedPostMatches] No matches in feed post - checking database for live matches...')
            // Feed post has no matches, but check if there are live matches in database
            const liveMatchesInDB = await Match.find({
                'fixture.date': { $gte: todayStart, $lte: todayEnd },
                'fixture.status.short': { $in: ['1H', '2H', 'HT', 'ET', 'P', 'BT'] }
            }).limit(10)
            
            if (liveMatchesInDB.length > 0) {
                console.log(`  ⚠️ Found ${liveMatchesInDB.length} live matches in database but feed post is empty - checking their status...`)
                // Check each match and update post
                for (const dbMatch of liveMatchesInDB) {
                    try {
                        const apiKey = getAPIKey()
                        const fixtureUrl = `${API_BASE_URL}/fixtures?id=${dbMatch.fixtureId}`
                        
                        const fixtureResponse = await fetch(fixtureUrl, {
                            method: 'GET',
                            headers: { 'x-apisports-key': apiKey }
                        })
                        
                        if (fixtureResponse.ok) {
                            const fixtureData = await fixtureResponse.json()
                            if (fixtureData.response && fixtureData.response.length > 0) {
                                const matchData = fixtureData.response[0]
                                const convertedMatch = convertMatchFormat(matchData)
                                
                                const status = convertedMatch.fixture.status.short
                                const finishedStatuses = ['FT', 'AET', 'PEN', 'CANC', 'POSTP', 'SUSP']
                                const isFinished = finishedStatuses.includes(status)
                                
                                // Update database
                                await Match.findOneAndUpdate(
                                    { fixtureId: convertedMatch.fixtureId },
                                    convertedMatch,
                                    { upsert: true, new: true }
                                )
                                
                                if (isFinished) {
                                    console.log(`  🏁 Match finished: ${convertedMatch.teams.home.name} vs ${convertedMatch.teams.away.name} (${status})`)
                                    const matchDetails = await fetchMatchDetails(dbMatch.fixtureId, true)
                                    if (matchDetails && matchDetails.events && matchDetails.events.length > 0) {
                                        convertedMatch.events = matchDetails.events
                                        await Match.findOneAndUpdate(
                                            { fixtureId: convertedMatch.fixtureId },
                                            { events: convertedMatch.events },
                                            { upsert: true, new: true }
                                        )
                                    }
                                }
                            }
                        }
                        await new Promise(resolve => setTimeout(resolve, 500))
                    } catch (error) {
                        console.log(`  ⚠️ Error checking match ${dbMatch.fixtureId}:`, error.message)
                    }
                }
                
                // Refresh the feed post
                console.log('  🔄 Refreshing feed post...')
                await autoPostTodayMatches()
            }
            return
        }
        
        console.log(`🔍 [forceCheckFeedPostMatches] Checking ${matchDataArray.length} matches in feed post against API...`)
        
        // Check each match in feed post against API-Football
        const updatedMatches = []
        let hasChanges = false
        
        for (const match of matchDataArray) {
            const homeName = match.homeTeam?.name || match.homeTeam
            const awayName = match.awayTeam?.name || match.awayTeam
            
            console.log(`  🔍 Checking: ${homeName} vs ${awayName}`)
            
            // Find match in database first to get fixtureId
            // Try exact match first
            let dbMatch = await Match.findOne({
                'teams.home.name': homeName,
                'teams.away.name': awayName,
                'fixture.date': { $gte: todayStart, $lte: todayEnd }
            })
            
            // If not found, try case-insensitive match
            if (!dbMatch) {
                dbMatch = await Match.findOne({
                    $or: [
                        { 
                            'teams.home.name': { $regex: new RegExp(`^${homeName}$`, 'i') },
                            'teams.away.name': { $regex: new RegExp(`^${awayName}$`, 'i') }
                        },
                        {
                            'teams.home.name': { $regex: new RegExp(`^${awayName}$`, 'i') },
                            'teams.away.name': { $regex: new RegExp(`^${homeName}$`, 'i') }
                        }
                    ],
                    'fixture.date': { $gte: todayStart, $lte: todayEnd }
                })
            }
            
            if (dbMatch && dbMatch.fixtureId) {
                // Query API-Football directly for this match
                try {
                    const apiKey = getAPIKey()
                    const fixtureUrl = `${API_BASE_URL}/fixtures?id=${dbMatch.fixtureId}`
                    
                    console.log(`    🌐 Querying API: ${fixtureUrl}`)
                    
                    const fixtureResponse = await fetch(fixtureUrl, {
                        method: 'GET',
                        headers: {
                            'x-apisports-key': apiKey
                        }
                    })
                    
                    if (fixtureResponse.ok) {
                        const fixtureData = await fixtureResponse.json()
                        
                        if (fixtureData.response && fixtureData.response.length > 0) {
                            const matchData = fixtureData.response[0]
                            const convertedMatch = convertMatchFormat(matchData)
                            
                            const status = convertedMatch.fixture.status.short
                            const finishedStatuses = ['FT', 'AET', 'PEN', 'CANC', 'POSTP', 'SUSP']
                            const isFinished = finishedStatuses.includes(status)
                            
                            console.log(`    📊 Status from API: ${status} (Finished: ${isFinished}) - Score: ${convertedMatch.goals?.home ?? 0}-${convertedMatch.goals?.away ?? 0}`)
                            
                            if (!isFinished) {
                                // Match is still live, update with latest data
                                updatedMatches.push({
                                    homeTeam: {
                                        name: convertedMatch.teams.home.name,
                                        logo: convertedMatch.teams.home.logo
                                    },
                                    awayTeam: {
                                        name: convertedMatch.teams.away.name,
                                        logo: convertedMatch.teams.away.logo
                                    },
                                    score: {
                                        home: convertedMatch.goals?.home ?? 0,
                                        away: convertedMatch.goals?.away ?? 0
                                    },
                                    status: {
                                        short: convertedMatch.fixture.status.short,
                                        long: convertedMatch.fixture.status.long,
                                        elapsed: convertedMatch.fixture.status.elapsed
                                    },
                                    league: {
                                        name: convertedMatch.league.name,
                                        logo: convertedMatch.league.logo
                                    },
                                    time: new Date(convertedMatch.fixture.date).toLocaleTimeString('en-US', { 
                                        hour: '2-digit', 
                                        minute: '2-digit',
                                        hour12: true
                                    }),
                                    date: convertedMatch.fixture.date
                                })
                            } else {
                                // Match finished
                                hasChanges = true
                                console.log(`    🏁 Match finished: ${homeName} vs ${awayName} (${status}) - Final Score: ${convertedMatch.goals?.home ?? 0}-${convertedMatch.goals?.away ?? 0}`)
                                
                                // Update database with finished match (including events/scorers)
                                const matchDetails = await fetchMatchDetails(dbMatch.fixtureId, true)
                                if (matchDetails && matchDetails.events && matchDetails.events.length > 0) {
                                    convertedMatch.events = matchDetails.events
                                    console.log(`    ⚽ Fetched ${matchDetails.events.length} events (scorers, cards, etc.)`)
                                }
                                await Match.findOneAndUpdate(
                                    { fixtureId: convertedMatch.fixtureId },
                                    convertedMatch,
                                    { upsert: true, new: true }
                                )
                            }
                        } else {
                            console.log(`    ⚠️ No data from API for fixture ${dbMatch.fixtureId}`)
                            // Keep the match if API doesn't return data
                            updatedMatches.push(match)
                        }
                    } else {
                        console.log(`    ⚠️ API error: ${fixtureResponse.status} ${fixtureResponse.statusText}`)
                        // Keep the match if API error
                        updatedMatches.push(match)
                    }
                    
                    // Rate limit protection
                    await new Promise(resolve => setTimeout(resolve, 500))
                } catch (error) {
                    console.log(`    ❌ Error checking match ${homeName} vs ${awayName}:`, error.message)
                    // Keep the match if we can't check it
                    updatedMatches.push(match)
                }
            } else {
                console.log(`    ⚠️ Match not found in database: ${homeName} vs ${awayName}`)
                // Keep the match if not found in database
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
                await autoPostTodayMatches()
            } else {
                // Some matches finished, update post with remaining live matches
                todayPost.footballData = JSON.stringify(updatedMatches)
                await todayPost.save()
                
                console.log(`  ✅ Updated feed post: Removed finished matches, ${updatedMatches.length} live matches remaining`)
                
                // Emit socket event
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
                                matchData: updatedMatches,
                                updatedAt: new Date()
                            })
                            onlineCount++
                        }
                    })
                    
                    console.log(`  📡 Emitted update to ${onlineCount} online followers`)
                }
            }
        } else {
            console.log(`  ✅ All matches in feed post are still live (no changes)`)
        }
    } catch (error) {
        console.error('❌ Error in forceCheckFeedPostMatches:', error)
        console.error('❌ Stack:', error.stack)
    }
}

export const manualPostTodayMatches = async (req, res) => {
    try {
        console.log('⚽ [manualPostTodayMatches] Manual post trigger received')
        console.log('⚽ [manualPostTodayMatches] User:', req.user ? req.user.username : 'Not authenticated')
        
        // FIRST: Force check existing feed post matches against API
        await forceCheckFeedPostMatches()
        
        // THEN: Use the auto-post function (reuse logic)
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

