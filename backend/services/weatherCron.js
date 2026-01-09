import cron from 'node-cron'
import { fetchCurrentWeather, autoPostWeatherUpdate, getWeatherAccount } from '../controller/weather.js'

// OpenWeatherMap API configuration
const getAPIKey = () => 'cc25b4660a957d0e957040a4606194b2'

let weatherCronJobsInitialized = false

// Fetch and update weather data for default cities
const fetchAndUpdateWeather = async () => {
    try {
        console.log('🌤️ [fetchAndUpdateWeather] Fetching weather for default cities...')
        
        // Create a mock request/response for the controller function
        const mockReq = {}
        const mockRes = {
            status: (code) => ({
                json: (data) => {
                    if (code === 200) {
                        console.log(`✅ [fetchAndUpdateWeather] ${data.message || 'Weather updated'}`)
                    } else {
                        console.error(`❌ [fetchAndUpdateWeather] Error: ${data.error || 'Unknown error'}`)
                    }
                }
            })
        }
        
        await fetchCurrentWeather(mockReq, mockRes)
        
    } catch (error) {
        console.error('❌ [fetchAndUpdateWeather] Error:', error)
    }
}

// Post weather update to feed
const postWeatherUpdate = async () => {
    try {
        console.log('🌤️ [postWeatherUpdate] Posting weather update to feed...')
        await autoPostWeatherUpdate()
        console.log('✅ [postWeatherUpdate] Weather update posted successfully')
    } catch (error) {
        console.error('❌ [postWeatherUpdate] Error:', error)
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
        console.log(`   - Feed post: Every 6 hours (4 times/day)`)
        console.log(`   - Free tier: 1,000 calls/day (well under limit)`)
        
        // 1. Fetch weather data every 1 hour
        cron.schedule('0 * * * *', async () => {
            console.log(`🌤️ [CRON] Running weather fetch - ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`)
            await fetchAndUpdateWeather()
        }, {
            scheduled: true,
            timezone: "UTC"
        })
        
        // 2. Post weather update to feed every 6 hours (4 times/day: 00:00, 06:00, 12:00, 18:00 UTC)
        cron.schedule('0 0,6,12,18 * * *', async () => {
            console.log(`🌤️ [CRON] Running weather feed post - ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`)
            await postWeatherUpdate()
            await emitWeatherPageUpdate()
        }, {
            scheduled: true,
            timezone: "UTC"
        })
        
        // 3. Fetch weather immediately on startup
        console.log('🌤️ [STARTUP] Fetching weather immediately...')
        setTimeout(async () => {
            await fetchAndUpdateWeather()
            await postWeatherUpdate()
        }, 5000) // Wait 5 seconds after server starts
        
        weatherCronJobsInitialized = true
        console.log('✅ Weather Cron Jobs initialized successfully')
        
    } catch (error) {
        console.error('❌ Error initializing Weather Cron Jobs:', error)
    }
}

export default initializeWeatherCron
