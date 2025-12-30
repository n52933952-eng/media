import NewsArticle from '../models/news.js'

// RSS Feed URL (100% Free, No API Key Required!)
const RSS_FEED_URL = 'https://www.aljazeera.com/xml/rss/all.xml'

// Helper: Fetch and parse RSS manually (no extra packages needed)
const fetchFromRSS = async (feedUrl) => {
    try {
        console.log('📰 [fetchFromRSS] Fetching:', feedUrl)
        
        const response = await fetch(feedUrl)
        const xmlText = await response.text()
        
        console.log('📰 [fetchFromRSS] Got XML response, length:', xmlText.length)
        
        // Simple XML parsing (no packages needed!)
        const articles = []
        const itemMatches = xmlText.match(/<item>[\s\S]*?<\/item>/g) || []
        
        console.log('📰 [fetchFromRSS] Found', itemMatches.length, 'items')
        
        for (const item of itemMatches.slice(0, 20)) {
            const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || 
                         item.match(/<title>(.*?)<\/title>/)?.[1] || ''
            const link = item.match(/<link>(.*?)<\/link>/)?.[1] || ''
            const description = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1] ||
                              item.match(/<description>(.*?)<\/description>/)?.[1] || ''
            const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || new Date().toISOString()
            
            if (title && link) {
                articles.push({
                    title: title.trim(),
                    description: description.trim(),
                    url: link.trim(),
                    urlToImage: null, // Al Jazeera RSS doesn't include images
                    publishedAt: pubDate,
                    content: description.trim(),
                    source: {
                        id: 'al-jazeera',
                        name: 'Al Jazeera'
                    },
                    author: 'Al Jazeera'
                })
            }
        }
        
        console.log('📰 [fetchFromRSS] Parsed', articles.length, 'articles')
        return { success: true, data: articles }
        
    } catch (error) {
        console.error('📰 [fetchFromRSS] Error:', error.message)
        return { success: false, error: error.message }
    }
}

// 1. Fetch latest news from Al Jazeera RSS
export const fetchAlJazeeraNews = async (req, res) => {
    try {
        console.log('📰 [fetchAlJazeeraNews] Fetching latest news from RSS...')
        
        // Fetch from Al Jazeera RSS Feed (100% Free!)
        const result = await fetchFromRSS(RSS_FEED_URL)
        
        if (!result.success) {
            return res.status(500).json({ error: result.error })
        }
        
        const articles = result.data.slice(0, 20) // Take first 20 articles
        let savedCount = 0
        
        // Store/update each article in database
        for (const article of articles) {
            // Create unique ID from URL
            const articleId = Buffer.from(article.url).toString('base64').substring(0, 50)
            
            await NewsArticle.findOneAndUpdate(
                { articleId },
                {
                    articleId,
                    source: {
                        id: article.source?.id || 'al-jazeera',
                        name: article.source?.name || 'Al Jazeera'
                    },
                    author: article.author,
                    title: article.title,
                    description: article.description,
                    url: article.url,
                    urlToImage: article.urlToImage,
                    publishedAt: new Date(article.publishedAt),
                    content: article.content,
                    category: 'general',
                    lastUpdated: new Date()
                },
                { upsert: true, new: true }
            )
            savedCount++
        }
        
        console.log(`📰 [fetchAlJazeeraNews] Saved ${savedCount} articles`)
        
        res.status(200).json({ 
            message: `Fetched and saved ${savedCount} articles from RSS feed`,
            count: savedCount
        })
        
    } catch (error) {
        console.error('📰 [fetchAlJazeeraNews] Error:', error)
        res.status(500).json({ error: error.message })
    }
}

// 2. Get news articles from database
export const getNews = async (req, res) => {
    try {
        const { category, limit = 10 } = req.query
        
        const query = {}
        
        if (category) {
            query.category = category
        }
        
        const articles = await NewsArticle.find(query)
            .sort({ publishedAt: -1 })
            .limit(parseInt(limit))
        
        console.log(`📰 [getNews] Found ${articles.length} articles`)
        
        res.status(200).json({ articles })
        
    } catch (error) {
        console.error('📰 [getNews] Error:', error)
        res.status(500).json({ error: error.message })
    }
}

// Test endpoint to check if news controller works
export const testNews = async (req, res) => {
    res.json({ message: 'News API is working!', timestamp: new Date() })
}

