import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react'
import {
    Box,
    Container,
    Heading,
    Text,
    Flex,
    Spinner,
    Button,
    Input,
    InputGroup,
    InputLeftElement,
    useColorModeValue,
    VStack,
    HStack,
    Badge,
    SimpleGrid,
    IconButton,
    useDisclosure,
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalCloseButton,
    ModalFooter
} from '@chakra-ui/react'
import { SearchIcon, DeleteIcon, AddIcon } from '@chakra-ui/icons'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'

// In-memory cache for weather data (shared across component instances)
// Also expose to window for Post component to use
const weatherCache = {
    data: null,
    timestamp: null,
    preferences: null,
    CACHE_TTL: 5 * 60 * 1000 // 5 minutes
}

// Expose to window for Post component
if (typeof window !== 'undefined') {
    window.weatherCache = weatherCache
}

const WeatherPage = () => {
    const { user, setUser } = useContext(UserContext)
    const { socket } = useContext(SocketContext) || {}
    const [weatherData, setWeatherData] = useState([])
    const [loading, setLoading] = useState(true)
    const [isFollowing, setIsFollowing] = useState(false)
    const [followLoading, setFollowLoading] = useState(false)
    const [weatherAccountId, setWeatherAccountId] = useState(null)
    
    // City selection states
    const [selectedCities, setSelectedCities] = useState([])
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState([])
    const [searchLoading, setSearchLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const { isOpen, onOpen, onClose } = useDisclosure()
    
    const showToast = useShowToast()
    
    const bgColor = useColorModeValue('white', 'gray.800')
    const borderColor = useColorModeValue('gray.200', 'gray.700')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
    const cardBg = useColorModeValue('white', '#252b3b')
    
    // Load user's saved cities
    const loadPreferences = useCallback(async () => {
        if (!user) return
        
        try {
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            const res = await fetch(`${baseUrl}/api/weather/preferences`, {
                credentials: 'include',
                cache: 'no-cache' // Always fetch fresh data
            })
            const data = await res.json()
            
            if (res.ok && data.cities) {
                console.log('🌤️ [WeatherPage] Loaded preferences from backend:', data.cities.length, 'cities')
                setSelectedCities(data.cities)
                return data.cities
            } else {
                setSelectedCities([])
                return []
            }
        } catch (error) {
            console.error('Error loading preferences:', error)
            return []
        }
    }, [user])
    
    useEffect(() => {
        loadPreferences()
    }, [user, loadPreferences])
    
    // Reload preferences when modal opens to ensure fresh data
    useEffect(() => {
        if (isOpen && user) {
            loadPreferences()
        }
    }, [isOpen, user, loadPreferences])
    
    // Check if user follows Weather account
    useEffect(() => {
        const checkFollowStatus = async () => {
            try {
                const res = await fetch(
                    `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/getUserPro/Weather`,
                    { credentials: 'include' }
                )
                const data = await res.json()
                
                if (res.ok && user && data._id) {
                    setWeatherAccountId(data._id)
                    setIsFollowing(user.following?.includes(data._id))
                }
            } catch (error) {
                console.error('Error checking follow status:', error)
            }
        }
        
        if (user) {
            checkFollowStatus()
        }
    }, [user])
    
    // Fetch weather function - for user's selected cities or default (with memory cache)
    const fetchWeather = async (silent = false, cities = null) => {
        try {
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            const citiesToFetch = cities || selectedCities
            const cacheKey = citiesToFetch.length > 0 
                ? JSON.stringify(citiesToFetch.map(c => `${c.name}-${c.country}`).sort())
                : 'default'
            
            // Check memory cache first
            const now = Date.now()
            if (weatherCache.data && 
                weatherCache.preferences === cacheKey &&
                weatherCache.timestamp && 
                (now - weatherCache.timestamp) < weatherCache.CACHE_TTL) {
                console.log('💾 [WeatherPage] Using cached weather data')
                setWeatherData(weatherCache.data)
                if (!silent) setLoading(false)
                return
            }
            
            // Check localStorage cache as fallback
            try {
                const cached = localStorage.getItem(`weatherCache_${cacheKey}`)
                if (cached) {
                    const parsed = JSON.parse(cached)
                    if (parsed.timestamp && (now - parsed.timestamp) < weatherCache.CACHE_TTL) {
                        console.log('💾 [WeatherPage] Using localStorage cached weather data')
                        setWeatherData(parsed.data)
                        weatherCache.data = parsed.data
                        weatherCache.timestamp = parsed.timestamp
                        weatherCache.preferences = cacheKey
                        if (!silent) setLoading(false)
                        return
                    }
                }
            } catch (e) {
                console.error('Error reading localStorage cache:', e)
            }
            
            if (!silent) {
                console.log('🌤️ [WeatherPage] Starting to fetch weather...')
                setLoading(true)
            }
            
            // If user has selected cities, fetch weather for those cities
            if (citiesToFetch.length > 0) {
                // Fetch weather for each selected city
                const weatherPromises = citiesToFetch.map(async (city, index) => {
                    // Add delay between requests to avoid rate limiting (except first one)
                    if (index > 0) {
                        await new Promise(resolve => setTimeout(resolve, 1100))
                    }
                    
                    try {
                        const res = await fetch(
                            `${baseUrl}/api/weather/forecast?lat=${city.lat}&lon=${city.lon}`,
                            { credentials: 'include' }
                        )
                        const data = await res.json()
                        if (res.ok && data.weather) {
                            return data.weather
                        }
                        return null
                    } catch (error) {
                        console.error(`Error fetching weather for ${city.name}:`, error)
                        return null
                    }
                })
                
                const results = await Promise.all(weatherPromises)
                const validResults = results.filter(w => w !== null)
                
                // Update cache
                weatherCache.data = validResults
                weatherCache.timestamp = now
                weatherCache.preferences = cacheKey
                
                // Also save to localStorage
                try {
                    localStorage.setItem(`weatherCache_${cacheKey}`, JSON.stringify({
                        data: validResults,
                        timestamp: now
                    }))
                } catch (e) {
                    console.error('Error saving to localStorage cache:', e)
                }
                
                if (!silent) console.log('🌤️ [WeatherPage] Setting weather data:', validResults.length)
                setWeatherData(validResults)
            } else {
                // No selected cities, fetch default cities
                const res = await fetch(
                    `${baseUrl}/api/weather?limit=10`,
                    { credentials: 'include' }
                )
                const data = await res.json()
                
                if (res.ok && data.weather) {
                    // Update cache
                    weatherCache.data = data.weather || []
                    weatherCache.timestamp = now
                    weatherCache.preferences = cacheKey
                    
                    // Also save to localStorage
                    try {
                        localStorage.setItem(`weatherCache_${cacheKey}`, JSON.stringify({
                            data: data.weather || [],
                            timestamp: now
                        }))
                    } catch (e) {
                        console.error('Error saving to localStorage cache:', e)
                    }
                    
                    if (!silent) console.log('🌤️ [WeatherPage] Setting weather data:', data.weather.length)
                    setWeatherData(data.weather || [])
                } else {
                    console.error('🌤️ [WeatherPage] Weather request failed:', data)
                    if (!silent) {
                        showToast('Error', 'Failed to load weather data', 'error')
                    }
                }
            }
            
        } catch (error) {
            console.error('🌤️ [WeatherPage] Error fetching weather:', error)
            if (!silent) {
                showToast('Error', 'Failed to load weather', 'error')
            }
        } finally {
            if (!silent) {
                setLoading(false)
                console.log('🌤️ [WeatherPage] Finished fetching weather')
            }
        }
    }
    
    // Initial fetch on mount and when selectedCities changes
    // Use useMemo to create a stable dependency key
    const citiesKey = useMemo(() => 
        selectedCities.map(c => `${c.name}-${c.country}-${c.lat}-${c.lon}`).join('|'),
        [selectedCities]
    )
    
    useEffect(() => {
        if (selectedCities.length > 0) {
            console.log('🌤️ [WeatherPage] Fetching weather for', selectedCities.length, 'selected cities:', selectedCities.map(c => c.name))
            fetchWeather(false, selectedCities)
        } else {
            console.log('🌤️ [WeatherPage] No cities selected, fetching default weather')
            fetchWeather()
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [citiesKey]) // Trigger when cities actually change (by content, not just reference)
    
    // Search cities
    const handleSearch = async (query) => {
        setSearchQuery(query)
        
        if (query.trim().length < 2) {
            setSearchResults([])
            return
        }
        
        setSearchLoading(true)
        try {
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            const res = await fetch(
                `${baseUrl}/api/weather/search?query=${encodeURIComponent(query)}`,
                { credentials: 'include' }
            )
            const data = await res.json()
            
            if (res.ok && data.cities) {
                setSearchResults(data.cities)
            }
        } catch (error) {
            console.error('Error searching cities:', error)
            showToast('Error', 'Failed to search cities', 'error')
        } finally {
            setSearchLoading(false)
        }
    }
    
    // Add city to selection and immediately fetch weather
    const handleAddCity = async (city) => {
        if (selectedCities.length >= 10) {
            showToast('Info', 'Maximum 10 cities allowed', 'info')
            return
        }
        
        const exists = selectedCities.some(c => 
            c.name === city.name && c.country === city.country
        )
        
        if (exists) {
            showToast('Info', 'City already added', 'info')
            return
        }
        
        const updatedCities = [...selectedCities, city]
        setSelectedCities(updatedCities)
        setSearchQuery('')
        setSearchResults([])
        
        // Immediately fetch weather for the new city to show it on the page
        try {
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            const weatherRes = await fetch(
                `${baseUrl}/api/weather/forecast?lat=${city.lat}&lon=${city.lon}`,
                { credentials: 'include' }
            )
            const weatherResponse = await weatherRes.json()
            
            if (weatherRes.ok && weatherResponse.weather) {
                const w = weatherResponse.weather
                const newWeatherItem = {
                    location: {
                        city: w.location?.city || city.name,
                        country: w.location?.country || city.country,
                        lat: city.lat,
                        lon: city.lon
                    },
                    current: {
                        temperature: w.current?.temperature,
                        condition: w.current?.condition,
                        humidity: w.current?.humidity,
                        windSpeed: w.current?.windSpeed
                    }
                }
                
                // Add to existing weather data immediately (will also be fetched by useEffect)
                setWeatherData(prev => {
                    const exists = prev.some(w => 
                        w.location?.city === newWeatherItem.location.city &&
                        w.location?.country === newWeatherItem.location.country
                    )
                    if (exists) return prev
                    return [...prev, newWeatherItem]
                })
                
                console.log('✅ [WeatherPage] Added city and fetched weather immediately:', city.name)
                // Note: useEffect will also fetch weather for all selectedCities, but this gives immediate feedback
            }
        } catch (error) {
            console.error('Error fetching weather for new city:', error)
        }
    }
    
    // Remove city from selection and auto-save
    const handleRemoveCity = async (index) => {
        const updatedCities = selectedCities.filter((_, i) => i !== index)
        setSelectedCities(updatedCities)
        
        // Auto-save immediately when city is removed
        if (user && updatedCities.length >= 0) {
            try {
                const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
                const res = await fetch(`${baseUrl}/api/weather/preferences`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ cities: updatedCities })
                })
                
                if (res.ok) {
                    console.log('✅ [WeatherPage] City removed and saved automatically')
                    // Clear cache and dispatch event for feed update
                    if (window.weatherCache) {
                        window.weatherCache.data = null
                        window.weatherCache.timestamp = null
                        window.weatherCache.preferences = null
                    }
                    try {
                        Object.keys(localStorage).forEach(key => {
                            if (key.startsWith('weatherCache_')) {
                                localStorage.removeItem(key)
                            }
                        })
                    } catch (e) {
                        console.error('Error clearing localStorage cache:', e)
                    }
                    window.dispatchEvent(new CustomEvent('weatherPreferencesUpdated', { 
                        detail: { cities: updatedCities } 
                    }))
                    // Refresh weather display
                    if (updatedCities.length > 0) {
                        fetchWeather(false, updatedCities)
                    } else {
                        fetchWeather() // Use defaults if no cities selected
                    }
                } else {
                    console.error('Failed to auto-save after city removal')
                }
            } catch (error) {
                console.error('Error auto-saving after city removal:', error)
            }
        }
    }
    
    // Save preferences
    const handleSavePreferences = async () => {
        if (!user) {
            showToast('Error', 'Please login to save preferences', 'error')
            return
        }
        
        setSaving(true)
        try {
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            const res = await fetch(`${baseUrl}/api/weather/preferences`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ cities: selectedCities })
            })
            
            const data = await res.json()
            
            if (res.ok) {
                showToast('Success', 'Weather preferences saved! Feed will now show weather for your selected cities.', 'success')
                
                // Clear all weather caches immediately
                if (window.weatherCache) {
                    window.weatherCache.data = null
                    window.weatherCache.timestamp = null
                    window.weatherCache.preferences = null
                }
                
                // Clear localStorage cache
                try {
                    Object.keys(localStorage).forEach(key => {
                        if (key.startsWith('weatherCache_')) {
                            localStorage.removeItem(key)
                        }
                    })
                } catch (e) {
                    console.error('Error clearing localStorage cache:', e)
                }
                
                onClose()
                
                // Fetch weather immediately for selected cities (will cache for Post component)
                fetchWeather(false, selectedCities)
                
                // Small delay to ensure backend has started fetching, then dispatch event
                setTimeout(() => {
                    // Trigger feed refresh - dispatch event for Post components
                    window.dispatchEvent(new CustomEvent('weatherPreferencesUpdated', { 
                        detail: { cities: selectedCities } 
                    }))
                    console.log('✅ [WeatherPage] Preferences saved, cache cleared, event dispatched')
                }, 500)
            } else {
                showToast('Error', data.error || 'Failed to save preferences', 'error')
            }
        } catch (error) {
            console.error('Error saving preferences:', error)
            showToast('Error', 'Failed to save preferences', 'error')
        } finally {
            setSaving(false)
        }
    }
    
    // Follow/Unfollow Weather account
    const handleFollowToggle = useCallback(async () => {
        if (!weatherAccountId) {
            showToast('Error', 'Weather account not found', 'error')
            return
        }
        
        try {
            setFollowLoading(true)
            
            const res = await fetch(
                `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/follow/${weatherAccountId}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include'
                }
            )
            
            const data = await res.json()
            
            if (res.ok) {
                setIsFollowing(!isFollowing)
                if (data.current) {
                    setUser(data.current)
                    localStorage.setItem('userInfo', JSON.stringify(data.current))
                }
                showToast(
                    'Success',
                    isFollowing ? 'Unfollowed Weather channel' : 'Following Weather channel! You\'ll now see updates in your feed',
                    'success'
                )
            } else {
                showToast('Error', data.error || 'Failed to update follow status', 'error')
            }
        } catch (error) {
            console.error('Error toggling follow:', error)
            showToast('Error', 'Failed to update follow status', 'error')
        } finally {
            setFollowLoading(false)
        }
    }, [weatherAccountId, isFollowing, setUser, showToast])
    
    // Get weather icon URL
    const getWeatherIcon = (iconCode) => {
        return `https://openweathermap.org/img/wn/${iconCode}@2x.png`
    }
    
    // Render weather card
    const WeatherCard = ({ weather }) => (
        <Box
            bg={cardBg}
            borderRadius="lg"
            border="1px solid"
            borderColor={borderColor}
            p={4}
            mb={3}
            _hover={{ shadow: 'md' }}
            transition="all 0.2s"
        >
            <Flex align="center" justify="space-between" mb={3}>
                <VStack align="start" spacing={0}>
                    <Text fontSize="lg" fontWeight="bold" color={textColor}>
                        {weather.location?.city}, {weather.location?.country}
                    </Text>
                    <Text fontSize="xs" color={secondaryTextColor}>
                        Updated {new Date(weather.lastUpdated).toLocaleString('en-US', { 
                            hour: '2-digit', 
                            minute: '2-digit',
                            month: 'short',
                            day: 'numeric'
                        })}
                    </Text>
                </VStack>
            </Flex>
            
            <Flex align="center" justify="space-between" mb={4}>
                <HStack spacing={3}>
                    {weather.current?.condition?.icon && (
                        <img 
                            src={getWeatherIcon(weather.current.condition.icon)} 
                            alt={weather.current.condition.main}
                            style={{ width: '60px', height: '60px' }}
                        />
                    )}
                    <VStack align="start" spacing={0}>
                        <Text fontSize="3xl" fontWeight="bold" color={textColor}>
                            {weather.current?.temperature}°C
                        </Text>
                        <Text fontSize="sm" color={secondaryTextColor} textTransform="capitalize">
                            {weather.current?.condition?.description}
                        </Text>
                    </VStack>
                </HStack>
            </Flex>
            
            <SimpleGrid columns={2} spacing={4} mt={4} pt={4} borderTop="1px solid" borderColor={borderColor}>
                <VStack align="start" spacing={1}>
                    <Text fontSize="xs" color={secondaryTextColor}>Feels like</Text>
                    <Text fontSize="md" fontWeight="semibold" color={textColor}>
                        {weather.current?.feelsLike}°C
                    </Text>
                </VStack>
                <VStack align="start" spacing={1}>
                    <Text fontSize="xs" color={secondaryTextColor}>Humidity</Text>
                    <Text fontSize="md" fontWeight="semibold" color={textColor}>
                        {weather.current?.humidity}%
                    </Text>
                </VStack>
                <VStack align="start" spacing={1}>
                    <Text fontSize="xs" color={secondaryTextColor}>Wind Speed</Text>
                    <Text fontSize="md" fontWeight="semibold" color={textColor}>
                        {weather.current?.windSpeed?.toFixed(1)} m/s
                    </Text>
                </VStack>
                <VStack align="start" spacing={1}>
                    <Text fontSize="xs" color={secondaryTextColor}>Pressure</Text>
                    <Text fontSize="md" fontWeight="semibold" color={textColor}>
                        {weather.current?.pressure} hPa
                    </Text>
                </VStack>
            </SimpleGrid>
            
            {weather.current?.visibility && (
                <Box mt={4} pt={4} borderTop="1px solid" borderColor={borderColor}>
                    <Text fontSize="xs" color={secondaryTextColor}>Visibility</Text>
                    <Text fontSize="md" fontWeight="semibold" color={textColor}>
                        {weather.current.visibility} km
                    </Text>
                </Box>
            )}
        </Box>
    )
    
    return (
        <Container maxW="800px" py={6}>
            {/* Header */}
            <Flex align="center" justify="space-between" mb={6}>
                <HStack spacing={3}>
                    <Text fontSize="4xl">🌤️</Text>
                    <VStack align="start" spacing={0}>
                        <Heading size="lg">Weather Updates</Heading>
                        <Text fontSize="sm" color={secondaryTextColor}>
                            {selectedCities.length > 0 
                                ? `Showing weather for ${selectedCities.length} selected city${selectedCities.length > 1 ? 'ies' : ''}`
                                : 'Live weather from cities around the world'
                            }
                        </Text>
                    </VStack>
                </HStack>
                
                <HStack spacing={2}>
                    {user && (
                        <>
                            <Button
                                onClick={onOpen}
                                colorScheme="blue"
                                size="sm"
                                leftIcon={<AddIcon />}
                            >
                                {selectedCities.length > 0 ? 'Edit Cities' : 'Select Cities'}
                            </Button>
                            <Button
                                onClick={handleFollowToggle}
                                isLoading={followLoading}
                                colorScheme={isFollowing ? 'gray' : 'blue'}
                                size="sm"
                            >
                                {isFollowing ? 'Following' : 'Follow'}
                            </Button>
                        </>
                    )}
                </HStack>
            </Flex>
            
            {/* Selected Cities Display */}
            {selectedCities.length > 0 && (
                <Box
                    bg={bgColor}
                    borderRadius="lg"
                    border="1px solid"
                    borderColor={borderColor}
                    p={4}
                    mb={4}
                >
                    <Text fontSize="sm" fontWeight="semibold" color={textColor} mb={2}>
                        Your Selected Cities ({selectedCities.length}/10):
                    </Text>
                    <Flex flexWrap="wrap" gap={2}>
                        {selectedCities.map((city, index) => (
                            <Badge
                                key={index}
                                px={3}
                                py={1}
                                borderRadius="full"
                                colorScheme="blue"
                                fontSize="xs"
                            >
                                {city.name}, {city.country}
                                {user && (
                                    <IconButton
                                        aria-label="Remove city"
                                        icon={<DeleteIcon />}
                                        size="xs"
                                        ml={2}
                                        onClick={() => handleRemoveCity(index)}
                                        variant="ghost"
                                        colorScheme="red"
                                    />
                                )}
                            </Badge>
                        ))}
                    </Flex>
                    {selectedCities.length > 0 && (
                        <Text fontSize="xs" color={secondaryTextColor} mt={2}>
                            💡 Your feed will show weather for these cities only. Click "Save Preferences" to update.
                        </Text>
                    )}
                </Box>
            )}
            
            {!user && (
                <Box
                    bg="blue.50"
                    borderRadius="lg"
                    p={4}
                    mb={4}
                    border="1px solid"
                    borderColor="blue.200"
                >
                    <Text color="blue.700" fontSize="sm">
                        💡 Login to select your preferred cities and see personalized weather in your feed!
                    </Text>
                </Box>
            )}
            
            {loading ? (
                <Flex justify="center" py={10}>
                    <Spinner size="xl" />
                </Flex>
            ) : weatherData.length > 0 ? (
                <VStack align="stretch" spacing={0}>
                    {weatherData.map((weather, index) => (
                        <WeatherCard key={weather._id || index} weather={weather} />
                    ))}
                </VStack>
            ) : (
                <Box textAlign="center" py={10}>
                    <Text fontSize="lg" color={secondaryTextColor} mb={2}>
                        🌤️ No weather data available
                    </Text>
                    <Text fontSize="sm" color={secondaryTextColor}>
                        {selectedCities.length > 0 
                            ? 'Select cities and click "Save Preferences" to see weather'
                            : 'Weather updates will appear here once fetched'
                        }
                    </Text>
                </Box>
            )}
            
            {/* City Selection Modal */}
            <Modal isOpen={isOpen} onClose={onClose} size="lg">
                <ModalOverlay />
                <ModalContent>
                    <ModalHeader>Select Your Cities</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody>
                        <VStack spacing={4} align="stretch">
                            <Box>
                                <Text fontSize="sm" color={secondaryTextColor} mb={2}>
                                    Search and select cities to see weather for your location (e.g., Amman, Jordan)
                                </Text>
                                <InputGroup>
                                    <InputLeftElement pointerEvents="none">
                                        <SearchIcon color="gray.400" />
                                    </InputLeftElement>
                                    <Input
                                        placeholder="Search cities (e.g., Amman, Jordan)"
                                        value={searchQuery}
                                        onChange={(e) => handleSearch(e.target.value)}
                                        bg={useColorModeValue('gray.50', '#2d2d2d')}
                                    />
                                </InputGroup>
                            </Box>
                            
                            {/* Search Results */}
                            {searchLoading && (
                                <Flex justify="center" py={4}>
                                    <Spinner size="sm" />
                                </Flex>
                            )}
                            
                            {searchResults.length > 0 && (
                                <Box maxH="200px" overflowY="auto">
                                    <VStack align="stretch" spacing={2}>
                                        {searchResults.map((city, index) => (
                                            <Flex
                                                key={index}
                                                p={2}
                                                borderRadius="md"
                                                border="1px solid"
                                                borderColor={borderColor}
                                                justify="space-between"
                                                align="center"
                                                _hover={{ bg: useColorModeValue('gray.50', 'gray.700') }}
                                            >
                                                <VStack align="start" spacing={0}>
                                                    <Text fontSize="sm" fontWeight="semibold" color={textColor}>
                                                        {city.name}
                                                    </Text>
                                                    <Text fontSize="xs" color={secondaryTextColor}>
                                                        {city.state && `${city.state}, `}{city.country}
                                                    </Text>
                                                </VStack>
                                                <Button
                                                    size="xs"
                                                    colorScheme="blue"
                                                    onClick={() => handleAddCity(city)}
                                                    isDisabled={selectedCities.length >= 10}
                                                >
                                                    Add
                                                </Button>
                                            </Flex>
                                        ))}
                                    </VStack>
                                </Box>
                            )}
                            
                            {/* Selected Cities */}
                            {selectedCities.length > 0 && (
                                <Box>
                                    <Text fontSize="sm" fontWeight="semibold" color={textColor} mb={2}>
                                        Selected Cities ({selectedCities.length}/10):
                                    </Text>
                                    <VStack align="stretch" spacing={2}>
                                        {selectedCities.map((city, index) => (
                                            <Flex
                                                key={index}
                                                p={2}
                                                borderRadius="md"
                                                border="1px solid"
                                                borderColor={borderColor}
                                                justify="space-between"
                                                align="center"
                                            >
                                                <Text fontSize="sm" color={textColor}>
                                                    {city.name}, {city.country}
                                                </Text>
                                                <IconButton
                                                    aria-label="Remove city"
                                                    icon={<DeleteIcon />}
                                                    size="sm"
                                                    onClick={() => handleRemoveCity(index)}
                                                    colorScheme="red"
                                                    variant="ghost"
                                                />
                                            </Flex>
                                        ))}
                                    </VStack>
                                </Box>
                            )}
                            
                            {searchQuery.length >= 2 && searchResults.length === 0 && !searchLoading && (
                                <Text fontSize="sm" color={secondaryTextColor} textAlign="center" py={4}>
                                    No cities found. Try a different search term.
                                </Text>
                            )}
                        </VStack>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="ghost" mr={3} onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            colorScheme="blue"
                            onClick={handleSavePreferences}
                            isLoading={saving}
                            isDisabled={selectedCities.length === 0}
                        >
                            Save Preferences
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </Container>
    )
}

export default WeatherPage
