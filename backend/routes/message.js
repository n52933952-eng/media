import express from 'express'

import{sendMessaeg,getMessage,mycon,deletconversation,toggleReaction} from '../controller/message.js'

import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()


router.post("/",protectRoute,sendMessaeg)

// Put more specific routes before parameterized routes to avoid conflicts
router.get("/conversations",protectRoute,mycon)

router.get("/:otherUserId",protectRoute,getMessage)

router.delete("/:id",protectRoute,deletconversation)

router.post("/reaction/:messageId",protectRoute,toggleReaction)

export default router