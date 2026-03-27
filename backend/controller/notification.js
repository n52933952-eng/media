import Notification from '../models/notification.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getRecipientSockedId } from '../socket/socket.js'
import { 
    sendLikeNotification, 
    sendCommentNotification, 
    sendMentionNotification,
    sendFollowNotification,
    sendNotificationToUser
} from '../services/pushNotifications.js'

function buildNotificationSocketPayload(notification, options = {}) {
    let notificationObj
    if (notification.toObject) {
        notificationObj = notification.toObject()
    } else if (typeof notification.toJSON === 'function') {
        notificationObj = notification.toJSON()
    } else {
        notificationObj = JSON.parse(JSON.stringify(notification))
    }

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

    if (notification.metadata) {
        notificationObj.metadata = notification.metadata
    } else if (options.postText || options.postId) {
        notificationObj.metadata = {
            postText: options.postText || null,
            postId: options.postId?.toString() || notificationObj.post?._id?.toString() || null
        }
    }

    if (!notificationObj.post && options.postId) {
        notificationObj.post = {
            _id: options.postId.toString()
        }
    }

    return notificationObj
}

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
        
        const notificationObj = buildNotificationSocketPayload(notification, options)
        const io = getIO()
        // In-app: only when there is a live, valid socket (same helper as messages)
        let deliveredInApp = false
        try {
            const socketId = await getRecipientSockedId(userId)
            if (io && socketId) {
                io.to(socketId).emit('newNotification', notificationObj)
                deliveredInApp = true
                console.log(`📬 [createNotification] In-app notification → user ${userId}, type: ${type}, socket: ${socketId}`)
            } else {
                console.log(`⚠️ [createNotification] No live socket for user ${userId} (type: ${type}) — will send push if applicable`)
            }
        } catch (emitErr) {
            console.error(`❌ [createNotification] Socket emit failed for ${userId}:`, emitErr?.message)
        }

        // Push (FCM): only when not delivered in-app — avoids duplicate banner while user is in the app
        if (deliveredInApp) {
            return notification
        }

        try {
            // Get the user who triggered the notification (fromUserId) with profile picture
            const fromUser = await User.findById(fromUserId).select('username name profilePic')
            if (!fromUser) {
                console.log(`⚠️ [createNotification] From user not found: ${fromUserId}`)
                return notification
            }

            const fromUserName = fromUser.name || fromUser.username || 'Someone'
            const postId = options.postId?.toString() || notification.post?.toString() || null
            
            // Get post image if it's a post-related notification
            let postImage = null
            if (postId && (type === 'like' || type === 'comment' || type === 'mention' || type === 'collaboration' || type === 'post_edit')) {
                try {
                    const Post = (await import('../models/post.js')).default
                    const post = await Post.findById(postId).select('img')
                    if (post && post.img) {
                        postImage = post.img
                    }
                } catch (postError) {
                    console.log(`⚠️ [createNotification] Could not fetch post image:`, postError.message)
                }
            }

            // Prepare images for rich notifications (Facebook-style)
            const images = {
                profilePic: fromUser.profilePic || null,
                postImage: postImage || null,
            }

            // Send appropriate FCM notification based on type
            switch (type) {
                case 'like':
                    await sendLikeNotification(userId.toString(), fromUserName, postId, images)
                    console.log(`📤 [createNotification] Sent FCM like notification to ${userId}`)
                    break
                
                case 'comment':
                    await sendCommentNotification(userId.toString(), fromUserName, postId, images)
                    console.log(`📤 [createNotification] Sent FCM comment notification to ${userId}`)
                    break
                
                case 'mention':
                    await sendMentionNotification(userId.toString(), fromUserName, postId, images)
                    console.log(`📤 [createNotification] Sent FCM mention notification to ${userId}`)
                    break
                
                case 'follow':
                    await sendFollowNotification(userId.toString(), fromUserName, fromUserId.toString(), images)
                    console.log(`📤 [createNotification] Sent FCM follow notification to ${userId}`)
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
                    }, images)
                    console.log(`📤 [createNotification] Sent FCM ${type} notification to ${userId}`)
                    break
                
                default:
                    console.log(`⚠️ [createNotification] Unknown notification type: ${type}, skipping FCM push`)
            }
        } catch (pushError) {
            // Don't fail notification creation if push fails
            console.error(`❌ [createNotification] Error sending FCM push notification:`, pushError)
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


