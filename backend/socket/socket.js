
import { Server } from 'socket.io'
import http from 'http'

// This will be set from index.js
let io = null
let server = null

const userSocketMap = {}

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

        // WebRTC: Handle call user - emit to both receiver AND sender like madechess
        socket.on("callUser", ({ userToCall, signalData, from, name }) => {
            const receiverData = userSocketMap[userToCall]
            const receiverSocketId = receiverData?.socketId

            const senderData = userSocketMap[from]
            const senderSocketId = senderData?.socketId

            if (receiverSocketId) {
                io.to(receiverSocketId).emit("callUser", { 
                    signal: signalData, 
                    from, 
                    name, 
                    userToCall 
                })
            }

            if (senderSocketId) {
                io.to(senderSocketId).emit("callUser", { 
                    signal: signalData, 
                    from, 
                    name, 
                    userToCall 
                })
            }
        })

        // WebRTC: Handle answer call
        socket.on("answerCall", (data) => {
            const callerData = userSocketMap[data.to]
            const callerSocketId = callerData?.socketId
            if (callerSocketId) {
                io.to(callerSocketId).emit("callAccepted", data.signal)
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

            if (receiverSocketId) {
                io.to(receiverSocketId).emit("CallCanceled")
            }
            if (senderSocketId) {
                io.to(senderSocketId).emit("CallCanceled")
            }
        })

        socket.on("disconnect", () => {
            console.log("user disconnected", socket.id)
            
            // Remove user from map by matching socket.id like madechess
            for (const [id, data] of Object.entries(userSocketMap)) {
                if (data.socketId === socket.id) {
                    delete userSocketMap[id]
                    break
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
