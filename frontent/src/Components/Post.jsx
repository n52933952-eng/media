import React,{useEffect,useState,useContext, useCallback, useMemo, memo, useRef} from 'react'
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
import { SocketContext } from '../context/SocketContext'
import { FiMail } from 'react-icons/fi'
import { followIdToString, mergePostUpdate, getReplyCount, getReplyPreviewUsers } from '../utils/postUtils.js'
import { isUserInOnlineList } from '../utils/presenceUtils.js'
import PostEditorMenu from './PostEditorMenu'
import FootballIcon from './FootballIcon'
import FootballMatchCards from './FootballMatchCards'
import { normalizeDbMatchForFootballFeed, isFootballMatchLive } from '../utils/footballFeed'
import {
  isGoFishFeedPost,
  isChessFeedPost,
  getCardGameDataForPost,
  getChessGameDataForPost,
} from '../utils/gameFeedPostUtils.js'
import { isVideoUrl, mediaDisplayUrl } from '../utils/mediaUrl.js'
import PostMediaCarousel, { FEED_CAROUSEL_FRAME_H } from './PostMediaCarousel'
import { getPostCarouselSlides, getPostCarouselAudio, shouldShowPostCarousel, postHasDisplayableMedia } from '../utils/postCarousel.js'
import { usePostEngagementSubscription } from '../hooks/usePostEngagementSubscription.js'

