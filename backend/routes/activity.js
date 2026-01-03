import express from 'express'
import { getActivities } from '../controller/activity.js'
import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()

router.get('/', protectRoute, getActivities)

export default router


