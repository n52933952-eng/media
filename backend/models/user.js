
import mongoose from 'mongoose'

const UserSchema = mongoose.Schema({

 
    name:{
        type:String,
        required:true,

    },

    username:{
        type:String,
        required:true,
        unique:true
    },

    email:{
         type:String,
        required:true,
        unique:true  
    },

    password:{
        type:String,
        minLength:6,
        required:true
    },

    profilePic:{
        type:String,
        default:""
    },


    followers:{
        type:[String],
        default:[]
    },

    following:{
        type:[String],
        default:[]
    },
   
    bio:{
        type:String,
        default:""
    },

    inCall:{
        type:Boolean,
        default:false
    },

    country:{
        type:String,
        default:""
    },

    instagram:{
        type:String,
        default:""
    },

    weatherCities:{
        type:[{
            name: String,
            country: String,
            countryCode: String,
            lat: Number,
            lon: Number
        }],
        default:[]
    }

},{timestamps:true})

// CRITICAL: Add indexes for performance - essential for production scaling
// Index on followers for fast follower queries
UserSchema.index({ followers: 1 })
// Index on following for fast following queries
UserSchema.index({ following: 1 })
// Note: username and email already have indexes from unique: true, no need to duplicate



const User = mongoose.model("User", UserSchema)

export default User