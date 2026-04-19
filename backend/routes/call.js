import express from 'express'
import { cancelCall, getIceServers, getLiveKitToken, getLiveStreamStatus } from '../controller/call.js'
import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()

// ── LiveKit ──────────────────────────────────────────────────────────────────
// POST /api/call/token  →  returns { token, roomName, livekitUrl }
// Used for: direct calls, group calls, live streams, viewers
router.post('/token', protectRoute, getLiveKitToken)
router.get('/livestream/:streamerId/status', protectRoute, getLiveStreamStatus)

// ── Legacy / kept for compatibility ─────────────────────────────────────────
// ICE servers still returned (legacy clients / fallback)
router.get('/ice-servers', protectRoute, getIceServers)

// HTTP cancel — used when app is killed / no socket (FCM offline flow)
router.post('/cancel', cancelCall)

export default router
