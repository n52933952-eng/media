import express from 'express'
import { createLiveStreamPost, getChannels } from '../controller/news.js'
import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()

// Live TV channels — paths kept at /api/news/* for mobile app compatibility
router.get('/channels', getChannels)
router.post('/post/livestream', protectRoute, createLiveStreamPost)

export default router
