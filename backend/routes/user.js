import express from 'express'

const router = express.Router()
import{SignUp,LoginUser,LogOut,FollowAndUnfollow,getUserProfile,UpdateUser,searchUsers} from '../controller/user.js'
import protectRoute  from '../middlware/protectRoute.js'
import upload from '../middlware/upload.js'

router.post("/signup", SignUp)
router.post("/login",LoginUser)
router.post("/logout",LogOut)
router.post("/follow/:id",protectRoute,FollowAndUnfollow)
router.get("/getUserPro/:query",protectRoute,getUserProfile)

router.put("/update/:id",protectRoute,upload.single('file'),UpdateUser)
router.get("/search",protectRoute,searchUsers)  // GET /api/user/search?search=john

export default router