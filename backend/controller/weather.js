import Weather from '../models/weather.js'
import User from '../models/user.js'
import Post from '../models/post.js'
import Follow from '../models/follow.js'
import { getIO } from '../socket/socket.js'

// OpenWeatherMap API configuration
const getWeatherAPIKey = () => 'cc25b4660a957d0e957040a4606194b2'
const API_BASE_URL = 'https://api.openweathermap.org/data/2.5'

// Default cities to fetch weather for (can be expanded)
const DEFAULT_CITIES = [
    { name: 'London', country: 'GB', lat: 51.5074, lon: -0.1278 },
    { name: 'New York', country: 'US', lat: 40.7128, lon: -74.0060 },
    { name: 'Tokyo', country: 'JP', lat: 35.6762, lon: 139.6503 },
    { name: 'Dubai', country: 'AE', lat: 25.2048, lon: 55.2708 },
    { name: 'Paris', country: 'FR', lat: 48.8566, lon: 2.3522 }
]

// Helper: Fetch from OpenWeatherMap API
const fetchFromWeatherAPI = async (endpoint) => {
    try {
        const apiKey = getWeatherAPIKey()
        if (!apiKey) {
            console.error('🌤️ [fetchFromWeatherAPI] No API key configured!')
            return { success: false, error: 'API key not configured' }
        }
        
        const fullUrl = `${API_BASE_URL}${endpoint}&appid=${apiKey}&units=metric`
        console.log('🌤️ [fetchFromWeatherAPI] Fetching:', fullUrl.replace(apiKey, '***'))
        
        const response = await fetch(fullUrl)
        
        console.log('🌤️ [fetchFromWeatherAPI] Response status:', response.status, response.statusText)
        
        if (response.status === 401) {
            console.error('🔑 [fetchFromWeatherAPI] Authentication failed! Check your WEATHER_API_KEY')
            return { success: false, error: 'API key authentication failed' }
        }
        
        if (response.status === 429) {
            console.error('🚫 [fetchFromWeatherAPI] Rate limit exceeded!')
            return { success: false, error: 'Rate limit exceeded', rateLimit: true }
        }
        
        const data = await response.json()
        
        if (response.ok && data) {
            console.log('🌤️ [fetchFromWeatherAPI] Success!')
            return { success: true, data: data }
        } else {
            const errorMsg = data.message || `HTTP ${response.status}: ${response.statusText}`
            console.error('🌤️ [fetchFromWeatherAPI] Error:', errorMsg)
            return { success: false, error: errorMsg }
        }
    } catch (error) {
        console.error('🌤️ [fetchFromWeatherAPI] Fetch Error:', error.message)
        return { success: false, error: error.message }
    }
}

// Helper: Convert OpenWeatherMap format to our database format
const convertWeatherFormat = (weatherData, cityInfo) => {
    const current = weatherData.current || weatherData
    
    return {
        location: {
            city: cityInfo.name || weatherData.name,
            country: cityInfo.country || weatherData.sys?.country || '',
            lat: cityInfo.lat || weatherData.coord?.lat,
            lon: cityInfo.lon || weatherData.coord?.lon
        },
        current: {
            temperature: Math.round(current.main?.temp || current.temp),
            feelsLike: Math.round(current.main?.feels_like || current.feels_like),
            humidity: current.main?.humidity || current.humidity,
            pressure: current.main?.pressure || current.pressure,
            visibility: current.visibility ? (current.visibility / 1000) : null, // Convert to km
            windSpeed: current.wind?.speed || 0,
            windDirection: current.wind?.deg || 0,
            clouds: current.clouds?.all || 0,
            uvIndex: current.uvi || null,
            condition: {
                main: current.weather?.[0]?.main || 'Unknown',
                description: current.weather?.[0]?.description || 'Unknown',
                icon: current.weather?.[0]?.icon || '01d'
            }
        },
        // Forecast: Free tier only has current weather. For forecast, use /forecast endpoint separately
        // For now, just store current weather (forecast can be added later if needed)
        forecast: weatherData.daily?.slice(0, 5).map(day => ({
            date: new Date(day.dt * 1000),
            temp: {
                min: Math.round(day.temp?.min),
                max: Math.round(day.temp?.max)
            },
            condition: {
                main: day.weather?.[0]?.main || 'Unknown',
                description: day.weather?.[0]?.description || 'Unknown',
                icon: day.weather?.[0]?.icon || '01d'
            },
            humidity: day.humidity,
            windSpeed: day.wind_speed || 0,
            precipitation: day.rain || day.snow || 0
        })) || weatherData.list?.slice(0, 5).map(item => ({
            date: new Date(item.dt * 1000),
            temp: {
                min: Math.round(item.main?.temp_min),
                max: Math.round(item.main?.temp_max)
            },
            condition: {
                main: item.weather?.[0]?.main || 'Unknown',
                description: item.weather?.[0]?.description || 'Unknown',
                icon: item.weather?.[0]?.icon || '01d'
            },
            humidity: item.main?.humidity,
            windSpeed: item.wind?.speed || 0,
            precipitation: item.rain?.['3h'] || item.snow?.['3h'] || 0
        })) || [],
        lastUpdated: new Date()
    }
}

