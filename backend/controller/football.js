import { Match, League } from '../models/football.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getUserSocketMap } from '../socket/socket.js'

// football-data.org API configuration
// API token from www.football-data.org
const getAPIKey = () => '5449eacc047c4b529267d309d166d09b'
const API_BASE_URL = 'https://api.football-data.org/v4'
const CURRENT_SEASON = new Date().getFullYear() // Current year (e.g., 2025)

// Supported leagues and competitions (football-data.org competition codes)
// Competition codes: PL=Premier League, PD=La Liga, SA=Serie A, BL1=Bundesliga, FL1=Ligue 1, CL=Champions League
const SUPPORTED_LEAGUES = [
    { id: 'PL', name: 'Premier League', country: 'England' },
    { id: 'PD', name: 'La Liga', country: 'Spain' },
    { id: 'SA', name: 'Serie A', country: 'Italy' },
    { id: 'BL1', name: 'Bundesliga', country: 'Germany' },
    { id: 'FL1', name: 'Ligue 1', country: 'France' },
    { id: 'CL', name: 'UEFA Champions League', country: 'Europe' }
]

// Map football-data.org status codes to our internal format
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

// Helper: Fetch match details with events (scorers, cards, substitutions) - football-data.org
// Note: football-data.org doesn't provide detailed events in free tier, so this is simplified
// For finished matches, we'll try to extract basic info from the match response
export const fetchMatchDetails = async (matchId, includeEvents = true) => {
    try {
        // Import cache module once (reuse throughout function)
        const cacheModule = await import('../services/footballCache.js')
        
        // Check cache first (saves API calls!)
        const cachedDetails = cacheModule.getCachedMatchDetails(matchId)
        
        if (cachedDetails) {
            console.log(`  📦 [Cache] Using cached match details for match ${matchId} (saving API call!)`)
            return cachedDetails
        }
        
        const apiKey = getAPIKey()
        if (!apiKey) {
            console.error(`  ❌ No API key configured for football-data.org`)
            return { events: [], elapsedTime: null }
        }
        
        console.log(`  🔍 Fetching match details for match ID: ${matchId} (cache miss)`)
        
        // football-data.org: Get match details
        const matchUrl = `${API_BASE_URL}/matches/${matchId}`
        
        const matchResponse = await fetch(matchUrl, {
            method: 'GET',
            headers: {
                'X-Auth-Token': apiKey
            }
        })
        
        if (!matchResponse.ok) {
            console.error(`  ❌ Failed to fetch match ${matchId}:`, matchResponse.status, matchResponse.statusText)
            if (matchResponse.status === 429) {
                console.error(`  🚫 Rate limit exceeded for match ${matchId}`)
            }
            return { events: [], elapsedTime: null }
        }
        
        const matchData = await matchResponse.json()
        
        if (!matchData || !matchData.id) {
            console.log(`  ⚠️ No match data found for ID: ${matchId}`)
            return { events: [], elapsedTime: null }
        }
        
        const events = []
        let elapsedTime = null
        
        // football-data.org free tier doesn't provide detailed events (scorers, cards)
        // We can only extract basic info from the match response
        // For events, we'd need to use a different endpoint or paid tier
        // For now, return empty events array - can be enhanced later if needed
        
        // Extract elapsed time from score (if available)
        if (matchData.score?.fullTime?.home !== null || matchData.score?.fullTime?.away !== null) {
            // Match is finished or in progress
            if (matchData.status === 'LIVE' || matchData.status === 'IN_PLAY') {
                // Estimate elapsed time (football-data.org doesn't provide minute-by-minute in free tier)
                // We can calculate approximate elapsed from match start time
                const matchStart = new Date(matchData.utcDate)
                const now = new Date()
                const diffMs = now - matchStart
                const diffMinutes = Math.floor(diffMs / (1000 * 60))
                elapsedTime = Math.min(diffMinutes, 90) // Cap at 90 minutes
            }
        }
        
        const result = { events, elapsedTime }
        
        // Cache the result for 10 minutes (football-data.org has stricter rate limits)
        cacheModule.setCachedMatchDetails(matchId, result)
        
        return result
    } catch (error) {
        console.error(`  ❌ Error fetching match ${matchId}:`, error.message)
        console.error(`  ❌ Stack:`, error.stack)
        return { events: [], elapsedTime: null }
    }
}

