import cron from 'node-cron'
import { fetchCurrentWeather, autoPostWeatherUpdate, getWeatherAccount } from '../controller/weather.js'

// OpenWeatherMap API configuration
const getAPIKey = () => 'cc25b4660a957d0e957040a4606194b2'

let weatherCronJobsInitialized = false

// Fetch and update weather data for default cities
const fetchAndUpdateWeather = async () => {
    try {
        const startTime = Date.now()
        console.log('🌤️ [fetchAndUpdateWeather] =================================')
        console.log('🌤️ [fetchAndUpdateWeather] Fetching weather for default cities...')
        console.log(`🌤️ [fetchAndUpdateWeather] Time: ${new Date().toLocaleString()}`)
        
        // Create a mock request/response for the controller function
        const mockReq = {}
        const mockRes = {
            status: (code) => ({
                json: (data) => {
                    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
                    if (code === 200) {
                        console.log(`✅ [fetchAndUpdateWeather] ${data.message || 'Weather updated'} (took ${duration}s)`)
                        console.log(`🌤️ [fetchAndUpdateWeather] Next fetch: ${new Date(Date.now() + 60 * 60 * 1000).toLocaleString()} (in 1 hour)`)
                    } else {
                        console.error(`❌ [fetchAndUpdateWeather] Error: ${data.error || 'Unknown error'}`)
                    }
                    console.log('🌤️ [fetchAndUpdateWeather] =================================')
                }
            })
        }
        
        await fetchCurrentWeather(mockReq, mockRes)
        
    } catch (error) {
        console.error('❌ [fetchAndUpdateWeather] Error:', error)
        console.log('🌤️ [fetchAndUpdateWeather] =================================')
    }
}

// Sync weather from API + prune legacy Post rows (no feed weather posts)
const postWeatherUpdate = async () => {
    try {
        const startTime = Date.now()
        console.log('📬 [postWeatherUpdate] =================================')
        console.log('📬 [postWeatherUpdate] Syncing weather data (Post collection not used for feed)...')
        console.log(`📬 [postWeatherUpdate] Time: ${new Date().toLocaleString()}`)
        
        await autoPostWeatherUpdate()
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`✅ [postWeatherUpdate] Weather sync finished (took ${duration}s)`)
        console.log(`📬 [postWeatherUpdate] Next sync: ${new Date(Date.now() + 2 * 60 * 60 * 1000).toLocaleString()} (in 2 hours)`)
        console.log('📬 [postWeatherUpdate] =================================')
    } catch (error) {
        console.error('❌ [postWeatherUpdate] Error:', error)
        console.log('📬 [postWeatherUpdate] =================================')
    }
}

// Emit weather page update to connected clients via Socket.IO
const emitWeatherPageUpdate = async () => {
    try {
        const { getIO } = await import('../socket/socket.js')
        const io = getIO()
        
        if (!io) {
            console.log('⚠️ [emitWeatherPageUpdate] Socket.IO not ready, skipping emit')
            return
        }
        
        // Get latest weather data
        const Weather = (await import('../models/weather.js')).default
        const weatherData = await Weather.find({})
            .sort({ lastUpdated: -1 })
            .limit(5)
            .lean()
        
        // Emit to all connected clients
        io.emit('weatherPageUpdate', {
            weather: weatherData,
            timestamp: new Date().toISOString()
        })
        
        console.log(`✅ [emitWeatherPageUpdate] Emitted weather update to all connected clients`)
        
    } catch (error) {
        console.error('❌ [emitWeatherPageUpdate] Error:', error)
    }
}

// Initialize Weather Cron Jobs
export const initializeWeatherCron = async () => {
    if (weatherCronJobsInitialized) {
        console.log('⚠️ Weather Cron Jobs already initialized, skipping...')
        return
    }
    
    try {
        // Ensure Weather account exists
        await getWeatherAccount()
        
        console.log('🌤️ Initializing Weather Cron Jobs...')
        console.log(`   - API: OpenWeatherMap (api.openweathermap.org/data/2.5)`)
        console.log(`   - Default cities: London, New York, Tokyo, Dubai, Paris`)
        console.log(`   - Weather fetch: Every 1 hour (~24 calls/day)`)
        console.log(`   - Weather sync (no feed posts): Every 2 hours`)
        console.log(`   - Total API calls: ~120 calls/day (Free tier: 1,000 calls/day - well under limit)`)
        
        // 1. Fetch weather data every 1 hour
        cron.schedule('0 * * * *', async () => {
            console.log(`🌤️ [CRON] Running weather fetch - ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`)
            await fetchAndUpdateWeather()
        }, {
            scheduled: true,
            timezone: "UTC"
        })
        
        // 2. Full weather sync every 2 hours (+ socket emit); Post collection not used for feed
        cron.schedule('0 */2 * * *', async () => {
            console.log(`🌤️ [CRON] Running weather sync - ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`)
            await postWeatherUpdate()
            await emitWeatherPageUpdate()
        }, {
            scheduled: true,
            timezone: "UTC"
        })
        
        // 3. Fetch weather immediately on startup (reduced delay for faster initial load)
        console.log('🌤️ [STARTUP] Scheduling immediate weather fetch...')
        setTimeout(async () => {
            console.log('🌤️ [STARTUP] Fetching fresh weather data from API...')
            await fetchAndUpdateWeather()
            console.log('🌤️ [STARTUP] Running weather sync (no feed posts)...')
            await postWeatherUpdate()
            console.log('✅ [STARTUP] Weather initialization complete!')
            console.log(`   Next update: ${new Date(Date.now() + 2 * 60 * 60 * 1000).toLocaleString('en-US', { timeZone: 'UTC' })} UTC (in 2 hours)`)
        }, 3000) // Wait 3 seconds after server starts (reduced from 5s for faster startup)
        
        weatherCronJobsInitialized = true
        console.log('✅ Weather Cron Jobs initialized successfully')
        
    } catch (error) {
        console.error('❌ Error initializing Weather Cron Jobs:', error)
    }
}

export default initializeWeatherCron
