import express from 'express'
import {
    fetchLiveMatches,
    fetchFixtures,
    getMatches,
    fetchStandings,
    getStandings,
    postMatchUpdate,
    getSupportedLeagues
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

// Get cached standings (for users)
router.get('/standings/:leagueId', getStandings)

// Auto-post match update to feed (admin/cron only)
router.post('/post-update', protectRoute, postMatchUpdate)

export default router

