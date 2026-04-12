import cron from 'node-cron'
import { cleanupExpiredStories } from '../controller/story.js'

/** Expired stories: delete MongoDB docs + Cloudinary assets (hourly + once after startup). */
export const initializeStoryCleanup = () => {
  console.log('🧹 Initializing Story expiry cleanup cron...')

  cron.schedule('15 * * * *', async () => {
    const timestamp = new Date().toISOString()
    console.log(`🧹 [CRON] Story expiry cleanup ${timestamp}`)
    try {
      await cleanupExpiredStories()
    } catch (e) {
      console.error('❌ [CRON] cleanupExpiredStories:', e?.message || e)
    }
  })

  setTimeout(async () => {
    console.log('🧹 [STARTUP] Running initial story expiry cleanup...')
    try {
      await cleanupExpiredStories()
    } catch (e) {
      console.error('❌ [STARTUP] cleanupExpiredStories:', e?.message || e)
    }
  }, 15000)

  console.log('✅ Story cleanup cron: every hour at :15, plus once ~15s after boot')
}
