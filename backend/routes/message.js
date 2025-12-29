import express from 'express'

import{sendMessaeg,getMessage,mycon,deletconversation,toggleReaction,deleteMessage,getTotalUnreadCount} from '../controller/message.js'

import protectRoute from '../middlware/protectRoute.js'
import upload from '../middlware/upload.js'

const router = express.Router()


// Route for sending messages - files are uploaded via Multer to Cloudinary
router.post("/",protectRoute,upload.single('file'),sendMessaeg)

// Put more specific routes before parameterized routes to avoid conflicts
router.get("/conversations",protectRoute,mycon)

// Get total unread count - specific route before parameterized routes
router.get("/unread/count",protectRoute,getTotalUnreadCount)

router.get("/:otherUserId",protectRoute,getMessage)

router.delete("/conversation/:id",protectRoute,deletconversation)

router.delete("/message/:messageId",protectRoute,deleteMessage)

router.post("/reaction/:messageId",protectRoute,toggleReaction)

export default router