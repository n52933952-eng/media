import React,{useEffect,useState,useContext, useCallback, useMemo, memo, useRef} from 'react'
import{Link} from 'react-router-dom'
import{Flex,Avatar,Box,Text,Image,Button, VStack, HStack, Grid, GridItem, SimpleGrid, Spinner, useColorModeValue, useDisclosure, Menu, MenuButton, MenuList, MenuItem, IconButton, Tooltip} from '@chakra-ui/react'
import { HiOutlineDotsHorizontal } from "react-icons/hi";
import { MdOutlineDeleteOutline, MdPersonRemove } from "react-icons/md";
import { BsThreeDotsVertical } from "react-icons/bs";
import Actions from '../Components/Actions'
import useShowToast from '../hooks/useShowToast.js'
import{useNavigate} from 'react-router-dom'
import { formatDistanceToNow, format } from 'date-fns'
import{UserContext} from '../context/UserContext'
import{PostContext} from '../context/PostContext'
import AddContributorModal from './AddContributorModal'
import ManageContributorsModal from './ManageContributorsModal'
import EditPost from './EditPost'
import FootballIcon from './FootballIcon'
import FootballMatchCards from './FootballMatchCards'
import { normalizeDbMatchForFootballFeed, isFootballMatchLive } from '../utils/footballFeed'

const apiBaseUrl = () => (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

const Post = ({post: initialPost, postedBy, onDelete, visibleVideoOnly = false}) => {
    
  // Local state for this specific post (used when not in feed context)
  const [localPost, setLocalPost] = useState(initialPost)
  
  // Use local post or initial post
  const post = localPost || initialPost
  const videoRef = useRef(null)
  const [isVideoInView, setIsVideoInView] = useState(!visibleVideoOnly)
  const optimizeCloudinaryMediaUrl = useCallback((rawUrl, kind) => {
    const url = String(rawUrl || '')
    if (!url.includes('res.cloudinary.com')) return url
    if (kind === 'video') {
      if (!url.includes('/video/upload/')) return url
      return url.replace('/video/upload/', '/video/upload/f_auto,q_auto:good,vc_auto/')
    }
    if (!url.includes('/image/upload/')) return url
    return url.replace('/image/upload/', '/image/upload/f_auto,q_auto:good/')
  }, [])
  const rawMediaUrl = String(post?.img || '')
  const optimizedImageUrl = optimizeCloudinaryMediaUrl(rawMediaUrl, 'image')
  const optimizedVideoUrl = optimizeCloudinaryMediaUrl(rawMediaUrl, 'video')
  const isVideoMedia = rawMediaUrl.match(/\.(mp4|webm|ogg|mov)$/i) || rawMediaUrl.includes('/video/upload/')
  
  // Update local post when initialPost changes (e.g., from parent re-fetch)
  useEffect(() => {
    console.log('🔄 [Post] Initial post prop changed, updating local state')
    setLocalPost(initialPost)
  }, [initialPost])

  useEffect(() => {
    if (!visibleVideoOnly) {
      setIsVideoInView(true)
      return
    }
    if (!isVideoMedia || !videoRef.current) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVideoInView(!!entry?.isIntersecting && entry.intersectionRatio >= 0.6)
      },
      { threshold: [0, 0.25, 0.6, 0.9] }
    )
    observer.observe(videoRef.current)
    return () => observer.disconnect()
  }, [visibleVideoOnly, isVideoMedia, post?._id])

  useEffect(() => {
    if (!isVideoMedia || !videoRef.current) return
    if (isVideoInView) {
      videoRef.current.play?.().catch(() => {})
    } else {
      videoRef.current.pause?.()
    }
  }, [isVideoInView, isVideoMedia])

  const navigate = useNavigate()

