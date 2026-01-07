import express from 'express'
import { getActivities, deleteActivity } from '../controller/activity.js'
import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()

router.get('/', protectRoute, getActivities)
router.delete('/:activityId', protectRoute, deleteActivity)

export default router


