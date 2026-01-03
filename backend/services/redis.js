import { createClient } from 'redis'

// Redis client singleton
let redisClient = null
let pubClient = null
let subClient = null

// Initialize Redis client - REQUIRED for scaling to 1M+ users
export const initRedis = async () => {
    // Redis is REQUIRED for production scaling
    if (!process.env.REDIS_URL) {
        console.error('❌ CRITICAL: REDIS_URL not set in environment variables!')
        console.error('❌ Redis is REQUIRED for scaling to 1M+ users')
        console.error('❌ Please set REDIS_URL in your .env file')
        console.error('❌ Example: REDIS_URL=redis://localhost:6379')
        process.exit(1) // Exit if Redis not configured
    }

    try {
        const redisUrl = process.env.REDIS_URL
        console.log('🔄 Connecting to Redis...')
        
        // Main Redis client for general operations
        redisClient = createClient({
            url: redisUrl,
            socket: {
                reconnectStrategy: (retries) => {
                    if (retries > 20) {
                        console.error('❌ Redis: Too many reconnection attempts, giving up')
                        return new Error('Too many retries')
                    }
                    const delay = Math.min(retries * 200, 5000)
                    if (retries <= 3) {
                        console.log(`🔄 Redis: Reconnecting in ${delay}ms (attempt ${retries})`)
                    }
                    return delay
                },
                connectTimeout: 10000 // 10 second timeout
            }
        })

        // Pub/Sub clients for Socket.IO adapter
        pubClient = createClient({
            url: redisUrl,
            socket: {
                reconnectStrategy: (retries) => {
                    if (retries > 20) return new Error('Too many retries')
                    return Math.min(retries * 200, 5000)
                },
                connectTimeout: 10000
            }
        })

        subClient = pubClient.duplicate()

        // Error handlers
        redisClient.on('error', (err) => {
            console.error('❌ Redis Client Error:', err.message)
        })

        pubClient.on('error', (err) => {
            console.error('❌ Redis Pub Client Error:', err.message)
        })

        subClient.on('error', (err) => {
            console.error('❌ Redis Sub Client Error:', err.message)
        })

        // Connect all clients
        await Promise.all([
            redisClient.connect(),
            pubClient.connect(),
            subClient.connect()
        ])

        console.log('✅ Redis connected successfully - App ready for scaling!')
        return { redisClient, pubClient, subClient }
    } catch (error) {
        console.error('❌ CRITICAL: Redis connection failed!')
        console.error('❌ Error:', error.message)
        console.error('❌ Redis is REQUIRED for production scaling')
        console.error('❌ Please ensure Redis is running and REDIS_URL is correct')
        process.exit(1) // Exit if Redis connection fails
    }
}

// Get Redis client - REQUIRED (no fallback for production)
export const getRedis = () => {
    if (!redisClient || !redisClient.isOpen) {
        throw new Error('Redis client not available - Redis is required for production')
    }
    return redisClient
}

// Get pub/sub clients for Socket.IO
export const getRedisPubSub = () => {
    if (!pubClient || !subClient || !pubClient.isOpen || !subClient.isOpen) {
        return null
    }
    return { pubClient, subClient }
}

// Check if Redis is available - REQUIRED for production
export const isRedisAvailable = () => {
    return redisClient && redisClient.isOpen
}

// Helper to ensure Redis is available (throws if not)
export const ensureRedis = () => {
    if (!isRedisAvailable()) {
        throw new Error('Redis is not available - Redis is required for production scaling')
    }
}

// Close Redis connections
export const closeRedis = async () => {
    try {
        if (redisClient && redisClient.isOpen) {
            await redisClient.quit()
        }
        if (pubClient && pubClient.isOpen) {
            await pubClient.quit()
        }
        if (subClient && subClient.isOpen) {
            await subClient.quit()
        }
        console.log('✅ Redis connections closed')
    } catch (error) {
        console.error('❌ Error closing Redis connections:', error)
    }
}

// Helper functions for common Redis operations

// Set a value with optional expiration (TTL in seconds)
export const redisSet = async (key, value, ttl = null) => {
    const client = getRedis()
    if (!client) return false
    
    try {
        if (ttl) {
            await client.setEx(key, ttl, JSON.stringify(value))
        } else {
            await client.set(key, JSON.stringify(value))
        }
        return true
    } catch (error) {
        console.error(`❌ Redis SET error for key ${key}:`, error)
        return false
    }
}

// Get a value
export const redisGet = async (key) => {
    const client = getRedis()
    if (!client) return null
    
    try {
        const value = await client.get(key)
        return value ? JSON.parse(value) : null
    } catch (error) {
        console.error(`❌ Redis GET error for key ${key}:`, error)
        return null
    }
}

// Delete a value
export const redisDel = async (key) => {
    const client = getRedis()
    if (!client) return false
    
    try {
        await client.del(key)
        return true
    } catch (error) {
        console.error(`❌ Redis DEL error for key ${key}:`, error)
        return false
    }
}

// Delete multiple keys
export const redisDelMultiple = async (keys) => {
    const client = getRedis()
    if (!client) return false
    
    try {
        if (keys.length > 0) {
            await client.del(keys)
        }
        return true
    } catch (error) {
        console.error('❌ Redis DEL multiple error:', error)
        return false
    }
}

// Check if key exists
export const redisExists = async (key) => {
    const client = getRedis()
    if (!client) return false
    
    try {
        const exists = await client.exists(key)
        return exists === 1
    } catch (error) {
        console.error(`❌ Redis EXISTS error for key ${key}:`, error)
        return false
    }
}

// Set expiration on existing key
export const redisExpire = async (key, ttl) => {
    const client = getRedis()
    if (!client) return false
    
    try {
        await client.expire(key, ttl)
        return true
    } catch (error) {
        console.error(`❌ Redis EXPIRE error for key ${key}:`, error)
        return false
    }
}


