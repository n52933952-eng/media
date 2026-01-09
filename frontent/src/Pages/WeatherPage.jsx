import React, { useState, useEffect, useContext } from 'react'
import {
    Box,
    Container,
    Heading,
    Text,
    Flex,
    Spinner,
    Button,
    useColorModeValue,
    VStack,
    HStack,
    Badge,
    SimpleGrid
} from '@chakra-ui/react'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import useShowToast from '../hooks/useShowToast'

const WeatherPage = () => {
    const { user } = useContext(UserContext)
    const { socket } = useContext(SocketContext) || {}
    const [weatherData, setWeatherData] = useState([])
    const [loading, setLoading] = useState(true)
    const [isFollowing, setIsFollowing] = useState(false)
    const [followLoading, setFollowLoading] = useState(false)
    const [weatherAccountId, setWeatherAccountId] = useState(null)
    
    const showToast = useShowToast()
    
    const bgColor = useColorModeValue('white', 'gray.800')
    const borderColor = useColorModeValue('gray.200', 'gray.700')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
    
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
    
    // Fetch weather function
    const fetchWeather = async (silent = false) => {
        try {
            if (!silent) {
                console.log('🌤️ [WeatherPage] Starting to fetch weather...')
                setLoading(true)
            }
            
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            
            const res = await fetch(
                `${baseUrl}/api/weather?limit=10`,
                { credentials: 'include' }
            )
            const data = await res.json()
            
            if (res.ok && data.weather) {
                if (!silent) console.log('🌤️ [WeatherPage] Setting weather data:', data.weather.length)
                setWeatherData(data.weather || [])
            } else {
                console.error('🌤️ [WeatherPage] Weather request failed:', data)
                if (!silent) {
                    showToast('Error', 'Failed to load weather data', 'error')
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
    
    // Initial fetch on mount
    useEffect(() => {
        fetchWeather()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    
    // Listen for real-time weather updates via socket
    useEffect(() => {
        if (!socket) return
        
        const isDev = import.meta.env.DEV
        
        const handleWeatherPageUpdate = (data) => {
            if (isDev) {
                console.log('📥 [WeatherPage] Update received:', {
                    weather: data.weather?.length || 0
                })
            }
            
            if (data.weather !== undefined) {
                setWeatherData(data.weather)
            }
        }
        
        socket.on('connect', () => {
            if (isDev) {
                console.log('✅ [WeatherPage] Socket connected')
            }
        })
        
        socket.on('disconnect', () => {
            console.warn('⚠️ [WeatherPage] Socket disconnected')
        })
        
        socket.on('connect_error', (error) => {
            console.error('❌ [WeatherPage] Socket connection error:', error)
        })
        
        // Listen for weather updates
        socket.on('weatherPageUpdate', handleWeatherPageUpdate)
        
        return () => {
            socket.off('weatherPageUpdate', handleWeatherPageUpdate)
            socket.off('connect')
            socket.off('disconnect')
            socket.off('connect_error')
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket])
    
    // Follow/Unfollow Weather account
    const handleFollowToggle = async () => {
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
    }
    
    // Get weather icon URL
    const getWeatherIcon = (iconCode) => {
        return `https://openweathermap.org/img/wn/${iconCode}@2x.png`
    }
    
    // Render weather card
    const WeatherCard = ({ weather }) => (
        <Box
            bg={bgColor}
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
                            Live weather from cities around the world
                        </Text>
                    </VStack>
                </HStack>
                
                {user && (
                    <Button
                        onClick={handleFollowToggle}
                        isLoading={followLoading}
                        colorScheme={isFollowing ? 'gray' : 'blue'}
                        size="sm"
                    >
                        {isFollowing ? 'Following' : 'Follow'}
                    </Button>
                )}
            </Flex>
            
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
                        💡 Follow the Weather channel to get live weather updates in your feed!
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
                        Weather updates will appear here once fetched
                    </Text>
                </Box>
            )}
        </Container>
    )
}

export default WeatherPage
