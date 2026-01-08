import cron from 'node-cron'
import { cleanupOldActivities } from '../controller/activity.js'

// Initialize activity cleanup cron job
export const initializeActivityCleanup = () => {
    console.log('🧹 Initializing Activity Cleanup Cron Job...')
    
    // Cleanup old activities every minute (TESTING - change back to every hour after testing)
    cron.schedule('* * * * *', async () => {
        console.log('🧹 [CRON] Running activity cleanup (TESTING - every minute)...')
        await cleanupOldActivities()
    })
    
    // Also run cleanup on startup (after 10 seconds)
    setTimeout(async () => {
        console.log('🧹 [STARTUP] Running initial activity cleanup...')
        await cleanupOldActivities()
    }, 10000)
    
    console.log('✅ Activity Cleanup Cron Job initialized (TESTING MODE)')
    console.log('   - Cleanup runs: Every minute (TESTING - change back to every hour after testing)')
    console.log('   - Activities older than: 1 minute (TESTING - change back to 6 hours after testing)')
}



