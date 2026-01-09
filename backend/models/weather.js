import mongoose from 'mongoose'

// Weather Data Schema
const WeatherSchema = mongoose.Schema({
    location: {
        city: {
            type: String,
            required: true
        },
        country: {
            type: String,
            required: true
        },
        lat: Number,
        lon: Number
    },
    
    current: {
        temperature: Number,      // Celsius
        feelsLike: Number,        // Celsius
        humidity: Number,         // %
        pressure: Number,         // hPa
        visibility: Number,       // meters
        windSpeed: Number,        // m/s
        windDirection: Number,    // degrees
        clouds: Number,           // %
        uvIndex: Number,
        condition: {
            main: String,         // "Clear", "Clouds", "Rain", etc.
            description: String,  // "clear sky", "few clouds", etc.
            icon: String          // Weather icon code
        }
    },
    
    forecast: [{
        date: Date,
        temp: {
            min: Number,
            max: Number
        },
        condition: {
            main: String,
            description: String,
            icon: String
        },
        humidity: Number,
        windSpeed: Number,
        precipitation: Number     // mm
    }],
    
    lastUpdated: {
        type: Date,
        default: Date.now
    }

}, { timestamps: true })

// Indexes for performance
WeatherSchema.index({ 'location.city': 1, 'location.country': 1 })
WeatherSchema.index({ lastUpdated: -1 })

const Weather = mongoose.model("Weather", WeatherSchema)

export default Weather
