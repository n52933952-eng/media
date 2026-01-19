import User from '../models/user.js'
import { getIO, getUserSocket } from '../socket/socket.js'
import * as redisService from '../services/redis.js'

// Helper functions (same as in socket.js)
const getActiveCall = async (callId) => {
    if (!redisService.isRedisAvailable()) {
        return null
    }
    try {
        const callData = await redisService.redisGet(`activeCall:${callId}`)
        return callData ? JSON.parse(callData) : null
    } catch (error) {
        console.error(`❌ [call] Error getting active call ${callId}:`, error.message)
        return null
    }
}

const deleteActiveCall = async (callId) => {
    if (!redisService.isRedisAvailable()) {
        return
    }
    try {
        await redisService.redisDel(`activeCall:${callId}`)
    } catch (error) {
        console.error(`❌ [call] Error deleting active call ${callId}:`, error.message)
    }
}

const deletePendingCall = async (receiverId) => {
    if (!redisService.isRedisAvailable()) {
        return
    }
    try {
        await redisService.redisDel(`pendingCall:${receiverId}`)
    } catch (error) {
        console.error(`❌ [call] Error deleting pending call for ${receiverId}:`, error.message)
    }
}

/**
 * HTTP endpoint to cancel a call
 * POST /api/call/cancel
 * Body: { conversationId: callerId, sender: receiverId }
 * 
 * This allows canceling calls even when the app is killed
 */
export const cancelCall = async (req, res) => {
    try {
        const { conversationId, sender } = req.body

        if (!conversationId || !sender) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing conversationId or sender' 
            })
        }

        console.log(`📴 [HTTP cancelCall] Canceling call - conversationId: ${conversationId}, sender: ${sender}`)

        // Get socket IDs (same logic as socket handler)
        const receiverData = await getUserSocket(conversationId)
        const receiverSocketId = receiverData?.socketId

        const senderData = await getUserSocket(sender)
        const senderSocketId = senderData?.socketId

        // Remove from active calls - try both possible call IDs
        const callId1 = `${sender}-${conversationId}`
        const callId2 = `${conversationId}-${sender}`
        const call1 = await getActiveCall(callId1)
        const call2 = await getActiveCall(callId2)
        if (call1) {
            await deleteActiveCall(callId1)
        } else if (call2) {
            await deleteActiveCall(callId2)
        }
        
        // Also delete pending call if receiver was offline
        await deletePendingCall(conversationId)

        // Update database - mark users as NOT in call (non-blocking)
        User.findByIdAndUpdate(sender, { inCall: false }).catch(err => 
            console.log('Error updating sender inCall status:', err)
        )
        User.findByIdAndUpdate(conversationId, { inCall: false }).catch(err => 
            console.log('Error updating receiver inCall status:', err)
        )

        // Send FCM notification to stop ringtone
        try {
            const { sendCallEndedNotificationToUser } = await import('../services/fcmNotifications.js')
            const fcmResult = await sendCallEndedNotificationToUser(conversationId, sender)
            if (fcmResult.success) {
                console.log('✅ [HTTP cancelCall] Sent call ended FCM notification to receiver')
            } else {
                console.log('⚠️ [HTTP cancelCall] FCM call ended notification failed:', fcmResult.error)
            }
        } catch (fcmError) {
            console.error('❌ [HTTP cancelCall] Error sending FCM call ended notification:', fcmError)
        }

        // Emit socket events to notify both users
        const io = getIO()
        if (io) {
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("CallCanceled")
            }
            if (senderSocketId) {
                io.to(senderSocketId).emit("CallCanceled")
            }
            io.emit("cancleCall", { userToCall: conversationId, from: sender })
        }

        console.log(`✅ [HTTP cancelCall] Call canceled successfully`)
        return res.status(200).json({ 
            success: true, 
            message: 'Call canceled successfully' 
        })

    } catch (error) {
        console.error('❌ [HTTP cancelCall] Error:', error)
        return res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            message: error.message 
        })
    }
}
