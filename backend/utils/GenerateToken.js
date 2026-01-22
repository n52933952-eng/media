import jwt from 'jsonwebtoken'


const GenerateToken = (userId,res) => {

    const token = jwt.sign({userId},process.env.JWT_SECRET,{expiresIn:"60d"})

    res.cookie("jwt",token,{httpOnly:true,maxAge:60 * 24 * 60 * 60 * 1000,sameSite:"strict"})


    return token 
}

export default GenerateToken