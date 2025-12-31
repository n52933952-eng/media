import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getUserSocketMap } from '../socket/socket.js'

// Curated list of kid-friendly full cartoons/movies from YouTube
const KIDS_CARTOONS = [
    {
        id: 'gCNeDWCI0vo',
        title: 'Tom and Jerry - Classic Compilation',
        thumbnail: 'https://img.youtube.com/vi/gCNeDWCI0vo/maxresdefault.jpg'
    },
    {
        id: 'cW_Lv0r-l4c',
        title: 'Peppa Pig - Full Episodes',
        thumbnail: 'https://img.youtube.com/vi/cW_Lv0r-l4c/maxresdefault.jpg'
    },
    {
        id: 'BvFJstCIrpw',
        title: 'Mickey Mouse Clubhouse - Full Movie',
        thumbnail: 'https://img.youtube.com/vi/BvFJstCIrpw/maxresdefault.jpg'
    },
    {
        id: '4NierWss1vI',
        title: 'Paw Patrol - Movie Collection',
        thumbnail: 'https://img.youtube.com/vi/4NierWss1vI/maxresdefault.jpg'
    },
    {
        id: 'wcz4u3Lv6bY',
        title: 'SpongeBob SquarePants - Best Episodes',
        thumbnail: 'https://img.youtube.com/vi/wcz4u3Lv6bY/maxresdefault.jpg'
    },
    {
        id: 'eKFTSSKCzWA',
        title: 'Scooby-Doo - Mystery Adventures',
        thumbnail: 'https://img.youtube.com/vi/eKFTSSKCzWA/maxresdefault.jpg'
    },
    {
        id: 'a6m9PQ6j5vY',
        title: 'Looney Tunes - Classic Cartoons',
        thumbnail: 'https://img.youtube.com/vi/a6m9PQ6j5vY/maxresdefault.jpg'
    },
    {
        id: 'QQc5O5J29ME',
        title: 'Dora the Explorer - Adventures',
        thumbnail: 'https://img.youtube.com/vi/QQc5O5J29ME/maxresdefault.jpg'
    },
    {
        id: 'KqTHH8hQpMg',
        title: 'Ben 10 - Full Episodes',
        thumbnail: 'https://img.youtube.com/vi/KqTHH8hQpMg/maxresdefault.jpg'
    },
    {
        id: 'LOSKoFiR5vg',
        title: 'Adventure Time - Best Moments',
        thumbnail: 'https://img.youtube.com/vi/LOSKoFiR5vg/maxresdefault.jpg'
    }
]

// Helper to get or create Kids system account
const getKidsAccount = async () => {
    let kidsAccount = await User.findOne({ username: 'KidsMovies' })
    if (!kidsAccount) {
        kidsAccount = new User({
            name: 'Kids Movies',
            username: 'KidsMovies',
            email: 'kids@system.com',
            password: 'system_account',
            profilePic: 'https://img.icons8.com/fluency/96/000000/kids.png',
            bio: '🎬 Fun cartoons and movies for kids!'
        })
        await kidsAccount.save()
        console.log('✅ Kids account created')
    }
    return kidsAccount
}

// Helper to get random cartoon
const getRandomCartoon = () => {
    const randomIndex = Math.floor(Math.random() * KIDS_CARTOONS.length)
    return KIDS_CARTOONS[randomIndex]
}

// POST /api/kids/post/random - Post random cartoon to feed
export const postRandomCartoon = async (req, res) => {
    try {
        const kidsAccount = await getKidsAccount()
        const cartoon = getRandomCartoon()
        
        console.log(`🎬 [postRandomCartoon] Creating post for: ${cartoon.title}`)
        
        // Create new cartoon post
        const cartoonPost = new Post({
            postedBy: kidsAccount._id,
            text: `🎬 ${cartoon.title}\n\nEnjoy this fun cartoon! Click "Next Cartoon" to watch something else! 🍿`,
            img: `https://www.youtube.com/embed/${cartoon.id}?autoplay=0&mute=0`
        })
        
        await cartoonPost.save()
        await cartoonPost.populate("postedBy", "username profilePic name")
        
        console.log('✅ Created cartoon post:', cartoonPost._id)
        
        // Emit to current user via socket
        const io = getIO()
        if (io && req.user) {
            const socketMap = getUserSocketMap()
            const userSocketId = socketMap[req.user._id.toString()]?.socketId
            
            if (userSocketId) {
                io.to(userSocketId).emit("newPost", cartoonPost)
                console.log('✅ Emitted cartoon post to user')
            }
        }
        
        res.status(200).json({
            message: 'Cartoon post created successfully',
            postId: cartoonPost._id,
            cartoon: cartoon.title
        })
        
    } catch (error) {
        console.error('🎬 [postRandomCartoon] Error:', error)
        res.status(500).json({ error: error.message })
    }
}

// GET /api/kids/cartoons - Get list of all cartoons
export const getAllCartoons = async (req, res) => {
    try {
        res.status(200).json({
            cartoons: KIDS_CARTOONS,
            total: KIDS_CARTOONS.length
        })
    } catch (error) {
        console.error('🎬 [getAllCartoons] Error:', error)
        res.status(500).json({ error: error.message })
    }
}

// POST /api/kids/next/:postId - Change cartoon in existing post
export const nextCartoon = async (req, res) => {
    try {
        const { postId } = req.params
        const userId = req.user._id
        
        const post = await Post.findById(postId)
        if (!post) {
            return res.status(404).json({ error: 'Post not found' })
        }
        
        // Verify it's a Kids post
        const kidsAccount = await getKidsAccount()
        if (post.postedBy.toString() !== kidsAccount._id.toString()) {
            return res.status(403).json({ error: 'Not a Kids post' })
        }
        
        // Get new random cartoon
        const cartoon = getRandomCartoon()
        
        // Update post
        post.text = `🎬 ${cartoon.title}\n\nEnjoy this fun cartoon! Click "Next Cartoon" to watch something else! 🍿`
        post.img = `https://www.youtube.com/embed/${cartoon.id}?autoplay=0&mute=0`
        await post.save()
        await post.populate("postedBy", "username profilePic name")
        
        console.log(`✅ Changed cartoon in post ${postId} to: ${cartoon.title}`)
        
        // Emit update to all online followers via socket
        const io = getIO()
        if (io) {
            const kidsFollowers = await User.findById(kidsAccount._id).select('followers')
            const followerIds = kidsFollowers?.followers?.map(f => f.toString()) || []
            
            const socketMap = getUserSocketMap()
            followerIds.forEach(followerId => {
                const socketId = socketMap[followerId]?.socketId
                if (socketId) {
                    io.to(socketId).emit('postUpdated', post)
                }
            })
        }
        
        res.status(200).json({
            message: 'Cartoon changed successfully',
            post,
            cartoon: cartoon.title
        })
        
    } catch (error) {
        console.error('🎬 [nextCartoon] Error:', error)
        res.status(500).json({ error: error.message })
    }
}