// Helper: Get or create Weather system account
export const getWeatherAccount = async () => {
    try {
        let weatherAccount = await User.findOne({ username: 'Weather' })
        
        if (!weatherAccount) {
            weatherAccount = new User({
                name: 'Weather Updates',
                username: 'Weather',
                email: 'weather@system.app',
                password: Math.random().toString(36),
                bio: '🌤️ Live weather updates from cities around the world',
                profilePic: 'https://cdn-icons-png.flaticon.com/512/414/414927.png'
            })
            await weatherAccount.save()
            console.log('✅ Weather system account created')
        }
        
        return weatherAccount
    } catch (error) {
        console.error('Error getting weather account:', error)
        return null
    }
}

// 1. Fetch and store current weather for default cities + all user-selected cities
export const fetchCurrentWeather = async (req, res) => {
    try {
        const allWeatherData = []
        
        // Get all unique cities from Weather collection (includes default + user-selected)
        const existingWeatherDocs = await Weather.find({}).select('location').lean()
        const allCitiesToUpdate = new Map()
        
        // Add default cities
        for (const city of DEFAULT_CITIES) {
            const key = `${city.name.toLowerCase()}_${city.country.toLowerCase()}`
            allCitiesToUpdate.set(key, city)
        }
        
        // Add user-selected cities from Weather collection
        for (const doc of existingWeatherDocs) {
            if (doc.location && doc.location.city && doc.location.lat && doc.location.lon) {
                const key = `${doc.location.city.toLowerCase()}_${(doc.location.country || '').toLowerCase()}`
                if (!allCitiesToUpdate.has(key)) {
                    allCitiesToUpdate.set(key, {
                        name: doc.location.city,
                        country: doc.location.country || '',
                        lat: doc.location.lat,
                        lon: doc.location.lon
                    })
                }
            }
        }
        
        const citiesToUpdate = Array.from(allCitiesToUpdate.values())
        console.log(`🌤️ [fetchCurrentWeather] Updating weather for ${citiesToUpdate.length} cities (${DEFAULT_CITIES.length} default + ${citiesToUpdate.length - DEFAULT_CITIES.length} user-selected)`)
        
        for (const city of citiesToUpdate) {
            // OpenWeatherMap: Get current weather by coordinates (more reliable)
            const endpoint = `/weather?lat=${city.lat}&lon=${city.lon}`
            const result = await fetchFromWeatherAPI(endpoint)
            
            if (result.success && result.data) {
                const convertedWeather = convertWeatherFormat(result.data, city)
                const saved = await Weather.findOneAndUpdate(
                    { 
                        'location.city': convertedWeather.location.city,
                        'location.country': convertedWeather.location.country
                    },
                    convertedWeather,
                    { upsert: true, new: true }
                )
                allWeatherData.push(saved)
            }
            
            // Rate limit protection: 60 calls/minute = 1 call per second (use 1.1 for safety)
            await new Promise(resolve => setTimeout(resolve, 1100))
        }
        
        res.status(200).json({ 
            message: `Updated weather for ${allWeatherData.length} cities`,
            cities: allWeatherData.length
        })
        
    } catch (error) {
        console.error('Error fetching current weather:', error)
        res.status(500).json({ error: error.message })
    }
}

