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

// 4. Create live stream post for any channel (dynamic)
export const createLiveStreamPost = async (req, res) => {
    try {
        let { channelId, streamIndex = 0, lang } = req.query
        
        // Backward compatibility: if lang is provided, assume it's Al Jazeera
        if (lang && !channelId) {
            channelId = 'aljazeera'
            streamIndex = lang === 'arabic' ? 1 : 0
        }
        
        console.log(`📺 [createLiveStreamPost] Creating live stream post for channel: ${channelId}`)
        
        // Import models and config
        const User = (await import('../models/user.js')).default
        const Post = (await import('../models/post.js')).default
        const { getIO, getUserSocketMap } = await import('../socket/socket.js')
        const { getChannelById } = await import('../config/channels.js')
        
        // Get channel config
        const channelConfig = getChannelById(channelId)
        
        if (!channelConfig) {
            return res.status(400).json({ error: `Channel ${channelId} not found` })
        }
        
        // Get stream config (default to first stream)
        const streamConfig = channelConfig.streams[parseInt(streamIndex)] || channelConfig.streams[0]
        
        if (!streamConfig) {
            return res.status(400).json({ error: 'Stream not found' })
        }
        
        // Find or create channel account
        let channelAccount = await User.findOne({ username: channelConfig.username })
        
        if (!channelAccount) {
            console.log(`📺 Creating ${channelConfig.name} account...`)
            channelAccount = new User({
                name: channelConfig.name,
                username: channelConfig.username,
                email: `${channelConfig.username.toLowerCase()}@system.com`,
                password: 'system_account',
                profilePic: channelConfig.logo,
                bio: channelConfig.bio
            })
            await channelAccount.save()
            console.log(`✅ ${channelConfig.name} account created`)
        }
        
        // Build YouTube embed URL
        const streamUrl = `https://www.youtube.com/embed/${streamConfig.youtubeId}?autoplay=1&mute=0`
        
        console.log(`📺 Creating ${channelConfig.name} ${streamConfig.language} live stream post...`)
        
        // Check if post already exists today for this stream
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        
        const existingPost = await Post.findOne({
            postedBy: channelAccount._id,
            img: streamUrl,
            createdAt: { $gte: todayStart }
        })
        
        if (existingPost) {
            console.log(`ℹ️ ${channelConfig.name} live stream post already exists today`)
            
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
                message: `${channelConfig.name} live stream post already in feed`,
                postId: existingPost._id,
                posted: false
            })
        }
        
        // Create live stream post
        const liveStreamPost = new Post({
            postedBy: channelAccount._id,
            text: streamConfig.text,
            img: streamUrl
        })
        
        await liveStreamPost.save()
        await liveStreamPost.populate("postedBy", "username profilePic name")
        
        console.log(`✅ Created live stream post: ${liveStreamPost._id}`)
        
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
            message: `${channelConfig.name} live stream post created successfully`,
            postId: liveStreamPost._id,
            posted: true,
            channel: channelConfig.name,
            language: streamConfig.language
        })
        
    } catch (error) {
        console.error('📺 [createLiveStreamPost] Error:', error)
        res.status(500).json({ error: error.message })
    }
}

// 5. Get all available channels (for frontend)
export const getChannels = async (req, res) => {
    try {
        const { LIVE_CHANNELS } = await import('../config/channels.js')
        res.status(200).json({ channels: LIVE_CHANNELS })
    } catch (error) {
        console.error('📺 [getChannels] Error:', error)
        res.status(500).json({ error: error.message })
    }
}

