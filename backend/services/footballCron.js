import cron from 'node-cron'
import mongoose from 'mongoose'
import { Match } from '../models/football.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import Follow from '../models/follow.js'
import { getIO, getAllUserSockets, getUserSocketMap } from '../socket/socket.js'
import {
    autoPostTodayMatches,
    getFootballAccount,
    fetchMatchDetails,
    EVENTS_FETCH_ENABLED,
} from '../controller/football.js'
import {
    getCachedMatchDetails,
    setCachedMatchDetails,
    getCacheStats,
} from './footballCache.js'
import {
    LIVE_STATUS_SHORT,
    FINISHED_STATUS_SHORT,
    isStaleLiveMatchRow,
    isEffectivelyFinishedForDisplay,
    reconcileStaleLiveMatches,
    enrichMatchForClient,
    inferLiveShort,
    estimateLiveElapsed,
    pickLiveGoals,
} from './footballStatuses.js'

/** Find a row in feed `footballData` JSON: prefer fixtureId, then normalized team names. */
const findFeedMatchIndex = (matchDataArray, fixtureIdNum, updatedMatch) => {
    if (!Array.isArray(matchDataArray) || !updatedMatch?.teams) return -1
    const fid = Number(fixtureIdNum)
    if (Number.isFinite(fid)) {
        const byId = matchDataArray.findIndex(
            (m) => m && m.fixtureId != null && Number(m.fixtureId) === fid
        )
        if (byId !== -1) return byId
    }
    const norm = (s) => String(s || '').trim().toLowerCase()
    const h = norm(updatedMatch.teams?.home?.name)
    const a = norm(updatedMatch.teams?.away?.name)
    return matchDataArray.findIndex((m) => {
        const homeName1 = norm(m?.homeTeam?.name || m?.homeTeam)
        const awayName1 = norm(m?.awayTeam?.name || m?.awayTeam)
        return homeName1 === h && awayName1 === a
    })
}

const emitFootballMatchUpdateToFollowers = async (footballAccountId, payload) => {
    const io = getIO()
    if (!io) return
    const followerDocs = await Follow.find({ followeeId: footballAccountId })
        .select('followerId')
        .limit(5000)
        .lean()
    const followerIds = followerDocs.map((d) => d.followerId.toString())
    if (followerIds.length === 0) return
    const userSocketMap = getUserSocketMap()
    let n = 0
    followerIds.forEach((followerId) => {
        const sock = userSocketMap[followerId]
        if (sock?.socketId) {
            io.to(sock.socketId).emit('footballMatchUpdate', payload)
            n++
        }
    })
    return n
}

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

// Status code mapping — covers every value in the football-data.org v4 status enum.
// EXTRA_TIME / PENALTY_SHOOTOUT are NOT part of their `?status=LIVE` filter, so they must be
// mapped explicitly or a knockout match looks finished the moment extra time begins.
const STATUS_MAP = {
    'SCHEDULED': { short: 'NS', long: 'Not Started' },
    'TIMED': { short: 'NS', long: 'Not Started' },
    'LIVE': { short: '1H', long: 'First Half' },
    'IN_PLAY': { short: '2H', long: 'Second Half' },
    'PAUSED': { short: 'HT', long: 'Half Time' },
    'EXTRA_TIME': { short: 'ET', long: 'Extra Time' },
    'PENALTY_SHOOTOUT': { short: 'P', long: 'Penalty Shootout' },
    'FINISHED': { short: 'FT', long: 'Full Time' },
    'POSTPONED': { short: 'POSTP', long: 'Postponed' },
    'SUSPENDED': { short: 'SUSP', long: 'Suspended' },
    'CANCELLED': { short: 'CANC', long: 'Cancelled' },
    'AWARDED': { short: 'AWD', long: 'Awarded' }
}

/** football-data.org `score.duration`: REGULAR | EXTRA_TIME | PENALTY_SHOOTOUT */
const scoreDurationOf = (matchData) => String(matchData?.score?.duration || 'REGULAR').toUpperCase()

