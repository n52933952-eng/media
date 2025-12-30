import NewsArticle from '../models/news.js'
import Parser from 'rss-parser'

// RSS Feed URLs (100% Free, No API Key Required!)
const RSS_FEEDS = {
    aljazeera: 'https://www.aljazeera.com/xml/rss/all.xml',
    aljazeeraWorld: 'https://www.aljazeera.com/xml/rss/world.xml',
    aljazeeraSports: 'https://www.aljazeera.com/xml/rss/sports.xml'
}

const rssParser = new Parser()

// Helper: Fetch from RSS Feed
const fetchFromRSS = async (feedUrl) => {
    try {
        console.log('📰 [fetchFromRSS] Fetching:', feedUrl)
        
        const feed = await rssParser.parseURL(feedUrl)
        
        console.log('📰 [fetchFromRSS] Success! Found', feed.items?.length || 0, 'articles')
        
        // Convert RSS items to our article format
        const articles = feed.items.map(item => ({
            title: item.title,
            description: item.contentSnippet || item.description,
            url: item.link,
            urlToImage: item.enclosure?.url || item['media:thumbnail']?.url || null,
            publishedAt: item.pubDate || item.isoDate,
            content: item.content,
            source: {
                id: 'al-jazeera',
                name: 'Al Jazeera'
            },
            author: item.creator || 'Al Jazeera'
        }))
        
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
        const result = await fetchFromRSS(RSS_FEEDS.aljazeera)
        
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
        const result = await fetchFromRSS(RSS_FEEDS.aljazeera)
        
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