// 2. Fetch forecast for a city (with current weather)
export const fetchWeatherForecast = async (req, res) => {
    try {
        const { city, lat, lon } = req.query
        
        if (!city && (!lat || !lon)) {
            return res.status(400).json({ error: 'Provide city name or lat/lon coordinates' })
        }
        
        let endpoint
        if (lat && lon) {
            endpoint = `/forecast?lat=${lat}&lon=${lon}`
        } else {
            endpoint = `/forecast?q=${city}`
        }
        
        // Also fetch current weather
        const currentEndpoint = lat && lon ? `/weather?lat=${lat}&lon=${lon}` : `/weather?q=${city}`
        
        const [forecastResult, currentResult] = await Promise.all([
            fetchFromWeatherAPI(endpoint),
            fetchFromWeatherAPI(currentEndpoint)
        ])
        
        if (!forecastResult.success || !currentResult.success) {
            return res.status(500).json({ error: forecastResult.error || currentResult.error })
        }
        
        // Combine current and forecast data
        const weatherData = {
            ...currentResult.data,
            daily: forecastResult.data.list || []
        }
        
        const cityInfo = { name: city || currentResult.data.name }
        const convertedWeather = convertWeatherFormat(weatherData, cityInfo)
        
        const saved = await Weather.findOneAndUpdate(
            { 
                'location.city': convertedWeather.location.city,
                'location.country': convertedWeather.location.country
            },
            convertedWeather,
            { upsert: true, new: true }
        )
        
        res.status(200).json({ weather: saved })
        
    } catch (error) {
        console.error('Error fetching weather forecast:', error)
        res.status(500).json({ error: error.message })
    }
}

// 3. Get cached weather data
export const getWeather = async (req, res) => {
    try {
        const { city, country, limit = 5 } = req.query
        
        let query = {}
        
        if (city) {
            query['location.city'] = new RegExp(city, 'i')
        }
        
        if (country) {
            query['location.country'] = country
        }
        
        const weatherData = await Weather.find(query)
            .sort({ lastUpdated: -1 })
            .limit(parseInt(limit))
            .lean()
        
        res.status(200).json({ weather: weatherData })
        
    } catch (error) {
        console.error('Error getting weather:', error)
        res.status(500).json({ error: error.message })
    }
}


