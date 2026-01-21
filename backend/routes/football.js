import express from 'express'
import {
    fetchLiveMatches,
    fetchFixtures,
    getMatches,
    fetchStandings,
    getStandings,
    postMatchUpdate,
    getSupportedLeagues,
    manualFetchFixtures,
    manualPostTodayMatches
} from '../controller/football.js'
import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()

// Get supported leagues
router.get('/leagues', getSupportedLeagues)

// Fetch live matches from API (admin/cron only)
router.post('/fetch/live', protectRoute, fetchLiveMatches)

// Fetch fixtures from API (admin/cron only)
router.post('/fetch/fixtures', protectRoute, fetchFixtures)

// Fetch standings from API (admin/cron only)
router.post('/fetch/standings/:leagueId', protectRoute, fetchStandings)

// Get cached matches (for users)
router.get('/matches', getMatches)

// Manual trigger to fetch fixtures (for testing - no auth needed)
router.post('/fetch/manual', manualFetchFixtures)

// Manual trigger to post today's matches to feed (for testing)
router.post('/post/manual', manualPostTodayMatches)

// Get cached standings (for users)
router.get('/standings/:leagueId', getStandings)

// Auto-post match update to feed (admin/cron only)
router.post('/post-update', protectRoute, postMatchUpdate)

// Test endpoint: Check database stats (for debugging)
router.get('/test/db-stats', async (req, res) => {
    try {
        const { Match } = await import('../models/football.js')
        const mongoose = await import('mongoose')
        
        const now = new Date()
        const todayStart = new Date(now.setHours(0, 0, 0, 0))
        const todayEnd = new Date(now.setHours(23, 59, 59, 999))
        const nextWeek = new Date()
        nextWeek.setDate(nextWeek.getDate() + 7)
        const threeDaysAgo = new Date()
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
        
        const stats = {
            total: await Match.countDocuments({}),
            live: await Match.countDocuments({
                'fixture.status.short': { $in: ['1H', '2H', 'HT', 'ET', 'P', 'LIVE', 'IN_PLAY', 'PAUSED'] },
                'fixture.date': { $gte: todayStart, $lt: todayEnd }
            }),
            upcoming: await Match.countDocuments({
                'fixture.status.short': { $in: ['NS', 'SCHEDULED'] },
                'fixture.date': { $gte: new Date(), $lt: nextWeek }
            }),
            finished: await Match.countDocuments({
                'fixture.status.short': { $in: ['FT', 'FINISHED'] },
                'fixture.date': { $gte: threeDaysAgo, $lt: new Date() }
            }),
            today: await Match.countDocuments({
                'fixture.date': { $gte: todayStart, $lt: todayEnd }
            }),
            lastUpdated: await Match.findOne({}).sort({ lastUpdated: -1 }).select('lastUpdated teams league fixture.status.short').lean()
        }
        
        res.json({ success: true, stats })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

export default router