const apiBaseUrl = () => (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

const Post = ({post: initialPost, postedBy, onDelete, onPostUpdated, visibleVideoOnly = false, autoPlayMedia, showFeedExtras = true, isOwnProfile = true}) => {
    
  // Local state for this specific post (used when not in feed context)
  const [localPost, setLocalPost] = useState(initialPost)
  const [contribHydrateMap, setContribHydrateMap] = useState({})
  const contribHydrateInFlightRef = useRef({})
  
  // Use local post or initial post
  const post = localPost || initialPost
  const videoRef = useRef(null)
  const [isVideoInView, setIsVideoInView] = useState(!visibleVideoOnly)
  const rawMediaUrl = String(post?.img || '')
  const mediaUrl = mediaDisplayUrl(rawMediaUrl)
  const isVideoMedia = isVideoUrl(rawMediaUrl)
  const carouselSlides = useMemo(() => getPostCarouselSlides(post), [post])
  const carouselAudio = useMemo(() => getPostCarouselAudio(post), [post?.audio])
  const showCarousel = shouldShowPostCarousel(post)
  
  // Keep local post in sync without wiping richer contributor data from a stale parent render
  useEffect(() => {
    if (!initialPost) return
    setLocalPost((prev) => {
      if (!prev || String(prev._id) !== String(initialPost._id)) return initialPost
      const prevT = new Date(prev.updatedAt || prev.createdAt || 0).getTime()
      const nextT = new Date(initialPost.updatedAt || initialPost.createdAt || 0).getTime()
      if (nextT < prevT) {
        return {
          ...mergePostUpdate(prev, initialPost),
          contributors: prev.contributors,
          updatedAt: prev.updatedAt,
        }
      }
      return mergePostUpdate(prev, initialPost)
    })
  }, [initialPost])

  // Hydrate contributor avatars when API/socket returns ids only (same as mobile)
  useEffect(() => {
    if (!post?.isCollaborative || !Array.isArray(post?.contributors)) return
    const todo = []
    for (const c of post.contributors) {
      const id =
        typeof c === 'string' || typeof c === 'number'
          ? String(c)
          : c?._id != null
            ? String(c._id)
            : ''
      if (!id) continue
      const hasIdentity =
        typeof c === 'object' && !!(c.username || c.name || c.profilePic)
      if (hasIdentity || contribHydrateMap[id] || contribHydrateInFlightRef.current[id]) continue
      todo.push(id)
    }
    if (!todo.length) return

    let cancelled = false
    todo.forEach((id) => {
      contribHydrateInFlightRef.current[id] = true
    })

    ;(async () => {
      const next = {}
      await Promise.all(
        todo.slice(0, 12).map(async (id) => {
          try {
            const res = await fetch(
              `${apiBaseUrl()}/api/user/getUserPro/${encodeURIComponent(id)}`,
              { credentials: 'include' },
            )
            const data = await res.json()
            const u = data?.user ?? data
            if (res.ok && u) next[id] = u
          } catch {
            /* ignore */
          }
        }),
      )
      if (cancelled) return
      if (Object.keys(next).length) {
        setContribHydrateMap((prev) => ({ ...prev, ...next }))
      }
      todo.forEach((id) => {
        contribHydrateInFlightRef.current[id] = false
      })
    })()

    return () => {
      cancelled = true
    }
  }, [post?.isCollaborative, post?.contributors, contribHydrateMap])

  useEffect(() => {
    // Feed can pass explicit playback control (single active video).
    // In that case, don't run local intersection observer logic.
    if (typeof autoPlayMedia === 'boolean') {
      return
    }
    if (!visibleVideoOnly) {
      setIsVideoInView(true)
      return
    }
    if (!isVideoMedia || !videoRef.current) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        // 0.35 is more stable on profile pages with sticky headers/overlays.
        setIsVideoInView(!!entry?.isIntersecting && entry.intersectionRatio >= 0.35)
      },
      { threshold: [0, 0.2, 0.35, 0.6, 0.9] }
    )
    observer.observe(videoRef.current)
    return () => observer.disconnect()
  }, [visibleVideoOnly, isVideoMedia, post?._id, autoPlayMedia])

  useEffect(() => {
    if (!isVideoMedia || !videoRef.current) return
    const shouldPlay = typeof autoPlayMedia === 'boolean' ? autoPlayMedia : isVideoInView
    if (shouldPlay) {
      videoRef.current.play?.().catch(() => {})
    } else {
      videoRef.current.pause?.()
    }
  }, [isVideoInView, isVideoMedia, autoPlayMedia])

  const navigate = useNavigate()
  /** Blocks post-card navigation after menu close (portal click-through). */
  const menuNavBlockRef = useRef(false)
  const menuOpenRef = useRef(false)

  const blockPostNavBriefly = useCallback(() => {
    menuNavBlockRef.current = true
    window.setTimeout(() => {
      menuNavBlockRef.current = false
    }, 450)
  }, [])

  const shouldNavigateToPostDetail = useCallback(
    (e) => {
      const target = e?.target
      if (!target || !post?._id || !postedBy?.username) return false
      if (menuNavBlockRef.current || menuOpenRef.current) return false
      if (
        target.closest('button') ||
        target.closest('a') ||
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('[data-no-navigate="true"]') ||
        target.closest('[data-feed-actions="true"]') ||
        target.closest('.chakra-menu__menu-button') ||
        target.closest('.chakra-menu__menu-list') ||
        target.closest('.chakra-menu__menuitem') ||
        target.closest('[role="menu"]') ||
        target.closest('svg[aria-label="Like"]') ||
        target.closest('svg[aria-label="Comment"]') ||
        target.closest('svg[aria-label="Share"]') ||
        target.closest('[data-chess-card]') ||
        target.closest('[data-card-game-card]')
      ) {
        return false
      }
      return true
    },
    [post?._id, postedBy?.username],
  )

  const goToPostDetail = useCallback(
    (e) => {
      if (!shouldNavigateToPostDetail(e)) return
      e?.preventDefault?.()
      navigate(`/${postedBy?.username}/post/${post._id}`)
    },
    [shouldNavigateToPostDetail, navigate, postedBy?.username, post._id],
  )

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
  const{followPost,setFollowPost,hideFeedPostFromFeed,hideFeedSourceFromFeed}=useContext(PostContext)
  const { socket, onlineUser } = useContext(SocketContext) || {}
  usePostEngagementSubscription(socket, post?._id)
  
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
  const isChessPost = isChessFeedPost(post)
  const isCardPost = isGoFishFeedPost(post)
  
  // Hide entire chess post immediately if user canceled their game (local state only)
  const [hideChessPost, setHideChessPost] = useState(false)
  /** Socket `chessGameEnded` → window `chessGameFeedUiEnded`: flip badge without refresh (parity with mobile). */
  const [chessFeedEndedLocally, setChessFeedEndedLocally] = useState(false)

  useEffect(() => {
    setChessFeedEndedLocally(false)
    if (!isChessPost || !post?.chessGameData) return
    let roomId = ''
    try {
      const d = JSON.parse(post.chessGameData)
      roomId = d?.roomId != null ? String(d.roomId).trim() : ''
    } catch {
      return
    }
    if (!roomId) return

    const onEnded = (ev) => {
      const rid = ev?.detail?.roomId
      if (rid != null && String(rid).trim() === roomId) {
        setChessFeedEndedLocally(true)
      }
    }
    window.addEventListener('chessGameFeedUiEnded', onEnded)
    return () => window.removeEventListener('chessGameFeedUiEnded', onEnded)
  }, [isChessPost, post?._id, post?.chessGameData])

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
  
  const chessGameData = isChessPost ? getChessGameDataForPost(post) : null
  const cardGameData = isCardPost ? getCardGameDataForPost(post) : null

  const resolveGameOpponentId = (player1Id, player2Id) => {
    const p1 = player1Id != null ? String(player1Id) : ''
    const p2 = player2Id != null ? String(player2Id) : ''
    const me = user?._id?.toString?.() ?? ''
    if (!p1 && !p2) return ''
    if (me && me === p1) return p2 || p1
    if (me && me === p2) return p1 || p2
    return p1 || p2
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
      // Tombstone first so silent feed refresh cannot revive from Redis cache
      if (onDelete) onDelete(post._id)
      setFollowPost((prev) => prev.filter((p) => String(p._id) !== String(post._id)))
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

  const postedById =
    (typeof post.postedBy === 'string' ? post.postedBy : post.postedBy?._id)?.toString?.() ??
    String(typeof post.postedBy === 'string' ? post.postedBy : post.postedBy?._id ?? '')
  const currentUserId = user?._id?.toString?.() ?? (user?._id ? String(user._id) : '')
  const isOwner = !!postedById && !!currentUserId && postedById === currentUserId
  const isContributor = post.contributors?.some((c) => {
    const cId = (typeof c === 'string' ? c : c?._id)?.toString?.() ?? String(typeof c === 'string' ? c : c?._id ?? '')
    return !!cId && !!currentUserId && cId === currentUserId
  })
  const applyPostUpdate = useCallback((updatedPost) => {
    if (!updatedPost) return
    const merged = mergePostUpdate(post, updatedPost)
    setLocalPost(merged)
    onPostUpdated?.(merged)
    if (setFollowPost) {
      setFollowPost((prev) =>
        prev.map((p) => (p._id === post._id ? mergePostUpdate(p, updatedPost) : p)),
      )
    }
  }, [post, post._id, setFollowPost, onPostUpdated])

  const isMyChannelFeedCard =
    !!post?.channelAddedBy && String(post.channelAddedBy) === String(user?._id)

  const canHideRegularUserPost =
    showFeedExtras &&
    !!user &&
    !isOwner &&
    !isChannelPost &&
    !isFootballPost &&
    !isWeatherPost &&
    !isChessPost &&
    !isCardPost &&
    !post?.isLive &&
    !!post?._id &&
    /^[0-9a-fA-F]{24}$/.test(String(post._id))

  const showFeedPostMenu =
    showFeedExtras &&
    !!user &&
    !isChessPost &&
    !isCardPost &&
    !post?.isLive &&
    !isFootballPost &&
    !isOwner &&
    (canHideRegularUserPost || isWeatherPost || isMyChannelFeedCard)

  const canMessagePostOwner =
    showFeedExtras &&
    !!user &&
    !isOwner &&
    !isChannelPost &&
    !isFootballPost &&
    !isWeatherPost &&
    !isChessPost &&
    !isCardPost &&
    !post?.isLive &&
    !!postedById &&
    /^[0-9a-fA-F]{24}$/.test(postedById)

  // Match mobile: hide owner edit/delete on someone else's profile
  const isSomeoneElsesProfile = !showFeedExtras && isOwnProfile === false

  const isFollowedAuthor = useMemo(() => {
    if (!showFeedExtras || !user?.following?.length || !postedById || isOwner) return false
    return user.following.some((entry) => followIdToString(entry) === postedById)
  }, [showFeedExtras, user?.following, postedById, isOwner])

  const showAuthorPresenceDot =
    isFollowedAuthor &&
    !isChannelPost &&
    !isFootballPost &&
    !isWeatherPost &&
    !isChessPost &&
    !isCardPost &&
    !post?.isLive

  const authorIsOnline = showAuthorPresenceDot && isUserInOnlineList(onlineUser, postedById)

  const onMessagePostOwner = (e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    if (!canMessagePostOwner) return
    const author = typeof post.postedBy === 'object' && post.postedBy ? post.postedBy : postedBy
    navigate('/messages', {
      state: {
        openDmUserId: postedById,
        openDmUser: {
          _id: postedById,
          name: author?.name || author?.username || 'User',
          username: author?.username,
          profilePic: author?.profilePic,
        },
      },
    })
  }

  const hideRegularPostFromFeed = async () => {
    const isSelfContributor = !!post.isCollaborative && !!isContributor && !isOwner && !!currentUserId
    if (isSelfContributor) {
      if (!window.confirm('Leave this collaborative post? It will be removed from your feed.')) return
      try {
        const res = await fetch(
          `${apiBaseUrl()}/api/post/collaborative/${String(post._id)}/contributor/${currentUserId}`,
          { method: 'DELETE', credentials: 'include' },
        )
        if (!res.ok) throw new Error('Failed to leave post')
        setFollowPost((prev) => prev.filter((p) => String(p._id) !== String(post._id)))
        onDelete?.(post._id)
        showToast('Success', 'Removed from feed', 'success')
      } catch (e) {
        showToast('Error', e?.message || 'Failed', 'error')
      }
      return
    }
    if (!window.confirm('Not interested? This post will be hidden from your feed.')) return
    try {
      await hideFeedPostFromFeed(String(post._id))
      onDelete?.(post._id)
      showToast('Success', 'Removed from feed', 'success')
    } catch (e) {
      showToast('Error', e?.message || 'Failed', 'error')
    }
  }

  const hideChannelOrWeatherFromFeed = async () => {
    if (!window.confirm('Remove this from your feed?')) return
    try {
      if (isMyChannelFeedCard && post?._id) {
        const res = await fetch(`${apiBaseUrl()}/api/post/${String(post._id)}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (!res.ok) throw new Error('Failed to delete')
        setFollowPost((prev) => prev.filter((p) => String(p._id) !== String(post._id)))
        onDelete?.(post._id)
      } else {
        const uname = post?.postedBy?.username
        if (uname === 'Football' || uname === 'Weather') {
          hideFeedSourceFromFeed(String(uname))
        } else {
          await hideFeedPostFromFeed(String(post._id))
        }
        onDelete?.(post._id)
      }
      showToast('Success', 'Removed from feed', 'success')
    } catch (e) {
      showToast('Error', e?.message || 'Failed', 'error')
    }
  }

  const handleFeedPostMenuPress = () => {
    if (isWeatherPost || isMyChannelFeedCard) {
      hideChannelOrWeatherFromFeed()
      return
    }
    if (canHideRegularUserPost) hideRegularPostFromFeed()
  }
  
  const postContent = (
    <Flex gap={3} mb="4" py={5} w="100%" maxW="100%" px={{ base: 3, md: 0 }}>
        
        
        <Flex flexDirection="column" alignItems="center">
           
            {postedBy?.username === 'Football' ? (
              <Box onClick={handleAvatarOrNameClick} cursor="pointer">
                <FootballIcon size="48px" />
              </Box>
            ) : (
            <Box position="relative" display="inline-block">
              <Avatar 
                size="md" 
                src={postedBy?.profilePic} 
                name={postedBy?.name}
                loading="lazy"
                cursor="pointer"
                onClick={handleAvatarOrNameClick}
              />
              {showAuthorPresenceDot ? (
                <Box
                  position="absolute"
                  bottom="2px"
                  left="2px"
                  w="14px"
                  h="14px"
                  borderRadius="full"
                  bg={authorIsOnline ? 'green.400' : 'gray.400'}
                  border="2px solid"
                  borderColor={cardBg}
                  title={authorIsOnline ? 'Online' : 'Offline'}
                />
              ) : null}
            </Box>
            )}
           
            <Box w="1px" h="full" bg="gray.light" my="2"></Box>
       
      
       <Box position="relative" w="full" minH="18px" display="flex" justifyContent="center" alignItems="center">
      {(() => {
        const replyCount = getReplyCount(post)
        const previewUsers = getReplyPreviewUsers(post, 3)
        if (replyCount <= 0) {
          return <Text textAlign="center" fontSize="sm" lineHeight="18px">🥱</Text>
        }
        return (
          <Flex alignItems="center" justifyContent="center">
            {previewUsers.map((u, i) => {
              const key = String(u?._id || u?.username || i)
              const pic = u?.profilePic
              return pic ? (
                <Box
                  key={key}
                  as="img"
                  src={pic}
                  alt=""
                  w="18px"
                  h="18px"
                  borderRadius="full"
                  objectFit="cover"
                  ml={i === 0 ? 0 : '-6px'}
                  border="1.5px solid"
                  borderColor={cardBg}
                  zIndex={previewUsers.length - i}
                />
              ) : (
                <Flex
                  key={key}
                  w="18px"
                  h="18px"
                  borderRadius="full"
                  bg="gray.600"
                  align="center"
                  justify="center"
                  ml={i === 0 ? 0 : '-6px'}
                  border="1.5px solid"
                  borderColor={cardBg}
                  zIndex={previewUsers.length - i}
                >
                  <Text fontSize="9px" fontWeight="700" color="white" lineHeight="1">
                    {(u?.name || u?.username || '?').charAt(0).toUpperCase()}
                  </Text>
                </Flex>
              )
            })}
          </Flex>
        )
      })()}
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
    
    
    
     <Flex alignItems="center" gap={2} data-no-navigate="true" onClick={(e) => e.stopPropagation()}>
        {/* Timestamp first (swapped with action icons) */}
        {(() => {
          const createdAt = post?.createdAt ? new Date(post.createdAt) : null
          const updatedAt = post?.updatedAt ? new Date(post.updatedAt) : null
          const fallbackAt = post?.date ? new Date(post.date) : null
          const createdOk = createdAt && !Number.isNaN(createdAt.getTime())
          const updatedOk = updatedAt && !Number.isNaN(updatedAt.getTime())
          const fallbackOk = fallbackAt && !Number.isNaN(fallbackAt.getTime())
          const rawDate = createdOk ? createdAt : (updatedOk ? updatedAt : (fallbackOk ? fallbackAt : null))
          // Clamp future timestamps (clock skew) so we never show "in 8 minutes"
          const displayDate =
            rawDate && rawDate.getTime() > Date.now() + 60_000
              ? new Date()
              : rawDate
          const isEdited =
            createdOk &&
            updatedOk &&
            Math.abs(updatedAt.getTime() - createdAt.getTime()) > 60 * 1000

          if (!displayDate) return null

          return (
            <Flex direction="column" alignItems="flex-end" gap={0} mr={1}>
              <Text fontSize="sm" color="gray.light" textAlign="right" whiteSpace="nowrap">
                {formatDistanceToNow(displayDate, { addSuffix: true })}
              </Text>
              {isEdited && (
                <Text fontSize="xs" color="gray.light" textAlign="right" whiteSpace="nowrap">
                  · Edited {format(updatedAt, 'PP p')}
                </Text>
              )}
            </Flex>
          )
        })()}

        {canMessagePostOwner ? (
          <Tooltip label="Message" hasArrow>
            <IconButton
              aria-label="Message author"
              icon={<FiMail />}
              size="sm"
              variant="ghost"
              colorScheme="blue"
              onClick={onMessagePostOwner}
            />
          </Tooltip>
        ) : null}
        {showFeedPostMenu ? (
          <Box
            as="span"
            display="inline-flex"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
          <Menu
            placement="bottom-end"
            isLazy
            onOpen={() => {
              menuOpenRef.current = true
            }}
            onClose={() => {
              menuOpenRef.current = false
              blockPostNavBriefly()
            }}
          >
            <MenuButton
              as={IconButton}
              aria-label="Post options"
              icon={<HiOutlineDotsHorizontal />}
              size="sm"
              variant="ghost"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                blockPostNavBriefly()
              }}
              onMouseDown={(e) => {
                e.stopPropagation()
                blockPostNavBriefly()
              }}
            />
            <MenuList zIndex={2000}>
              <MenuItem
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  blockPostNavBriefly()
                }}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  blockPostNavBriefly()
                  window.setTimeout(() => handleFeedPostMenuPress(), 0)
                }}
              >
                {isWeatherPost || isMyChannelFeedCard ? 'Remove from feed' : 'Not interested'}
              </MenuItem>
            </MenuList>
          </Menu>
          </Box>
        ) : null}

         {/* Delete: owner (or channel adder) — only on own profile / feed, not on someone else's profile */}
         {!isSomeoneElsesProfile &&
           (user?._id === postedBy?._id ||
             (post?.channelAddedBy && post.channelAddedBy === user?._id?.toString())) && (
           <MdOutlineDeleteOutline 
             onClick={(e) => {
               e.preventDefault()
               e.stopPropagation()
               handleDeletepost(e)
             }}
             cursor="pointer"
             color={useColorModeValue('gray.600', 'gray.400')}
             _hover={{ color: 'red.500' }}
           />
         )}
     </Flex>
   
  
    </Flex>
    
    {/* Collaborative contributors — compact chips (aligned with mobile) */}
    {post?.isCollaborative &&
      Array.isArray(post?.contributors) &&
      post.contributors.length > 0 &&
      (() => {
        const ownerId =
          postedBy?._id?.toString() ||
          post.postedBy?._id?.toString() ||
          post.postedBy?.toString() ||
          postedBy?.toString() ||
          ''
        const displayContributors = post.contributors
          .filter((contributor) => {
            const contributorId = (contributor?._id || contributor)?.toString()
            return contributorId && contributorId !== ownerId
          })
          .slice(0, 8)

        if (displayContributors.length === 0) return null

        return (
          <Flex
            direction="column"
            gap={1.5}
            mb={2}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <Text
              fontSize="13px"
              fontWeight="600"
              color={secondaryTextColor}
              letterSpacing="0.01em"
            >
              Contributors
            </Text>
            <Flex align="center" gap={2} overflowX="auto" pb={0.5} sx={{ scrollbarWidth: 'none' }}>
              {displayContributors.map((contributor, idx) => {
                const contributorId = (contributor?._id || contributor)?.toString()
                const hydrated =
                  contributorId && contribHydrateMap[contributorId]
                    ? contribHydrateMap[contributorId]
                    : null
                const cObj = hydrated || (typeof contributor === 'object' ? contributor : null)
                const contributorName = cObj?.name || cObj?.username || null
                const contributorUsername = cObj?.username || null
                const contributorProfilePic = cObj?.profilePic || null
                const label = contributorName || contributorUsername || '?'

                return (
                  <Tooltip
                    key={contributorId || idx}
                    label={label !== '?' ? label : 'Contributor'}
                  >
                    <Flex
                      direction="column"
                      align="center"
                      gap={1}
                      minW="40px"
                      cursor={contributorUsername ? 'pointer' : 'default'}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (contributorUsername) navigate(`/${contributorUsername}`)
                      }}
                      _hover={contributorUsername ? { opacity: 0.85 } : undefined}
                      transition="opacity 0.15s"
                    >
                      <Avatar
                        src={contributorProfilePic || undefined}
                        name={label}
                        size="sm"
                        boxSize="32px"
                        borderWidth="1px"
                        borderColor={borderColor}
                      />
                      {!showFeedExtras ? (
                        <Text
                          fontSize="10px"
                          color={secondaryTextColor}
                          noOfLines={1}
                          maxW="48px"
                          textAlign="center"
                        >
                          {label}
                        </Text>
                      ) : null}
                    </Flex>
                  </Tooltip>
                )
              })}
              {post.contributors.filter((c) => {
                const id = (c?._id || c)?.toString()
                return id && id !== ownerId
              }).length > displayContributors.length && (
                <Text fontSize="xs" color={secondaryTextColor} flexShrink={0}>
                  +
                  {post.contributors.filter((c) => {
                    const id = (c?._id || c)?.toString()
                    return id && id !== ownerId
                  }).length - displayContributors.length}
                </Text>
              )}
            </Flex>
          </Flex>
        )
      })()}
    
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
              Tap to watch
            </Text>
          </VStack>
        </Flex>
        {(() => {
          const status = chessGameData?.gameStatus
          const serverEnded = !(status === 'active' || status == null)
          const showEnded = chessFeedEndedLocally || serverEnded
          return (
            <Text
              fontSize="xs"
              fontWeight="semibold"
              color={showEnded ? secondaryTextColor : 'green.500'}
            >
              {showEnded ? 'Ended' : 'Live'}
            </Text>
          )
        })()}
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

  {/* Card Game Card Display */}
  {isCardPost && cardGameData && (
    <Box
      data-card-game-card
      mt={3}
      mb={2}
      bg={cardBg}
      borderRadius="lg"
      border="1px solid"
      borderColor={borderColor}
      p={4}
      w="full"
    >
      <Flex align="center" justify="space-between" mb={3}>
        <Flex align="center" gap={3}>
          <Text fontSize="3xl">🃏</Text>
          <VStack align="start" spacing={0}>
            <Text fontSize="sm" fontWeight="bold" color={textColor}>
              Playing Go Fish
            </Text>
          </VStack>
        </Flex>
        {cardGameData?.gameStatus === 'active' || cardGameData?.gameStatus == null ? (
          <Text fontSize="xs" fontWeight="semibold" color="green.500">Live</Text>
        ) : (
          <Text fontSize="xs" fontWeight="semibold" color={secondaryTextColor}>Ended</Text>
        )}
      </Flex>
      <Flex align="center" justify="space-around" gap={4} onClick={(e) => e.stopPropagation()}>
        <VStack spacing={1}>
          <Avatar src={cardGameData.player1?.profilePic} name={cardGameData.player1?.name} size="md" pointerEvents="none" />
          <Text fontSize="xs" fontWeight="semibold" color={textColor} pointerEvents="none">{cardGameData.player1?.name}</Text>
        </VStack>
        <Text fontSize="xl" color={textColor} fontWeight="bold" pointerEvents="none">vs</Text>
        <VStack spacing={1}>
          <Avatar src={cardGameData.player2?.profilePic} name={cardGameData.player2?.name} size="md" pointerEvents="none" />
          <Text fontSize="xs" fontWeight="semibold" color={textColor} pointerEvents="none">{cardGameData.player2?.name}</Text>
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
  
  {(post?.img || (Array.isArray(post?.images) && post.images.length) || postHasDisplayableMedia(post)) && !isFootballPost && !isWeatherPost && !isChessPost && (
    <Box
      key={`feed-media-${post._id}`}
      data-post-media="true"
      borderRadius={4}
      overflow="hidden"
      border="0.5px solid"
      borderColor="gray.light"
      my={2}
      cursor="pointer"
      title="Open post"
      sx={{
        cursor: 'pointer !important',
        '& img, & video': { cursor: 'pointer !important' },
      }}
    >
      {showCarousel && carouselSlides.length > 0 && !rawMediaUrl.includes('youtube.com/embed') && !rawMediaUrl.includes('youtu.be') && !isVideoMedia ? (
        <PostMediaCarousel slides={carouselSlides} audioUrl={carouselAudio} frameHeight={FEED_CAROUSEL_FRAME_H} />
      ) : post?.img && (post.img.includes('youtube.com/embed') || post.img.includes('youtu.be')) ? (
        <Box position="relative" paddingBottom="56.25%" height="0" overflow="hidden" cursor="pointer">
          <iframe
            src={post.img}
            title="Live Stream"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              border: 'none',
              pointerEvents: 'none',
            }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </Box>
      ) : post?.img && (post.img.match(/\.(mp4|webm|ogg|mov)$/i) || post.img.includes('/video/upload/')) ? (
        <Box
          as="video"
          key={`feed-video-${post._id}-${mediaUrl}`}
          ref={videoRef}
          src={mediaUrl}
          controls
          autoPlay={typeof autoPlayMedia === 'boolean' ? autoPlayMedia : (visibleVideoOnly ? isVideoInView : true)}
          muted
          playsInline
          loop
          w="full"
          maxH="400px"
          cursor="pointer"
          onLoadedData={(e) => {
            if (visibleVideoOnly && !isVideoInView) return
            e.target.play().catch(() => {})
          }}
        />
      ) : post?.img ? (
        <Box
          h={FEED_CAROUSEL_FRAME_H}
          w="full"
          bg="black"
          display="flex"
          alignItems="center"
          justifyContent="center"
          overflow="hidden"
          cursor="pointer"
        >
          <Image
            key={`feed-img-${post._id}-${mediaUrl}`}
            src={mediaUrl}
            maxH="100%"
            maxW="100%"
            w="auto"
            h="auto"
            objectFit="contain"
            loading="lazy"
            alt="Post image"
            style={{ cursor: 'pointer' }}
          />
        </Box>
      ) : showCarousel && carouselSlides.length > 0 ? (
        <PostMediaCarousel slides={carouselSlides} audioUrl={carouselAudio} frameHeight={FEED_CAROUSEL_FRAME_H} />
      ) : null}
    </Box>
  )}
  
  
  <Flex gap={2} my={1} align="flex-start" flexWrap="nowrap" data-no-navigate="true" data-feed-actions="true" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
    {!isChessPost && !isCardPost && (
      <Actions post={post} showFeedExtras={showFeedExtras} />
    )}

    <Box mt={2} flexShrink={0} alignSelf="flex-start">
      <PostEditorMenu
        post={post}
        onPostUpdated={applyPostUpdate}
        showFeedExtras={showFeedExtras}
        isOwnProfile={isOwnProfile}
        iconOnly
        onMenuStateChange={(open) => {
          menuOpenRef.current = open
        }}
        onMenuInteraction={blockPostNavBriefly}
      />
    </Box>
  </Flex>
  
   </Flex>
   
    </Flex>
  )

  // Chess/card posts: game card opens match; don't wrap whole post in Link to post detail
  if (isChessPost || isCardPost) {
    return (
      <Box 
        onClick={(e) => {
          const gameCard = e.target.closest('[data-chess-card], [data-card-game-card]')
          if (!gameCard) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        onMouseDown={(e) => {
          const gameCard = e.target.closest('[data-chess-card], [data-card-game-card]')
          if (!gameCard) {
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
    <Box
      data-post-id={post._id}
      onClick={goToPostDetail}
      onMouseDown={(e) => {
        if (menuOpenRef.current || menuNavBlockRef.current) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      cursor="pointer"
      sx={{
        cursor: 'pointer !important',
        '& img, & video': { cursor: 'pointer !important' },
        '& [data-post-media]': { cursor: 'pointer !important' },
      }}
    >
      {postContent}
    </Box>
  )
}

// Memoize Post component to prevent unnecessary re-renders
export default memo(Post)
