
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
            origin: "http://localhost:5173",
            credentials: true,
            methods: ["GET", "POST"]
        }
    })

    io.on("connection", (socket) => {
        console.log("user connected", socket.id)
        
        const userId = socket.handshake.query.userId
        // Fix: Check if userId exists and is not "undefined" string
        if (userId && userId !== "undefined") {
            userSocketMap[userId] = socket.id
        }

        io.emit("getOnlineUser", Object.keys(userSocketMap))

        // WebRTC: Handle call user
        socket.on("callUser", ({ userToCall, signalData, from, name }) => {
            const receiverSocketId = userSocketMap[userToCall]
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("callUser", { 
                    signal: signalData, 
                    from, 
                    name, 
                    userToCall 
                })
            }
        })

        // WebRTC: Handle answer call
        socket.on("answerCall", (data) => {
            const callerSocketId = userSocketMap[data.to]
            if (callerSocketId) {
                io.to(callerSocketId).emit("callAccepted", data.signal)
            }
        })

        // WebRTC: Handle ICE candidate
        socket.on("iceCandidate", ({ userToCall, candidate, from }) => {
            const receiverSocketId = userSocketMap[userToCall]
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("iceCandidate", { candidate, from })
            }
        })

        // WebRTC: Handle cancel call
        socket.on("cancelCall", ({ conversationId, sender }) => {
            const receiverSocketId = userSocketMap[conversationId]
            const senderSocketId = userSocketMap[sender]

            if (receiverSocketId) {
                io.to(receiverSocketId).emit("CallCanceled")
            }
            if (senderSocketId && senderSocketId !== receiverSocketId) {
                io.to(senderSocketId).emit("CallCanceled")
            }
        })

        socket.on("disconnect", () => {
            console.log("user disconnected", socket.id)
            if (userId && userId !== "undefined") {
                delete userSocketMap[userId]
            }
            io.emit("getOnlineUser", Object.keys(userSocketMap))
        })
    })

    return { io, server }
}

export const getRecipientSockedId = (recipientId) => {
    return userSocketMap[recipientId]
}

// Export getters for io and server
export const getIO = () => io
export const getServer = () => server