// 4. Auto-post weather update to feed
export const autoPostWeatherUpdate = async () => {
    try {
        const weatherAccount = await getWeatherAccount()
        if (!weatherAccount) {
            console.log('❌ [autoPostWeatherUpdate] Weather account not found')
            return
        }
        
        console.log('🌤️ [autoPostWeatherUpdate] Fetching fresh weather data from API...')
        
        // FETCH FRESH WEATHER DATA FROM API (not from database cache)
        // Get all cities from Weather collection (default + user-selected)
        const existingWeatherDocs = await Weather.find({}).select('location').lean()
        const allCitiesToUpdate = new Map()
        
        // Add default cities
        for (const city of DEFAULT_CITIES) {
            const key = `${city.name.toLowerCase()}_${city.country.toLowerCase()}`
            allCitiesToUpdate.set(key, city)
        }
        
        // Add user-selected cities from Weather collection
        for (const doc of existingWeatherDocs) {
            if (doc.location && doc.location.city && doc.location.lat && doc.location.lon) {
                const key = `${doc.location.city.toLowerCase()}_${(doc.location.country || '').toLowerCase()}`
                if (!allCitiesToUpdate.has(key)) {
                    allCitiesToUpdate.set(key, {
                        name: doc.location.city,
                        country: doc.location.country || '',
                        lat: doc.location.lat,
                        lon: doc.location.lon
                    })
                }
            }
        }
        
        const citiesToUpdate = Array.from(allCitiesToUpdate.values())
        console.log(`🌤️ [autoPostWeatherUpdate] Updating weather for ${citiesToUpdate.length} cities`)
        
        const allWeatherData = []
        
        for (const city of citiesToUpdate) {
            try {
                const endpoint = `/weather?lat=${city.lat}&lon=${city.lon}`
                const result = await fetchFromWeatherAPI(endpoint)
                
                if (result.success && result.data) {
                    const convertedWeather = convertWeatherFormat(result.data, city)
                    
                    // Check if temperature changed (for logging)
                    const existingWeather = await Weather.findOne({
                        'location.city': convertedWeather.location.city,
                        'location.country': convertedWeather.location.country
                    })
                    
                    const oldTemp = existingWeather?.current?.temperature
                    const newTemp = convertedWeather.current.temperature
                    
                    // Save to database
                    const saved = await Weather.findOneAndUpdate(
                        { 
                            'location.city': convertedWeather.location.city,
                            'location.country': convertedWeather.location.country
                        },
                        convertedWeather,
                        { upsert: true, new: true }
                    )
                    allWeatherData.push(saved)
                    
                    if (oldTemp !== undefined && oldTemp !== newTemp) {
                        console.log(`✅ [autoPostWeatherUpdate] ${city.name}: ${oldTemp}°C → ${newTemp}°C (${newTemp > oldTemp ? '↑' : '↓'} ${Math.abs(newTemp - oldTemp)}°C)`)
                    } else {
                        console.log(`✅ [autoPostWeatherUpdate] ${city.name}: ${newTemp}°C (${convertedWeather.current.condition.description})`)
                    }
                }
                
                // Rate limit protection: 60 calls/minute = 1 call per second
                await new Promise(resolve => setTimeout(resolve, 1100))
            } catch (error) {
                console.error(`❌ [autoPostWeatherUpdate] Error fetching ${city.name}:`, error.message)
            }
        }
        
        if (allWeatherData.length === 0) {
            console.log('📭 [autoPostWeatherUpdate] No fresh weather data available')
            return
        }
        
        // Find the MOST RECENT weather post (no date filter - could be from any day)
        // IMPORTANT: Use updatedAt to find the most recently updated one (not just created)
        // This ensures we update the same post that's currently in feeds
        const existingPost = await Post.findOne({
            postedBy: weatherAccount._id,
            weatherData: { $exists: true, $ne: null }
        }).sort({ updatedAt: -1, createdAt: -1 }) // Get the most recently updated one first
        
        // Log which post we found (for debugging)
        if (existingPost) {
            console.log(`🔍 [autoPostWeatherUpdate] Found existing post: ID=${existingPost._id}, createdAt=${existingPost.createdAt}, updatedAt=${existingPost.updatedAt}`)
        } else {
            console.log(`📭 [autoPostWeatherUpdate] No existing weather post found, will create new one`)
        }
        
        const weatherDataArray = allWeatherData.map(w => ({
            city: w.location.city,
            country: w.location.country,
            temperature: w.current.temperature,
            condition: w.current.condition.main,
            description: w.current.condition.description,
            icon: w.current.condition.icon,
            humidity: w.current.humidity,
            windSpeed: w.current.windSpeed
        }))
        
        if (existingPost) {
            // ALWAYS update the existing post with fresh data and new timestamp
            const oldWeatherData = existingPost.weatherData
            existingPost.weatherData = JSON.stringify(weatherDataArray)
            existingPost.text = `🌤️ Weather Update - ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
            existingPost.updatedAt = new Date() // Update timestamp to bring to top of feed
            
            // Verify save worked
            const savedPost = await existingPost.save()
            
            // Double-check database has updated data
            const verifyPost = await Post.findById(existingPost._id)
            const dataChanged = verifyPost.weatherData !== oldWeatherData
            
            // Log weather data preview to verify update
            let weatherPreview = 'N/A'
            try {
                const parsedData = JSON.parse(verifyPost.weatherData || '[]')
                if (parsedData.length > 0) {
                    weatherPreview = `${parsedData[0].city}: ${parsedData[0].temperature}°C (${parsedData[0].description})`
                }
            } catch (e) {}
            
            console.log(`✅ [autoPostWeatherUpdate] Updated existing weather post (ID: ${existingPost._id})`)
            console.log(`   📊 Data changed: ${dataChanged ? 'YES' : 'NO'}, UpdatedAt: ${verifyPost.updatedAt}`)
            console.log(`   🌤️ Weather preview: ${weatherPreview}`)
            
            if (!dataChanged) {
                console.warn(`   ⚠️ [autoPostWeatherUpdate] WARNING: Weather data did not change in database!`)
                console.warn(`   🔍 Old data preview: ${oldWeatherData?.substring(0, 150)}...`)
                console.warn(`   🔍 New data preview: ${verifyPost.weatherData?.substring(0, 150)}...`)
            }
            
            // Emit postUpdated event for real-time update
            const io = getIO()
            if (io) {
                // Use scalable Follow collection instead of weatherAccount.followers array
                const followerDocs = await Follow.find({ followeeId: weatherAccount._id }).select('followerId').limit(5000).lean()
                const followerIds = followerDocs.map(doc => doc.followerId.toString())
                
                if (followerIds.length > 0) {
                    const { getUserSocketMap } = await import('../socket/socket.js')
                    const userSocketMap = getUserSocketMap()
                    const onlineFollowers = []
                    
                    followerIds.forEach(followerId => {
                        if (userSocketMap[followerId]) {
                            onlineFollowers.push(userSocketMap[followerId].socketId)
                        }
                    })
                    
                    if (onlineFollowers.length > 0) {
                        await existingPost.populate("postedBy", "username profilePic name")
                        const postObj = existingPost.toObject ? existingPost.toObject() : JSON.parse(JSON.stringify(existingPost))
                        onlineFollowers.forEach(socketId => {
                            io.to(socketId).emit("postUpdated", { postId: existingPost._id.toString(), post: postObj })
                        })
                        console.log(`✅ [autoPostWeatherUpdate] Emitted postUpdated to ${onlineFollowers.length} followers (out of ${followerIds.length} total)`)
                    } else {
                        console.log(`📭 [autoPostWeatherUpdate] No online followers (${followerIds.length} total followers, 0 online)`)
                    }
                } else {
                    console.log(`📭 [autoPostWeatherUpdate] No followers found for Weather account`)
                }
            }
        } else {
            // Create new post
            const newPost = new Post({
                postedBy: weatherAccount._id,
                text: `🌤️ Weather Update - ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
                weatherData: JSON.stringify(weatherDataArray)
            })
            
            await newPost.save()
            await newPost.populate("postedBy", "username profilePic name")
            
            console.log('✅ [autoPostWeatherUpdate] Created new weather post')
            
            // Emit to followers
            const io = getIO()
            if (io) {
                // Use scalable Follow collection instead of weatherAccount.followers array
                const followerDocs = await Follow.find({ followeeId: weatherAccount._id }).select('followerId').limit(5000).lean()
                const followerIds = followerDocs.map(doc => doc.followerId.toString())
                
                if (followerIds.length > 0) {
                    const { getUserSocketMap } = await import('../socket/socket.js')
                    const userSocketMap = getUserSocketMap()
                    const onlineFollowers = []
                    
                    followerIds.forEach(followerId => {
                        if (userSocketMap[followerId]) {
                            onlineFollowers.push(userSocketMap[followerId].socketId)
                        }
                    })
                    
                    if (onlineFollowers.length > 0) {
                        io.to(onlineFollowers).emit("newPost", newPost)
                        console.log(`✅ [autoPostWeatherUpdate] Emitted newPost to ${onlineFollowers.length} online followers (out of ${followerIds.length} total)`)
                    } else {
                        console.log(`📭 [autoPostWeatherUpdate] No online followers (${followerIds.length} total followers, 0 online)`)
                    }
                } else {
                    console.log(`📭 [autoPostWeatherUpdate] No followers found for Weather account`)
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Error auto-posting weather update:', error)
    }
}

// 5. Manual trigger to fetch weather (for testing)
export const manualFetchWeather = async (req, res) => {
    try {
        console.log('🌤️ [manualFetchWeather] ========== MANUAL FETCH TRIGGERED ==========')
        
        const allWeatherData = []
        
        for (const city of DEFAULT_CITIES) {
            // OpenWeatherMap: Get current weather by coordinates (more reliable)
            const endpoint = `/weather?lat=${city.lat}&lon=${city.lon}`
            const result = await fetchFromWeatherAPI(endpoint)
            
            if (result.success && result.data) {
                const convertedWeather = convertWeatherFormat(result.data, city)
                const saved = await Weather.findOneAndUpdate(
                    { 
                        'location.city': convertedWeather.location.city,
                        'location.country': convertedWeather.location.country
                    },
                    convertedWeather,
                    { upsert: true, new: true }
                )
                allWeatherData.push(saved)
            }
            
            // Rate limit protection: 60 calls/minute = 1 call per second (use 1.1 for safety)
            await new Promise(resolve => setTimeout(resolve, 1100))
        }
        
        // Also create/update feed post (run in background, don't wait)
        autoPostWeatherUpdate().catch(err => {
            console.error('❌ [manualFetchWeather] Error posting weather update:', err)
        })
        
        res.status(200).json({ 
            message: `Updated weather for ${allWeatherData.length} cities`,
            cities: allWeatherData.length
        })
        
    } catch (error) {
        console.error('❌ [manualFetchWeather] Error:', error)
        res.status(500).json({ error: error.message })
    }
}

// 6. Manual trigger to post weather to feed
export const manualPostWeather = async (req, res) => {
    try {
        const weatherAccount = await getWeatherAccount()
        if (!weatherAccount) {
            return res.status(404).json({ error: 'Weather account not found' })
        }
        
        console.log('🌤️ [manualPostWeather] Fetching fresh weather data from API...')
        
        // FETCH FRESH WEATHER DATA FROM API (not from database cache)
        const allWeatherData = []
        
        for (const city of DEFAULT_CITIES) {
            try {
                const endpoint = `/weather?lat=${city.lat}&lon=${city.lon}`
                const result = await fetchFromWeatherAPI(endpoint)
                
                if (result.success && result.data) {
                    const convertedWeather = convertWeatherFormat(result.data, city)
                    
                    // Check if temperature changed (for logging)
                    const existingWeather = await Weather.findOne({
                        'location.city': convertedWeather.location.city,
                        'location.country': convertedWeather.location.country
                    })
                    
                    const oldTemp = existingWeather?.current?.temperature
                    const newTemp = convertedWeather.current.temperature
                    
                    // Save to database
                    const saved = await Weather.findOneAndUpdate(
                        { 
                            'location.city': convertedWeather.location.city,
                            'location.country': convertedWeather.location.country
                        },
                        convertedWeather,
                        { upsert: true, new: true }
                    )
                    allWeatherData.push(saved)
                    
                    if (oldTemp !== undefined && oldTemp !== newTemp) {
                        console.log(`✅ [manualPostWeather] ${city.name}: ${oldTemp}°C → ${newTemp}°C (${newTemp > oldTemp ? '↑' : '↓'} ${Math.abs(newTemp - oldTemp)}°C)`)
                    } else {
                        console.log(`✅ [manualPostWeather] ${city.name}: ${newTemp}°C (${convertedWeather.current.condition.description})`)
                    }
                }
                
                // Rate limit protection: 60 calls/minute = 1 call per second
                await new Promise(resolve => setTimeout(resolve, 1100))
            } catch (error) {
                console.error(`❌ [manualPostWeather] Error fetching ${city.name}:`, error.message)
            }
        }
        
        if (allWeatherData.length === 0) {
            console.log('📭 [manualPostWeather] No fresh weather data available')
            return res.status(404).json({ 
                error: 'No weather data available',
                message: 'Could not fetch fresh weather data from API'
            })
        }
        
        // Get latest weather post (not just today - find most recent one)
        // IMPORTANT: Use updatedAt to find the most recently updated one (not just created)
        const existingPost = await Post.findOne({
            postedBy: weatherAccount._id,
            weatherData: { $exists: true, $ne: null }
        }).sort({ updatedAt: -1, createdAt: -1 }) // Get the most recently updated one first
        
        const weatherDataArray = allWeatherData.map(w => ({
            city: w.location.city,
            country: w.location.country,
            temperature: w.current.temperature,
            condition: w.current.condition.main,
            description: w.current.condition.description,
            icon: w.current.condition.icon,
            humidity: w.current.humidity,
            windSpeed: w.current.windSpeed
        }))
        
        if (existingPost) {
            // ALWAYS update with fresh data and new timestamp
            existingPost.weatherData = JSON.stringify(weatherDataArray)
            existingPost.text = `🌤️ Weather Update - ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
            existingPost.updatedAt = new Date() // Update timestamp to bring to top of feed
            await existingPost.save()
            
            // Populate postedBy for response
            await existingPost.populate('postedBy', 'username name profilePic')
            
            console.log(`✅ [manualPostWeather] Updated existing weather post (ID: ${existingPost._id})`)
            
            // Emit postUpdated event for real-time update
            const io = getIO()
            if (io) {
                // Use scalable Follow collection instead of weatherAccount.followers array
                const followerDocs = await Follow.find({ followeeId: weatherAccount._id }).select('followerId').limit(5000).lean()
                const followerIds = followerDocs.map(doc => doc.followerId.toString())
                
                if (followerIds.length > 0) {
                    const { getUserSocketMap } = await import('../socket/socket.js')
                    const userSocketMap = getUserSocketMap()
                    const onlineFollowers = []
                    
                    followerIds.forEach(followerId => {
                        if (userSocketMap[followerId]) {
                            onlineFollowers.push(userSocketMap[followerId].socketId)
                        }
                    })
                    
                    if (onlineFollowers.length > 0) {
                        const postObj = existingPost.toObject ? existingPost.toObject() : JSON.parse(JSON.stringify(existingPost))
                        onlineFollowers.forEach(socketId => {
                            io.to(socketId).emit("postUpdated", { postId: existingPost._id.toString(), post: postObj })
                        })
                        console.log(`✅ [manualPostWeather] Emitted postUpdated to ${onlineFollowers.length} followers (out of ${followerIds.length} total)`)
                    } else {
                        console.log(`📭 [manualPostWeather] No online followers (${followerIds.length} total followers, 0 online)`)
                    }
                } else {
                    console.log(`📭 [manualPostWeather] No followers found for Weather account`)
                }
            }
            
            return res.status(200).json({ 
                posted: true,
                updated: true,
                post: existingPost,
                message: 'Weather post updated with fresh data'
            })
        }
        
        // Create new post if none exists
        const newPost = new Post({
            postedBy: weatherAccount._id,
            text: `🌤️ Weather Update - ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
            weatherData: JSON.stringify(weatherDataArray)
        })
        
        await newPost.save()
        
        // Populate postedBy for response
        await newPost.populate('postedBy', 'username name profilePic')
        
        console.log('✅ [manualPostWeather] Created new weather post:', newPost._id)
        
        res.status(200).json({ 
            posted: true,
            post: newPost,
            message: 'Weather post created successfully'
        })
    } catch (error) {
        console.error('Error posting weather:', error)
        res.status(500).json({ error: error.message })
    }
}