/**
 * Resolve the stored status code. `status` is authoritative, but `score.duration` is used as a
 * second signal so a match sitting in IN_PLAY/PAUSED during overtime is not mistaken for
 * regulation play, and a finished knockout is recorded as AET / PEN rather than plain FT.
 */
/**
 * Only record an observed kickoff this soon after the scheduled time. If the cron was not running
 * at kickoff, the first live tick we see could be 20m late and would make the badge read far too
 * low — better to fall back to the scheduled date in that case.
 */
const OBSERVED_KICKOFF_MAX_LATE_MIN = 12

const resolveStatusCodes = (apiStatus, matchData) => {
    const duration = scoreDurationOf(matchData)
    const inOvertime = duration === 'EXTRA_TIME' || duration === 'PENALTY_SHOOTOUT'
    const kickoff = new Date(matchData?.utcDate || matchData?.date || 0).getTime()
    const ageMin =
        Number.isFinite(kickoff) && kickoff > 0 ? (Date.now() - kickoff) / (60 * 1000) : 0

    if (apiStatus === 'FINISHED') {
        if (duration === 'PENALTY_SHOOTOUT') return { short: 'PEN', long: 'Finished After Penalties' }
        if (duration === 'EXTRA_TIME') return { short: 'AET', long: 'Finished After Extra Time' }
        return STATUS_MAP.FINISHED
    }
    // Overtime only when `score.duration` says so. Age-based guessing labelled regulation league
    // matches as ET, which then kept them in the Live tab for hours.
    if ((apiStatus === 'IN_PLAY' || apiStatus === 'LIVE') && inOvertime) {
        return duration === 'PENALTY_SHOOTOUT' ? STATUS_MAP.PENALTY_SHOOTOUT : STATUS_MAP.EXTRA_TIME
    }
    // A break during overtime is not half time — 'BT' keeps it live without the 45' regulation rules.
    if (apiStatus === 'PAUSED' && inOvertime) {
        return { short: 'BT', long: 'Break Time' }
    }

    const mapped = STATUS_MAP[apiStatus]
    if (!mapped) {
        console.warn(`⚠️ [convertMatchFormat] Unknown football-data.org status "${apiStatus}" — treating as scheduled`)
        return STATUS_MAP.SCHEDULED
    }
    const inferred = inferLiveShort(mapped.short, ageMin)
    if (inferred === mapped.short) return mapped
    const LONG = {
        '1H': 'First Half',
        '2H': 'Second Half',
        HT: 'Half Time',
        ET: 'Extra Time',
        BT: 'Break Time',
        P: 'Penalty Shootout',
    }
    return { short: inferred, long: LONG[inferred] || mapped.long }
}

/** Match minute for the badge. Overtime is allowed past 90; the API gives us no live clock. */
const estimateElapsed = (statusShort, matchData) => {
    const kickoff = new Date(matchData.utcDate || matchData.date || 0).getTime()
    const ageMin = Number.isFinite(kickoff) && kickoff > 0
        ? (Date.now() - kickoff) / (60 * 1000)
        : 0
    return estimateLiveElapsed(statusShort, ageMin)
}

