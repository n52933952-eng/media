import express from 'express'
import mongoose from 'mongoose'
import dotenv from 'dotenv'; 
import cookieParser from 'cookie-parser'
import cors from 'cors'
import UserRoute from './routes/user.js'
import PostRoute from './routes/post.js'
import{v2 as cloudinary} from 'cloudinary'
import MessageRoute from './routes/message.js'
import FootballRoute from './routes/football.js'
import NewsRoute from './routes/news.js'
import { initializeSocket } from './socket/socket.js'
import { initializeFootballCron } from './services/footballCron.js'
import { initializeChessPostCleanup } from './services/chessPostCleanup.js'
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

app.use(express.json({ limit: "500mb" })); // Increased for other endpoints
app.use(express.urlencoded({ limit: "500mb", extended: true })); // Increased for other endpoints
// Note: File uploads via Multer use multipart/form-data and have their own 500MB limit

// Increase server timeout for large file uploads (20 minutes)
app.use((req, res, next) => {
  req.setTimeout(1200000); // 20 minutes
  res.setTimeout(1200000); // 20 minutes
  next();
});

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
app.use("/api/football",FootballRoute)
app.use("/api/news",NewsRoute)

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
    
    // Initialize Football Cron Jobs after server starts
    initializeFootballCron()
    
    // Initialize Chess Post Cleanup Cron Job
    initializeChessPostCleanup()
})