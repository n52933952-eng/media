import express from 'express'

const router = express.Router()

import{LikeComent,ReplyToComment,createPost,getPost,deletePost,updatePost,LikePost,getPostLikes,ReplyPost,getFeedPost,getUserPosts,getUserPostsById,addContributorToPost,removeContributorFromPost,hidePostFromFeed,getHiddenFeedPostIds,getUserComments,deleteComment} from '../controller/post.js'
import protectRoute from '../middlware/protectRoute.js'
import optionalAuth from '../middlware/optionalAuth.js'
import upload from '../middlware/upload.js'

router.post("/create",protectRoute,upload.single('file'),createPost)
router.get("/:id",optionalAuth,getPost)
router.get("/user/:username",optionalAuth,getUserPosts)
router.get("/user/id/:userId",protectRoute,getUserPostsById)
router.get("/comments/user/:username",getUserComments)

router.delete("/:id",protectRoute,deletePost)
router.put("/:id",protectRoute,upload.single('file'),updatePost)

router.put("/likes/:id",protectRoute,LikePost)
router.get("/likes-list/:id",protectRoute,getPostLikes)
router.put("/reply/:id",protectRoute,ReplyPost)

router.get("/feed/feedpost",protectRoute,getFeedPost)
router.get("/feed/hidden-ids", protectRoute, getHiddenFeedPostIds)
router.put("/feed/hide/:postId", protectRoute, hidePostFromFeed)

router.put("/reply-comment/:id", protectRoute, ReplyToComment)


router.put("/likecoment/:postId/:replyId", protectRoute, LikeComent)
router.delete("/comment/:postId/:replyId", protectRoute, deleteComment)

router.put("/collaborative/:postId/contributor", protectRoute, addContributorToPost)
router.delete("/collaborative/:postId/contributor/:contributorId", protectRoute, removeContributorFromPost)

export default router