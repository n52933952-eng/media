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
import NotificationRoute from './routes/notification.js'
import ActivityRoute from './routes/activity.js'
import { initializeSocket } from './socket/socket.js'
import { initializeFootballCron } from './services/footballCron.js'
import { initializeChessPostCleanup } from './services/chessPostCleanup.js'
import { initializeActivityCleanup } from './services/activityCleanup.js'
import { initRedis, isRedisAvailable } from './services/redis.js'
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


// Configure MongoDB connection with connection pooling for scalability
mongoose.connect(process.env.MONGO, {
    maxPoolSize: 50,        // Maximum number of connections in the pool
    minPoolSize: 5,         // Minimum number of connections in the pool
    serverSelectionTimeoutMS: 5000, // How long to try selecting a server
    socketTimeoutMS: 45000, // How long to wait for a socket
    family: 4,              // Use IPv4, skip trying IPv6
    retryWrites: true,      // Retry writes on network errors
    w: 'majority'            // Write concern: wait for majority of replicas
})
.then(async () => {
    console.log("✅ MongoDB Connected with connection pooling")
    
    // Initialize Redis after MongoDB connection
    await initRedis()
})
.catch((error) => {
    console.error("❌ MongoDB connection error:", error)
    process.exit(1) // Exit if database connection fails
})

// Health check endpoint for load balancer
app.get('/health', async (req, res) => {
    try {
        const health = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            checks: {
                database: mongoose.connection.readyState === 1 ? 'ok' : 'error',
                redis: isRedisAvailable() ? 'ok' : 'error'
            }
        }
        
        const allHealthy = Object.values(health.checks).every(c => c === 'ok')
        const statusCode = allHealthy ? 200 : 503
        
        res.status(statusCode).json(health)
    } catch (error) {
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: error.message
        })
    }
})

// API routes - must be registered before static files and catch-all
app.use("/api/user",UserRoute)
app.use("/api/post",PostRoute)
app.use("/api/message",MessageRoute)
app.use("/api/football",FootballRoute)
app.use("/api/news",NewsRoute)
app.use("/api/notification",NotificationRoute)
app.use("/api/activity",ActivityRoute)

// 404 handler for API routes (before static files and catch-all)
app.use('/api/*', (req, res) => {
    console.log(`[404] API route not found: ${req.method} ${req.originalUrl}`)
    res.status(404).json({ error: 'API route not found', path: req.originalUrl })
})

// Serve static files from React app (for production)
app.use(express.static(path.join(__dirname, '../frontent/dist')))

// Catch all handler: send back React's index.html file for SPA routing (only for non-API routes)
app.get('*', (req, res) => {
    // Don't catch API routes - they should have been handled above
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API route not found', path: req.originalUrl })
    }
    res.sendFile(path.join(__dirname, '../frontent/dist/index.html'))
})

// Initialize Socket.IO with the Express app (async - waits for Redis adapter setup)
// Start server using the HTTP server from Socket.IO
initializeSocket(app).then((result) => {
    const server = result.server
    server.listen(process.env.PORT, () => {
        console.log("✅ Server is running on port", process.env.PORT)
        console.log("✅ App is ready for 1M+ users with Redis scaling!")
        
        // Initialize Football Cron Jobs after server starts
        initializeFootballCron()
        
        // Ensure Football account exists on startup
        setTimeout(async () => {
            try {
                const User = (await import('./models/user.js')).default
                let footballAccount = await User.findOne({ username: 'Football' })
                
                if (!footballAccount) {
                    console.log('📦 Creating Football system account on startup...')
                    footballAccount = new User({
                        name: 'Football Live',
                        username: 'Football',
                        email: 'football@system.app',
                        password: Math.random().toString(36),
                        bio: '⚽ Live football scores, fixtures & updates from top leagues worldwide 🏆',
                        profilePic: 'https://cdn-icons-png.flaticon.com/512/53/53283.png'
                    })
                    await footballAccount.save()
                    console.log('✅ Football system account created on startup')
                } else {
                    console.log('✅ Football account already exists')
                }
            } catch (error) {
                console.error('❌ Error checking Football account on startup:', error)
            }
        }, 2000) // Run 2 seconds after server starts
        
        // Initialize Chess Post Cleanup Cron Job
        initializeChessPostCleanup()
        
        // Initialize Activity Cleanup Cron Job
        initializeActivityCleanup()
    })
}).catch((error) => {
    console.error('❌ Failed to initialize Socket.IO:', error)
    process.exit(1)
})