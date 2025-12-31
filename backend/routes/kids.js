import express from 'express'
import { initializeKidsAccount, postRandomCartoon, getAllCartoons, nextCartoon } from '../controller/kids.js'
import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()

// Initialize Kids account (no auth needed - system initialization)
router.post('/init', initializeKidsAccount)

// Post random cartoon to feed (requires auth)
router.post('/post/random', protectRoute, postRandomCartoon)

// Get all cartoons (no auth needed)
router.get('/cartoons', getAllCartoons)

// Change cartoon in existing post (requires auth)
router.post('/next/:postId', protectRoute, nextCartoon)

export default router

