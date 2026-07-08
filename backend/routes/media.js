import express from 'express'
import protectRoute from '../middlware/protectRoute.js'
import { createUploadUrl } from '../controller/media.js'

const router = express.Router()

router.post('/presign', protectRoute, createUploadUrl)

export default router
