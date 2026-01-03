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

    footballData:{
        type:String // JSON string of match data for Football posts
    },

    chessGameData:{
        type:String // JSON string of chess game data: {player1, player2, roomId, gameStatus}
    },

    channelAddedBy:{
        type:String // User ID who added this channel post (for tracking and deletion)
    },

    // Collaborative posts - multiple users can contribute
    isCollaborative: {
        type: Boolean,
        default: false
    },
    contributors: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],

    // Match reaction posts - auto-created when goals are scored
    isMatchReaction: {
        type: Boolean,
        default: false
    },
    matchReactionData: {
        matchId: String,
        homeTeam: String,
        awayTeam: String,
        scorer: String,
        team: String,
        minute: Number,
        score: {
            home: Number,
            away: Number
        }
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

// CRITICAL: Add indexes for performance - essential for production
// Index on postedBy + createdAt for fast feed queries
PostSchema.index({ postedBy: 1, createdAt: -1 })
// Index on createdAt for sorting
PostSchema.index({ createdAt: -1 })

const Post = mongoose.model("Post",PostSchema)

export default Post