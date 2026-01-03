import express from 'express'
import {
    getNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    getUnreadCount,
    deleteNotification
} from '../controller/notification.js'
import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()

// Get all notifications for logged-in user
router.get('/', protectRoute, getNotifications)

// Get unread notification count
router.get('/unread-count', protectRoute, getUnreadCount)

// Mark a specific notification as read
router.put('/:notificationId/read', protectRoute, markNotificationAsRead)

// Mark all notifications as read
router.put('/read-all', protectRoute, markAllNotificationsAsRead)

// Delete a notification
router.delete('/:notificationId', protectRoute, deleteNotification)

export default router