// Helper: Convert football-data.org match format to our database format
const convertMatchFormat = (matchData) => {
    const competition = matchData.competition || {}
    const area = competition.area || {}
    
    // Map football-data.org status to our internal format
    const apiStatus = matchData.status || 'SCHEDULED'
    const statusMapping = resolveStatusCodes(apiStatus, matchData)
    const statusShort = statusMapping.short
    const statusLong = statusMapping.long

    const elapsed = estimateElapsed(statusShort, matchData)
    
    const liveGoals = pickLiveGoals(matchData.score)
    
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
            home: liveGoals.home,
            away: liveGoals.away
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

/** Cap the `?ids=` list so one verification stays a single small request. */
const MAX_VERIFY_IDS = 20

/**
 * Read the true status of matches that vanished from the live poll.
 * One request for the whole batch; an empty map means "could not confirm" and callers must not
 * assume the match finished.
 * @returns {Promise<Map<number, object>>} fixtureId → raw football-data.org match
 */
const verifyOmittedMatchStatuses = async (fixtureIds) => {
    const result = new Map()
    const ids = [...new Set(fixtureIds.filter((id) => Number.isFinite(id)))].slice(0, MAX_VERIFY_IDS)
    if (ids.length === 0) return result

    const res = await fetchFromAPI(`/matches?ids=${ids.join(',')}`)
    if (!res.success || !Array.isArray(res.data)) {
        console.warn(
            `⚠️ [verifyOmittedMatchStatuses] Could not confirm ${ids.length} match(es): ${res.error || 'no data'}`
        )
        return result
    }

    for (const m of res.data) {
        const fid = typeof m?.id === 'string' ? parseInt(m.id, 10) : Number(m?.id)
        if (Number.isFinite(fid)) result.set(fid, m)
    }
    return result
}

// getFootballAccount is imported from '../controller/football.js' - no need to redeclare

// Helper: Update feed post when matches finish (check database for finished matches)
const updateFeedPostWhenMatchesFinish = async () => {
    try {
        // Football no longer uses Post documents for the feed — Match collection + sockets only.
        return
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
                todayPost.updatedAt = new Date()
                todayPost.footballData = JSON.stringify(updatedMatches)
                await todayPost.save()

                await emitFootballMatchUpdateToFollowers(footballAccount._id, {
                    postId: todayPost._id.toString(),
                    matchData: updatedMatches,
                    updatedAt: new Date(),
                })

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
        // Kickoff/goal/full-time as separate Posts disabled (no Football posts in Post collection).
        return
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

        // Get date range for today (UTC calendar day)
        const now = new Date()
        const todayStart = new Date(now)
        todayStart.setUTCHours(0, 0, 0, 0)
        const todayEnd = new Date(now)
        todayEnd.setUTCHours(23, 59, 59, 999)
        
        // IMPROVED: Detect finished matches by comparing database with /matches?status=LIVE response
        // This is much more efficient than checking each match individually!
        
        // Live scores: always hit the API. Caching this list made goals wait an extra 25–50s.
        let result = await fetchFromAPI('/matches?status=LIVE')
        
        if (result.rateLimit) {
            console.warn('⚠️ [fetchAndUpdateLiveMatches] Rate limit hit, skipping this update')
            const dbMatches = await Match.find({
                'fixture.date': { $gte: todayStart, $lte: todayEnd },
                'fixture.status.short': { $in: LIVE_STATUS_SHORT },
            }).limit(10)

            if (dbMatches.length > 0) {
                console.log(`📦 [fetchAndUpdateLiveMatches] Using ${dbMatches.length} database matches as fallback`)
                result = { success: true, data: dbMatches }
            } else {
                await reconcileStaleLiveMatches(Match)
                await emitFootballPageUpdate()
                return
            }
        }

        if (!result.success || !result.data) {
            if (isDev) {
                console.log('📭 No live matches found in API')
            }
            await reconcileStaleLiveMatches(Match)
            await updateFeedPostWhenMatchesFinish()
            await emitFootballPageUpdate()
            return
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
        
        // Normalize fixture IDs so API (number) and DB (number|string) always match in the Set
        const toFixtureIdNum = (raw) => {
            if (raw == null || raw === '') return NaN
            const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw)
            return Number.isFinite(n) ? n : NaN
        }

        // Get all fixture IDs from live matches to detect finished ones
        const liveFixtureIds = new Set()
        for (const matchData of filteredMatches) {
            const fid = toFixtureIdNum(matchData.id ?? matchData.fixtureId)
            if (!Number.isNaN(fid)) liveFixtureIds.add(fid)
        }

        /**
         * IMPORTANT: Do NOT infer "finished" when the live list is empty.
         * If the API returns [], rate-limit empty, cache miss, or every match is filtered out by league,
         * liveFixtureIds is empty — marking all DB live rows as FT wipes real live games (they "come back"
         * on the next good poll). The Mongo prune job only deletes *old finished* rows, not this path.
         */
        const rawLiveCount = Array.isArray(result.data) ? result.data.length : 0
        /** Non-empty set means this tick had at least one supported-league live id — safe to diff against DB */
        const canInferFinishedFromOmission = liveFixtureIds.size > 0

        const previouslyLiveMatches = await Match.find({
            'fixture.date': { $gte: todayStart, $lte: todayEnd },
            'fixture.status.short': { $in: LIVE_STATUS_SHORT },
        })

        // Only trust "not in LIVE list ⇒ FT" when we have a non-empty authoritative live set from this tick
        const MIN_MS_AFTER_KICKOFF_BEFORE_OMISSION_FT = 45 * 60 * 1000 // avoid kickoff/API lag false positives

        if (canInferFinishedFromOmission) {
            /**
             * Absence from `?status=LIVE` does NOT mean the match is over: that filter only covers
             * IN_PLAY + PAUSED, so a match drops out the moment it enters EXTRA_TIME or
             * PENALTY_SHOOTOUT. Confirm the real status with one `?ids=` lookup before writing FT.
             */
            const omitted = []
            for (const dbMatch of previouslyLiveMatches) {
                const dbFixtureId = toFixtureIdNum(dbMatch.fixtureId)
                if (Number.isNaN(dbFixtureId)) {
                    console.warn(`⚠️ [fetchAndUpdateLiveMatches] Invalid dbMatch.fixtureId: ${dbMatch.fixtureId}, skipping`)
                    continue
                }

                if (liveFixtureIds.has(dbFixtureId)) continue

                const kickoff = dbMatch.fixture?.date ? new Date(dbMatch.fixture.date).getTime() : NaN
                const kickoffOk =
                    Number.isFinite(kickoff) && Date.now() - kickoff >= MIN_MS_AFTER_KICKOFF_BEFORE_OMISSION_FT
                if (!kickoffOk) continue

                omitted.push({ fixtureId: dbFixtureId, dbMatch })
            }

            if (omitted.length > 0) {
                const verified = await verifyOmittedMatchStatuses(omitted.map((o) => o.fixtureId))

                for (const { fixtureId, dbMatch } of omitted) {
                    const label = `${dbMatch.teams?.home?.name} vs ${dbMatch.teams?.away?.name}`
                    const apiMatch = verified.get(fixtureId)

                    if (!apiMatch) {
                        // Lookup unavailable (rate limit / error): leave it live. The stale-row
                        // reconciler is the backstop for genuinely abandoned rows.
                        console.warn(`  ⏳ Could not confirm status, keeping live: ${label}`)
                        continue
                    }

                    const codes = resolveStatusCodes(apiMatch.status || '', apiMatch)
                    // This `?ids=` payload is the last score we ever see for the match: once it
                    // leaves `?status=LIVE` nothing refetches it, so writing only the status would
                    // freeze whatever the final live tick happened to report.
                    const finalGoals = pickLiveGoals(apiMatch.score)
                    const goalsUpdate = {}
                    if (finalGoals.home != null) {
                        goalsUpdate['goals.home'] = finalGoals.home
                        goalsUpdate['goals.away'] = finalGoals.away
                    }

                    if (!FINISHED_STATUS_SHORT.includes(codes.short)) {
                        console.log(`  ⏱️ Still playing (${codes.long}), keeping live: ${label}`)
                        await Match.findOneAndUpdate(
                            { fixtureId },
                            {
                                'fixture.status.short': codes.short,
                                'fixture.status.long': codes.long,
                                'fixture.status.elapsed': estimateElapsed(codes.short, apiMatch),
                                ...goalsUpdate,
                                lastUpdated: new Date(),
                            }
                        )
                        continue
                    }

                    console.log(
                        `  🏁 Match finished (${codes.long}): ${label} ${finalGoals.home ?? '?'}-${finalGoals.away ?? '?'}`
                    )
                    await Match.findOneAndUpdate(
                        { fixtureId },
                        {
                            'fixture.status.short': codes.short,
                            'fixture.status.long': codes.long,
                            'fixture.status.elapsed': codes.short === 'FT' ? 90 : 120,
                            ...goalsUpdate,
                            lastUpdated: new Date(),
                        }
                    )
                }
            }
        } else if (previouslyLiveMatches.length > 0 && isDev) {
            console.warn(
                `⚽ [fetchAndUpdateLiveMatches] Skipping "omit from LIVE list ⇒ FT" (${previouslyLiveMatches.length} DB live rows): liveFixtureIds=${liveFixtureIds.size}, filtered=${filteredMatches.length}, rawLive=${rawLiveCount}`
            )
        }

        // After ET/P rows are labelled, clock-FT only leftover abandoned live rows.
        await reconcileStaleLiveMatches(Match)
        
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
            
            const previousGoalsHome = previousMatch?.goals?.home
            const previousGoalsAway = previousMatch?.goals?.away
            let currentGoalsHome = convertedMatch.goals?.home
            let currentGoalsAway = convertedMatch.goals?.away

            // Don't wipe a known score if this API tick omitted fullTime/regularTime.
            if (currentGoalsHome == null && currentGoalsAway == null && previousGoalsHome != null) {
                convertedMatch.goals.home = previousGoalsHome
                convertedMatch.goals.away = previousGoalsAway
                currentGoalsHome = previousGoalsHome
                currentGoalsAway = previousGoalsAway
            }
            
            // IMPORTANT: Don't fetch events/scorers for live matches (only for finished)
            convertedMatch.events = []

            // Anchor the live clock on the real kickoff. Only trust the tick where we actually saw
            // the flip out of SCHEDULED/NS — then the error is bounded by the poll interval. Carry
            // the stored value forward otherwise, since this update replaces the whole `fixture`.
            const previousLiveStartedAt = previousMatch?.fixture?.liveStartedAt || null
            const previousShort = previousMatch?.fixture?.status?.short
            const wasNotStarted = previousShort === 'NS' || previousShort === 'SCHEDULED'
            const isLiveNow = LIVE_STATUS_SHORT.includes(convertedMatch.fixture?.status?.short)

            const scheduledMs = new Date(convertedMatch.fixture?.date || 0).getTime()
            const minutesLate = Number.isFinite(scheduledMs)
                ? (Date.now() - scheduledMs) / (60 * 1000)
                : Infinity

            if (previousLiveStartedAt) {
                convertedMatch.fixture.liveStartedAt = previousLiveStartedAt
            } else if (wasNotStarted && isLiveNow && minutesLate <= OBSERVED_KICKOFF_MAX_LATE_MIN) {
                convertedMatch.fixture.liveStartedAt = new Date()
                console.log(
                    `  ⏱️ Kickoff observed (+${minutesLate.toFixed(1)}m): ${convertedMatch.teams?.home?.name} vs ${convertedMatch.teams?.away?.name}`
                )
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
                
                // Feed Post collection updates disabled — `emitFootballPageUpdate` refreshes Football screen.
            }
        }
        
        await reconcileStaleLiveMatches(Match)

        // Update feed post (removes finished matches from post)
        await updateFeedPostWhenMatchesFinish()

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
        
        const liveMatchesRaw = await Match.find({
            'fixture.status.short': { $in: LIVE_STATUS_SHORT },
            'fixture.date': { $gte: todayStart, $lt: todayEnd },
        })
        .sort({ 'fixture.date': -1 })
        .limit(50)
        .lean()

        const liveMatches = liveMatchesRaw.filter(
            (m) => !isStaleLiveMatchRow(m) && !isEffectivelyFinishedForDisplay(m),
        )
        
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
            'fixture.status.short': { $in: FINISHED_STATUS_SHORT },
            'fixture.date': { $gte: threeDaysAgo, $lt: new Date() },
        })
        .sort({ 'fixture.date': -1 })
        .limit(50)
        .lean()
        
        // Fetch events for finished matches if missing (lazy load - only first 10 to avoid delays)
        if (EVENTS_FETCH_ENABLED) {
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
        }
        
        const data = {
            live: liveMatches.map(enrichMatchForClient),
            upcoming: upcomingMatches.map(enrichMatchForClient),
            finished: finishedMatches.map(enrichMatchForClient),
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

/**
 * Remove old Match rows so MongoDB does not grow forever.
 * Finished games are kept for FOOTBALL_MATCH_RETENTION_DAYS (default 45), then deleted.
 * Very old NS/SCHEDULED kickoffs (14+ days past) are removed as stale schedule noise.
 */
const cleanupOldFootballMatches = async () => {
    try {
        const retentionDays = Math.max(
            7,
            parseInt(process.env.FOOTBALL_MATCH_RETENTION_DAYS || '45', 10) || 45
        )
        const cutoff = new Date()
        cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays)
        cutoff.setUTCHours(0, 0, 0, 0)

        const finishedRes = await Match.deleteMany({
            'fixture.status.short': { $in: FINISHED_STATUS_SHORT },
            'fixture.date': { $exists: true, $lt: cutoff },
        })

        const staleScheduledCutoff = new Date()
        staleScheduledCutoff.setUTCDate(staleScheduledCutoff.getUTCDate() - 14)
        staleScheduledCutoff.setUTCHours(0, 0, 0, 0)

        const staleNsRes = await Match.deleteMany({
            'fixture.status.short': { $in: ['NS', 'SCHEDULED'] },
            'fixture.date': { $exists: true, $lt: staleScheduledCutoff },
        })

        if (finishedRes.deletedCount > 0 || staleNsRes.deletedCount > 0) {
            console.log(
                `🧹 [cleanupOldFootballMatches] Deleted ${finishedRes.deletedCount} finished (kickoff before ${cutoff.toISOString().slice(0, 10)}, retention ${retentionDays}d) and ${staleNsRes.deletedCount} stale scheduled`
            )
        }
    } catch (error) {
        console.error('❌ [cleanupOldFootballMatches]', error)
    }
}

