import Notification from '../models/notification.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getUserSocketMap } from '../socket/socket.js'
import { 
    sendLikeNotification, 
    sendCommentNotification, 
    sendMentionNotification,
    sendFollowNotification,
    sendNotificationToUser
} from '../services/pushNotifications.js'

// Create a notification
export const createNotification = async (userId, type, fromUserId, options = {}) => {
    try {
        // Don't notify user if they're notifying themselves
        if (userId.toString() === fromUserId.toString()) {
            return null
        }

        // Create new notification
        const notification = new Notification({
            user: userId,
            type: type, // 'follow', 'comment', 'mention', 'collaboration', 'post_edit'
            from: fromUserId,
            post: options.postId || null,
            comment: options.commentText || null,
            metadata: (options.postText || options.postId) ? { 
                postText: options.postText || null,
                postId: options.postId || null
            } : null, // Store postText and postId in metadata for collaboration/post_edit
            read: false
        })

        await notification.save()
        
        // Populate notification (for both new and existing) before emitting
        // Populate 'from' field for socket emission
        await notification.populate('from', 'username name profilePic')
        
        // Populate post if it exists (even if postId was provided as string, Mongoose should have converted it)
        if (notification.post || options.postId) {
            try {
                await notification.populate({
                    path: 'post',
                    select: 'text img postedBy',
                    populate: {
                        path: 'postedBy',
                        select: 'username name'
                    }
                })
            } catch (populateError) {
                console.error('⚠️ [createNotification] Error populating post:', populateError)
                // Continue even if populate fails - metadata has the info we need
            }
        }
        
        // Emit real-time notification to user if online
        // Use setTimeout to ensure socket is fully ready
        setTimeout(() => {
            const io = getIO()
            if (io) {
                const userSocketMap = getUserSocketMap()
                const userSocketData = userSocketMap[userId.toString()]
                
                if (userSocketData) {
                    // Convert Mongoose document to plain object for socket emission
                    let notificationObj
                    if (notification.toObject) {
                        notificationObj = notification.toObject()
                    } else if (typeof notification.toJSON === 'function') {
                        notificationObj = notification.toJSON()
                    } else {
                        notificationObj = JSON.parse(JSON.stringify(notification))
                    }
                    
                    // Ensure all nested objects are properly serialized
                    if (notificationObj.from && typeof notificationObj.from === 'object') {
                        notificationObj.from = {
                            _id: notificationObj.from._id?.toString() || notificationObj.from._id,
                            username: notificationObj.from.username,
                            name: notificationObj.from.name,
                            profilePic: notificationObj.from.profilePic
                        }
                    }
                    
                    if (notificationObj.post && typeof notificationObj.post === 'object') {
                        notificationObj.post = {
                            _id: notificationObj.post._id?.toString() || notificationObj.post._id,
                            text: notificationObj.post.text,
                            img: notificationObj.post.img,
                            postedBy: notificationObj.post.postedBy ? {
                                username: notificationObj.post.postedBy.username || notificationObj.post.postedBy
                            } : null
                        }
                    }
                    
                    // Include metadata in socket emission (for collaboration/post_edit notifications)
                    if (notification.metadata) {
                        notificationObj.metadata = notification.metadata
                    } else if (options.postText || options.postId) {
                        // Ensure metadata is included even if not saved properly
                        notificationObj.metadata = {
                            postText: options.postText || null,
                            postId: options.postId?.toString() || notificationObj.post?._id?.toString() || null
                        }
                    }
                    
                    // Ensure post is included for navigation (even if populate failed)
                    if (!notificationObj.post && options.postId) {
                        notificationObj.post = {
                            _id: options.postId.toString()
                        }
                    }
                    
                    io.to(userSocketData.socketId).emit('newNotification', notificationObj)
                    console.log(`📬 [createNotification] Sent notification to user ${userId} (socket: ${userSocketData.socketId}), type: ${type}`)
                } else {
                    console.log(`⚠️ [createNotification] User ${userId} is not online (not in socket map)`)
                    console.log(`🔍 [createNotification] Available users in socket map:`, Object.keys(userSocketMap))
                }
            } else {
                console.log(`⚠️ [createNotification] Socket.IO not initialized`)
            }
        }, 200) // Small delay to ensure socket is ready

        // Send OneSignal push notification (for likes, comments, mentions, follows, etc.)
        // Note: Call notifications are handled separately via FCM
        try {
            // Get the user who triggered the notification (fromUserId)
            const fromUser = await User.findById(fromUserId).select('username name')
            if (!fromUser) {
                console.log(`⚠️ [createNotification] From user not found: ${fromUserId}`)
                return notification
            }

            const fromUserName = fromUser.name || fromUser.username || 'Someone'
            const postId = options.postId?.toString() || notification.post?.toString() || null

            // Send appropriate OneSignal notification based on type
            switch (type) {
                case 'like':
                    await sendLikeNotification(userId.toString(), fromUserName, postId)
                    console.log(`📤 [createNotification] Sent OneSignal like notification to ${userId}`)
                    break
                
                case 'comment':
                    await sendCommentNotification(userId.toString(), fromUserName, postId)
                    console.log(`📤 [createNotification] Sent OneSignal comment notification to ${userId}`)
                    break
                
                case 'mention':
                    await sendMentionNotification(userId.toString(), fromUserName, postId)
                    console.log(`📤 [createNotification] Sent OneSignal mention notification to ${userId}`)
                    break
                
                case 'follow':
                    await sendFollowNotification(userId.toString(), fromUserName, fromUserId.toString())
                    console.log(`📤 [createNotification] Sent OneSignal follow notification to ${userId}`)
                    break
                
                case 'collaboration':
                case 'post_edit':
                    // Use generic notification for collaboration/post_edit
                    const title = type === 'collaboration' ? 'Collaborative Post 👥' : 'Post Updated ✏️'
                    const message = type === 'collaboration' 
                        ? `${fromUserName} added you as a contributor`
                        : `${fromUserName} edited your collaborative post`
                    await sendNotificationToUser(userId.toString(), title, message, {
                        type: type,
                        postId: postId
                    })
                    console.log(`📤 [createNotification] Sent OneSignal ${type} notification to ${userId}`)
                    break
                
                default:
                    console.log(`⚠️ [createNotification] Unknown notification type: ${type}, skipping OneSignal push`)
            }
        } catch (pushError) {
            // Don't fail notification creation if push fails
            console.error(`❌ [createNotification] Error sending OneSignal push notification:`, pushError)
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

// Delete a notification
export const deleteNotification = async (req, res) => {
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

        await Notification.findByIdAndDelete(notificationId)

        res.status(200).json({ message: 'Notification deleted successfully' })
    } catch (error) {
        console.error('Error deleting notification:', error)
        res.status(500).json({ error: 'Failed to delete notification' })
    }
}

// Delete follow notification when user unfollows
export const deleteFollowNotification = async (userId, fromUserId) => {
    try {
        // Delete unread follow notifications from this user
        const deleted = await Notification.deleteMany({
            user: userId,
            type: 'follow',
            from: fromUserId,
            read: false // Only delete unread notifications
        })

        if (deleted.deletedCount > 0) {
            console.log(`🗑️ [deleteFollowNotification] Deleted ${deleted.deletedCount} follow notification(s) for user ${userId} from ${fromUserId}`)
            
            // Emit notification deletion to user if online
            const io = getIO()
            if (io) {
                const userSocketMap = getUserSocketMap()
                const userSocketData = userSocketMap[userId.toString()]
                
                if (userSocketData) {
                    io.to(userSocketData.socketId).emit('notificationDeleted', {
                        type: 'follow',
                        from: fromUserId.toString()
                    })
                    console.log(`📤 [deleteFollowNotification] Emitted notificationDeleted to user ${userId}`)
                }
            }
        }

        return deleted
    } catch (error) {
        console.error('Error deleting follow notification:', error)
        return null
    }
}


