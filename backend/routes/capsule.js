import express from 'express'
import protectRoute from '../middlware/protectRoute.js'
import {
  sealCapsule,
  unsealCapsule,
  getMyCapsules,
  getCapsuleStatus,
  getCapsuleCount,
} from '../controller/capsule.js'

const router = express.Router()

router.post('/seal', protectRoute, sealCapsule)
router.delete('/unseal/:postId', protectRoute, unsealCapsule)
router.get('/mine', protectRoute, getMyCapsules)
router.get('/status/:postId', protectRoute, getCapsuleStatus)
router.get('/count/:postId', getCapsuleCount)

export default router
