import Notification from '../models/notification.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getUserSocketMap } from '../socket/socket.js'

// Create a notification
export const createNotification = async (userId, type, fromUserId, options = {}) => {
    try {
        // Don't notify user if they're notifying themselves
        if (userId.toString() === fromUserId.toString()) {
            return null
        }

        const notification = new Notification({
            user: userId,
            type: type, // 'follow', 'comment', or 'mention'
            from: fromUserId,
            post: options.postId || null,
            comment: options.commentText || null,
            read: false
        })

        await notification.save()
        
        // Populate 'from' field for socket emission
        await notification.populate('from', 'username name profilePic')
        
        // Emit real-time notification to user if online
        const io = getIO()
        if (io) {
            const userSocketMap = getUserSocketMap()
            const userSocketData = userSocketMap[userId.toString()]
            
            if (userSocketData) {
                io.to(userSocketData.socketId).emit('newNotification', notification)
                console.log(`📬 [createNotification] Sent notification to user ${userId} (socket: ${userSocketData.socketId})`)
            }
        }

        return notification
    } catch (error) {
        console.error('Error creating notification:', error)
        return null
    }
}

// Get all notifications for a user
export const getNotifications = async (req, res) => {
    try {
        const userId = req.user._id
        
        // Get unread count
        const unreadCount = await Notification.countDocuments({ 
            user: userId, 
            read: false 
        })

        // Get notifications (most recent first)
        const notifications = await Notification.find({ user: userId })
            .populate('from', 'username name profilePic')
            .populate({
                path: 'post',
                select: 'text img postedBy',
                populate: {
                    path: 'postedBy',
                    select: 'username'
                }
            })
            .sort({ createdAt: -1 })
            .limit(50) // Limit to 50 most recent

        res.status(200).json({
            notifications,
            unreadCount
        })
    } catch (error) {
        console.error('Error fetching notifications:', error)
        res.status(500).json({ error: 'Failed to fetch notifications' })
    }
}

// Mark notification as read
export const markNotificationAsRead = async (req, res) => {
    try {
        const { notificationId } = req.params
        const userId = req.user._id

        const notification = await Notification.findOne({
            _id: notificationId,
            user: userId
        })

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' })
        }

        notification.read = true
        await notification.save()

        res.status(200).json({ message: 'Notification marked as read' })
    } catch (error) {
        console.error('Error marking notification as read:', error)
        res.status(500).json({ error: 'Failed to mark notification as read' })
    }
}

// Mark all notifications as read
export const markAllNotificationsAsRead = async (req, res) => {
    try {
        const userId = req.user._id

        await Notification.updateMany(
            { user: userId, read: false },
            { read: true }
        )

        res.status(200).json({ message: 'All notifications marked as read' })
    } catch (error) {
        console.error('Error marking all notifications as read:', error)
        res.status(500).json({ error: 'Failed to mark all notifications as read' })
    }
}

// Get unread notification count
export const getUnreadCount = async (req, res) => {
    try {
        const userId = req.user._id
        
        const unreadCount = await Notification.countDocuments({ 
            user: userId, 
            read: false 
        })

        res.status(200).json({ unreadCount })
    } catch (error) {
        console.error('Error fetching unread count:', error)
        res.status(500).json({ error: 'Failed to fetch unread count' })
    }
}
