import cron from 'node-cron'
import { Match } from '../models/football.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getUserSocketMap } from '../socket/socket.js'

// API-FOOTBALL configuration
const API_KEY = process.env.FOOTBALL_API_KEY || 'f3ebe896455cab31fc80e859716411df'
const API_BASE_URL = 'https://v3.football.api-sports.io'

// Supported leagues
const SUPPORTED_LEAGUES = [39, 140, 2, 135, 78, 61] // Premier, La Liga, Champions, Serie A, Bundesliga, Ligue 1

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
            console.error('⚽ API-FOOTBALL Error:', data.errors || 'Unknown error')
            return { success: false, error: data.errors || 'Failed to fetch from API' }
        }
    } catch (error) {
        console.error('⚽ API-FOOTBALL Fetch Error:', error)
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
        
        console.log(`✅ Auto-posted: ${updateType} for ${match.teams.home.name} vs ${match.teams.away.name}`)
        
    } catch (error) {
        console.error('❌ Error auto-posting match update:', error)
    }
}

// 1. Fetch live matches and update database
const fetchAndUpdateLiveMatches = async () => {
    try {
        console.log('⚽ Fetching live matches...')
        
        const result = await fetchFromAPI('/fixtures?live=all')
        
        if (!result.success) {
            console.error('❌ Failed to fetch live matches')
            return
        }
        
        const liveMatches = result.data
        
        if (liveMatches.length === 0) {
            console.log('📭 No live matches at the moment')
            return
        }
        
        console.log(`📊 Found ${liveMatches.length} live matches`)
        
        for (const matchData of liveMatches) {
            // Get previous state
            const previousMatch = await Match.findOne({ fixtureId: matchData.fixture.id })
            
            const previousGoalsHome = previousMatch?.goals?.home || 0
            const previousGoalsAway = previousMatch?.goals?.away || 0
            const currentGoalsHome = matchData.goals.home || 0
            const currentGoalsAway = matchData.goals.away || 0
            
            // Update match in database
            const updatedMatch = await Match.findOneAndUpdate(
                { fixtureId: matchData.fixture.id },
                {
                    fixtureId: matchData.fixture.id,
                    league: {
                        id: matchData.league.id,
                        name: matchData.league.name,
                        country: matchData.league.country,
                        logo: matchData.league.logo,
                        flag: matchData.league.flag,
                        season: matchData.league.season
                    },
                    teams: {
                        home: {
                            id: matchData.teams.home.id,
                            name: matchData.teams.home.name,
                            logo: matchData.teams.home.logo
                        },
                        away: {
                            id: matchData.teams.away.id,
                            name: matchData.teams.away.name,
                            logo: matchData.teams.away.logo
                        }
                    },
                    fixture: {
                        date: new Date(matchData.fixture.date),
                        venue: matchData.fixture.venue?.name,
                        city: matchData.fixture.venue?.city,
                        status: {
                            long: matchData.fixture.status.long,
                            short: matchData.fixture.status.short,
                            elapsed: matchData.fixture.status.elapsed
                        }
                    },
                    goals: {
                        home: currentGoalsHome,
                        away: currentGoalsAway
                    },
                    lastUpdated: new Date()
                },
                { upsert: true, new: true }
            )
            
            // Auto-post updates
            // 1. Match just started (1st minute)
            if (!previousMatch && matchData.fixture.status.elapsed <= 2) {
                await autoPostMatchUpdate(updatedMatch, 'start')
            }
            
            // 2. Goal scored
            if ((currentGoalsHome > previousGoalsHome) || (currentGoalsAway > previousGoalsAway)) {
                await autoPostMatchUpdate(updatedMatch, 'goal')
            }
            
            // 3. Match finished
            if (matchData.fixture.status.short === 'FT' && previousMatch?.fixture?.status?.short !== 'FT') {
                await autoPostMatchUpdate(updatedMatch, 'finish')
            }
        }
        
    } catch (error) {
        console.error('❌ Error in fetchAndUpdateLiveMatches:', error)
    }
}

// 2. Fetch today's fixtures (runs once daily)
const fetchTodayFixtures = async () => {
    try {
        console.log('📅 Fetching today\'s fixtures...')
        
        const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
        let totalFetched = 0
        
        for (const leagueId of SUPPORTED_LEAGUES) {
            const result = await fetchFromAPI(`/fixtures?league=${leagueId}&date=${today}&season=2024`)
            
            if (result.success && result.data.length > 0) {
                for (const matchData of result.data) {
                    await Match.findOneAndUpdate(
                        { fixtureId: matchData.fixture.id },
                        {
                            fixtureId: matchData.fixture.id,
                            league: {
                                id: matchData.league.id,
                                name: matchData.league.name,
                                country: matchData.league.country,
                                logo: matchData.league.logo,
                                flag: matchData.league.flag,
                                season: matchData.league.season
                            },
                            teams: {
                                home: {
                                    id: matchData.teams.home.id,
                                    name: matchData.teams.home.name,
                                    logo: matchData.teams.home.logo
                                },
                                away: {
                                    id: matchData.teams.away.id,
                                    name: matchData.teams.away.name,
                                    logo: matchData.teams.away.logo
                                }
                            },
                            fixture: {
                                date: new Date(matchData.fixture.date),
                                venue: matchData.fixture.venue?.name,
                                city: matchData.fixture.venue?.city,
                                status: {
                                    long: matchData.fixture.status.long,
                                    short: matchData.fixture.status.short,
                                    elapsed: matchData.fixture.status.elapsed
                                }
                            },
                            goals: {
                                home: matchData.goals.home,
                                away: matchData.goals.away
                            },
                            lastUpdated: new Date()
                        },
                        { upsert: true, new: true }
                    )
                    totalFetched++
                }
            }
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500))
        }
        
        console.log(`✅ Fetched ${totalFetched} fixtures for today`)
        
    } catch (error) {
        console.error('❌ Error in fetchTodayFixtures:', error)
    }
}

// 3. Initialize cron jobs
export const initializeFootballCron = () => {
    console.log('⚽ Initializing Football Cron Jobs...')
    
    // Job 1: Fetch live matches every 2 minutes (during match hours: 12pm - 11pm UTC)
    cron.schedule('*/2 12-23 * * *', async () => {
        console.log('⚽ [CRON] Running live match update...')
        await fetchAndUpdateLiveMatches()
    })
    
    // Job 2: Fetch today's fixtures once at 6 AM UTC
    cron.schedule('0 6 * * *', async () => {
        console.log('📅 [CRON] Running daily fixtures fetch...')
        await fetchTodayFixtures()
    })
    
    // Job 3: Create football account if not exists (runs once on startup)
    setTimeout(async () => {
        await getFootballAccount()
    }, 3000)
    
    console.log('✅ Football Cron Jobs initialized')
    console.log('   - Live matches: Every 2 minutes (12pm-11pm UTC)')
    console.log('   - Daily fixtures: 6 AM UTC')
}

