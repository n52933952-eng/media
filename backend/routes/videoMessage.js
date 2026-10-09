import express from 'express'
import protectRoute from '../middlware/protectRoute.js'
import {
  sendVideoMessage,
  listVideoMessages,
  getVideoMessageUnseenCount,
  getVideoMessage,
  addVideoNote,
  deleteVideoNote,
  deleteVideoMessage,
} from '../controller/videoMessage.js'

const router = express.Router()

router.post('/', protectRoute, sendVideoMessage)
router.get('/', protectRoute, listVideoMessages)
router.get('/unseen-count', protectRoute, getVideoMessageUnseenCount)
router.get('/:id', protectRoute, getVideoMessage)
router.delete('/:id', protectRoute, deleteVideoMessage)
router.post('/:id/notes', protectRoute, addVideoNote)
router.delete('/:id/notes/:noteId', protectRoute, deleteVideoNote)

export default router
