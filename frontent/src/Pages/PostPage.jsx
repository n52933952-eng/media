import React,{useEffect,useState,useContext,useCallback,useMemo,useRef} from 'react'
import{Avatar,Flex,Text,Image,Box,Divider,Button,Spinner,VStack,HStack,Grid,GridItem,SimpleGrid,Tooltip,useColorModeValue} from '@chakra-ui/react'
import { HiDotsHorizontal } from "react-icons/hi";
import Actions from '../Components/Actions'
import Comment from '../Components/Comment'
import PostEditorMenu from '../Components/PostEditorMenu'
import GetUserProfile from '../hooks/GetUserProfile.js'
import{useParams, useSearchParams} from 'react-router-dom'
import{PostContext} from '../context/PostContext'
import{UserContext} from '../context/UserContext'
import{SocketContext} from '../context/SocketContext'
import { MdOutlineDeleteOutline } from "react-icons/md";
import{formatDistanceToNow} from 'date-fns'
import useShowToast from '../hooks/useShowToast.js'
import{useNavigate} from 'react-router-dom'
import FootballMatchCards from '../Components/FootballMatchCards'
import {
  normalizeDbMatchForFootballFeed,
  isFootballMatchLive,
  footballMatchKey,
} from '../utils/footballFeed'
import {
  COMMENTS_PAGE_SIZE,
  mergeRepliesById,
  mergePostUpdate,
  postCommentsApiUrl,
  postDetailApiUrl,
  hideChannelPostComments,
} from '../utils/postUtils.js'
import PostMediaCarousel, { POST_DETAIL_CAROUSEL_FRAME_H } from '../Components/PostMediaCarousel'
import { getPostCarouselSlides, getPostCarouselAudio, shouldShowPostCarousel, postHasDisplayableMedia } from '../utils/postCarousel.js'
import { usePostEngagementSubscription, applyPostEngagement } from '../hooks/usePostEngagementSubscription.js'

