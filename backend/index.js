import express from 'express'
import mongoose from 'mongoose'
import dotenv from 'dotenv'; 
import cookieParser from 'cookie-parser'
import cors from 'cors'
import UserRoute from './routes/user.js'
import PostRoute from './routes/post.js'
import{v2 as cloudinary} from 'cloudinary'
import MessageRoute from './routes/message.js'
import { initializeSocket } from './socket/socket.js'
import path from 'path'
import { fileURLToPath } from 'url'

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config()

const app = express()

cloudinary.config({
     cloud_name:process.env.CLOUDINARY_CLOUD_NAME,
     api_key:process.env.CLOUDINARY_API_KEY,
     api_secret:process.env.CLOUDINARY_API_SECRET

})

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

app.use(cookieParser())
// CORS - allow both localhost (dev) and your Render frontend URL (prod)
app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true
}))


mongoose.connect(process.env.MONGO)
.then(() => console.log("MogoConnected"))
.catch((error) => console.log(error))



app.use("/api/user",UserRoute)
app.use("/api/post",PostRoute)
app.use("/api/message",MessageRoute)

// Serve static files from React app (for production)
app.use(express.static(path.join(__dirname, '../frontent/dist')))

// Initialize Socket.IO with the Express app
const { server } = initializeSocket(app)

// Catch all handler: send back React's index.html file for SPA routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontent/dist/index.html'))
})

// Start server using the HTTP server from Socket.IO
server.listen(process.env.PORT, () => {
    console.log("Server is running on port", process.env.PORT)
})