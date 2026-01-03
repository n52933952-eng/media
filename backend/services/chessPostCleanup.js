import cron from 'node-cron'
import Post from '../models/post.js'

// Cleanup chess game posts older than 1 hour
const cleanupOldChessPosts = async () => {
    try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago
        
        // Find all chess game posts older than 1 hour
        const oldPosts = await Post.find({
            chessGameData: { $exists: true, $ne: null },
            createdAt: { $lt: oneHourAgo }
        })
        
        if (oldPosts.length > 0) {
            // Delete all old chess posts
            const result = await Post.deleteMany({
                chessGameData: { $exists: true, $ne: null },
                createdAt: { $lt: oneHourAgo }
            })
            console.log(`✅ [chessPostCleanup] Deleted ${result.deletedCount} old chess game posts`)
        }
    } catch (error) {
        console.error('❌ [chessPostCleanup] Error cleaning up old chess posts:', error)
    }
}

// Initialize cleanup cron job - run every 30 minutes
export const initializeChessPostCleanup = () => {
    // Run cleanup every 30 minutes
    cron.schedule('*/30 * * * *', cleanupOldChessPosts)
    
    // Also run immediately on startup
    cleanupOldChessPosts()
    
    console.log('✅ [chessPostCleanup] Chess post cleanup cron job initialized (runs every 30 minutes)')
}



