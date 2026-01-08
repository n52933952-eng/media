import NodeCache from 'node-cache'

// Initialize cache
// stdTTL: default time to live in seconds
// checkperiod: how often to check for expired keys (in seconds)
const cache = new NodeCache({ 
    stdTTL: 30, // Default: 30 seconds for live matches
    checkperiod: 10, // Check for expired keys every 10 seconds
    useClones: false // Better performance for large objects
})

// Cache keys
const CACHE_KEYS = {
    LIVE_MATCHES: 'live_matches',
    UPCOMING_MATCHES: 'upcoming_matches',
    FINISHED_MATCHES: 'finished_matches',
    MATCH_DETAILS: 'match_details_' // Prefix for match details (fixtureId appended)
}

// Cache TTL (Time To Live) in seconds
const CACHE_TTL = {
    LIVE_MATCHES: 30, // 30 seconds - live matches change frequently
    UPCOMING_MATCHES: 3600, // 1 hour - upcoming matches don't change often
    FINISHED_MATCHES: 3600, // 1 hour - finished matches don't change
    MATCH_DETAILS: 300 // 5 minutes - match details (scorers, events) don't change often
}

/**
 * Get data from cache or return null if not found/expired
 */
export function getFromCache(key) {
    const data = cache.get(key)
    if (data) {
        console.log(`📦 [Cache] HIT: ${key}`)
        return data
    }
    console.log(`❌ [Cache] MISS: ${key}`)
    return null
}

/**
 * Set data in cache with TTL
 */
export function setCache(key, data, ttl = null) {
    const cacheTTL = ttl || CACHE_TTL[key] || 30
    cache.set(key, data, cacheTTL)
    console.log(`💾 [Cache] SET: ${key} (TTL: ${cacheTTL}s)`)
}

/**
 * Get live matches from cache
 */
export function getCachedLiveMatches() {
    return getFromCache(CACHE_KEYS.LIVE_MATCHES)
}

/**
 * Set live matches in cache
 */
export function setCachedLiveMatches(matches) {
    setCache(CACHE_KEYS.LIVE_MATCHES, matches, CACHE_TTL.LIVE_MATCHES)
}

/**
 * Get upcoming matches from cache
 */
export function getCachedUpcomingMatches() {
    return getFromCache(CACHE_KEYS.UPCOMING_MATCHES)
}

/**
 * Set upcoming matches in cache
 */
export function setCachedUpcomingMatches(matches) {
    setCache(CACHE_KEYS.UPCOMING_MATCHES, matches, CACHE_TTL.UPCOMING_MATCHES)
}

/**
 * Get finished matches from cache
 */
export function getCachedFinishedMatches() {
    return getFromCache(CACHE_KEYS.FINISHED_MATCHES)
}

/**
 * Set finished matches in cache
 */
export function setCachedFinishedMatches(matches) {
    setCache(CACHE_KEYS.FINISHED_MATCHES, matches, CACHE_TTL.FINISHED_MATCHES)
}

/**
 * Get match details (scorers, events) from cache
 */
export function getCachedMatchDetails(fixtureId) {
    return getFromCache(CACHE_KEYS.MATCH_DETAILS + fixtureId)
}

/**
 * Set match details in cache
 */
export function setCachedMatchDetails(fixtureId, details) {
    setCache(CACHE_KEYS.MATCH_DETAILS + fixtureId, details, CACHE_TTL.MATCH_DETAILS)
}

/**
 * Clear all cache (useful for testing or manual refresh)
 */
export function clearCache() {
    cache.flushAll()
    console.log('🗑️ [Cache] Cleared all cache')
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
    return cache.getStats()
}

export default {
    getFromCache,
    setCache,
    getCachedLiveMatches,
    setCachedLiveMatches,
    getCachedUpcomingMatches,
    setCachedUpcomingMatches,
    getCachedFinishedMatches,
    setCachedFinishedMatches,
    getCachedMatchDetails,
    setCachedMatchDetails,
    clearCache,
    getCacheStats
}
