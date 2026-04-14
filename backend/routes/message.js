import express from 'express'

import {
  sendMessaeg,
  getMessage,
  mycon,
  deletconversation,
  toggleReaction,
  deleteMessage,
  getTotalUnreadCount,
  ackMessageDeliveredHttp,
  createGroup,
  updateGroupInfo,
  addGroupMember,
  removeGroupMember,
  leaveGroup,
} from '../controller/message.js'

import protectRoute from '../middlware/protectRoute.js'
import upload from '../middlware/upload.js'

const router = express.Router()

// ── Message send / ack ─────────────────────────────────────────────────────
router.post('/', protectRoute, upload.single('file'), sendMessaeg)
router.post('/ack-delivered', ackMessageDeliveredHttp)

// ── Conversations list ─────────────────────────────────────────────────────
router.get('/conversations', protectRoute, mycon)

// ── Unread count ───────────────────────────────────────────────────────────
router.get('/unread/count', protectRoute, getTotalUnreadCount)

// ── Group management ───────────────────────────────────────────────────────
router.post('/group', protectRoute, createGroup)
router.put('/group/:id', protectRoute, updateGroupInfo)
router.post('/group/:id/members', protectRoute, addGroupMember)
router.delete('/group/:id/members/:userId', protectRoute, removeGroupMember)
router.post('/group/:id/leave', protectRoute, leaveGroup)

// ── Message actions ────────────────────────────────────────────────────────
router.delete('/conversation/:id', protectRoute, deletconversation)
router.delete('/message/:messageId', protectRoute, deleteMessage)
router.post('/reaction/:messageId', protectRoute, toggleReaction)

// ── Fetch messages (1-to-1 legacy; groups pass ?conversationId=) ───────────
router.get('/:otherUserId', protectRoute, getMessage)

export default router