// 7. Search cities using OpenWeatherMap Geocoding API
export const searchCities = async (req, res) => {
    try {
        const { query } = req.query
        
        if (!query || query.trim().length < 2) {
            return res.status(400).json({ error: 'Query must be at least 2 characters' })
        }
        
        const apiKey = getWeatherAPIKey()
        const geocodeUrl = `http://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=10&appid=${apiKey}`
        
        console.log('🌤️ [searchCities] Searching:', query)
        
        const response = await fetch(geocodeUrl)
        const data = await response.json()
        
        if (!response.ok) {
            console.error('🌤️ [searchCities] API Error:', data)
            return res.status(response.status).json({ error: data.message || 'Failed to search cities' })
        }
        
        // Format response
        const cities = data.map(city => ({
            name: city.name,
            country: city.country,
            countryCode: city.country,
            state: city.state || '',
            lat: city.lat,
            lon: city.lon
        }))
        
        res.status(200).json({ cities })
        
    } catch (error) {
        console.error('Error searching cities:', error)
        res.status(500).json({ error: error.message })
    }
}

// 8. Save user's weather city preferences
export const saveWeatherPreferences = async (req, res) => {
    try {
        const userId = req.user._id
        const { cities } = req.body
        
        if (!Array.isArray(cities)) {
            return res.status(400).json({ error: 'Cities must be an array' })
        }
        
        if (cities.length > 10) {
            return res.status(400).json({ error: 'Maximum 10 cities allowed' })
        }
        
        // Handle both formats: array of strings (city names) or array of objects
        const validCities = []
        
        for (const city of cities) {
            if (typeof city === 'string') {
                // If it's just a city name, try to find it in the Weather collection
                const weatherDoc = await Weather.findOne({ 
                    'location.city': new RegExp(`^${city}$`, 'i') 
                }).lean()
                
                if (weatherDoc && weatherDoc.location) {
                    validCities.push({
                        name: weatherDoc.location.city,
                        country: weatherDoc.location.country,
                        lat: weatherDoc.location.lat,
                        lon: weatherDoc.location.lon
                    })
                } else {
                    // If not found, try to match with DEFAULT_CITIES
                    const defaultCity = DEFAULT_CITIES.find(c => 
                        c.name.toLowerCase() === city.toLowerCase()
                    )
                    if (defaultCity) {
                        validCities.push(defaultCity)
                    }
                }
            } else if (city.name && city.country && typeof city.lat === 'number' && typeof city.lon === 'number') {
                // Already in correct format
                validCities.push(city)
            } else if (city.name) {
                // Has name but missing other fields - try to find in Weather collection
                const weatherDoc = await Weather.findOne({ 
                    'location.city': new RegExp(`^${city.name}$`, 'i') 
                }).lean()
                
                if (weatherDoc && weatherDoc.location) {
                    validCities.push({
                        name: weatherDoc.location.city,
                        country: weatherDoc.location.country || city.country || '',
                        lat: weatherDoc.location.lat || city.lat || 0,
                        lon: weatherDoc.location.lon || city.lon || 0
                    })
                } else {
                    // Try DEFAULT_CITIES
                    const defaultCity = DEFAULT_CITIES.find(c => 
                        c.name.toLowerCase() === city.name.toLowerCase()
                    )
                    if (defaultCity) {
                        validCities.push(defaultCity)
                    }
                }
            }
        }
        
        const user = await User.findByIdAndUpdate(
            userId,
            { weatherCities: validCities },
            { new: true }
        ).select('-password')
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' })
        }
        
        console.log(`✅ [saveWeatherPreferences] Saved ${validCities.length} cities for user ${user.username}`)
        
        // Fetch and cache weather for user's selected cities immediately (in background, non-blocking)
        if (validCities.length > 0) {
            console.log(`🌤️ [saveWeatherPreferences] Fetching weather for ${validCities.length} cities in background...`)
            
            // Use setImmediate to run in background without blocking response
            setImmediate(async () => {
                for (let i = 0; i < validCities.length && i < 5; i++) { // Limit to 5 cities
                    const city = validCities[i]
                    // Add delay between requests to avoid rate limiting (60 calls/minute = 1 per second)
                    if (i > 0) {
                        await new Promise(resolve => setTimeout(resolve, 1100))
                    }
                    
                    try {
                        const endpoint = `/weather?lat=${city.lat}&lon=${city.lon}`
                        const result = await fetchFromWeatherAPI(endpoint)
                        
                        if (result.success && result.data) {
                            const convertedWeather = convertWeatherFormat(result.data, city)
                            await Weather.findOneAndUpdate(
                                { 
                                    'location.city': convertedWeather.location.city,
                                    'location.country': convertedWeather.location.country
                                },
                                convertedWeather,
                                { upsert: true, new: true }
                            )
                            console.log(`✅ [saveWeatherPreferences] Cached weather for ${city.name}`)
                        }
                    } catch (error) {
                        console.error(`❌ [saveWeatherPreferences] Error fetching weather for ${city.name}:`, error)
                    }
                }
                console.log(`✅ [saveWeatherPreferences] Finished caching weather for user's cities`)
            })
        }
        
        res.status(200).json({ 
            message: 'Weather preferences saved successfully',
            cities: validCities
        })
        
    } catch (error) {
        console.error('Error saving weather preferences:', error)
        res.status(500).json({ error: error.message })
    }
}

// 9. Get user's weather city preferences
export const getWeatherPreferences = async (req, res) => {
    try {
        const userId = req.user._id
        
        const user = await User.findById(userId).select('weatherCities')
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' })
        }
        
        // Return both formats for compatibility (mobile expects selectedCities as array of city names)
        const weatherCities = user.weatherCities || []
        const selectedCities = weatherCities.map(city => city.name || city) // Extract city names
        
        res.status(200).json({ 
            cities: weatherCities, // Full city objects (for web)
            selectedCities: selectedCities // City names only (for mobile)
        })
        
    } catch (error) {
        console.error('Error getting weather preferences:', error)
        res.status(500).json({ error: error.message })
    }
}