// Helper: Fetch from football-data.org API
const fetchFromAPI = async (endpoint) => {
    try {
        const apiKey = getAPIKey()
        if (!apiKey) {
            console.error('⚽ [fetchFromAPI] No API key configured! Set FOOTBALL_API_KEY or FOOTBALL_DATA_API_KEY in .env')
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
        
        // Handle rate limit (429 status)
        if (response.status === 429) {
            console.error('🚫 [fetchFromAPI] RATE LIMIT HIT!')
            // Check rate limit headers if available
            const remainingRequests = response.headers.get('X-Requests-Available')
            const resetTime = response.headers.get('X-RequestCounter-Reset')
            if (remainingRequests !== null) {
                console.error(`  Remaining requests: ${remainingRequests}, Reset at: ${resetTime}`)
            }
            return { success: false, error: 'Rate limit exceeded', rateLimit: true }
        }
        
        // Handle authentication errors (401)
        if (response.status === 401) {
            console.error('🔑 [fetchFromAPI] Authentication failed! Check your FOOTBALL_API_KEY in .env')
            return { success: false, error: 'API key authentication failed', rateLimit: false }
        }
        
        const data = await response.json()
        
        // Check for API errors in response
        if (data.errorCode || data.message) {
            const errorMsg = data.message || `Error ${data.errorCode || 'Unknown'}`
            console.error('⚽ [fetchFromAPI] API Error:', errorMsg)
            
            // Check if it's a rate limit error
            const errorLower = errorMsg.toLowerCase()
            if (errorLower.includes('rate limit') || errorLower.includes('quota') || errorLower.includes('limit exceeded')) {
                console.error('🚫 [fetchFromAPI] Rate limit/quota exceeded!')
                return { success: false, error: errorMsg, rateLimit: true }
            }
            
            return { success: false, error: errorMsg }
        }
        
        if (response.ok && data) {
            // football-data.org returns data directly (not wrapped in response array)
            // For matches endpoint, data.matches is an array
            // For single match, data is the match object itself
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
        console.error('⚽ [fetchFromAPI] Error stack:', error.stack)
        return { success: false, error: error.message }
    }
}

// Helper: Convert football-data.org match format to our database format
const convertMatchFormat = (matchData) => {
    // football-data.org response structure:
    // {
    //   id, competition: {id, name, area: {name}}, homeTeam: {id, name, crest}, 
    //   awayTeam: {id, name, crest}, score: {fullTime: {home, away}}, 
    //   status, utcDate, venue, matchday
    // }
    
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
        elapsed = Math.max(0, Math.min(diffMinutes, 90)) // Cap between 0-90 minutes
    } else if (apiStatus === 'PAUSED') {
        // Half time - assume around 45 minutes
        elapsed = 45
    }
    
    // Get scores (football-data.org uses score.fullTime)
    const score = matchData.score || {}
    const fullTime = score.fullTime || {}
    const homeScore = fullTime.home !== null && fullTime.home !== undefined ? fullTime.home : null
    const awayScore = fullTime.away !== null && fullTime.away !== undefined ? fullTime.away : null
    
    // football-data.org free tier doesn't provide detailed events (scorers, cards)
    // Events array will be empty - can be populated from other sources if needed
    const events = []
    
    return {
        fixtureId: matchData.id, // Use match ID as fixtureId
        league: {
            id: competition.id || competition.code || '', // Competition code (PL, CL, etc.)
            name: competition.name || 'Unknown League',
            country: area.name || 'Unknown',
            logo: competition.emblem || '', // Competition emblem
            flag: area.flag || '', // Country flag
            season: CURRENT_SEASON // Use current season
        },
        teams: {
            home: {
                id: matchData.homeTeam?.id || 0,
                name: matchData.homeTeam?.name || 'Unknown Team',
                logo: matchData.homeTeam?.crest || '' // football-data.org uses 'crest' not 'logo'
            },
            away: {
                id: matchData.awayTeam?.id || 0,
                name: matchData.awayTeam?.name || 'Unknown Team',
                logo: matchData.awayTeam?.crest || '' // football-data.org uses 'crest' not 'logo'
            }
        },
        fixture: {
            date: new Date(matchData.utcDate || matchData.date || new Date()),
            venue: matchData.venue || '',
            city: '', // football-data.org doesn't provide city in free tier
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
        events: events, // Empty - free tier doesn't provide detailed events
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
        // football-data.org: Get all live matches (status=LIVE or IN_PLAY)
        // Note: Can also use status=IN_PLAY for more specificity
        const result = await fetchFromAPI('/matches?status=LIVE')
        
        if (!result.success) {
            if (result.rateLimit) {
                console.warn('🚫 Rate limit hit while fetching live matches')
            }
            return res.status(500).json({ error: result.error })
        }
        
        const liveMatches = result.data || []
        let updatedCount = 0
        
        console.log(`⚽ [fetchLiveMatches] Fetched ${liveMatches.length} live matches`)
        
        // Filter for supported leagues only (competition codes)
        const supportedLeagueIds = SUPPORTED_LEAGUES.map(l => l.id)
        const filteredMatches = liveMatches.filter(match => {
            const competitionId = match.competition?.id || match.competition?.code || ''
            return supportedLeagueIds.includes(competitionId)
        })
        
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
            // football-data.org: Use competition endpoint with date filters
            // Format: /competitions/{code}/matches?dateFrom={date}&dateTo={date}
            const targetDate = date || new Date().toISOString().split('T')[0]
            const dateFrom = targetDate
            const dateTo = targetDate
            
            const endpoint = `/competitions/${league.id}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`
            
            const result = await fetchFromAPI(endpoint)
            
            if (result.success && result.data) {
                // result.data is already an array of matches from football-data.org
                allFixtures.push(...result.data)
                
                // Rate limit protection: Wait 1 second between league requests
                await new Promise(resolve => setTimeout(resolve, 1000))
            } else if (result.rateLimit) {
                console.warn(`⚠️ Rate limit hit while fetching ${league.name} fixtures`)
                break // Stop fetching if rate limited
            }
        }
        
        // Store fixtures in database
        let storedCount = 0
        for (const matchData of allFixtures) {
            const convertedMatch = convertMatchFormat(matchData)
            
            // For upcoming/scheduled matches, no events yet
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
        // Map our query status to database status codes (compatible with both old and new API formats)
        if (status) {
            if (status === 'live') {
                // Live matches: 1H, 2H, HT, ET, P (First Half, Second Half, Half Time, Extra Time, Penalties)
                // Also include LIVE, IN_PLAY, PAUSED from football-data.org
                query['fixture.status.short'] = { $in: ['1H', '2H', 'HT', 'ET', 'P', 'LIVE', 'IN_PLAY', 'PAUSED'] }
                console.log('⚽ [getMatches] Filtering for LIVE matches')
            } else if (status === 'finished') {
                // Finished matches: FT (Full Time), also handle FINISHED from football-data.org
                query['fixture.status.short'] = { $in: ['FT', 'FINISHED'] }
                console.log('⚽ [getMatches] Filtering for FINISHED matches')
            } else if (status === 'upcoming') {
                // Upcoming matches: NS (Not Started), also handle SCHEDULED from football-data.org
                query['fixture.status.short'] = { $in: ['NS', 'SCHEDULED'] }
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
        const { leagueId } = req.params // This is now a competition code (PL, CL, etc.)
        
        // football-data.org: /competitions/{code}/standings
        const result = await fetchFromAPI(`/competitions/${leagueId}/standings`)
        
        if (!result.success) {
            return res.status(500).json({ error: result.error })
        }
        
        // football-data.org returns: { standings: [{ table: [{ ... }] }] }
        // Each table array contains team standings
        const standingsData = result.data?.standings?.[0]?.table
        
        if (!standingsData || standingsData.length === 0) {
            return res.status(404).json({ error: 'No standings found' })
        }
        
        // Store in database (football-data.org format)
        const standings = standingsData.map(team => ({
            rank: team.position || team.rank,
            team: {
                id: team.team?.id || 0,
                name: team.team?.name || 'Unknown Team',
                logo: team.team?.crest || ''
            },
            points: team.points || 0,
            played: team.playedGames || 0,
            win: team.won || 0,
            draw: team.draw || 0,
            lose: team.lost || 0,
            goalsFor: team.goalsFor || 0,
            goalsAgainst: team.goalsAgainst || 0,
            goalsDiff: team.goalDifference || 0
        }))
        
        // Get competition info from result or use defaults
        const competitionInfo = result.data?.competition || {}
        const area = competitionInfo.area || {}
        
        await League.findOneAndUpdate(
            { leagueId: leagueId }, // Store competition code as leagueId
            {
                leagueId: leagueId,
                name: competitionInfo.name || 'Unknown League',
                country: area.name || 'Unknown',
                logo: competitionInfo.emblem || '',
                flag: area.flag || '',
                season: CURRENT_SEASON,
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
        const { leagueId } = req.params // Competition code (PL, CL, etc.)
        
        // Try to find by leagueId (could be string code or number ID from old data)
        let league = await League.findOne({ leagueId: leagueId })
        
        // If not found, try to find by integer ID (for backward compatibility)
        if (!league && !isNaN(parseInt(leagueId))) {
            league = await League.findOne({ leagueId: parseInt(leagueId) })
        }
        
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
        console.log('⚽ [manualFetchFixtures] Using football-data.org API')
        
        const today = new Date()
        
        // Fetch for past 3 days (for finished matches) and next 7 days (for upcoming)
        const startDate = new Date(today)
        startDate.setDate(startDate.getDate() - 3) // 3 days ago
        const startDateStr = startDate.toISOString().split('T')[0]
        
        const endDate = new Date(today)
        endDate.setDate(endDate.getDate() + 7) // 7 days ahead
        const endDateStr = endDate.toISOString().split('T')[0]
        
        console.log('⚽ [manualFetchFixtures] Fetching fixtures from', startDateStr, 'to', endDateStr)
        
        let totalFetched = 0
        const results = []
        const leagueResults = {}
        
        // Fetch fixtures for each supported league (football-data.org uses dateFrom/dateTo range)
        for (const league of SUPPORTED_LEAGUES) {
            console.log(`⚽ [manualFetchFixtures] Fetching ${league.name} (${league.id})...`)
            
            // football-data.org: /competitions/{code}/matches?dateFrom={date}&dateTo={date}
            const endpoint = `/competitions/${league.id}/matches?dateFrom=${startDateStr}&dateTo=${endDateStr}`
            const result = await fetchFromAPI(endpoint)
            
            if (result.rateLimit) {
                console.warn(`🚫 [manualFetchFixtures] Rate limit hit, stopping fetch`)
                break
            }
            
            if (result.success && result.data && result.data.length > 0) {
                console.log(`  ✅ Found ${result.data.length} matches for ${league.name}`)
                
                // Save each match to database
                for (const matchData of result.data) {
                    const convertedMatch = convertMatchFormat(matchData)
                    
                    // For finished matches: Try to fetch events (football-data.org free tier may not have detailed events)
                    const isFinished = convertedMatch.fixture?.status?.short === 'FT' || 
                                      convertedMatch.fixture?.status?.short === 'FINISHED'
                    
                    if (isFinished && (!convertedMatch.events || convertedMatch.events.length === 0)) {
                        try {
                            // Note: football-data.org free tier doesn't provide detailed events
                            // This is just for structure - events will likely be empty
                            const matchDetails = await fetchMatchDetails(convertedMatch.fixtureId, true)
                            if (matchDetails && matchDetails.events && matchDetails.events.length > 0) {
                                convertedMatch.events = matchDetails.events
                                console.log(`    ✅ Fetched ${matchDetails.events.length} events for finished match ${convertedMatch.fixtureId}`)
                            }
                        } catch (error) {
                            // Silent fail - events not available in free tier
                        }
                    }
                    
                    await Match.findOneAndUpdate(
                        { fixtureId: convertedMatch.fixtureId },
                        convertedMatch,
                        { upsert: true, new: true }
                    )
                    totalFetched++
                    
                    // Track by league
                    if (!leagueResults[league.name]) {
                        leagueResults[league.name] = 0
                    }
                    leagueResults[league.name]++
                }
            } else {
                console.log(`  ⚠️ No matches found for ${league.name} or API error`)
            }
            
            // Rate limit protection: Wait 7 seconds between league requests (10 req/min = 6 sec between, use 7 for safety)
            await new Promise(resolve => setTimeout(resolve, 7000))
        }
        
        // Format results
        for (const league of SUPPORTED_LEAGUES) {
            results.push({
                league: league.name,
                id: league.id,
                matches: leagueResults[league.name] || 0
            })
        }
        
        console.log(`✅ [manualFetchFixtures] COMPLETE! Total matches fetched: ${totalFetched}`)
        console.log(`📊 [manualFetchFixtures] Results by league:`, results)
        
        // Emit real-time update to Football page after manual fetch
        try {
            const { emitFootballPageUpdate } = await import('../services/footballCron.js')
            if (emitFootballPageUpdate) {
                await emitFootballPageUpdate()
            }
        } catch (error) {
            console.error('⚠️ [manualFetchFixtures] Could not emit football page update:', error.message)
        }
        
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
                        ['1H', '2H', 'HT', 'LIVE', 'IN_PLAY', 'PAUSED', 'ET', 'P', 'BT'].includes(match.status?.short)
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
        
        // Get today's matches: ONLY LIVE matches (currently happening)
        // football-data.org: Get all live matches (status=LIVE or IN_PLAY)
        const result = await fetchFromAPI('/matches?status=LIVE')
        
        // Track which matches are currently live (for finish detection)
        const currentlyLiveFixtureIds = new Set()
        
        // If API call successful, save matches to database
        if (result.success && result.data) {
            // Filter for matches from supported leagues (competition codes)
            const supportedLeagueIds = SUPPORTED_LEAGUES.map(l => l.id)
            const filteredMatches = result.data.filter(match => {
                const competitionId = match.competition?.id || match.competition?.code || ''
                return supportedLeagueIds.includes(competitionId)
            })
            
            if (filteredMatches.length > 0) {
                // Process and save matches to database
                for (const matchData of filteredMatches) {
                    const convertedMatch = convertMatchFormat(matchData)
                    // Track this match as currently live
                    currentlyLiveFixtureIds.add(convertedMatch.fixtureId)
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
        
        // CRITICAL: Detect and update finished matches
        // If a match was previously live in database but NOT in current API response, it finished!
        const previouslyLiveMatches = await Match.find({
            'fixture.date': { $gte: todayStart, $lte: todayEnd },
            'fixture.status.short': { 
                $in: ['1H', '2H', 'HT', 'ET', 'P', 'BT', 'LIVE', 'IN_PLAY', 'PAUSED']  // Previously live statuses
            }
        })
        
        console.log(`🔍 [autoPostTodayMatches] Checking ${previouslyLiveMatches.length} previously live matches to see if they finished...`)
        
        for (const dbMatch of previouslyLiveMatches) {
            // If match was live but not in current live API response, mark as finished
            if (!currentlyLiveFixtureIds.has(dbMatch.fixtureId)) {
                console.log(`  🏁 Match finished: ${dbMatch.teams?.home?.name} vs ${dbMatch.teams?.away?.name} (not in live API response)`)
                
                // Update status to FINISHED in database
                await Match.findOneAndUpdate(
                    { fixtureId: dbMatch.fixtureId },
                    { 
                        'fixture.status.short': 'FT',
                        'fixture.status.long': 'Full Time',
                        'fixture.status.elapsed': 90 // Assume 90 minutes for finished matches
                    }
                )
            }
        }
        
        // Always query database for live matches (either from API above or from previous fetches)
        // Reuse 'now' from above, create new one only if needed
        const currentTime = new Date()
        let matches = await Match.find({
            'fixture.date': { $gte: todayStart, $lte: todayEnd },
            'fixture.status.short': { 
                $in: ['1H', '2H', 'HT', 'ET', 'P', 'BT', 'LIVE', 'IN_PLAY', 'PAUSED']  // LIVE matches (both old and new status codes)
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
                'fixture.status.short': { $in: ['1H', '2H', 'HT', 'ET', 'P', 'BT', 'LIVE', 'IN_PLAY', 'PAUSED'] }
            }).limit(10)
            
            if (liveMatchesInDB.length > 0) {
                console.log(`  ⚠️ Found ${liveMatchesInDB.length} live matches in database but no feed post - checking their status...`)
                
                // EFFICIENT: Fetch all live matches once instead of checking each individually
                let currentLiveFixtureIds = new Set()
                try {
                    const liveResult = await fetchFromAPI('/matches?status=LIVE')
                    if (liveResult.success && liveResult.data) {
                        liveResult.data.forEach(m => {
                            currentLiveFixtureIds.add(m.id)
                        })
                    }
                } catch (error) {
                    console.log(`  ⚠️ Could not fetch live matches: ${error.message}`)
                }
                
                // Check each match: if not in live response, it finished
                for (const dbMatch of liveMatchesInDB) {
                    if (!currentLiveFixtureIds.has(dbMatch.fixtureId)) {
                        console.log(`  🏁 Match finished: ${dbMatch.teams?.home?.name} vs ${dbMatch.teams?.away?.name} (not in live API response)`)
                        
                        // Update status to finished
                        await Match.findOneAndUpdate(
                            { fixtureId: dbMatch.fixtureId },
                            { 
                                'fixture.status.short': 'FT',
                                'fixture.status.long': 'Full Time',
                                'fixture.status.elapsed': 90
                            }
                        )
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
                'fixture.status.short': { $in: ['1H', '2H', 'HT', 'ET', 'P', 'BT', 'LIVE', 'IN_PLAY', 'PAUSED'] }
            }).limit(10)
            
            if (liveMatchesInDB.length > 0) {
                console.log(`  ⚠️ Found ${liveMatchesInDB.length} live matches in database but feed post is empty - checking their status...`)
                
                // EFFICIENT: Fetch all live matches once instead of checking each individually
                let currentLiveFixtureIds = new Set()
                try {
                    const liveResult = await fetchFromAPI('/matches?status=LIVE')
                    if (liveResult.success && liveResult.data) {
                        liveResult.data.forEach(m => {
                            currentLiveFixtureIds.add(m.id)
                        })
                    }
                } catch (error) {
                    console.log(`  ⚠️ Could not fetch live matches: ${error.message}`)
                }
                
                // Check each match: if not in live response, it finished
                for (const dbMatch of liveMatchesInDB) {
                    if (!currentLiveFixtureIds.has(dbMatch.fixtureId)) {
                        console.log(`  🏁 Match finished: ${dbMatch.teams?.home?.name} vs ${dbMatch.teams?.away?.name} (not in live API response)`)
                        
                        // Update status to finished
                        await Match.findOneAndUpdate(
                            { fixtureId: dbMatch.fixtureId },
                            { 
                                'fixture.status.short': 'FT',
                                'fixture.status.long': 'Full Time',
                                'fixture.status.elapsed': 90
                            }
                        )
                    }
                }
                
                // Refresh the feed post
                console.log('  🔄 Refreshing feed post...')
                await autoPostTodayMatches()
            }
            return
        }
        
        console.log(`🔍 [forceCheckFeedPostMatches] Checking ${matchDataArray.length} matches in feed post against API...`)
        
        // IMPROVED: Instead of checking each match individually (expensive!), 
        // fetch all live matches once and compare
        // This is much more efficient for football-data.org rate limits
        let currentLiveFixtureIds = new Set()
        try {
            const liveResult = await fetchFromAPI('/matches?status=LIVE')
            if (liveResult.success && liveResult.data) {
                liveResult.data.forEach(m => {
                    currentLiveFixtureIds.add(m.id)
                })
                console.log(`  ✅ Fetched ${currentLiveFixtureIds.size} currently live matches from API`)
            }
        } catch (error) {
            console.log(`  ⚠️ Could not fetch live matches: ${error.message}`)
        }
        
        // Check each match in feed post against football-data.org
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
                // EFFICIENT: Check if match is in current live matches (from API we fetched above)
                // This avoids individual API calls per match!
                const isCurrentlyLive = currentLiveFixtureIds.has(dbMatch.fixtureId)
                
                if (isCurrentlyLive) {
                    // Match is still live - update from database (which should be updated by cron)
                    const updatedDbMatch = await Match.findOne({ fixtureId: dbMatch.fixtureId })
                    if (updatedDbMatch) {
                        updatedMatches.push({
                            homeTeam: {
                                name: updatedDbMatch.teams.home.name,
                                logo: updatedDbMatch.teams.home.logo
                            },
                            awayTeam: {
                                name: updatedDbMatch.teams.away.name,
                                logo: updatedDbMatch.teams.away.logo
                            },
                            score: {
                                home: updatedDbMatch.goals?.home ?? 0,
                                away: updatedDbMatch.goals?.away ?? 0
                            },
                            status: {
                                short: updatedDbMatch.fixture.status.short,
                                long: updatedDbMatch.fixture.status.long,
                                elapsed: updatedDbMatch.fixture.status.elapsed
                            },
                            league: {
                                name: updatedDbMatch.league.name,
                                logo: updatedDbMatch.league.logo
                            },
                            time: new Date(updatedDbMatch.fixture.date).toLocaleTimeString('en-US', { 
                                hour: '2-digit', 
                                minute: '2-digit',
                                hour12: true
                            }),
                            date: updatedDbMatch.fixture.date
                        })
                        console.log(`    ✅ Match still live: ${homeName} vs ${awayName}`)
                    } else {
                        // Match not found in updated DB, keep original
                        updatedMatches.push(match)
                    }
                } else {
                    // Match was live but NOT in current live API response = it finished!
                    hasChanges = true
                    console.log(`    🏁 Match finished: ${homeName} vs ${awayName} (not in live API response)`)
                    
                    // Update database to mark as finished
                    await Match.findOneAndUpdate(
                        { fixtureId: dbMatch.fixtureId },
                        { 
                            'fixture.status.short': 'FT',
                            'fixture.status.long': 'Full Time',
                            'fixture.status.elapsed': 90
                        }
                    )
                    // Don't add to updatedMatches - it's finished, remove from feed post
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