const showToast = useShowToast()

 console.log({"postby":postedBy})

  // Debug: Log when post prop changes (CRITICAL for debugging re-renders)
  useEffect(() => {
    console.log('🔥🔥🔥 [Post] ============ COMPONENT RE-RENDER ============')
    console.log('🔥 [Post] Timestamp:', new Date().toISOString())
    console.log('🔥 [Post] Post ID:', post?._id)
    console.log('🔥 [Post] isCollaborative:', post?.isCollaborative)
    console.log('🔥 [Post] Contributors count:', post?.contributors?.length)
    if (post?.contributors) {
      console.log('🔥 [Post] Contributors:', JSON.stringify(post.contributors.map(c => ({
        id: (c._id || c)?.toString()?.substring(0, 8),
        name: c.name,
        username: c.username
      })), null, 2))
    }
  }, [post]) // Triggered whenever the post prop changes
  
  // Debug: Log collaborative post data (with key to force re-render detection)
  useEffect(() => {
    if (post?.isCollaborative) {
      const contributorsKey = post.contributors?.map(c => (c?._id || c)?.toString()).join(',')
      console.log('🔵 [Post] Collaborative Post Data UPDATE:', {
        postId: post._id?.substring(0, 8),
        isCollaborative: post.isCollaborative,
        contributorsCount: post.contributors?.length,
        contributorsKey: contributorsKey?.substring(0, 20),
        contributorsData: post.contributors?.map(c => ({
          id: (c?._id || c)?.toString()?.substring(0, 8),
          name: c?.name,
          username: c?.username,
          hasProfilePic: !!c?.profilePic
        })),
        ownerId: (post.postedBy?._id || post.postedBy)?.toString()?.substring(0, 8),
        ownerName: post.postedBy?.name || postedBy?.name
      })
    }
  }, [post?.isCollaborative, post?.contributors, post?._id]) // Added post._id to force re-run

  const{user}=useContext(UserContext)
  const{followPost,setFollowPost}=useContext(PostContext)
  const { isOpen: isAddContributorOpen, onOpen: onAddContributorOpen, onClose: onAddContributorClose } = useDisclosure()
  const { isOpen: isManageContributorsOpen, onOpen: onManageContributorsOpen, onClose: onManageContributorsClose } = useDisclosure()
  const { isOpen: isEditPostOpen, onOpen: onEditPostOpen, onClose: onEditPostClose } = useDisclosure()
  
  // Color modes
  const cardBg = useColorModeValue('white', '#252b3b')
  const borderColor = useColorModeValue('#e1e4ea', '#2d3548')
  const textColor = useColorModeValue('gray.800', 'white')
  const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
  // Each live match is its own raised card (visually separate from the post body, like mobile units)
  const footballMatchCardBg = useColorModeValue('white', '#1e2433')
  const footballMatchCardBorder = useColorModeValue('gray.200', 'gray.600')
  
  // Football feed card (same idea as mobile: live list from API, post.footballData as fallback)
  const isFootballPost = postedBy?.username === 'Football'
  
  // Check if this is a Weather post
  const isWeatherPost = postedBy?.username === 'Weather' && post?.weatherData
  
  // Check if this is a Weather onboarding post
  const isWeatherOnboarding = post?.weatherOnboarding === true
  
  // Check if this is a Chess game post
  const isChessPost = post?.chessGameData
  
  // Hide entire chess post immediately if user canceled their game (local state only)
  const [hideChessPost, setHideChessPost] = useState(false)
  
  useEffect(() => {
    if (!isChessPost || !user?._id) return
    
    let chessGameData = null
    try {
      chessGameData = JSON.parse(post.chessGameData)
    } catch (e) {
      return
    }
    
    // Check if this is the current user's game
    const player1Id = chessGameData?.player1?._id?.toString()
    const player2Id = chessGameData?.player2?._id?.toString()
    const currentUserId = user._id.toString()
    const isMyGame = (player1Id === currentUserId || player2Id === currentUserId)
    
    if (isMyGame) {
      // Check if game is still live in localStorage
      const gameLive = localStorage.getItem('gameLive') === 'true'
      const roomId = localStorage.getItem('chessRoomId')
      const postRoomId = chessGameData?.roomId
      
      // If game is not live or roomId doesn't match, hide the entire post immediately
      if (!gameLive || roomId !== postRoomId) {
        setHideChessPost(true)
      } else {
        setHideChessPost(false)
      }
    }
  }, [isChessPost, post?.chessGameData, user?._id])
  
  // Also listen for localStorage changes (when game ends)
  useEffect(() => {
    if (!isChessPost || !user?._id) return
    
    const checkGameStatus = () => {
      let chessGameData = null
      try {
        chessGameData = JSON.parse(post.chessGameData)
      } catch (e) {
        return
      }
      
      const player1Id = chessGameData?.player1?._id?.toString()
      const player2Id = chessGameData?.player2?._id?.toString()
      const currentUserId = user._id.toString()
      const isMyGame = (player1Id === currentUserId || player2Id === currentUserId)
      
      if (isMyGame) {
        const gameLive = localStorage.getItem('gameLive') === 'true'
        const roomId = localStorage.getItem('chessRoomId')
        const postRoomId = chessGameData?.roomId
        
        if (!gameLive || roomId !== postRoomId) {
          setHideChessPost(true)
        }
      }
    }
    
    // Check immediately
    checkGameStatus()
    
    // Listen for storage events (when localStorage changes in other tabs/windows)
    window.addEventListener('storage', checkGameStatus)
    
    // Also check periodically (in case localStorage changes in same tab)
    const interval = setInterval(checkGameStatus, 500)
    
    return () => {
      window.removeEventListener('storage', checkGameStatus)
      clearInterval(interval)
    }
  }, [isChessPost, post?.chessGameData, user?._id])
  
  // Debug Al Jazeera posts
  if (postedBy?.username === 'AlJazeera') {
    console.log('🔴 Al Jazeera Post Data:', {
      username: postedBy.username,
      hasImg: !!post?.img,
      imgUrl: post?.img,
      isYouTube: post?.img?.includes('youtube')
    })
  }
  
  const [matchesData, setMatchesData] = useState([])
  const [footballApiMatches, setFootballApiMatches] = useState([])
  const [footballLoading, setFootballLoading] = useState(false)
  const [weatherDataArray, setWeatherDataArray] = useState([])
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [showFullText, setShowFullText] = useState(false)
  const textRef = React.useRef(null)
  const [shouldTruncate, setShouldTruncate] = useState(false)
  
  // Parse initial football data (use API time directly, no client-side calculation)
  useEffect(() => {
    if (isFootballPost && post?.footballData) {
      try {
        const parsed = JSON.parse(post.footballData)
        setMatchesData(Array.isArray(parsed) ? parsed : parsed ? [parsed] : [])
      } catch (e) {
        console.error('Failed to parse football data:', e)
        setMatchesData([])
      }
    } else {
      setMatchesData([])
    }
  }, [post?.footballData, isFootballPost])

  const fetchFootballLiveMatches = useCallback(async (silent = false) => {
    if (!isFootballPost) return
    try {
      if (!silent) setFootballLoading(true)
      const today = new Date().toISOString().split('T')[0]
      const res = await fetch(
        `${apiBaseUrl()}/api/football/matches?status=live&date=${today}`,
        { credentials: 'include' }
      )
      const data = await res.json().catch(() => ({}))
      const raw = Array.isArray(data.matches) ? data.matches : []
      setFootballApiMatches(raw)
    } catch (e) {
      console.error('⚽ [Post] Failed to fetch live matches:', e)
    } finally {
      if (!silent) setFootballLoading(false)
    }
  }, [isFootballPost])

  useEffect(() => {
    if (!isFootballPost) {
      setFootballApiMatches([])
      setFootballLoading(false)
      return
    }
    fetchFootballLiveMatches(false)
  }, [isFootballPost, post?._id, fetchFootballLiveMatches])

  const footballDisplayMatches = useMemo(() => {
    if (!isFootballPost) return []
    if (footballApiMatches.length > 0) {
      return footballApiMatches
        .map(normalizeDbMatchForFootballFeed)
        .filter(Boolean)
        .filter(isFootballMatchLive)
    }
    return (matchesData || []).filter(isFootballMatchLive)
  }, [isFootballPost, footballApiMatches, matchesData])

  // Parse weather data and fetch user's personalized cities
  useEffect(() => {
    if (!isWeatherPost || !post?.weatherData) {
      setWeatherDataArray([])
      setWeatherLoading(false)
      return
    }
    
    const loadPersonalizedWeather = async (forceRefresh = false) => {
      setWeatherLoading(true)
      
      // Don't show default data immediately - check preferences first
      setWeatherDataArray([])
      
      try {
        // First, try to load user's selected cities
        if (user?._id) {
          const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
          const prefsRes = await fetch(`${baseUrl}/api/weather/preferences`, {
            credentials: 'include'
          })
          const prefsData = await prefsRes.json()
          
          console.log('🌤️ [Post] User preferences:', prefsData.cities?.length || 0, 'cities', prefsData.cities?.map(c => c.name))
          
          // If user has selected cities, fetch weather for those cities (don't show default)
          if (prefsRes.ok && prefsData.cities && prefsData.cities.length > 0) {
            console.log('🌤️ [Post] Loading personalized weather for', prefsData.cities.length, 'cities:', prefsData.cities.map(c => c.name))
            
            // Check memory cache first (shared with WeatherPage) - skip if force refresh
            const cacheKey = JSON.stringify(prefsData.cities.map(c => `${c.name}-${c.country}`).sort())
            const now = Date.now()
            
            if (!forceRefresh) {
            // Check if we have cached data in memory (from WeatherPage)
            if (window.weatherCache && 
                window.weatherCache.preferences === cacheKey &&
                window.weatherCache.timestamp && 
                (now - window.weatherCache.timestamp) < (5 * 60 * 1000)) {
              console.log('💾 [Post] Using memory cached weather data', window.weatherCache.data)
              
              // Handle different cache formats - WeatherPage saves Weather model format
              let formattedWeather = []
              
              if (window.weatherCache.data && Array.isArray(window.weatherCache.data)) {
                formattedWeather = window.weatherCache.data.map(w => {
                  // Check if it's already in display format (has city directly)
                  if (w.city && typeof w.city === 'string' && (w.temperature !== undefined || w.temperature !== null)) {
                    return w
                  }
                  // Convert from Weather model format (what WeatherPage saves)
                  return {
                    city: w.location?.city || w.city,
                    country: w.location?.country || w.country,
                    temperature: w.current?.temperature !== undefined && w.current?.temperature !== null 
                      ? w.current.temperature 
                      : (w.temperature !== undefined && w.temperature !== null ? w.temperature : null),
                    condition: w.current?.condition?.main || w.condition,
                    description: w.current?.condition?.description || w.description,
                    icon: w.current?.condition?.icon || w.icon,
                    humidity: w.current?.humidity !== undefined ? w.current.humidity : w.humidity,
                    windSpeed: w.current?.windSpeed !== undefined ? w.current.windSpeed : w.windSpeed
                  }
                }).filter(w => w.city && w.temperature !== undefined && w.temperature !== null && typeof w.temperature === 'number')
              }
              
              console.log('💾 [Post] Formatted weather from memory cache:', formattedWeather)
              
              if (formattedWeather.length > 0) {
                setWeatherDataArray(formattedWeather)
                setWeatherLoading(false)
                return
              } else {
                console.log('⚠️ [Post] Memory cache found but no valid weather items after formatting')
              }
            }
              
              // Check localStorage cache
              try {
                const cached = localStorage.getItem(`weatherCache_${cacheKey}`)
                if (cached) {
                  const parsed = JSON.parse(cached)
                  console.log('💾 [Post] Raw cached data:', parsed)
                  
                  if (parsed.timestamp && (now - parsed.timestamp) < (5 * 60 * 1000)) {
                    console.log('💾 [Post] Using localStorage cached weather data', parsed.data)
                    
                    // Handle different cache formats - WeatherPage saves Weather model format
                    let formattedWeather = []
                    
                    if (parsed.data && Array.isArray(parsed.data)) {
                      console.log('💾 [Post] Cached data array length:', parsed.data.length)
                      
                      formattedWeather = parsed.data.map(w => {
                        // Weather model format (from WeatherPage): { location: {city, country}, current: {temperature, condition: {...}, ...} }
                        // Display format: { city, country, temperature, condition, description, icon, humidity, windSpeed }
                        
                        // Check if it's already in display format (has city directly)
                        if (w.city && typeof w.city === 'string' && (w.temperature !== undefined || w.temperature !== null)) {
                          console.log('💾 [Post] Item already in display format:', w)
                          return w
                        }
                        
                        // Convert from Weather model format (what WeatherPage saves)
                        const formatted = {
                          city: w.location?.city || w.city,
                          country: w.location?.country || w.country,
                          temperature: w.current?.temperature !== undefined && w.current?.temperature !== null 
                            ? w.current.temperature 
                            : (w.temperature !== undefined && w.temperature !== null ? w.temperature : null),
                          condition: w.current?.condition?.main || w.condition,
                          description: w.current?.condition?.description || w.description,
                          icon: w.current?.condition?.icon || w.icon,
                          humidity: w.current?.humidity !== undefined ? w.current.humidity : w.humidity,
                          windSpeed: w.current?.windSpeed !== undefined ? w.current.windSpeed : w.windSpeed
                        }
                        
                        console.log('💾 [Post] Converted from Weather model:', { original: w, formatted })
                        return formatted
                      }).filter(w => {
                        const isValid = w.city && w.temperature !== undefined && w.temperature !== null && typeof w.temperature === 'number'
                        if (!isValid) {
                          console.warn('⚠️ [Post] Filtered out invalid item:', w, {
                            hasCity: !!w.city,
                            hasTemp: w.temperature !== undefined,
                            tempNotNull: w.temperature !== null,
                            tempIsNumber: typeof w.temperature === 'number'
                          })
                        }
                        return isValid
                      })
                    }
                    
                    console.log('💾 [Post] Final formatted weather from cache:', formattedWeather, 'Length:', formattedWeather.length)
                    
                    if (formattedWeather.length > 0) {
                      setWeatherDataArray(formattedWeather)
                      setWeatherLoading(false)
                      return
                    } else {
                      console.warn('⚠️ [Post] Cached data found but no valid weather items after formatting. Raw data:', parsed.data)
                    }
                  } else {
                    console.log('⚠️ [Post] Cached data expired or invalid timestamp')
                  }
                } else {
                  console.log('⚠️ [Post] No cached data found for key:', `weatherCache_${cacheKey}`)
                }
              } catch (e) {
                console.error('❌ Error reading localStorage cache:', e, e.stack)
              }
            } else {
              console.log('🔄 [Post] Force refresh - skipping cache')
            }
            
            // First try to get cached weather from database
            try {
              const cacheRes = await fetch(`${baseUrl}/api/weather?limit=50`, {
                credentials: 'include'
              })
              const cachedWeather = await cacheRes.json()
              
              if (cacheRes.ok && cachedWeather.weather && cachedWeather.weather.length > 0) {
                const cityNames = prefsData.cities.map(c => c.name)
                const matchingCached = cachedWeather.weather.filter(w => 
                  cityNames.includes(w.location?.city)
                )
                
                if (matchingCached.length > 0) {
                  console.log('✅ [Post] Found', matchingCached.length, 'cached cities from database', matchingCached)
                  const formattedWeather = matchingCached.map(w => ({
                    city: w.location?.city,
                    country: w.location?.country,
                    temperature: w.current?.temperature,
                    condition: w.current?.condition?.main,
                    description: w.current?.condition?.description,
                    icon: w.current?.condition?.icon,
                    humidity: w.current?.humidity,
                    windSpeed: w.current?.windSpeed
                  })).filter(w => w.city && w.temperature !== undefined && w.temperature !== null)
                  
                  console.log('✅ [Post] Formatted weather from database:', formattedWeather)
                  
                  if (formattedWeather.length > 0) {
                    setWeatherDataArray(formattedWeather)
                    
                    // Update memory cache for future use
                    if (!window.weatherCache) window.weatherCache = {}
                    window.weatherCache.data = matchingCached
                    window.weatherCache.timestamp = now
                    window.weatherCache.preferences = cacheKey
                    
                    setWeatherLoading(false)
                    return
                  } else {
                    console.log('⚠️ [Post] Database cache found but no valid weather items after formatting')
                  }
                }
              }
            } catch (cacheError) {
              console.error('❌ [Post] Error checking cache:', cacheError)
            }
            
            // If not cached, fetch from API (limit to 5 cities to avoid too many API calls)
            console.log('🌤️ [Post] No cache found, fetching from API for first 5 cities...')
            const citiesToFetch = prefsData.cities.slice(0, 5)
            const fetchedWeather = []
            
            for (let i = 0; i < citiesToFetch.length; i++) {
              const city = citiesToFetch[i]
              // Add delay to avoid rate limiting (except first one)
              if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1100))
              }
              
              try {
                const weatherRes = await fetch(
                  `${baseUrl}/api/weather/forecast?lat=${city.lat}&lon=${city.lon}`,
                  { credentials: 'include' }
                )
                const weatherResponse = await weatherRes.json()
                
                if (weatherRes.ok && weatherResponse.weather) {
                  const w = weatherResponse.weather
                  const weatherItem = {
                    city: w.location?.city || city.name,
                    country: w.location?.country || city.country,
                    temperature: w.current?.temperature,
                    condition: w.current?.condition?.main,
                    description: w.current?.condition?.description,
                    icon: w.current?.condition?.icon,
                    humidity: w.current?.humidity,
                    windSpeed: w.current?.windSpeed
                  }
                  
                  console.log(`🌤️ [Post] Fetched weather for ${city.name}:`, weatherItem)
                  
                  if (weatherItem.temperature !== undefined && weatherItem.temperature !== null) {
                    fetchedWeather.push(weatherItem)
                  } else {
                    console.warn(`⚠️ [Post] Invalid temperature for ${city.name}:`, weatherItem.temperature)
                  }
                }
              } catch (error) {
                console.error(`❌ Error fetching weather for ${city.name}:`, error)
              }
            }
            
            if (fetchedWeather.length > 0) {
              console.log('✅ [Post] Loaded personalized weather for', fetchedWeather.length, 'cities:', fetchedWeather)
              // Filter out any invalid items just to be safe
              const validWeather = fetchedWeather.filter(w => 
                w.city && 
                w.temperature !== undefined && 
                w.temperature !== null
              )
              
              if (validWeather.length > 0) {
                console.log('✅ [Post] Setting', validWeather.length, 'valid weather items')
                setWeatherDataArray(validWeather)
              
                // Update memory cache for future use (store in display format for easier retrieval)
                if (!window.weatherCache) window.weatherCache = {}
                window.weatherCache.data = validWeather
                window.weatherCache.timestamp = Date.now()
                window.weatherCache.preferences = cacheKey
                
                // Also save to localStorage in display format
                try {
                  localStorage.setItem(`weatherCache_${cacheKey}`, JSON.stringify({
                    data: validWeather,
                    timestamp: Date.now()
                  }))
                  console.log('💾 [Post] Saved', validWeather.length, 'weather items to cache')
                } catch (e) {
                  console.error('Error saving to localStorage cache:', e)
                }
                
                setWeatherLoading(false)
                return
              } else {
                console.log('⚠️ [Post] Fetched weather but no valid items after filtering')
              }
            } else {
              console.log('⚠️ [Post] No weather fetched from API')
              // Don't show default if user has preferences - keep it empty or show loading
              // User's cities might not have weather data yet, but don't fallback to default
            }
          } else {
            // User has no selected cities - show default from post
            console.log('🌤️ [Post] No user preferences found, showing default cities')
            try {
              const defaultParsed = JSON.parse(post.weatherData)
              if (Array.isArray(defaultParsed) && defaultParsed.length > 0) {
                setWeatherDataArray(defaultParsed)
              }
            } catch (e) {
              console.error('Failed to parse default weather data:', e)
            }
          }
        } else {
          // No user logged in - show default
          console.log('🌤️ [Post] No user logged in, showing default cities')
          try {
            const defaultParsed = JSON.parse(post.weatherData)
            if (Array.isArray(defaultParsed) && defaultParsed.length > 0) {
              setWeatherDataArray(defaultParsed)
            }
          } catch (e) {
            console.error('Failed to parse default weather data:', e)
          }
        }
      } catch (e) {
        console.error('❌ Failed to load weather data:', e)
        // Only show default on error if user has no preferences
        // If user has preferences but fetch failed, don't show default
        try {
          const defaultParsed = JSON.parse(post.weatherData)
          if (Array.isArray(defaultParsed) && defaultParsed.length > 0) {
            setWeatherDataArray(defaultParsed)
          }
        } catch (parseError) {
          console.error('Failed to parse default weather data:', parseError)
        }
      } finally {
        setWeatherLoading(false)
      }
    }
    
    loadPersonalizedWeather()
    
    // Listen for preference updates
    const handlePreferencesUpdate = () => {
      console.log('🌤️ [Post] Preferences updated event received, reloading weather...')
      // Clear cache and reload with force refresh
      if (window.weatherCache) {
        window.weatherCache.data = null
        window.weatherCache.timestamp = null
        window.weatherCache.preferences = null
      }
      // Clear localStorage cache for all keys
      try {
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('weatherCache_')) {
            localStorage.removeItem(key)
          }
        })
      } catch (e) {
        console.error('Error clearing localStorage cache:', e)
      }
      // Force refresh to fetch fresh data
      loadPersonalizedWeather(true)
    }
    
    window.addEventListener('weatherPreferencesUpdated', handlePreferencesUpdate)
    
    return () => {
      window.removeEventListener('weatherPreferencesUpdated', handlePreferencesUpdate)
    }
  }, [post?.weatherData, isWeatherPost, user?._id])
  
  // Same as mobile Post: refresh live list from API on socket (feed + cards stay in sync)
  useEffect(() => {
    if (!isFootballPost) return
    const refresh = () => {
      fetchFootballLiveMatches(true)
    }
    window.addEventListener('footballMatchUpdate', refresh)
    window.addEventListener('footballPageUpdate', refresh)
    return () => {
      window.removeEventListener('footballMatchUpdate', refresh)
      window.removeEventListener('footballPageUpdate', refresh)
    }
  }, [isFootballPost, fetchFootballLiveMatches])
  
  let chessGameData = null
  if (isChessPost) {
    try {
      chessGameData = JSON.parse(post.chessGameData)
    } catch (e) {
      console.error('Failed to parse chess game data:', e)
    }
  }
  
  const handleChessPostClick = (e) => {
    // CRITICAL: Stop all event propagation immediately - MUST be first
    if (e) {
      e.preventDefault()
      e.stopPropagation()
      if (e.nativeEvent) {
        e.nativeEvent.stopImmediatePropagation()
      }
    }
    
    if (import.meta.env.DEV) {
      console.log('🎯 [Post] Chess card clicked!', { chessGameData, event: e })
    }
    
    if (!chessGameData) {
      if (import.meta.env.DEV) {
        console.error('❌ [Post] No chessGameData!')
      }
      return
    }
    
    // Navigate to chess page to view/spectate
    // Determine which player to use based on current user
    const currentUserId = user?._id?.toString()
    const player1Id = chessGameData.player1?._id
    const player2Id = chessGameData.player2?._id
    
    let opponentIdToUse = player1Id // Default to player1
    
    // If current user is player1, navigate to player2 (to view as player1)
    if (currentUserId === player1Id) {
      opponentIdToUse = player2Id
    }
    // If current user is player2, navigate to player1 (to view as player2)
    else if (currentUserId === player2Id) {
      opponentIdToUse = player1Id
    }
    // If current user is neither (spectator), use player1 to view the game
    else {
      opponentIdToUse = player1Id
    }
    
      // Get roomId from chessGameData for spectators
      const roomId = chessGameData.roomId
      
      if (import.meta.env.DEV) {
        console.log('🎯 [Post] Navigating to chess page:', `/chess/${opponentIdToUse}`, {
          currentUserId,
          player1Id,
          player2Id,
          opponentIdToUse,
          roomId
        })
      }
      
      if (opponentIdToUse) {
        // Pass roomId as URL param for spectator mode
        const chessUrl = roomId 
          ? `/chess/${opponentIdToUse}?roomId=${roomId}&spectator=true`
          : `/chess/${opponentIdToUse}`
        
        // Use setTimeout to ensure navigation happens after event is fully stopped
        setTimeout(() => {
          navigate(chessUrl, { replace: false })
        }, 0)
      }
    
    // Return false to prevent any default behavior
    return false
  }

  const handleDeletepost = async(e) => {
    e.preventDefault()

    try{
    if(!window.confirm("Are you sure you want to delete this post"))return
   
    const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/${post._id}`,{
      credentials:"include",
      method:"DELETE"
    })
   
    const data = await res.json()

     if(res.ok){
      // Remove post from the feed
      setFollowPost(followPost.filter((p) => p._id !== post._id))
      
      // Call onDelete callback if provided (for UserPage to update local state)
      if (onDelete) {
        onDelete(post._id)
      }
      
      showToast("Success","POST deleted","success")
     } else {
      showToast("Error", data.error || "Failed to delete post", "error")
     }
    }
    catch(error){
      console.log(error)
      showToast("Error","Failed to delete post","error")
    }
  }
   
  
  
  // Check if this is a channel post (system account with YouTube embed or channel post)
  const isChannelPost = post?.img?.includes('youtube.com/embed') || 
                        post?.channelAddedBy || 
                        ['Football', 'AlJazeera', 'NBCNews', 'BeinSportsNews', 'SkyNews', 'Cartoonito', 
                         'NatGeoKids', 'SciShowKids', 'JJAnimalTime', 'KidsArabic', 'NatGeoAnimals', 
                         'MBCDrama', 'Fox11'].includes(postedBy?.username)
  
  const handleAvatarOrNameClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    // If it's Football channel, navigate to Football page
    if (postedBy?.username === 'Football') {
      navigate('/football')
    } 
    // If it's another channel post, navigate to post page instead of profile
    else if (isChannelPost && post?._id) {
      navigate(`/${postedBy?.username}/post/${post._id}`)
    } else {
      navigate(`/${postedBy?.username}`)
    }
  }
  
  const postContent = (
    <Flex gap={3}  mb="4" py={5}>
        
        
        <Flex flexDirection="column" alignItems="center">
           
            {postedBy?.username === 'Football' ? (
              <Box onClick={handleAvatarOrNameClick} cursor="pointer">
                <FootballIcon size="48px" />
              </Box>
            ) : (
            <Avatar 
              size="md" 
              src={postedBy?.profilePic} 
              name={postedBy?.name}
              loading="lazy"
                cursor="pointer"
                onClick={handleAvatarOrNameClick}
              />
            )}
           
            <Box w="1px" h="full" bg="gray.light" my="2"></Box>
       
      
       <Box position="relative" w="full">
       
      {post?.replies?.length === 0 && <Text textAlign="center">🥱</Text>}
      
       {post.replies[0] && (
          <Avatar 
        src={post?.replies[0]?.userProfilePic}
        size="sm" name={post?.replies[0]?.username} position="absolute" top="0px" left="15px" padding="2px"/>
       )}
      
         
         {post.replies[1] && (
          <Avatar 
        src={post?.replies[1]?.userProfilePic}
        size="sm" name={post?.replies[1]?.username} position="absolute" bottom="0px" right="-5px" padding="2px"/>
         )}
       
       
        {post?.replies[2] &&(
        <Avatar 
        src={post?.replies[2]?.userProfilePic}
        size="sm" name={post?.replies[2]?.username} bottom="0px" left="4px" padding="2px"/>
        )}
       
        
       </Box>
       
        
      
        </Flex>
    
    
   <Flex flex={1} flexDirection="column" gap={2}>
     <Flex justifyContent="space-between" w="full">
     <Flex w="full" alignItems="center">
       
        <Text 
          fontSize="sm" 
          fontWeight="bold" 
          onClick={handleAvatarOrNameClick}
          cursor="pointer"
        >
         {postedBy?.name}
         </Text>
      
        <Image src="/verified.png" w={4} h={4} ml={1} />
     </Flex>
    
    
    
     <Flex alignItems="center" gap={2}>
        {/* Timestamp: relative on top, Edited on second line if needed */}
        {(() => {
          const createdAt = post?.createdAt ? new Date(post.createdAt) : null
          const updatedAt = post?.updatedAt ? new Date(post.updatedAt) : null
          const createdOk = createdAt && !Number.isNaN(createdAt.getTime())
          const updatedOk = updatedAt && !Number.isNaN(updatedAt.getTime())
          const isEdited =
            createdOk &&
            updatedOk &&
            Math.abs(updatedAt.getTime() - createdAt.getTime()) > 60 * 1000

          if (!createdOk) return null

          return (
            <Flex direction="column" alignItems="flex-end" gap={0}>
              <Text fontSize="sm" color="gray.light" textAlign="right" whiteSpace="nowrap">
                {formatDistanceToNow(createdAt)} ago
              </Text>
              {isEdited && (
                <Text fontSize="xs" color="gray.light" textAlign="right" whiteSpace="nowrap">
                  · Edited {format(updatedAt, 'PP p')}
                </Text>
              )}
            </Flex>
          )
        })()}

         {/* Show delete button if user is post author OR user added this channel post */}
         {(user?._id === postedBy?._id || (post?.channelAddedBy && post.channelAddedBy === user?._id?.toString())) && (
           <MdOutlineDeleteOutline 
             onClick={handleDeletepost}
             cursor="pointer"
             color={useColorModeValue('gray.600', 'gray.400')}
             _hover={{ color: 'red.500' }}
           />
         )}
     </Flex>
   
  
    </Flex>
    
    {/* Collaborative Post Badge */}
    {post?.isCollaborative && (
      <Flex 
        align="center" 
        gap={2} 
        mb={2} 
        p={2} 
        bg={useColorModeValue('blue.50', 'blue.900')} 
        borderRadius="md"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <Text fontSize="xs">🤝</Text>
        <Text fontSize="xs" color={secondaryTextColor}>
          Collaborative Post
        </Text>
        {post?.contributors && Array.isArray(post.contributors) && post.contributors.length > 0 && (() => {
          console.log('🟢🟢🟢 [Post] ============ RENDERING CONTRIBUTORS BADGE ============')
          console.log('🟢 [Post] Contributors array length:', post.contributors.length)
          console.log('🟢 [Post] Full contributors array:', JSON.stringify(post.contributors, null, 2))
          
          // Filter out the owner from contributors list for display (owner is shown separately)
          // Handle both cases: postedBy as object with _id, or as direct ID
          const ownerId = postedBy?._id?.toString() || post.postedBy?._id?.toString() || post.postedBy?.toString() || postedBy?.toString()
          console.log('🟢 [Post] Owner ID for filtering:', ownerId)
          console.log('🟢 [Post] postedBy:', postedBy)
          console.log('🟢 [Post] post.postedBy:', post.postedBy)
          
          const displayContributors = post.contributors.filter((contributor) => {
            const contributorId = (contributor?._id || contributor)?.toString()
            const isOwner = contributorId === ownerId
            console.log('🟢 [Post] Checking contributor:', {
              contributorId: contributorId,
              contributorIdShort: contributorId?.substring(0, 8),
              name: contributor?.name,
              username: contributor?.username,
              ownerId: ownerId,
              ownerIdShort: ownerId?.substring(0, 8),
              isOwner: isOwner,
              willInclude: !isOwner
            })
            // Skip if this contributor is the owner
            return contributorId && !isOwner
          }).slice(0, 5)
          
          console.log('🟢🟢🟢 [Post] Display contributors AFTER FILTER:', displayContributors.length)
          console.log('🟢 [Post] Filtered contributors:', JSON.stringify(displayContributors.map(c => ({
            id: (c._id || c)?.toString()?.substring(0, 8),
            name: c.name,
            username: c.username
          })), null, 2))
          
          // If no contributors after filtering (only owner), don't show contributors section
          if (displayContributors.length === 0) {
            console.log('⚠️⚠️⚠️ [Post] NO CONTRIBUTORS TO DISPLAY after filtering (all filtered out)')
            return null
          }
          
          console.log('🟢🟢🟢 [Post] Will display', displayContributors.length, 'contributors')
          
          return (
            <Flex align="center" gap={1} ml="auto" flexWrap="wrap">
              <Text fontSize="xs" color={secondaryTextColor}>
                Contributors:
              </Text>
              {displayContributors.map((contributor, idx) => {
                console.log('🔵 [Post] Rendering contributor avatar:', contributor?.name || contributor?.username)
                // Ensure we have a proper contributor object with populated data
                const contributorId = (contributor?._id || contributor)?.toString()
                const contributorName = contributor?.name || contributor?.username || null
                const contributorUsername = contributor?.username || null
                const contributorProfilePic = contributor?.profilePic || null
                
                // Skip if we don't have enough data to display
                if (!contributorName && !contributorUsername) {
                  console.warn('Contributor missing name/username:', contributor)
                  return null
                }
                
                return (
                  <Tooltip 
                    key={contributorId || contributor?._id || idx} 
                    label={contributorName || contributorUsername || 'Contributor'}
                  >
                    <Box position="relative" display="inline-block">
                      <Avatar
                        src={contributorProfilePic}
                        name={contributorName || contributorUsername || 'C'}
                        size="xs"
                        ml={-1}
                        border="2px solid"
                        borderColor={cardBg}
                        cursor="pointer"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (contributorUsername) {
                            navigate(`/${contributorUsername}`)
                          }
                        }}
                        _hover={{ transform: 'scale(1.1)', zIndex: 10 }}
                        transition="all 0.2s"
                      />
                    </Box>
                  </Tooltip>
                )
              })}
              {post.contributors.length > displayContributors.length + 1 && (
                <Text fontSize="xs" color={secondaryTextColor} ml={1}>
                  +{post.contributors.length - displayContributors.length - 1}
                </Text>
              )}
            </Flex>
          )
        })()}
      </Flex>
    )}
    
     {/* Post text — hide for Football: copy is often stale (“no live matches”) while live cards come from API */}
     <Box>
       {!isFootballPost && (
         <>
           <Text
             ref={textRef}
             noOfLines={shouldTruncate && !showFullText ? 4 : undefined}
             style={{
               wordBreak: 'break-word',
               whiteSpace: 'pre-wrap'
             }}
           >
             {post.text}
           </Text>
           {shouldTruncate && (
             <Button
               size="xs"
               variant="link"
               colorScheme="blue"
               mt={1}
               onClick={() => setShowFullText(!showFullText)}
             >
               {showFullText ? 'Show less' : 'Show more...'}
             </Button>
           )}
         </>
       )}

       {/* Weather Onboarding Button */}
       {isWeatherOnboarding && (
         <Button
           mt={3}
           colorScheme="blue"
           size="md"
           width="full"
           onClick={(e) => {
             e.preventDefault()
             e.stopPropagation()
             navigate('/weather')
           }}
         >
           🌤️ Visit Weather Page
         </Button>
       )}
     </Box>
  
  {/* Football: live list from API (like mobile); post.footballData only if API empty */}
  {isFootballPost && footballLoading && footballDisplayMatches.length === 0 && (
    <Flex justify="center" align="center" py={6} direction="column" gap={2}>
      <Spinner size="sm" color="blue.500" />
      <Text fontSize="sm" color={secondaryTextColor}>
        Loading matches…
      </Text>
    </Flex>
  )}

  {isFootballPost && !footballLoading && footballDisplayMatches.length === 0 && (
    <Box mt={4} mb={2} p={4} borderRadius="xl" borderWidth="1px" borderColor={footballMatchCardBorder} bg={footballMatchCardBg} textAlign="center">
      <Text fontWeight="bold" color={textColor}>⚽ No live matches right now</Text>
      <Text fontSize="sm" color={secondaryTextColor} mt={1}>
        Check back during match hours — or open the Football page for more.
      </Text>
    </Box>
  )}

  {isFootballPost && footballDisplayMatches.length > 0 && (
    <FootballMatchCards
      matches={footballDisplayMatches}
      enableNavigate
      postId={post?._id}
      postedByUsername={postedBy?.username}
    />
  )}
  
  {/* Chess Game Card Display */}
  {isChessPost && chessGameData && (
    <Box
      as="button"
      type="button"
      data-chess-card
      mt={3}
      mb={2}
      bg={cardBg}
      borderRadius="lg"
      border="1px solid"
      borderColor={borderColor}
      p={4}
      cursor="pointer"
      _hover={{ shadow: 'md', borderColor: 'purple.500' }}
      transition="all 0.2s"
      onClick={handleChessPostClick}
      onMouseDown={(e) => {
        // Also stop on mousedown to prevent any Link activation
        e.preventDefault()
        e.stopPropagation()
      }}
      position="relative"
      zIndex={10}
      w="full"
      textAlign="left"
    >
      <Flex align="center" justify="space-between" mb={3}>
        <Flex align="center" gap={3}>
          <Text fontSize="3xl">♟️</Text>
          <VStack align="start" spacing={0}>
            <Text fontSize="sm" fontWeight="bold" color={textColor}>
              Playing Chess
            </Text>
            <Text fontSize="xs" color={secondaryTextColor}>
              Click to view game
            </Text>
          </VStack>
        </Flex>
        <Text fontSize="xs" color="green.500" fontWeight="semibold">
          Live
        </Text>
      </Flex>
      
      <Flex align="center" justify="space-around" gap={4} onClick={(e) => e.stopPropagation()}>
        {/* Player 1 */}
        <VStack spacing={1} onClick={(e) => e.stopPropagation()}>
          <Avatar
            src={chessGameData.player1?.profilePic}
            name={chessGameData.player1?.name}
            size="md"
            pointerEvents="none"
          />
          <Text fontSize="xs" fontWeight="semibold" color={textColor} textAlign="center" pointerEvents="none">
            {chessGameData.player1?.name}
          </Text>
          <Text fontSize="xs" color={secondaryTextColor} pointerEvents="none">
            @{chessGameData.player1?.username}
          </Text>
        </VStack>
        
        <Text fontSize="xl" color={textColor} fontWeight="bold" pointerEvents="none">
          vs
        </Text>
        
        {/* Player 2 */}
        <VStack spacing={1} onClick={(e) => e.stopPropagation()}>
          <Avatar
            src={chessGameData.player2?.profilePic}
            name={chessGameData.player2?.name}
            size="md"
            pointerEvents="none"
          />
          <Text fontSize="xs" fontWeight="semibold" color={textColor} textAlign="center" pointerEvents="none">
            {chessGameData.player2?.name}
          </Text>
          <Text fontSize="xs" color={secondaryTextColor} pointerEvents="none">
            @{chessGameData.player2?.username}
          </Text>
        </VStack>
      </Flex>
    </Box>
  )}
  
  {/* Weather Data Display */}
  {isWeatherPost && (
    <Box mt={3} mb={2}>
      {weatherLoading && weatherDataArray.length === 0 ? (
        <Flex justify="center" py={4}>
          <Text fontSize="sm" color={secondaryTextColor}>Loading weather data...</Text>
        </Flex>
      ) : weatherDataArray.length > 0 ? (
        <VStack spacing={2} align="stretch">
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
            {weatherDataArray.slice(0, 6).map((weather, index) => (
              <Box
                key={index}
                bg={cardBg}
                borderRadius="lg"
                border="1px solid"
                borderColor={borderColor}
                p={3}
                transition="all 0.2s"
                _hover={{ shadow: 'md', transform: 'translateY(-2px)' }}
              >
                <Flex align="center" justify="space-between" mb={2}>
                  <Text fontSize="sm" fontWeight="semibold" color={textColor} noOfLines={1}>
                    {weather.city}, {weather.country}
                  </Text>
                  {weather.icon && (
                    <img 
                      src={`https://openweathermap.org/img/wn/${weather.icon}@2x.png`} 
                      alt={weather.condition || 'weather'}
                      style={{ width: '40px', height: '40px', flexShrink: 0 }}
                      loading="lazy"
                    />
                  )}
                </Flex>
                <Text fontSize="xl" fontWeight="bold" color={textColor}>
                  {weather.temperature}°C
                </Text>
                <Text fontSize="xs" color={secondaryTextColor} textTransform="capitalize" mt={1} noOfLines={1}>
                  {weather.description || weather.condition}
                </Text>
                <Flex justify="space-between" mt={2} fontSize="xs" color={secondaryTextColor}>
                  <HStack spacing={1}>
                    <Text>💧</Text>
                    <Text fontWeight="semibold">{weather.humidity}%</Text>
                  </HStack>
                  <HStack spacing={1}>
                    <Text>💨</Text>
                    <Text fontWeight="semibold">{weather.windSpeed?.toFixed(1) || '0.0'} m/s</Text>
                  </HStack>
                </Flex>
              </Box>
            ))}
          </SimpleGrid>
        </VStack>
      ) : (
        <Text fontSize="sm" color={secondaryTextColor} textAlign="center" py={2}>
          No weather data available
        </Text>
      )}
    </Box>
  )}
  
  {post?.img && !isFootballPost && !isWeatherPost && !isChessPost && (
    <Box borderRadius={4} overflow="hidden" border="0.5px solid" borderColor="gray.light" my={2}>
      {/* YouTube Embed (Al Jazeera Live or any YouTube video) */}
      {(() => {
        const isYouTube = post.img.includes('youtube.com/embed') || post.img.includes('youtu.be')
        console.log('🎬 Checking media type:', {
          url: post.img,
          isYouTube,
          username: postedBy?.username
        })
        return isYouTube
      })() ? (
        <Box position="relative" paddingBottom="56.25%" height="0" overflow="hidden">
          <iframe
            src={post.img}
            title="Live Stream"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              border: 'none'
            }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </Box>
      ) : post.img.match(/\.(mp4|webm|ogg|mov)$/i) || post.img.includes('/video/upload/') ? (
        <Box
          as="video"
          ref={videoRef}
          src={optimizedVideoUrl}
          controls
          autoPlay={visibleVideoOnly ? isVideoInView : true}
          muted
          playsInline
          loop
          w="full"
          maxH="400px"
          onLoadedData={(e) => {
            // Ensure video plays when loaded (some browsers need this)
            if (visibleVideoOnly && !isVideoInView) return
            e.target.play().catch(err => {
              console.log('Video autoplay prevented:', err)
            })
          }}
        />
      ) : (
        <Image 
          src={optimizedImageUrl} 
          w="full" 
          objectFit="contain" 
          maxH="400px"
          loading="lazy"
          alt="Post image"
        />
      )}
    </Box>
  )}
  
  
  <Flex gap={2} my={1} align="center" flexWrap="wrap">
    <Actions post={post}/>
    
    {/* Edit Post Button - Show for:
        1. Post owner (for both regular and collaborative posts)
        2. Contributors (for collaborative posts only)
    */}
    {(() => {
      const isOwner = user?._id?.toString() === postedBy?._id?.toString()
      const isContributor = post?.isCollaborative && post?.contributors && Array.isArray(post.contributors) && 
        post.contributors.some(c => (c._id || c).toString() === user?._id?.toString())
      const canEdit = isOwner || isContributor
      
      console.log('🔵 [Post] Edit button check:', {
        postId: post?._id?.substring(0, 8),
        isOwner: isOwner,
        isContributor: isContributor,
        canEdit: canEdit,
        userId: user?._id?.toString()?.substring(0, 8),
        postedById: postedBy?._id?.toString()?.substring(0, 8),
        contributorsArray: post?.contributors?.map(c => ({
          id: (c._id || c)?.toString()?.substring(0, 8),
          name: c?.name
        }))
      })
      
      if (!canEdit) return null
      
      return (
        <Flex align="center" gap={2} flexWrap="wrap">
        <Button
          size="xs"
          variant="outline"
          colorScheme="blue"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onEditPostOpen()
          }}
        >
          ✏️ Edit Post
        </Button>
        
        {/* Collaborative Post Actions - Only show for collaborative posts */}
        {(() => {
          const isOwner = user?._id?.toString() === postedBy?._id?.toString()
          const isContributor = post?.isCollaborative && post?.contributors && Array.isArray(post.contributors) &&
            post.contributors.some(c => (c._id || c).toString() === user?._id?.toString())
          const isCollab = post?.isCollaborative
          const hasContributors = post?.contributors && Array.isArray(post.contributors) && post.contributors.length > 0
          
          console.log('🔵 [Post] Collaborative actions check:', {
            postId: post?._id?.substring(0, 8),
            isCollaborative: isCollab,
            isOwner: isOwner,
            hasContributors: hasContributors,
            contributorsCount: post?.contributors?.length,
            userId: user?._id?.toString(),
            postedById: postedBy?._id?.toString(),
            userIdMatch: user?._id?.toString() === postedBy?._id?.toString()
          })
          
          if (!isCollab) {
            console.log('⚠️ [Post] Not a collaborative post, hiding actions')
            return null
          }
          
          return (
            <>
              <Button
                size="xs"
                variant="outline"
                colorScheme="blue"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onAddContributorOpen()
                }}
              >
                + Add Contributor
              </Button>
              
              {/* Manage Contributors Menu (only for owner of collaborative post) */}
              {(() => {
                console.log('🔵 [Post] Three-dot menu check:', {
                  isOwner: isOwner,
                  isContributor: isContributor,
                  hasContributors: hasContributors,
                  willShow: (isOwner || isContributor) && hasContributors
                })
                
                if (!isOwner && !isContributor) {
                  console.log('⚠️ [Post] User is not owner/contributor, hiding three dots')
                  return null
                }
                
                if (!hasContributors) {
                  console.log('⚠️ [Post] No contributors yet, hiding three dots')
                  return null
                }
                
                console.log('✅ [Post] Showing three-dot menu!')
                return (
                <Menu>
                  <MenuButton
                    as={IconButton}
                    icon={<BsThreeDotsVertical />}
                    size="xs"
                    variant="ghost"
                    aria-label="Manage contributors"
                  />
                  <MenuList zIndex={1500}>
                    <MenuItem
                      icon={<MdPersonRemove />}
                      onClick={() => {
                        console.log('🔵 [Post] Manage Contributors clicked!')
                        onManageContributorsOpen()
                      }}
                    >
                      Manage Contributors
                    </MenuItem>
                  </MenuList>
                </Menu>
                )
              })()}
            </>
          )
        })()}
      </Flex>
      )
    })()}
    
    {/* Add Contributor Modal */}
    <AddContributorModal
      isOpen={isAddContributorOpen}
      onClose={onAddContributorClose}
      post={(() => {
        console.log('🔵 [Post] Passing post to AddContributorModal:', {
          postId: post?._id?.substring(0, 8),
          isCollaborative: post?.isCollaborative,
          contributorsCount: post?.contributors?.length
        })
        return post
      })()}
      onContributorAdded={(updatedPost) => {
        console.log('🔥🔥🔥 [Post] ============ onContributorAdded CALLBACK TRIGGERED ============')
        console.log('🔥🔥🔥 [Post] Timestamp:', new Date().toISOString())
        console.log('🔥 [Post] Updated post received:', updatedPost ? 'YES' : 'NO')
        console.log('🔥 [Post] Current post._id:', post._id)
        
        if (updatedPost) {
          console.log('🔥🔥🔥 [Post] UPDATED POST DATA:')
          console.log('🔥 [Post] - Post ID:', updatedPost._id)
          console.log('🔥 [Post] - isCollaborative:', updatedPost.isCollaborative)
          console.log('🔥 [Post] - Contributors count:', updatedPost.contributors?.length)
          console.log('🔥 [Post] - Contributors array:', updatedPost.contributors)
          console.log('🔥 [Post] Full contributors JSON:', JSON.stringify(updatedPost.contributors?.map(c => ({
            id: (c._id || c)?.toString()?.substring(0, 8),
            name: c.name,
            username: c.username
          })), null, 2))
          
          // IMMEDIATELY update local state - this ensures the owner sees the update right away
          console.log('🔥🔥🔥 [Post] UPDATING LOCAL STATE IMMEDIATELY')
          setLocalPost({ ...updatedPost })
          
          // Also update feed state if post is in feed
          setFollowPost(prevPosts => {
            console.log('🔥🔥🔥 [Post] ============ UPDATING FEED STATE ============')
            console.log('🔥 [Post] Current feed has', prevPosts.length, 'posts')
            console.log('🔥 [Post] Looking for post ID:', post._id)
            
            let foundPost = false
            const newPosts = []
            
            for (const p of prevPosts) {
              if (p._id === post._id) {
                console.log('🔥🔥🔥 [Post] FOUND POST IN FEED! Replacing...')
                console.log('🔥 [Post] OLD post contributors:', p.contributors?.length || 0)
                console.log('🔥 [Post] NEW post contributors:', updatedPost.contributors?.length || 0)
                console.log('🔥 [Post] NEW contributors data:', JSON.stringify(updatedPost.contributors?.map(c => ({
                  id: (c._id || c)?.toString()?.substring(0, 8),
                  name: c.name,
                  username: c.username
                })), null, 2))
                
                // Push completely new object with spread to ensure new reference
                newPosts.push({ ...updatedPost })
                foundPost = true
              } else {
                newPosts.push(p)
              }
            }
            
            if (foundPost) {
              console.log('🔥🔥🔥 [Post] POST REPLACED IN FEED! Returning new array...')
            } else {
              console.error('❌❌❌ [Post] POST NOT FOUND IN FEED! (But local state already updated)')
            }
            console.log('🔥 [Post] Returning array of length:', newPosts.length)
            
            // Return completely new array reference
            return [...newPosts]
          })
          
          // Force a small delay and check if update happened
          setTimeout(() => {
            console.log('🔍 [Post] Checking if post updated in 100ms...')
          }, 100)
        } else {
          console.log('⚠️ [Post] No updated post provided, fetching...')
          fetch(
            `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/getPost/${post._id}`,
            { credentials: 'include' }
          )
          .then(res => res.json())
          .then(data => {
            if (data.post) {
              console.log('✅ [Post] Fetched and updating post')
              setFollowPost(prev => prev.map(p => p._id === post._id ? { ...data.post } : p))
            }
          })
          .catch(error => console.error('❌ [Post] Error refreshing post:', error))
        }
      }}
    />
    
    {/* Edit Post Modal */}
    <EditPost
      post={post}
      isOpen={isEditPostOpen}
      onClose={onEditPostClose}
      onUpdate={(updatedPost) => {
        // Update post in feed
        if (setFollowPost && updatedPost) {
          setFollowPost(prev => prev.map(p => p._id === updatedPost._id ? updatedPost : p))
        }
        // Update local state too (profile pages may not use feed state)
        if (updatedPost) {
          setLocalPost({ ...updatedPost })
        }
        console.log('✅ Post updated:', updatedPost._id)
      }}
    />
    
    {/* Manage Contributors Modal */}
    <ManageContributorsModal
      isOpen={isManageContributorsOpen}
      onClose={onManageContributorsClose}
      post={post}
      onContributorRemoved={(updatedPost) => {
        console.log('🔥 [Post] onContributorRemoved called')
        if (updatedPost) {
          // IMMEDIATELY update local state - ensures owner sees update right away
          console.log('🔥 [Post] UPDATING LOCAL STATE IMMEDIATELY after removal')
          setLocalPost({ ...updatedPost })
          
          // Also update feed state if post is in feed
          setFollowPost(prev => {
            const updated = prev.map(p => p._id === post._id ? updatedPost : p)
            const foundInFeed = prev.some(p => p._id === post._id)
            console.log(foundInFeed ? '✅ [Post] Updated in feed' : '⚠️ [Post] Not in feed (but local state updated)')
            return updated
          })
          console.log('✅ [Post] Updated post after removing contributor:', updatedPost.contributors?.length)
        } else {
          // Fallback: fetch post data if not provided
          fetch(
            `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/getPost/${post._id}`,
            { credentials: 'include' }
          )
          .then(res => res.json())
          .then(data => {
            if (data.post) {
              // Update local state immediately
              console.log('🔄 [Post] Fetched post, updating local state')
              setLocalPost({ ...data.post })
              
              // Also update feed if post is in it
              setFollowPost(prev => {
                const updated = prev.map(p => p._id === post._id ? data.post : p)
                return updated
              })
            }
          })
          .catch(error => console.error('Error refreshing post:', error))
        }
      }}
    />
  </Flex>
  
   </Flex>
   
    </Flex>
  )

  // For chess posts, don't wrap in Link - only chess card should be clickable
  // Make the wrapper non-clickable to prevent any navigation
  if (isChessPost) {
    return (
      <Box 
        onClick={(e) => {
          // Only allow navigation if clicking the chess card itself
          const chessCard = e.target.closest('[data-chess-card]')
          if (!chessCard) {
            // If clicking outside chess card, prevent any navigation
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        onMouseDown={(e) => {
          const chessCard = e.target.closest('[data-chess-card]')
          if (!chessCard) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
      >
        {postContent}
      </Box>
    )
  }

  // Don't render the entire post if it should be hidden (after all hooks are called)
  if (hideChessPost) {
    return null
  }

  return (
    <Link 
      to={`/${postedBy?.username}/post/${post._id}`}
      onClick={(e) => {
        // Check if clicked element should prevent navigation
        const target = e.target
        
        // Check if the click is on a button, input, or has data-no-navigate
        if (
          target.closest('button') ||
          target.closest('[data-no-navigate="true"]') ||
          target.closest('.chakra-menu__menu-button') ||
          target.closest('.chakra-menu__menu-list')
        ) {
          console.log('🔵 [Post] Preventing navigation - clicked on interactive element')
          e.preventDefault()
        }
      }}
    >
      {postContent}
    </Link>
  )
}

// Memoize Post component to prevent unnecessary re-renders
export default memo(Post)