// 3. Manual trigger to fetch news (for testing - No Auth Required)
export const manualFetchNews = async (req, res) => {
    try {
        console.log('📰 [manualFetchNews] Manual fetch triggered')
        
        // Fetch from RSS Feed (100% Free, No API Key!)
        const result = await fetchFromRSS(RSS_FEED_URL)
        
        if (!result.success) {
            return res.status(500).json({ error: result.error })
        }
        
        const articles = result.data.slice(0, 20)
        let savedCount = 0
        
        for (const article of articles) {
            const articleId = Buffer.from(article.url).toString('base64').substring(0, 50)
            
            await NewsArticle.findOneAndUpdate(
                { articleId },
                {
                    articleId,
                    source: {
                        id: article.source?.id || 'al-jazeera',
                        name: article.source?.name || 'Al Jazeera'
                    },
                    author: article.author,
                    title: article.title,
                    description: article.description,
                    url: article.url,
                    urlToImage: article.urlToImage,
                    publishedAt: new Date(article.publishedAt),
                    content: article.content,
                    category: 'general',
                    lastUpdated: new Date()
                },
                { upsert: true, new: true }
            )
            savedCount++
        }
        
        res.status(200).json({ 
            message: `Successfully fetched ${savedCount} articles from Al Jazeera RSS`,
            count: savedCount,
            source: 'RSS Feed (100% Free!)'
        })
        
    } catch (error) {
        console.error('📰 [manualFetchNews] Error:', error)
        res.status(500).json({ error: error.message })
    }
}

// 4. Create live stream post for Al Jazeera (like Football does)
export const createLiveStreamPost = async (req, res) => {
    try {
        console.log('📰 [createLiveStreamPost] Creating Al Jazeera live stream post...')
        
        // Import models
        const User = (await import('../models/user.js')).default
        const Post = (await import('../models/post.js')).default
        const { getIO, getUserSocketMap } = await import('../socket/socket.js')
        
        // Find or create Al Jazeera account
        let alJazeeraAccount = await User.findOne({ username: 'AlJazeera' })
        
        if (!alJazeeraAccount) {
            console.log('📰 Creating Al Jazeera account...')
            alJazeeraAccount = new User({
                name: 'Al Jazeera English',
                username: 'AlJazeera',
                email: 'aljazeera@system.com',
                password: 'system_account',
                profilePic: 'https://upload.wikimedia.org/wikipedia/en/thumb/f/f1/Al_Jazeera_English_logo.svg/1200px-Al_Jazeera_English_logo.svg.png',
                bio: '🔴 Live news stream 24/7'
            })
            await alJazeeraAccount.save()
            console.log('✅ Al Jazeera account created')
        }
        
        // Check if post already exists today
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        
        const existingPost = await Post.findOne({
            postedBy: alJazeeraAccount._id,
            text: { $regex: /Live Stream/ },
            createdAt: { $gte: todayStart }
        })
        
        if (existingPost) {
            console.log('ℹ️ Live stream post already exists today')
            
            // Still emit to current user's socket
            await existingPost.populate("postedBy", "username profilePic name")
            
            const io = getIO()
            if (io && req.user) {
                const socketMap = getUserSocketMap()
                const userSocketId = socketMap[req.user._id.toString()]?.socketId
                
                if (userSocketId) {
                    io.to(userSocketId).emit("newPost", existingPost)
                    console.log('✅ Emitted existing post to user')
                }
            }
            
            return res.status(200).json({
                message: 'Live stream post already in feed',
                postId: existingPost._id,
                posted: false
            })
        }
        
        // Create live stream post
        console.log('📰 Creating new live stream post...')
        const liveStreamPost = new Post({
            postedBy: alJazeeraAccount._id,
            text: '🔴 Al Jazeera English - Live Stream\n\nWatch live news coverage 24/7',
            img: 'https://www.youtube.com/embed/gCNeDWCI0vo' // YouTube embed URL (allowed!)
        })
        
        await liveStreamPost.save()
        await liveStreamPost.populate("postedBy", "username profilePic name")
        
        console.log('✅ Created live stream post:', liveStreamPost._id)
        
        // Emit to current user via socket
        const io = getIO()
        if (io && req.user) {
            const socketMap = getUserSocketMap()
            const userSocketId = socketMap[req.user._id.toString()]?.socketId
            
            if (userSocketId) {
                io.to(userSocketId).emit("newPost", liveStreamPost)
                console.log('✅ Emitted new post to user')
            }
        }
        
        res.status(200).json({
            message: 'Live stream post created successfully',
            postId: liveStreamPost._id,
            posted: true
        })
        
    } catch (error) {
        console.error('📰 [createLiveStreamPost] Error:', error)
        res.status(500).json({ error: error.message })
    }
}

