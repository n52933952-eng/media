import express from 'express'
import {
  createLiveStreamPost,
  getChannels,
  addVideoLink,
  deleteVideoLink,
  hideDefaultChannel,
  watchVideoLink,
  shareVideo,
} from '../controller/news.js'
import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()

// Live TV channels — paths kept at /api/news/* for mobile app compatibility
router.get('/channels', getChannels)
router.post('/post/livestream', protectRoute, createLiveStreamPost)
router.post('/links', protectRoute, addVideoLink)
router.delete('/links/:id', protectRoute, deleteVideoLink)
router.post('/links/:id/watch', protectRoute, watchVideoLink)
router.post('/channels/hide', protectRoute, hideDefaultChannel)
router.post('/share', protectRoute, shareVideo)

export default router
