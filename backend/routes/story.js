import express from 'express'
import protectRoute from '../middlware/protectRoute.js'
import upload from '../middlware/upload.js'
import {
  createStory,
  deleteMyStory,
  getFeedStrip,
  getStoryByUser,
  getStoryViewers,
  getStoryStatus,
} from '../controller/story.js'

const router = express.Router()

router.post('/create', protectRoute, upload.array('files', 20), createStory)
router.delete('/mine', protectRoute, deleteMyStory)
router.get('/feed-strip', protectRoute, getFeedStrip)
router.get('/status/:userId', protectRoute, getStoryStatus)
router.get('/user/:userId', protectRoute, getStoryByUser)
router.get('/:storyId/viewers', protectRoute, getStoryViewers)

export default router