const apiBaseUrl = () => (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

const PostPage = () => {
  
  
  const{userpro,loading}=GetUserProfile()
  
  const{id}=useParams()
  const [searchParams] = useSearchParams()
  const fixtureIdParam = searchParams.get('fixture')
  

   const{user}=useContext(UserContext)

   const{followPost,setFollowPost}=useContext(PostContext)
   const {socket} = useContext(SocketContext) || {}

    // Never use followPost[0] — that flashes the wrong feed/profile post until fetch finishes.
    const post = useMemo(() => {
      if (!id) return null
      const list = Array.isArray(followPost) ? followPost : []
      return list.find((p) => String(p?._id) === String(id)) || null
    }, [followPost, id])

    const carouselSlides = useMemo(() => (post ? getPostCarouselSlides(post) : []), [post])
    const carouselAudio = useMemo(() => (post ? getPostCarouselAudio(post) : null), [post?.audio])
    const showCarousel = post ? shouldShowPostCarousel(post) : false
    usePostEngagementSubscription(socket, post?._id)

    const [postReplies, setPostReplies] = useState([])
    const [commentsLoading, setCommentsLoading] = useState(false)
    const [commentsLoadingMore, setCommentsLoadingMore] = useState(false)
    const [commentsHasMore, setCommentsHasMore] = useState(false)
    const commentsSkipRef = useRef(0)
    const loadMoreRef = useRef(null)
    const commentsFetchGenRef = useRef(0)
    /** Avoid infinite spinner when opening a deleted post from a notification. */
    const [postLoadFailed, setPostLoadFailed] = useState(false)
    const missingPostHandledRef = useRef(false)

    /** From feed: `?fixture=<id>` scopes comments to that match thread */
    const footballMatchId = fixtureIdParam || null

    const scopedReplies = useMemo(() => {
      const all = Array.isArray(postReplies) ? postReplies : []
      if (!footballMatchId) return all
      const fid = String(footballMatchId)
      const roots = all.filter(
        (r) => !r?.parentReplyId && String(r?.footballMatchId || '') === fid,
      )
      const rootIds = new Set(roots.map((r) => String(r._id)))
      const inThread = new Set(rootIds)
      let added = true
      while (added) {
        added = false
        for (const r of all) {
          const rid = String(r._id)
          if (inThread.has(rid)) continue
          const p = r.parentReplyId ? String(r.parentReplyId) : ''
          if (p && inThread.has(p)) {
            inThread.add(rid)
            added = true
          }
        }
      }
      return all.filter((r) => inThread.has(String(r._id)))
    }, [postReplies, footballMatchId])

    const topLevelReplies = useMemo(
      () => scopedReplies.filter((r) => !r?.parentReplyId),
      [scopedReplies],
    )

    const hideChannelComments = hideChannelPostComments(post)
    const showCommentsSection = !hideChannelComments || !!footballMatchId

    const bumpReplyCount = useCallback(
      (delta) => {
        if (!delta) return
        setFollowPost((prev) =>
          prev.map((p) => {
            if (String(p._id) !== String(id)) return p
            const next = Math.max(0, (typeof p.replyCount === 'number' ? p.replyCount : 0) + delta)
            return { ...p, replyCount: next, replies: [] }
          }),
        )
      },
      [id, setFollowPost],
    )

    const fetchCommentsPage = useCallback(
      async (loadMore) => {
        if (!id) return
        if (loadMore) {
          if (!commentsHasMore || commentsLoadingMore || commentsLoading) return
          setCommentsLoadingMore(true)
        } else {
          if (commentsLoading) return
          setCommentsLoading(true)
          commentsSkipRef.current = 0
        }

        const gen = ++commentsFetchGenRef.current
        const skip = loadMore ? commentsSkipRef.current : 0

        try {
          const res = await fetch(
            postCommentsApiUrl(id, {
              limit: COMMENTS_PAGE_SIZE,
              skip,
              footballMatchId,
            }),
            { credentials: 'include' },
          )
          const data = await res.json()
          if (gen !== commentsFetchGenRef.current) return
          if (!res.ok) throw new Error(data?.error || 'Failed to load comments')

          const batch = Array.isArray(data?.replies) ? data.replies : []
          setPostReplies((prev) => (loadMore ? mergeRepliesById(prev, batch) : batch))
          setCommentsHasMore(!!data?.hasMore)
          commentsSkipRef.current = skip + COMMENTS_PAGE_SIZE
        } catch (error) {
          console.error('[PostPage] comments fetch:', error)
          if (!loadMore) setPostReplies([])
        } finally {
          if (gen === commentsFetchGenRef.current) {
            if (loadMore) setCommentsLoadingMore(false)
            else setCommentsLoading(false)
          }
        }
      },
      [id, footballMatchId, commentsHasMore, commentsLoadingMore, commentsLoading],
    )

    const fetchCommentsPageRef = useRef(fetchCommentsPage)
    fetchCommentsPageRef.current = fetchCommentsPage

    const handleReplyAdded = useCallback(
      (reply) => {
        if (!reply?._id) return
        setPostReplies((prev) => mergeRepliesById(prev, [reply]))
        bumpReplyCount(1)
      },
      [bumpReplyCount],
    )
    
    const showToast = useShowToast()
    
    const navigate = useNavigate()

    const applyPostUpdate = useCallback(
      (updatedPost) => {
        if (!updatedPost?._id) return
        setFollowPost((prev) => {
          const list = Array.isArray(prev) ? prev : []
          const nextPost = { ...updatedPost, replies: postReplies }
          const idx = list.findIndex((p) => String(p?._id) === String(updatedPost._id))
          if (idx >= 0) {
            const copy = [...list]
            copy[idx] = mergePostUpdate(list[idx], nextPost)
            return copy
          }
          return [nextPost, ...list]
        })
      },
      [setFollowPost, postReplies],
    )

    // Color modes
    const cardBg = useColorModeValue('white', '#252b3b')
    const borderColor = useColorModeValue('#e1e4ea', '#2d3548')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')

    const [contribHydrateMap, setContribHydrateMap] = useState({})
    const contribHydrateInFlightRef = useRef({})

    // Hydrate contributor avatars when API returns ids only (same as feed Post)
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
    
    // Football channel posts: live cards come from API (same as feed); footballData is only a fallback
    const isFootballPost = userpro?.username === 'Football'
    
    // Check if this is a Weather post
    const isWeatherPost = userpro?.username === 'Weather' && post?.weatherData
    
    // Parse football match data
    const [matchesData, setMatchesData] = useState([])
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

    const [footballApiMatches, setFootballApiMatches] = useState([])
    const [footballLoading, setFootballLoading] = useState(false)

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
        console.error('⚽ [PostPage] Failed to fetch live matches:', e)
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
      const arr = Array.isArray(matchesData) ? matchesData : []
      return arr.filter(isFootballMatchLive)
    }, [isFootballPost, footballApiMatches, matchesData])

    /** From feed: `?fixture=<id>` shows only that card; if it dropped off live list, show all live again */
    const footballMatchesForView = useMemo(() => {
      if (!fixtureIdParam) return footballDisplayMatches
      const filtered = footballDisplayMatches.filter(
        (m, i) => footballMatchKey(m, i) === fixtureIdParam
      )
      return filtered.length ? filtered : footballDisplayMatches
    }, [fixtureIdParam, footballDisplayMatches])
    
    // Parse weather data and fetch user's personalized cities
    const [weatherDataArray, setWeatherDataArray] = useState([])
    useEffect(() => {
      if (!isWeatherPost || !post?.weatherData) {
        setWeatherDataArray([])
        return
      }
      
      const loadPersonalizedWeather = async () => {
        try {
          // First, try to load user's selected cities
          if (user?._id) {
            const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
            const prefsRes = await fetch(`${baseUrl}/api/weather/preferences`, {
              credentials: 'include'
            })
            const prefsData = await prefsRes.json()
            
            console.log('🌤️ [PostPage] User preferences:', prefsData.cities?.length || 0, 'cities')
            
            // If user has selected cities, fetch weather for those cities
            if (prefsRes.ok && prefsData.cities && prefsData.cities.length > 0) {
              console.log('🌤️ [PostPage] Loading personalized weather for', prefsData.cities.length, 'cities:', prefsData.cities.map(c => c.name))
              
              // Check memory cache first (shared with WeatherPage)
              const cacheKey = JSON.stringify(prefsData.cities.map(c => `${c.name}-${c.country}`).sort())
              const now = Date.now()
              
              // Check if we have cached data in memory (from WeatherPage)
              if (window.weatherCache && 
                  window.weatherCache.preferences === cacheKey &&
                  window.weatherCache.timestamp && 
                  (now - window.weatherCache.timestamp) < (5 * 60 * 1000)) {
                console.log('💾 [PostPage] Using memory cached weather data')
                const formattedWeather = window.weatherCache.data.map(w => ({
                  city: w.location?.city,
                  country: w.location?.country,
                  temperature: w.current?.temperature,
                  condition: w.current?.condition?.main,
                  description: w.current?.condition?.description,
                  icon: w.current?.condition?.icon,
                  humidity: w.current?.humidity,
                  windSpeed: w.current?.windSpeed
                }))
                setWeatherDataArray(formattedWeather)
                return
              }
              
              // Check localStorage cache
              try {
                const cached = localStorage.getItem(`weatherCache_${cacheKey}`)
                if (cached) {
                  const parsed = JSON.parse(cached)
                  if (parsed.timestamp && (now - parsed.timestamp) < (5 * 60 * 1000)) {
                    console.log('💾 [PostPage] Using localStorage cached weather data')
                    const formattedWeather = parsed.data.map(w => ({
                      city: w.location?.city,
                      country: w.location?.country,
                      temperature: w.current?.temperature,
                      condition: w.current?.condition?.main,
                      description: w.current?.condition?.description,
                      icon: w.current?.condition?.icon,
                      humidity: w.current?.humidity,
                      windSpeed: w.current?.windSpeed
                    }))
                    setWeatherDataArray(formattedWeather)
                    return
                  }
                }
              } catch (e) {
                console.error('Error reading localStorage cache:', e)
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
                    console.log('✅ [PostPage] Found', matchingCached.length, 'cached cities from database')
                    const formattedWeather = matchingCached.map(w => ({
                      city: w.location?.city,
                      country: w.location?.country,
                      temperature: w.current?.temperature,
                      condition: w.current?.condition?.main,
                      description: w.current?.condition?.description,
                      icon: w.current?.condition?.icon,
                      humidity: w.current?.humidity,
                      windSpeed: w.current?.windSpeed
                    }))
                    setWeatherDataArray(formattedWeather)
                    
                    // Update memory cache for future use
                    if (!window.weatherCache) window.weatherCache = {}
                    window.weatherCache.data = matchingCached
                    window.weatherCache.timestamp = now
                    window.weatherCache.preferences = cacheKey
                    
                    return
                  }
                }
              } catch (cacheError) {
                console.error('❌ [PostPage] Error checking cache:', cacheError)
              }
              
              // If not cached, fetch from API (limit to 5 cities to avoid too many API calls)
              console.log('🌤️ [PostPage] No cache found, fetching from API for first 5 cities...')
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
                    
                    if (weatherItem.temperature !== undefined) {
                      fetchedWeather.push(weatherItem)
                    }
                  }
                } catch (error) {
                  console.error(`❌ Error fetching weather for ${city.name}:`, error)
                }
              }
              
              if (fetchedWeather.length > 0) {
                console.log('✅ [PostPage] Loaded personalized weather for', fetchedWeather.length, 'cities')
                setWeatherDataArray(fetchedWeather)
                
                // Update memory cache for future use
                if (!window.weatherCache) window.weatherCache = {}
                const cacheData = fetchedWeather.map(item => ({
                  location: { city: item.city, country: item.country },
                  current: {
                    temperature: item.temperature,
                    condition: { main: item.condition, description: item.description, icon: item.icon },
                    humidity: item.humidity,
                    windSpeed: item.windSpeed
                  }
                }))
                window.weatherCache.data = cacheData
                window.weatherCache.timestamp = Date.now()
                window.weatherCache.preferences = cacheKey
                
                // Also save to localStorage
                try {
                  localStorage.setItem(`weatherCache_${cacheKey}`, JSON.stringify({
                    data: cacheData,
                    timestamp: Date.now()
                  }))
                } catch (e) {
                  console.error('Error saving to localStorage cache:', e)
                }
                
                return
              } else {
                console.log('⚠️ [PostPage] No weather fetched from API, using default')
              }
            }
          }
          
          // Fallback: Use post data (default cities)
          const parsed = JSON.parse(post.weatherData)
          setWeatherDataArray(Array.isArray(parsed) ? parsed : [])
        } catch (e) {
          console.error('❌ Failed to parse weather data:', e)
          setWeatherDataArray([])
        }
      }
      
      loadPersonalizedWeather()
      
      // Listen for preference updates
      const handlePreferencesUpdate = () => {
        console.log('🌤️ [PostPage] Preferences updated event received, reloading weather...')
        loadPersonalizedWeather()
      }
      
      window.addEventListener('weatherPreferencesUpdated', handlePreferencesUpdate)
      
      return () => {
        window.removeEventListener('weatherPreferencesUpdated', handlePreferencesUpdate)
      }
    }, [post?.weatherData, isWeatherPost, user?._id])
    
    // Listen for real-time football match updates
    useEffect(() => {
      if (!isFootballPost || !post?._id) return
      
      const handleMatchUpdate = (event) => {
        const { postId, matchData } = event.detail
        
        // Only update if this is the correct post
        if (postId === post._id.toString()) {
          console.log('⚽ Updating match data for post:', postId)
          setMatchesData(matchData)
        }
      }
      
      window.addEventListener('footballMatchUpdate', handleMatchUpdate)
      
      return () => {
        window.removeEventListener('footballMatchUpdate', handleMatchUpdate)
      }
    }, [isFootballPost, post?._id, post])

    // Listen for real-time post updates (when contributors edit the post)
    useEffect(() => {
      if (!socket || !post?._id) return
      
      const handlePostUpdated = (data) => {
        // Handle both formats: { postId, post } or just post object
        const postId = data.postId || data._id
        const updatedPost = data.post || data
        
        const postIdStr = post._id?.toString()
        const updatedPostIdStr = postId?.toString()
        
        if (postIdStr === updatedPostIdStr) {
          console.log('✏️ Post updated via socket on PostPage:', postId)
          setFollowPost(prev => 
            prev.map(p => {
              const pIdStr = p._id?.toString()
              if (pIdStr === updatedPostIdStr) {
                return mergePostUpdate(p, {
                  ...updatedPost,
                  replies: [],
                  replyCount: updatedPost.replyCount ?? p.replyCount,
                })
              }
              return p
            })
          )
        }
      }
      
      const handlePostEngagement = (data) => {
        const postIdStr = post._id?.toString()
        const incomingId = data?.postId?.toString?.()
        if (!postIdStr || postIdStr !== incomingId) return
        setFollowPost((prev) =>
          prev.map((p) => (p._id?.toString() === postIdStr ? applyPostEngagement(p, data) : p)),
        )
      }
      
      socket.on('postUpdated', handlePostUpdated)
      socket.on('postEngagement', handlePostEngagement)
      
      return () => {
        socket.off('postUpdated', handlePostUpdated)
        socket.off('postEngagement', handlePostEngagement)
      }
    }, [socket, post?._id, setFollowPost])

    useEffect(() => {
      // Reset when opening a different post id
      setPostLoadFailed(false)
      missingPostHandledRef.current = false

      const getpost = async (opts = {}) => {
        const requestedId = String(id || '')
        if (!requestedId) return
        const silent = opts.silent === true

        try {
          const res = await fetch(postDetailApiUrl(id, { includeReplies: false }), {
            credentials: 'include',
          })

          const data = await res.json().catch(() => ({}))

          if (res.ok && data?._id) {
            setPostLoadFailed(false)
            missingPostHandledRef.current = false
            // Keep feed/profile list intact — update or insert the opened post by id.
            setFollowPost((prev) => {
              const nextPost = { ...data, replies: [] }
              const list = Array.isArray(prev) ? prev : []
              const idx = list.findIndex((p) => String(p?._id) === String(nextPost._id))
              if (idx >= 0) {
                const copy = [...list]
                copy[idx] = mergePostUpdate(list[idx], nextPost)
                return copy
              }
              return [nextPost, ...list]
            })
            setPostReplies([])
            setCommentsHasMore(false)
            commentsSkipRef.current = 0
            commentsFetchGenRef.current += 1
            if (!hideChannelPostComments(data) || footballMatchId) {
              fetchCommentsPageRef.current(false)
            }
            return
          }

          // Deleted / missing post (same idea as mobile PostDetailScreen)
          const msg = String(data?.message || data?.error || '').toLowerCase()
          const missing =
            res.status === 404 ||
            msg.includes('no post') ||
            msg.includes('not found') ||
            msg.includes('post not found')

          if (missing) {
            setFollowPost((prev) =>
              (Array.isArray(prev) ? prev : []).filter(
                (p) => String(p?._id) !== requestedId,
              ),
            )
            setPostLoadFailed(true)
            if (!missingPostHandledRef.current) {
              missingPostHandledRef.current = true
              if (!silent) {
                showToast('Info', 'Post not found', 'info')
              }
              if (window.history.length > 1) navigate(-1)
              else navigate('/notifications')
            }
          } else if (!silent) {
            setPostLoadFailed(true)
            showToast('Error', data?.error || data?.message || 'Failed to load post', 'error')
          }
        } catch (err) {
          console.error('Error loading post:', err)
          if (!silent && !missingPostHandledRef.current) {
            setPostLoadFailed(true)
            missingPostHandledRef.current = true
            showToast('Error', 'Failed to load post', 'error')
            if (window.history.length > 1) navigate(-1)
            else navigate('/notifications')
          }
        }
      }

      getpost()

      // Refresh post when page becomes visible (in case profile was updated)
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          getpost({ silent: true })
        }
      }
      document.addEventListener('visibilitychange', handleVisibilityChange)

      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }, [id, setFollowPost, footballMatchId, showToast, navigate])

  useEffect(() => {
    const el = loadMoreRef.current
    if (!el || !commentsHasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          fetchCommentsPageRef.current(true)
        }
      },
      { rootMargin: '240px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [commentsHasMore, topLevelReplies.length])




   
  
   if(!userpro && loading){
   
   
    return(
      <Flex justifyContent="center" minH="70vh" alignItems="center">
       <Spinner  size="xl"/>
      </Flex>
    )
  }
  

  console.log(followPost)
  
if(!post) {
  if (postLoadFailed) {
    return (
      <Flex justifyContent="center" minH="70vh" alignItems="center" direction="column" gap={3}>
        <Text color={textColor} fontWeight="600">
          Post not found
        </Text>
        <Button size="sm" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/notifications'))}>
          Go back
        </Button>
      </Flex>
    )
  }
  return (
    <Flex justifyContent="center" minH="70vh" alignItems="center">
      <Spinner size="xl" />
    </Flex>
  )
}
  
  





  const handleDeletepost = async() => {
    try{
    if(!window.confirm("Are you sure you want to delete this post"))return
   
    const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/${post._id}`,{
      credentials:"include",
      method:"DELETE"
    })
   
    const data = await res.json()

     if(res.ok){
      // Remove deleted post from context (keep rest of feed/profile list)
      setFollowPost((prev) =>
        (Array.isArray(prev) ? prev : []).filter((p) => String(p?._id) !== String(post._id)),
      )
      showToast("Success","POST deleted","success")
      navigate(`/${user.username}`)
     } else {
      showToast("Error", data.error || "Failed to delete post", "error")
     }
    }
    catch(error){
      console.log(error)
      showToast("Error","Failed to delete post","error")
    }
  }
   




  return (
    
    <Box minH="100vh" transition="opacity 0.2s">
    <Flex>
    
    <Flex w="full" alignItems="center" gap={3}>
      <Avatar 
        src={post?.postedBy?.profilePic || userpro?.profilePic} 
        size="sm" 
        bg="white" 
        name={post?.postedBy?.username || userpro?.username} 
      />
     
      <Flex>
        <Text fontSize="sm" fontWeight="bold">{post?.postedBy?.username || userpro?.username}</Text>
        <Image src="/verified.png" w={4} h={4} ml={4} />
      </Flex>
    

        





    </Flex>
      
     
     <Flex alignItems="center" gap={2}>
        <Text fontSize="sm" color="gray.light" textAlign="right" width={36}>
         {formatDistanceToNow(new Date(post.createdAt))} ago </Text>
        
        <PostEditorMenu
          post={post}
          onPostUpdated={applyPostUpdate}
          menuButtonProps={{ size: 'xs' }}
        />
        
        {/* Delete button only for owner */}
        {user?._id?.toString() === post?.postedBy?._id?.toString() && (
          <MdOutlineDeleteOutline onClick={handleDeletepost} style={{ cursor: 'pointer' }} />
        )}
     </Flex>


      </Flex>

    {/* Collaborative contributors (aligned with feed Post) */}
    {post?.isCollaborative &&
      Array.isArray(post?.contributors) &&
      post.contributors.length > 0 &&
      (() => {
        const ownerId =
          post?.postedBy?._id?.toString() ||
          post?.postedBy?.toString() ||
          userpro?._id?.toString() ||
          ''
        const displayContributors = post.contributors
          .filter((contributor) => {
            const contributorId = (contributor?._id || contributor)?.toString()
            return contributorId && contributorId !== ownerId
          })
          .slice(0, 8)

        if (displayContributors.length === 0) return null

        return (
          <Flex direction="column" gap={1.5} mt={3} mb={1}>
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
                      onClick={() => {
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
                      <Text
                        fontSize="10px"
                        color={secondaryTextColor}
                        noOfLines={1}
                        maxW="48px"
                        textAlign="center"
                      >
                        {label}
                      </Text>
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

    {userpro?.username !== 'Football' && <Text my={3}>{post?.text}</Text>}

    {isFootballPost && footballLoading && footballDisplayMatches.length === 0 && (
      <Flex justify="center" align="center" py={8} direction="column" gap={2}>
        <Spinner size="sm" color="blue.500" />
        <Text fontSize="sm" color={secondaryTextColor}>
          Loading matches…
        </Text>
      </Flex>
    )}

    {isFootballPost && !footballLoading && footballDisplayMatches.length === 0 && (
      <Box mt={3} mb={2} p={4} borderRadius="xl" borderWidth="1px" borderColor={borderColor} bg={cardBg} textAlign="center">
        <Text fontWeight="bold" color={textColor}>
          ⚽ No live matches right now
        </Text>
        <Text fontSize="sm" color={secondaryTextColor} mt={1}>
          Check back during match hours — or open the Football page for more.
        </Text>
      </Box>
    )}

    {isFootballPost && footballMatchesForView.length > 0 && (
      <FootballMatchCards matches={footballMatchesForView} enableNavigate={false} />
    )}

    {/* Weather Cards */}
    {isWeatherPost && weatherDataArray.length > 0 && (
      <VStack spacing={2} mt={3} mb={2} align="stretch">
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
          {weatherDataArray.map((weather, index) => (
            <Box
              key={index}
              bg={cardBg}
              borderRadius="lg"
              border="1px solid"
              borderColor={borderColor}
              p={3}
            >
              <Flex align="center" justify="space-between" mb={2}>
                <Text fontSize="sm" fontWeight="semibold" color={textColor}>
                  {weather.city}, {weather.country}
                </Text>
                {weather.icon && (
                  <img
                    src={`https://openweathermap.org/img/wn/${weather.icon}@2x.png`}
                    alt={weather.condition}
                    style={{ width: '40px', height: '40px' }}
                  />
                )}
              </Flex>
              <Text fontSize="xl" fontWeight="bold" color={textColor}>
                {weather.temperature}°C
              </Text>
              <Text fontSize="xs" color={secondaryTextColor} textTransform="capitalize" mt={1}>
                {weather.description}
              </Text>
              <Flex justify="space-between" mt={2} fontSize="xs" color={secondaryTextColor}>
                <HStack>
                  <Text>Humidity:</Text>
                  <Text fontWeight="semibold">{weather.humidity}%</Text>
                </HStack>
                <HStack>
                  <Text>Wind:</Text>
                  <Text fontWeight="semibold">{weather.windSpeed?.toFixed(1)} m/s</Text>
                </HStack>
              </Flex>
            </Box>
          ))}
        </SimpleGrid>
      </VStack>
    )}

    <Box
      key={`detail-media-${post._id}`}
      borderRadius={16}
      overflow="hidden"
      border="1px solid"
      borderColor="gray.light"
      my={3}
    >
      {(showCarousel || postHasDisplayableMedia(post)) && (
        showCarousel && carouselSlides.length > 0 ? (
          <PostMediaCarousel slides={carouselSlides} audioUrl={carouselAudio} frameHeight={POST_DETAIL_CAROUSEL_FRAME_H} />
        ) : post?.img && (post.img.includes('youtube.com/embed') || post.img.includes('youtu.be') || post.img.includes('youtube.com/watch')) ? (
          (() => {
            const isYouTubeEmbed = post.img.includes('youtube.com/embed')
            if (isYouTubeEmbed) {
              return (
                <Box position="relative" w="full" h="0" paddingBottom="56.25%" bg="black">
                  <iframe
                    src={post.img}
                    title="Live Stream"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                  />
                </Box>
              )
            }
            let videoId = ''
            if (post.img.includes('youtu.be/')) {
              videoId = post.img.split('youtu.be/')[1]?.split('?')[0] || ''
            } else if (post.img.includes('youtube.com/watch?v=')) {
              videoId = post.img.split('v=')[1]?.split('&')[0] || ''
            }
            if (videoId) {
              return (
                <Box position="relative" w="full" h="0" paddingBottom="56.25%" bg="black">
                  <iframe
                    src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
                    title="Live Stream"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                  />
                </Box>
              )
            }
            return null
          })()
        ) : post?.img && (post.img.match(/\.(mp4|webm|ogg|mov)$/i) || post.img.includes('/video/upload/')) ? (
          <Box
            as="video"
            src={post.img}
            controls
            autoPlay
            playsInline
            muted={false}
            w="full"
            maxH="500px"
            onLoadedMetadata={(e) => {
              e.currentTarget.play?.().catch(() => {})
            }}
          />
        ) : post?.img ? (
          <Box
            h={POST_DETAIL_CAROUSEL_FRAME_H}
            w="full"
            bg="black"
            display="flex"
            alignItems="center"
            justifyContent="center"
            overflow="hidden"
          >
            <Image src={post.img} maxH="100%" maxW="100%" w="auto" h="auto" objectFit="contain" />
          </Box>
        ) : showCarousel && carouselSlides.length > 0 ? (
          <PostMediaCarousel slides={carouselSlides} audioUrl={carouselAudio} frameHeight={POST_DETAIL_CAROUSEL_FRAME_H} />
        ) : null
      )}
    </Box>


       
     
     <Flex my={3} gap={3}>
        <Actions
          post={post}
          showFeedExtras={false}
          onReplyAdded={handleReplyAdded}
        />
      </Flex>
      

     




      <Divider my={4}/>
       
     
     <Flex justifyContent="space-between">
     
     <Flex alignItems="center" gap={2}>
      <Text fontSize="2xl">👏</Text>
      <Text>Get the app to like ,reply and post</Text>
     </Flex>

   
    <Button>Get</Button>

     </Flex>
  
      <Divider my={4}/>

    {/* Comments section - paginated from /api/post/:id/comments */}
    {showCommentsSection && (
    <Box data-comments-section pb={8}>
      {commentsLoading && topLevelReplies.length === 0 ? (
        <Flex justify="center" py={8}>
          <Spinner size="md" />
        </Flex>
      ) : topLevelReplies.length === 0 ? (
        <Text color={secondaryTextColor} textAlign="center" py={8}>
          No comments yet. Start the conversation.
        </Text>
      ) : (
        topLevelReplies.map((reply) => (
          <Box key={reply._id} data-comment-id={reply._id}>
            <Comment
              reply={reply}
              postId={post._id}
              allReplies={scopedReplies}
              postedBy={post.postedBy}
              onRepliesChange={setPostReplies}
              onReplyCountDelta={bumpReplyCount}
            />
          </Box>
        ))
      )}

      {commentsLoadingMore && (
        <Flex justify="center" py={4}>
          <Spinner size="sm" />
        </Flex>
      )}

      {commentsHasMore && <Box ref={loadMoreRef} h="1px" aria-hidden />}
    </Box>
    )}
   
    </Box>
  )
}

export default PostPage