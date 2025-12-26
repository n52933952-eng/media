
import { Server } from 'socket.io'
import http from 'http'
import Message from '../models/message.js'
import Conversation from '../models/conversation.js'

// This will be set from index.js
let io = null
let server = null

const userSocketMap = {}
// Track active calls: { callId: { user1, user2 } }
const activeCalls = new Map()

export const initializeSocket = (app) => {
    // Create HTTP server from Express app
    server = http.createServer(app)
    
    // Initialize Socket.IO
    io = new Server(server, {
        cors: {
            origin: process.env.FRONTEND_URL || "http://localhost:5173",
            credentials: true,
            methods: ["GET", "POST"]
        }
    })

    io.on("connection", (socket) => {
        console.log("user connected", socket.id)
        
        const userId = socket.handshake.query.userId
        // Store socket info as object like madechess
        if (userId && userId !== "undefined") {
            userSocketMap[userId] = {
                socketId: socket.id,
                onlineAt: Date.now(),
            }
        }

        // Emit online users as array of objects like madechess
        const onlineArray = Object.entries(userSocketMap).map(([id, data]) => ({
            userId: id,
            onlineAt: data.onlineAt,
        }))
        io.emit("getOnlineUser", onlineArray)

        // Helper function to check if user is busy
        const isUserBusy = (userId) => {
            for (const [callId, callData] of activeCalls.entries()) {
                if (callData.user1 === userId || callData.user2 === userId) {
                    return true
                }
            }
            return false
        }

        // WebRTC: Handle call user - emit to both receiver AND sender like madechess
        socket.on("callUser", ({ userToCall, signalData, from, name, callType = 'video' }) => {
            // Check if either user is already in a call
            if (isUserBusy(userToCall) || isUserBusy(from)) {
                // Notify sender that the call cannot be made (user is busy)
                const senderData = userSocketMap[from]
                const senderSocketId = senderData?.socketId
                if (senderSocketId) {
                    io.to(senderSocketId).emit("callBusyError", { 
                        message: "User is currently in a call",
                        busyUserId: isUserBusy(userToCall) ? userToCall : from
                    })
                }
                return
            }

            const receiverData = userSocketMap[userToCall]
            const receiverSocketId = receiverData?.socketId

            const senderData = userSocketMap[from]
            const senderSocketId = senderData?.socketId

            if (receiverSocketId) {
                io.to(receiverSocketId).emit("callUser", { 
                    signal: signalData, 
                    from, 
                    name, 
                    userToCall,
                    callType
                })
            }

            if (senderSocketId) {
                io.to(senderSocketId).emit("callUser", { 
                    signal: signalData, 
                    from, 
                    name, 
                    userToCall,
                    callType
                })
            }

            // Mark both users as busy
            const callId = `${from}-${userToCall}`
            activeCalls.set(callId, { user1: from, user2: userToCall })
            
            io.emit("callBusy", { userToCall, from })
        })

        // WebRTC: Handle answer call
        socket.on("answerCall", (data) => {
            const callerData = userSocketMap[data.to]
            const callerSocketId = callerData?.socketId
            if (callerSocketId) {
                io.to(callerSocketId).emit("callAccepted", data.signal)
                // Call is now active - both users are busy (already marked in callUser)
            }
        })

        // WebRTC: Handle ICE candidate
        socket.on("iceCandidate", ({ userToCall, candidate, from }) => {
            const receiverData = userSocketMap[userToCall]
            const receiverSocketId = receiverData?.socketId
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("iceCandidate", { candidate, from })
            }
        })

        // WebRTC: Handle cancel call - match madechess implementation
        socket.on("cancelCall", ({ conversationId, sender }) => {
            const receiverData = userSocketMap[conversationId]
            const receiverSocketId = receiverData?.socketId

            const senderData = userSocketMap[sender]
            const senderSocketId = senderData?.socketId

            // Remove from active calls - try both possible call IDs
            const callId1 = `${sender}-${conversationId}`
            const callId2 = `${conversationId}-${sender}`
            if (activeCalls.has(callId1)) {
                activeCalls.delete(callId1)
            } else if (activeCalls.has(callId2)) {
                activeCalls.delete(callId2)
            }

            if (receiverSocketId) {
                io.to(receiverSocketId).emit("CallCanceled")
            }
            if (senderSocketId) {
                io.to(senderSocketId).emit("CallCanceled")
            }
            io.emit("cancleCall", { userToCall: conversationId, from: sender })
        })

        // Mark messages as seen
        socket.on("markmessageasSeen", async ({ conversationId, userId }) => {
            try {
                // Get the current user's ID from socket
                const currentUserId = socket.handshake.query.userId
                
                // Update only messages sent by userId (the other user) to seen: true
                // This marks messages from userId as "seen by currentUserId"
                await Message.updateMany(
                    { 
                        conversationId: conversationId, 
                        sender: userId,  // Only messages sent by userId
                        seen: false 
                    },
                    { $set: { seen: true } }
                )
                // Update conversation's lastMessage.seen to true
                await Conversation.updateOne(
                    { _id: conversationId },
                    { $set: { "lastMessage.seen": true } }
                )
                
                // Emit to the sender (the userId is the sender of the messages)
                const senderData = userSocketMap[userId]
                const senderSocketId = senderData?.socketId
                if (senderSocketId) {
                    io.to(senderSocketId).emit("messagesSeen", { conversationId })
                }
                
                // Also emit to the current user who marked messages as seen (to update their count)
                if (currentUserId && currentUserId !== userId) {
                    const currentUserData = userSocketMap[currentUserId]
                    const currentUserSocketId = currentUserData?.socketId
                    if (currentUserSocketId) {
                        io.to(currentUserSocketId).emit("messagesSeen", { conversationId })
                    }
                }
            } catch (error) {
                console.log("Error marking messages as seen:", error)
            }
        })

        // Typing indicator - user started typing
        socket.on("typingStart", ({ from, to, conversationId }) => {
            const recipientData = userSocketMap[to]
            const recipientSocketId = recipientData?.socketId
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("userTyping", { userId: from, conversationId, isTyping: true })
            }
        })

        // Typing indicator - user stopped typing
        socket.on("typingStop", ({ from, to, conversationId }) => {
            const recipientData = userSocketMap[to]
            const recipientSocketId = recipientData?.socketId
            if (recipientSocketId) {
                io.to(recipientSocketId).emit("userTyping", { userId: from, conversationId, isTyping: false })
            }
        })

        socket.on("disconnect", () => {
            console.log("user disconnected", socket.id)
            
            let disconnectedUserId = null
            
            // Remove user from map by matching socket.id like madechess
            for (const [id, data] of Object.entries(userSocketMap)) {
                if (data.socketId === socket.id) {
                    disconnectedUserId = id
                    delete userSocketMap[id]
                    break
                }
            }

            // Clean up active calls for disconnected user
            if (disconnectedUserId) {
                for (const [callId, callData] of activeCalls.entries()) {
                    if (callData.user1 === disconnectedUserId || callData.user2 === disconnectedUserId) {
                        activeCalls.delete(callId)
                        // Notify the other user
                        const otherUserId = callData.user1 === disconnectedUserId ? callData.user2 : callData.user1
                        const otherUserData = userSocketMap[otherUserId]
                        if (otherUserData) {
                            io.to(otherUserData.socketId).emit("CallCanceled")
                            io.emit("cancleCall", { userToCall: otherUserId, from: disconnectedUserId })
                        }
                    }
                }
            }

            // Emit updated online list as array of objects
            const updatedOnlineArray = Object.entries(userSocketMap).map(([id, data]) => ({
                userId: id,
                onlineAt: data.onlineAt,
            }))
            io.emit("getOnlineUser", updatedOnlineArray)
        })
    })

    return { io, server }
}

export const getRecipientSockedId = (recipientId) => {
    const userData = userSocketMap[recipientId]
    return userData ? userData.socketId : null
}

// Export getters for io and server
export const getIO = () => io
export const getServer = () => server
