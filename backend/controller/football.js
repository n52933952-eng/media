import { Match, League } from '../models/football.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getUserSocketMap } from '../socket/socket.js'

// API-FOOTBALL configuration (add your key to .env)
const API_KEY = process.env.FOOTBALL_API_KEY || 'f3ebe896455cab31fc80e859716411df'
const API_BASE_URL = 'https://v3.football.api-sports.io'

// Supported leagues (you can add more)
const SUPPORTED_LEAGUES = [
    { id: 39, name: 'Premier League', country: 'England' },
    { id: 140, name: 'La Liga', country: 'Spain' },
    { id: 2, name: 'UEFA Champions League', country: 'World' },
    { id: 135, name: 'Serie A', country: 'Italy' },
    { id: 78, name: 'Bundesliga', country: 'Germany' },
    { id: 61, name: 'Ligue 1', country: 'France' }
]

// Helper: Fetch from API-FOOTBALL
const fetchFromAPI = async (endpoint) => {
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'GET',
            headers: {
                'x-rapidapi-key': API_KEY,
                'x-rapidapi-host': 'v3.football.api-sports.io'
            }
        })
        
        const data = await response.json()
        
        if (response.ok && data.response) {
            return { success: true, data: data.response }
        } else {
            console.error('API-FOOTBALL Error:', data.errors || 'Unknown error')
            return { success: false, error: data.errors || 'Failed to fetch from API' }
        }
    } catch (error) {
        console.error('API-FOOTBALL Fetch Error:', error)
        return { success: false, error: error.message }
    }
}

// Helper: Get or create football system account
const getFootballAccount = async () => {
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
            const endDate = new Date(date)
            endDate.setDate(endDate.getDate() + 1)
            
            query['fixture.date'] = {
                $gte: startDate,
                $lt: endDate
            }
            console.log('⚽ [getMatches] Filtering by date:', { date, startDate, endDate })
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
        
        const matches = await Match.find(query)
            .sort({ 'fixture.date': -1 })
            .limit(50)
        
        console.log('⚽ [getMatches] Found matches:', matches.length)
        if (matches.length > 0) {
            console.log('⚽ [getMatches] Sample match:', {
                fixtureId: matches[0].fixtureId,
                teams: `${matches[0].teams?.home?.name} vs ${matches[0].teams?.away?.name}`,
                status: matches[0].fixture?.status?.short,
                date: matches[0].fixture?.date
            })
        } else {
            console.log('⚽ [getMatches] No matches found with query. Checking if database has any matches at all...')
            const anyMatch = await Match.findOne({})
            if (anyMatch) {
                console.log('⚽ [getMatches] Database has matches, but query returned none. Sample match in DB:', {
                    fixtureId: anyMatch.fixtureId,
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

