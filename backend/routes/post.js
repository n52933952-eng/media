import express from 'express'

const router = express.Router()

import{LikeComent,ReplyToComment,createPost,getPost,deletePost,LikePost,ReplyPost,getFeedPost,getUserPosts} from '../controller/post.js'
import protectRoute from '../middlware/protectRoute.js'

router.post("/create",protectRoute,createPost)
router.get("/:id",getPost)
router.get("/user/:username",getUserPosts)

router.delete("/:id",protectRoute,deletePost)

router.put("/likes/:id",protectRoute,LikePost)
router.put("/reply/:id",protectRoute,ReplyPost)

router.get("/feed/feedpost",protectRoute,getFeedPost)

router.put("/reply-comment/:id", protectRoute, ReplyToComment)


router.put("/likecoment/:postId/:replyId", protectRoute, LikeComent)


export default router