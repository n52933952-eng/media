import express from 'express'

const router = express.Router()
import{SignUp,LoginUser,LogOut,FollowAndUnfollow,getUserProfile,UpdateUser,searchUsers,getSuggestedUsers,getBusyChessUsers,getBusyCardUsers,getFollowingUsers} from '../controller/user.js'
import protectRoute  from '../middlware/protectRoute.js'
import upload from '../middlware/upload.js'
import User from '../models/user.js'

router.post("/signup", SignUp)
router.post("/login",LoginUser)
router.post("/logout",LogOut)
router.post("/follow/:id",protectRoute,FollowAndUnfollow)

// IMPORTANT: More specific routes should come before less specific ones
// Put getUserPro before other routes that might conflict
router.get("/getUserPro/:query",protectRoute,getUserProfile)

router.put("/update/:id",protectRoute,upload.single('file'),UpdateUser)
router.get("/search",protectRoute,searchUsers)  // GET /api/user/search?search=john
router.get("/suggested",protectRoute,getSuggestedUsers)  // GET /api/user/suggested
router.get("/following",protectRoute,getFollowingUsers)  // GET /api/user/following
router.get("/busyChessUsers",protectRoute,getBusyChessUsers)  // GET /api/user/busyChessUsers
router.get("/busyCardUsers",protectRoute,getBusyCardUsers)  // GET /api/user/busyCardUsers
router.post("/save-fcm-token",protectRoute,async (req,res) => {
  try {
    const { fcmToken } = req.body
    const userId = req.user._id
    
    await User.findByIdAndUpdate(userId, { fcmToken })
    res.status(200).json({ success: true, message: 'FCM token saved' })
  } catch (error) {
    console.error('Error saving FCM token:', error)
    res.status(500).json({ error: 'Failed to save FCM token' })
  }
})

export default router