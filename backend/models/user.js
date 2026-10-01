
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

    googleId:{
        type:String,
        sparse:true,
        unique:true,
    },

    profilePic:{
        type:String,
        default:""
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

    admin: {
        type: Boolean,
        default: false,
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
    },

    /** Default live channels this user hid from their channel list. */
    hiddenChannelIds: {
        type: [String],
        default: [],
    },

    // FCM token for push notifications (for calls)
    fcmToken: {
        type: String,
        default: ""
    }

},{timestamps:true})

// Note: username and email already have indexes from unique: true
UserSchema.index({ country: 1 })



const User = mongoose.model("User", UserSchema)

export default User