// 3. Initialize cron jobs
export const initializeFootballCron = () => {
    console.log('⚽ Initializing Football Cron Jobs...')
    
    // Job 1: Smart Polling - Only during match hours (OPTIMIZED FOR FREE TIER)
    // Premier League, La Liga, Serie A match hours:
    // - Weekends (Sat-Sun): 12:00-22:00 UTC (peak hours)
    // - Weekdays: 17:00-23:00 UTC (evening matches, including late kickoffs)
    // - Off-hours: Don't poll (or very rarely)
    
    // Free tier: 10 req/min. Live poll every 30s in peak windows (~2 LIVE calls/min).
    const isDev = process.env.NODE_ENV !== 'production'
    
    // Weekend (Sat-Sun) 12:00-22:00 UTC — 6-field cron (seconds first)
    cron.schedule('*/30 * 12-22 * * 6,0', async () => {
        if (isDev) {
            const timestamp = new Date().toLocaleString('en-US', { timeZone: 'UTC' })
            console.log(`⚽ [CRON] Running live match update (weekend: every 30s) - ${timestamp} UTC`)
        }
        await fetchAndUpdateLiveMatches()
    })
    
    // Weekday (Mon-Fri) 17:00-23:00 UTC
    cron.schedule('*/30 * 17-23 * * 1-5', async () => {
        if (isDev) {
            const timestamp = new Date().toLocaleString('en-US', { timeZone: 'UTC' })
            console.log(`⚽ [CRON] Running live match update (weekday: every 30s) - ${timestamp} UTC`)
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
    
    // Peak ~1 LIVE call/min in windows above; off-hours */10. Still well under free-tier limits.
    
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

    // Job 7: Prune old Match documents (finished + stale NS) — daily, low traffic
    cron.schedule('30 3 * * *', async () => {
        console.log('🧹 [CRON] Pruning old football matches from MongoDB...')
        await cleanupOldFootballMatches()
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

        console.log('🧹 [STARTUP] One-time prune of old football matches...')
        await cleanupOldFootballMatches()
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
    console.log('   - DB prune: 3:30 AM UTC daily (FOOTBALL_MATCH_RETENTION_DAYS, default 45)')
}

