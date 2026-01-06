import User from '../models/user.js'
import jwt from 'jsonwebtoken'
const protectRoute = async(req,res,next) => {


    try{
 
        const token = req.cookies.jwt
        
        if(!token){
           return res.status(401).json({message:"no token"})
        }

        const decode = jwt.verify(token,process.env.JWT_SECRET)

        if (!decode || !decode.userId) {
            return res.status(401).json({message:"Invalid token"})
        }

         const user = await User.findById(decode.userId).select("-password")

         if (!user) {
            return res.status(401).json({message:"User not found"})
        }

         req.user = user

         next()
    }
    catch(error){
        // Handle JWT errors specifically
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({message: "Invalid or expired token"})
        }
        console.error('Error in protectRoute:', error)
        return res.status(500).json({error: error.message || "Internal server error"})
    }
}


export default protectRoute