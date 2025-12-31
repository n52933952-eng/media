import User from '../models/user.js'
import Post from '../models/post.js'
import { getIO, getUserSocketMap } from '../socket/socket.js'

// Curated list of 100 kid-friendly videos from YouTube
// Focused on popular kids songs and educational content that typically allows embedding
const KIDS_CARTOONS = [
    // Baby Shark and Pinkfong
    { id: 'XqZsoesa55w', title: 'Baby Shark Dance - Pinkfong', thumbnail: 'https://img.youtube.com/vi/XqZsoesa55w/maxresdefault.jpg' },
    { id: 'R75a1znn07k', title: 'Baby Shark Brooklyn - Pinkfong', thumbnail: 'https://img.youtube.com/vi/R75a1znn07k/maxresdefault.jpg' },
    { id: 'FX-FCytGFqg', title: 'Pinkfong Halloween Songs', thumbnail: 'https://img.youtube.com/vi/FX-FCytGFqg/maxresdefault.jpg' },
    
    // Super Simple Songs (usually embeddable)
    { id: 'BQ0mxQXmLsk', title: 'The Wheels On The Bus', thumbnail: 'https://img.youtube.com/vi/BQ0mxQXmLsk/maxresdefault.jpg' },
    { id: 'AuQNVDsCPEY', title: 'Walking Walking - Super Simple Songs', thumbnail: 'https://img.youtube.com/vi/AuQNVDsCPEY/maxresdefault.jpg' },
    { id: '0BdLGIlN9d4', title: 'Make A Circle - Super Simple Songs', thumbnail: 'https://img.youtube.com/vi/0BdLGIlN9d4/maxresdefault.jpg' },
    { id: 'GvTcpfSnOMQ', title: 'Seven Steps - Super Simple Songs', thumbnail: 'https://img.youtube.com/vi/GvTcpfSnOMQ/maxresdefault.jpg' },
    { id: 'NwT5oX_mqS0', title: 'One Little Finger - Super Simple Songs', thumbnail: 'https://img.youtube.com/vi/NwT5oX_mqS0/maxresdefault.jpg' },
    
    // CoComelon (popular but some may be restricted)
    { id: 'Yvga8pg9hsw', title: 'CoComelon - Wheels on the Bus', thumbnail: 'https://img.youtube.com/vi/Yvga8pg9hsw/maxresdefault.jpg' },
    { id: '_UR-l3QI2nE', title: 'CoComelon - Bath Song', thumbnail: 'https://img.youtube.com/vi/_UR-l3QI2nE/maxresdefault.jpg' },
    
    // ABC and Learning Songs
    { id: 'YQHsXMglC9A', title: 'ABC Song - Alphabet Learning', thumbnail: 'https://img.youtube.com/vi/YQHsXMglC9A/maxresdefault.jpg' },
    { id: 'BELlZKpi1Zs', title: 'Alphabet Song for Kids', thumbnail: 'https://img.youtube.com/vi/BELlZKpi1Zs/maxresdefault.jpg' },
    { id: 'saF3-f0XWAY', title: 'ABC Phonics Song', thumbnail: 'https://img.youtube.com/vi/saF3-f0XWAY/maxresdefault.jpg' },
    
    // Number Songs
    { id: 'DR-cfDsHCGA', title: 'Counting to 10 Song', thumbnail: 'https://img.youtube.com/vi/DR-cfDsHCGA/maxresdefault.jpg' },
    { id: 'VCPXrPc-Bqo', title: 'Numbers Song 1-20', thumbnail: 'https://img.youtube.com/vi/VCPXrPc-Bqo/maxresdefault.jpg' },
    { id: '85359N6TQLw', title: 'Count to 100 Song', thumbnail: 'https://img.youtube.com/vi/85359N6TQLw/maxresdefault.jpg' },
    
    // Colors and Shapes
    { id: 'tkpfj_l_N2E', title: 'Learn Colors for Kids', thumbnail: 'https://img.youtube.com/vi/tkpfj_l_N2E/maxresdefault.jpg' },
    { id: '36n93jvjkDs', title: 'Colors Song for Children', thumbnail: 'https://img.youtube.com/vi/36n93jvjkDs/maxresdefault.jpg' },
    { id: 'TcgSJ5jqU2Y', title: 'Shapes Song', thumbnail: 'https://img.youtube.com/vi/TcgSJ5jqU2Y/maxresdefault.jpg' },
    
    // Disney Songs (some may work)
    { id: 'L0MK7qz13bU', title: 'Let It Go - Frozen', thumbnail: 'https://img.youtube.com/vi/L0MK7qz13bU/maxresdefault.jpg' },
    { id: 'ZNra8eK0K6k', title: 'How Far I\'ll Go - Moana', thumbnail: 'https://img.youtube.com/vi/ZNra8eK0K6k/maxresdefault.jpg' },
    
    // Kids Dance Songs
    { id: 'D0Ajq682yrA', title: 'Head Shoulders Knees and Toes', thumbnail: 'https://img.youtube.com/vi/D0Ajq682yrA/maxresdefault.jpg' },
    { id: 'e4MSN6IImpI', title: 'If You\'re Happy and You Know It', thumbnail: 'https://img.youtube.com/vi/e4MSN6IImpI/maxresdefault.jpg' },
    { id: 'tVlcKp3bWH8', title: 'The Hokey Pokey Song', thumbnail: 'https://img.youtube.com/vi/tVlcKp3bWH8/maxresdefault.jpg' },
    
    // Nursery Rhymes
    { id: '_z-1fTlSDF0', title: 'Twinkle Twinkle Little Star', thumbnail: 'https://img.youtube.com/vi/_z-1fTlSDF0/maxresdefault.jpg' },
    { id: 'yCjJyiqpAuU', title: 'Baa Baa Black Sheep', thumbnail: 'https://img.youtube.com/vi/yCjJyiqpAuU/maxresdefault.jpg' },
    { id: '9mmF8zOlh_g', title: 'Mary Had a Little Lamb', thumbnail: 'https://img.youtube.com/vi/9mmF8zOlh_g/maxresdefault.jpg' },
    { id: 'NVGxktQHurs', title: 'Humpty Dumpty', thumbnail: 'https://img.youtube.com/vi/NVGxktQHurs/maxresdefault.jpg' },
    { id: 'DkKRFvcYKH4', title: 'Old MacDonald Had a Farm', thumbnail: 'https://img.youtube.com/vi/DkKRFvcYKH4/maxresdefault.jpg' },
    
    // Blippi (educational content)
    { id: 'f4ZRK8YLmPc', title: 'Blippi - Fire Truck Song', thumbnail: 'https://img.youtube.com/vi/f4ZRK8YLmPc/maxresdefault.jpg' },
    { id: 'DIFA8JpYdvQ', title: 'Blippi - Excavator Song', thumbnail: 'https://img.youtube.com/vi/DIFA8JpYdvQ/maxresdefault.jpg' },
    
    // Peppa Pig (some episodes)
    { id: 'Cnqc_qlWdQY', title: 'Peppa Pig - Best Moments', thumbnail: 'https://img.youtube.com/vi/Cnqc_qlWdQY/maxresdefault.jpg' },
    { id: '7rZuA4x-X9o', title: 'Peppa Pig - Fun Compilation', thumbnail: 'https://img.youtube.com/vi/7rZuA4x-X9o/maxresdefault.jpg' },
    
    // Animal Songs
    { id: 'WST-5m8lX2w', title: 'Animal Sounds Song', thumbnail: 'https://img.youtube.com/vi/WST-5m8lX2w/maxresdefault.jpg' },
    { id: 'OwRmivbNgQk', title: 'The Lion Sleeps Tonight', thumbnail: 'https://img.youtube.com/vi/OwRmivbNgQk/maxresdefault.jpg' },
    { id: 'cZzK226zuR8', title: 'Five Little Ducks', thumbnail: 'https://img.youtube.com/vi/cZzK226zuR8/maxresdefault.jpg' },
    
    // Sesame Street
    { id: 'tRxcSNaVCPA', title: 'Sesame Street - ABC Song', thumbnail: 'https://img.youtube.com/vi/tRxcSNaVCPA/maxresdefault.jpg' },
    { id: 'shbgRyColvE', title: 'Sesame Street - Count Song', thumbnail: 'https://img.youtube.com/vi/shbgRyColvE/maxresdefault.jpg' },
    
    // Kids Cartoons & Stories
    { id: 'bIuM6kRPp6E', title: 'Three Little Pigs Story', thumbnail: 'https://img.youtube.com/vi/bIuM6kRPp6E/maxresdefault.jpg' },
    { id: '9C_HReR_McQ', title: 'Goldilocks and Three Bears', thumbnail: 'https://img.youtube.com/vi/9C_HReR_McQ/maxresdefault.jpg' },
    { id: 'ZSS5dEeMX64', title: 'Little Red Riding Hood', thumbnail: 'https://img.youtube.com/vi/ZSS5dEeMX64/maxresdefault.jpg' },
    
    // Educational - Planets/Space
    { id: '6eWNPwHT1kI', title: 'Planet Song for Kids', thumbnail: 'https://img.youtube.com/vi/6eWNPwHT1kI/maxresdefault.jpg' },
    { id: 'BZ5sWfhkpE0', title: 'Solar System Song', thumbnail: 'https://img.youtube.com/vi/BZ5sWfhkpE0/maxresdefault.jpg' },
    
    // Days/Months/Seasons
    { id: 'mXMofxtDPUQ', title: 'Days of the Week Song', thumbnail: 'https://img.youtube.com/vi/mXMofxtDPUQ/maxresdefault.jpg' },
    { id: 'Fe9bnYRzFvk', title: 'Months of the Year Song', thumbnail: 'https://img.youtube.com/vi/Fe9bnYRzFvk/maxresdefault.jpg' },
    { id: 'dqz1QRA0DkI', title: 'Four Seasons Song', thumbnail: 'https://img.youtube.com/vi/dqz1QRA0DkI/maxresdefault.jpg' },
    
    // More Nursery Rhymes
    { id: '5_sfnQDr1-o', title: 'Itsy Bitsy Spider', thumbnail: 'https://img.youtube.com/vi/5_sfnQDr1-o/maxresdefault.jpg' },
    { id: 'ahSYkW-JgcQ', title: 'Row Row Row Your Boat', thumbnail: 'https://img.youtube.com/vi/ahSYkW-JgcQ/maxresdefault.jpg' },
    { id: 'lY2yjAdbvdQ', title: 'Ring Around the Rosie', thumbnail: 'https://img.youtube.com/vi/lY2yjAdbvdQ/maxresdefault.jpg' },
    { id: 'fnbZuIIgf3I', title: 'London Bridge is Falling Down', thumbnail: 'https://img.youtube.com/vi/fnbZuIIgf3I/maxresdefault.jpg' },
    { id: 'H6mfh_RYes0', title: 'Five Little Monkeys', thumbnail: 'https://img.youtube.com/vi/H6mfh_RYes0/maxresdefault.jpg' },
    
    // More Super Simple Songs
    { id: 'pcvRfTo547I', title: 'Clean Up Song', thumbnail: 'https://img.youtube.com/vi/pcvRfTo547I/maxresdefault.jpg' },
    { id: 'Nmm4bbzKKE4', title: 'Good Morning Song', thumbnail: 'https://img.youtube.com/vi/Nmm4bbzKKE4/maxresdefault.jpg' },
    { id: '9T9X2cIKJQg', title: 'Put On Your Shoes', thumbnail: 'https://img.youtube.com/vi/9T9X2cIKJQg/maxresdefault.jpg' },
    { id: 'L5ppbTMkx7M', title: 'I See Something Blue', thumbnail: 'https://img.youtube.com/vi/L5ppbTMkx7M/maxresdefault.jpg' },
    { id: 'eBVqcTEC3zQ', title: 'Do You Like Broccoli?', thumbnail: 'https://img.youtube.com/vi/eBVqcTEC3zQ/maxresdefault.jpg' },
    
    // Action Songs
    { id: 'qqFCG_-pIAg', title: 'Jump Jump Jump', thumbnail: 'https://img.youtube.com/vi/qqFCG_-pIAg/maxresdefault.jpg' },
    { id: 'ZjNn8SRPQNY', title: 'Freeze Dance', thumbnail: 'https://img.youtube.com/vi/ZjNn8SRPQNY/maxresdefault.jpg' },
    { id: 'l4WNrvVjiTw', title: 'Clap Your Hands', thumbnail: 'https://img.youtube.com/vi/l4WNrvVjiTw/maxresdefault.jpg' },
    
    // Weather Songs
    { id: 'XcW9Ct000yY', title: 'Rain Rain Go Away', thumbnail: 'https://img.youtube.com/vi/XcW9Ct000yY/maxresdefault.jpg' },
    { id: 'dUb_VdH-5sE', title: 'Weather Song for Kids', thumbnail: 'https://img.youtube.com/vi/dUb_VdH-5sE/maxresdefault.jpg' },
    { id: 'rRWWFFlidtI', title: 'How\'s the Weather Today?', thumbnail: 'https://img.youtube.com/vi/rRWWFFlidtI/maxresdefault.jpg' },
    
    // Phonics Songs
    { id: 'U2HYM9VXz9k', title: 'Letter A Song', thumbnail: 'https://img.youtube.com/vi/U2HYM9VXz9k/maxresdefault.jpg' },
    { id: 'Mh4f9AYRCZY', title: 'Phonics Song', thumbnail: 'https://img.youtube.com/vi/Mh4f9AYRCZY/maxresdefault.jpg' },
    { id: 'saF3-f0XWAY', title: 'Phonics Sounds', thumbnail: 'https://img.youtube.com/vi/saF3-f0XWAY/maxresdefault.jpg' },
    
    // More Animal Songs
    { id: 'dLoRO87SqSc', title: 'Hickory Dickory Dock', thumbnail: 'https://img.youtube.com/vi/dLoRO87SqSc/maxresdefault.jpg' },
    { id: '59vY1kUhYJA', title: 'Three Little Kittens', thumbnail: 'https://img.youtube.com/vi/59vY1kUhYJA/maxresdefault.jpg' },
    { id: 'qfZ8qnYYRpY', title: 'Five Little Speckled Frogs', thumbnail: 'https://img.youtube.com/vi/qfZ8qnYYRpY/maxresdefault.jpg' },
    
    // Bedtime Songs
    { id: 'DkXLTPKBQdI', title: 'Brahms Lullaby', thumbnail: 'https://img.youtube.com/vi/DkXLTPKBQdI/maxresdefault.jpg' },
    { id: 'yjRp8LDxvxY', title: 'Hush Little Baby', thumbnail: 'https://img.youtube.com/vi/yjRp8LDxvxY/maxresdefault.jpg' },
    { id: 'k3yKMLjSgCg', title: 'Rock-a-Bye Baby', thumbnail: 'https://img.youtube.com/vi/k3yKMLjSgCg/maxresdefault.jpg' },
    
    // More Educational
    { id: 'lH4gC69ZEhc', title: 'Body Parts Song', thumbnail: 'https://img.youtube.com/vi/lH4gC69ZEhc/maxresdefault.jpg' },
    { id: 'AQe8BYv-v_o', title: 'Feelings Song for Kids', thumbnail: 'https://img.youtube.com/vi/AQe8BYv-v_o/maxresdefault.jpg' },
    { id: 'i8wE20hmTJc', title: 'Family Members Song', thumbnail: 'https://img.youtube.com/vi/i8wE20hmTJc/maxresdefault.jpg' },
    
    // Transportation Songs
    { id: 'CZ0x7aGZQ-g', title: 'Cars and Trucks Song', thumbnail: 'https://img.youtube.com/vi/CZ0x7aGZQ-g/maxresdefault.jpg' },
    { id: 'lT21g_3gUNw', title: 'Train Song for Kids', thumbnail: 'https://img.youtube.com/vi/lT21g_3gUNw/maxresdefault.jpg' },
    { id: 'Z3jcfcNGJTY', title: 'Airplane Song', thumbnail: 'https://img.youtube.com/vi/Z3jcfcNGJTY/maxresdefault.jpg' },
    
    // Holiday Songs
    { id: '6QRCVw26CbE', title: 'Jingle Bells for Kids', thumbnail: 'https://img.youtube.com/vi/6QRCVw26CbE/maxresdefault.jpg' },
    { id: 'VbhsYKBicHw', title: 'Halloween Songs', thumbnail: 'https://img.youtube.com/vi/VbhsYKBicHw/maxresdefault.jpg' },
    { id: 'dAbyUJWk0sE', title: 'Happy Birthday Song', thumbnail: 'https://img.youtube.com/vi/dAbyUJWk0sE/maxresdefault.jpg' },
    
    // Food Songs
    { id: 'y3g_DNwBPvs', title: 'Fruit Song for Kids', thumbnail: 'https://img.youtube.com/vi/y3g_DNwBPvs/maxresdefault.jpg' },
    { id: 'e_04ZrNroTo', title: 'Vegetables Song', thumbnail: 'https://img.youtube.com/vi/e_04ZrNroTo/maxresdefault.jpg' },
    { id: 'GSBFBxWHr7U', title: 'Ice Cream Song', thumbnail: 'https://img.youtube.com/vi/GSBFBxWHr7U/maxresdefault.jpg' },
    
    // Opposites and Concepts
    { id: 'oEQj-IOrh8o', title: 'Opposites Song', thumbnail: 'https://img.youtube.com/vi/oEQj-IOrh8o/maxresdefault.jpg' },
    { id: 'NHg36d8EfHY', title: 'Big and Small Song', thumbnail: 'https://img.youtube.com/vi/NHg36d8EfHY/maxresdefault.jpg' },
    { id: 'QkHQ0CYwjaI', title: 'Left and Right Song', thumbnail: 'https://img.youtube.com/vi/QkHQ0CYwjaI/maxresdefault.jpg' },
    
    // More Action Songs
    { id: 'frN3nvhIHUk', title: 'Stomp Like Dinosaurs', thumbnail: 'https://img.youtube.com/vi/frN3nvhIHUk/maxresdefault.jpg' },
    { id: 'IcfYYwhHYvs', title: 'Move Like Animals', thumbnail: 'https://img.youtube.com/vi/IcfYYwhHYvs/maxresdefault.jpg' },
    { id: '388khHgQ28k', title: 'The Wiggle Song', thumbnail: 'https://img.youtube.com/vi/388khHgQ28k/maxresdefault.jpg' },
    
    // Counting Songs
    { id: '0TgLtF3PMOc', title: 'Ten in the Bed', thumbnail: 'https://img.youtube.com/vi/0TgLtF3PMOc/maxresdefault.jpg' },
    { id: 'YT7W3uKlQaQ', title: 'Five Little Ducks', thumbnail: 'https://img.youtube.com/vi/YT7W3uKlQaQ/maxresdefault.jpg' },
    { id: '3W5jNj9faz8', title: 'One Two Buckle My Shoe', thumbnail: 'https://img.youtube.com/vi/3W5jNj9faz8/maxresdefault.jpg' },
    
    // More Learning Content
    { id: 'JF7vYjjkqI0', title: 'Community Helpers Song', thumbnail: 'https://img.youtube.com/vi/JF7vYjjkqI0/maxresdefault.jpg' },
    { id: 'g02WKrWjUgA', title: 'Good Manners Song', thumbnail: 'https://img.youtube.com/vi/g02WKrWjUgA/maxresdefault.jpg' },
    { id: 'xG2fwRjLjSE', title: 'Safety Rules Song', thumbnail: 'https://img.youtube.com/vi/xG2fwRjLjSE/maxresdefault.jpg' },
    
    // Classic Kids Songs
    { id: 'y2IdfBNTPIo', title: 'This Old Man', thumbnail: 'https://img.youtube.com/vi/y2IdfBNTPIo/maxresdefault.jpg' },
    { id: 'lZICz-rxUaw', title: 'B-I-N-G-O Song', thumbnail: 'https://img.youtube.com/vi/lZICz-rxUaw/maxresdefault.jpg' },
    { id: '9upTLWRZTfw', title: 'Do Re Mi Song', thumbnail: 'https://img.youtube.com/vi/9upTLWRZTfw/maxresdefault.jpg' },
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

// POST /api/kids/init - Initialize Kids account (manual trigger)
export const initializeKidsAccount = async (req, res) => {
    try {
        const kidsAccount = await getKidsAccount()
        res.status(200).json({
            message: 'Kids account initialized successfully',
            account: {
                _id: kidsAccount._id,
                username: kidsAccount.username,
                name: kidsAccount.name,
                profilePic: kidsAccount.profilePic
            }
        })
    } catch (error) {
        console.error('🎬 [initializeKidsAccount] Error:', error)
        res.status(500).json({ error: error.message })
    }
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

