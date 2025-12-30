import express from 'express'
import {
    fetchAlJazeeraNews,
    getNews,
    manualFetchNews
} from '../controller/news.js'
import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()

// Fetch news from NewsAPI (admin/cron only)
router.post('/fetch', protectRoute, fetchAlJazeeraNews)

// Get cached news articles (for users)
router.get('/articles', getNews)

// Manual trigger to fetch news (for testing)
router.post('/fetch/manual', manualFetchNews)

export default router

