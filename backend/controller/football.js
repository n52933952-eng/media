import { Match, League } from '../models/football.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import Follow from '../models/follow.js'
import { getIO, getUserSocketMap, getAllUserSockets } from '../socket/socket.js'

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

/**
 * football-data.org (free tier) does not expose the official match minute.
 * Old logic used "minutes since kickoff" capped at 90 — wrong in the 2nd half (half-time not removed),
 * so the clock looked like 70'+ when the real match was ~55'.
 *
 * Heuristic (recomputed often via getMatches for live games):
 * - 1H / LIVE: wall minutes since kickoff, capped for 1st-half stoppage.
 * - 2H / IN_PLAY: 45 + max(0, wallMin - 60) (~45' play + ~15' HT before 2nd half clock starts).
 * - HT / PAUSED: no minute (UI shows half-time).
 */
function refreshLiveElapsedMinute(matchLike) {
    const short = String(matchLike?.fixture?.status?.short || '').toUpperCase()
    const kick = matchLike?.fixture?.date ? new Date(matchLike.fixture.date) : null
    if (!kick || Number.isNaN(kick.getTime())) {
        return matchLike?.fixture?.status?.elapsed ?? null
    }

    const wallMin = Math.floor((Date.now() - kick.getTime()) / (1000 * 60))

    if (short === 'HT' || short === 'PAUSED') return null

    if (short === '1H' || short === 'LIVE') {
        return Math.min(Math.max(wallMin, 0), 54)
    }

    if (short === '2H' || short === 'IN_PLAY') {
        const approx = 45 + Math.max(0, wallMin - 60)
        return Math.min(Math.max(approx, 45), 95)
    }

    if (short === 'ET') {
        const approx = 90 + Math.max(0, wallMin - 105)
        return Math.min(Math.max(approx, 90), 120)
    }

    if (short === 'P') return 90

    return matchLike?.fixture?.status?.elapsed ?? null
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
    
    // Get scores (football-data.org uses score.fullTime)
    const score = matchData.score || {}
    const fullTime = score.fullTime || {}
    const homeScore = fullTime.home !== null && fullTime.home !== undefined ? fullTime.home : null
    const awayScore = fullTime.away !== null && fullTime.away !== undefined ? fullTime.away : null
    
    // football-data.org free tier doesn't provide detailed events (scorers, cards)
    // Events array will be empty - can be populated from other sources if needed
    const events = []
    
    const converted = {
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
                elapsed: null,
            }
        },
        goals: {
            home: homeScore,
            away: awayScore
        },
        events: events, // Empty - free tier doesn't provide detailed events
        lastUpdated: new Date()
    }

    converted.fixture.status.elapsed = refreshLiveElapsedMinute(converted)

    return converted
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

        // Live: recompute display minute on every request (DB value may be stale; old formula was wrong for 2nd half)
        if (status === 'live' && matches.length > 0) {
            matches = matches.map((m) => {
                const o = typeof m.toObject === 'function' ? m.toObject() : m
                if (!o.fixture?.status) return o
                return {
                    ...o,
                    fixture: {
                        ...o.fixture,
                        status: {
                            ...o.fixture.status,
                            elapsed: refreshLiveElapsedMinute(o),
                        },
                    },
                }
            })
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

// 6. Match update → feed post (disabled — Football screen uses Match collection + sockets, not Post)
export const postMatchUpdate = async (req, res) => {
    try {
        const { fixtureId } = req.body
        const match = await Match.findOne({ fixtureId })
        if (!match) {
            return res.status(404).json({ error: 'Match not found' })
        }
        return res.status(200).json({
            message: 'Football feed posts disabled; match updates are not stored as Post documents.',
            feedPostsDisabled: true,
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

// 9. Auto-post today's matches (called by cron or manually) — feed posts disabled; Match collection powers Football screen.
export const autoPostTodayMatches = async () => {
    try {
        const footballAccount = await getFootballAccount()
        if (!footballAccount) {
            console.error('❌ [autoPostTodayMatches] Football account not found!')
            return { success: false, error: 'Football account not found' }
        }
        try {
            const del = await Post.deleteMany({ postedBy: footballAccount._id })
            if (del.deletedCount > 0) {
                console.log('🗑️ [autoPostTodayMatches] Removed ' + del.deletedCount + ' legacy football post(s)')
            }
        } catch (e) {
            console.warn('⚠️ [autoPostTodayMatches] Could not prune legacy football posts:', e.message)
        }
        console.log('⚽ [autoPostTodayMatches] Feed posts disabled; skipping post creation.')
        return { success: true, postId: null, matchesPosted: 0, noMatches: false, feedPostsDisabled: true }
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

// Helper: Legacy feed-post checker (disabled — no Football posts in Post collection)
export const forceCheckFeedPostMatches = async () => {
    console.log('📭 [forceCheckFeedPostMatches] Skipped (feed football posts disabled)')
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
            message: result.feedPostsDisabled
                ? 'Football feed posts disabled; legacy posts pruned. Matches are served from the Match collection / APIs.'
                : result.noMatches
                  ? 'No live or upcoming matches in the next 24 hours'
                  : `Posted ${result.matchesPosted || 0} matches to feed`,
            postId: result.postId,
            matchesPosted: result.matchesPosted || 0,
            posted: !result.feedPostsDisabled,
            noMatches: result.noMatches || false,
            feedPostsDisabled: !!result.feedPostsDisabled,
            post: result.postId ? await Post.findById(result.postId).populate("postedBy", "username profilePic name") : null
        })
        
    } catch (error) {
        console.error('❌ [manualPostTodayMatches] Error:', error)
        res.status(500).json({ error: error.message })
    }
}

