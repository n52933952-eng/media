import express from 'express'
import {
    fetchAlJazeeraNews,
    getNews,
    manualFetchNews,
    testNews,
    createLiveStreamPost
} from '../controller/news.js'
import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()

// Test endpoint
router.get('/test', testNews)

// Fetch news from NewsAPI (admin/cron only)
router.post('/fetch', protectRoute, fetchAlJazeeraNews)

// Get cached news articles (for users)
router.get('/articles', getNews)

// Manual trigger to fetch news (for testing)
router.post('/fetch/manual', manualFetchNews)

// Create live stream post (when user follows Al Jazeera) - requires auth
router.post('/post/livestream', protectRoute, createLiveStreamPost)

export default router

