import mongoose from 'mongoose'

// News Article Schema
const NewsArticleSchema = mongoose.Schema({
    articleId: {
        type: String,
        required: true,
        unique: true
    },
    
    source: {
        id: String,
        name: String
    },
    
    author: String,
    title: String,
    description: String,
    url: String,
    urlToImage: String,
    publishedAt: Date,
    content: String,
    
    category: {
        type: String,
        enum: ['general', 'world', 'politics', 'business', 'technology', 'sports'],
        default: 'general'
    },
    
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true })

// Indexes for performance
NewsArticleSchema.index({ articleId: 1 })
NewsArticleSchema.index({ publishedAt: -1 })
NewsArticleSchema.index({ source: 1 })
NewsArticleSchema.index({ category: 1 })

const NewsArticle = mongoose.model("NewsArticle", NewsArticleSchema)

export default NewsArticle

