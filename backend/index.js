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
app.use(cors({origin:"http://localhost:5173",credentials:true}))


mongoose.connect(process.env.MONGO)
.then(() => console.log("MogoConnected"))
.catch((error) => console.log(error))



app.use("/api/user",UserRoute)
app.use("/api/post",PostRoute)
app.use("/api/message",MessageRoute)

// Initialize Socket.IO with the Express app
const { server } = initializeSocket(app)

// Start server using the HTTP server from Socket.IO
server.listen(process.env.PORT, () => {
    console.log("Server is running on port", process.env.PORT)
})



app.use(express.static(path.join(__dirname, '/frontent/dist')))

app.get('*',(req,res) => {
    res.sendFile(path.join(__dirname, 'frontent', 'dist', 'index.html'))
})