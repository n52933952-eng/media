import express from 'express'
import { cancelCall } from '../controller/call.js'
import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()

// POST /api/call/cancel
// Body: { conversationId: callerId, sender: receiverId }
// Allows canceling calls even when the app is killed
router.post("/cancel", cancelCall)

export default router
