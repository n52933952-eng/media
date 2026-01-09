import express from 'express'
import {
    fetchCurrentWeather,
    fetchWeatherForecast,
    getWeather,
    manualFetchWeather,
    manualPostWeather
} from '../controller/weather.js'
import protectRoute from '../middlware/protectRoute.js'

const router = express.Router()

// Fetch current weather for default cities (admin/cron only)
router.post('/fetch/current', protectRoute, fetchCurrentWeather)

// Fetch weather forecast for specific city
router.get('/forecast', fetchWeatherForecast)

// Get cached weather data (for users)
router.get('/', getWeather)

// Manual trigger to fetch weather (for testing)
router.post('/fetch/manual', manualFetchWeather)

// Manual trigger to post weather to feed (for testing)
router.post('/post/manual', manualPostWeather)

export default router
