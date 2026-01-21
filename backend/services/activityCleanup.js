import cron from 'node-cron'
import { cleanupOldActivities } from '../controller/activity.js'

// Initialize activity cleanup cron job
export const initializeActivityCleanup = () => {
    console.log('🧹 Initializing Activity Cleanup Cron Job...')
    
    // Cleanup old activities every hour (at minute 0 of every hour)
    cron.schedule('0 * * * *', async () => {
        const timestamp = new Date().toISOString()
        console.log(`🧹 [CRON] Running activity cleanup... ${timestamp}`)
        await cleanupOldActivities()
    })
    
    // Also run cleanup on startup (after 10 seconds)
    setTimeout(async () => {
        console.log('🧹 [STARTUP] Running initial activity cleanup...')
        await cleanupOldActivities()
    }, 10000)
    
    console.log('✅ Activity Cleanup Cron Job initialized')
    console.log('   - Cleanup runs: Every hour')
}



