import mongoose from 'mongoose'


const PostSchema = mongoose.Schema({

 
    postedBy:{
       
        type:mongoose.Schema.Types.ObjectId,
        ref:"User",
        required:true

    },

    text:{
        type:String,
        maxLength:500
    },

    img:{
        type:String
    },

    likes:{
       type:[mongoose.Schema.Types.ObjectId],
       ref:"User",
       default:[]

    },


    replies:[
        {
            userId:{
                type:mongoose.Schema.Types.ObjectId,
                ref:"User",
                required:true
            },
            text:{
                type:String,
                required:true
            },
            userProfilePic:{
                type:String
            },

            username:{
                type:String
            },
          
            date: {
             type: Date,
             default: Date.now, 
             },

              parentReplyId: {
                type: mongoose.Schema.Types.ObjectId,
                default: null 
            },
            
           
            likes: {
                type: [mongoose.Schema.Types.ObjectId],
                ref: "User",
                default: []
            },
            
            // NEW: Track who was mentioned in this reply (like @username on Facebook)
            mentionedUser: {
                userId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User",
                    default: null
                },
                username: {
                    type: String,
                    default: null
                }
            }
        }
    ]




},{timestamps:true})

const Post = mongoose.model("Post",PostSchema)

export default Post