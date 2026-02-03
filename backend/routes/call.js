import express from 'express'
import { cancelCall, getIceServers } from '../controller/call.js'
import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()

// GET /api/call/ice-servers - ICE config for WebRTC (STUN + TURN from env)
router.get("/ice-servers", protectRoute, getIceServers)

// POST /api/call/cancel
// Body: { conversationId: callerId, sender: receiverId }
// Allows canceling calls even when the app is killed
router.post("/cancel", cancelCall)

export default router
