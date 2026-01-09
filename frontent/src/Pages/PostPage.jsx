import React,{useEffect,useState,useContext} from 'react'
import{Avatar,Flex,Text,Image,Box,Divider,Button,Spinner,VStack,HStack,Grid,GridItem,SimpleGrid,useColorModeValue} from '@chakra-ui/react'
import { HiDotsHorizontal } from "react-icons/hi";
import Actions from '../Components/Actions'
import Comment from '../Components/Comment'
import GetUserProfile from '../hooks/GetUserProfile.js'
import{useParams} from 'react-router-dom'
import{PostContext} from '../context/PostContext'
import{UserContext} from '../context/UserContext'
import { MdOutlineDeleteOutline } from "react-icons/md";
import{formatDistanceToNow} from 'date-fns'
import useShowToast from '../hooks/useShowToast.js'
import{useNavigate} from 'react-router-dom'


const PostPage = () => {
  
  
  const{userpro,loading}=GetUserProfile()
  
  const{id}=useParams()
  

   const{user}=useContext(UserContext)

   const{followPost,setFollowPost}=useContext(PostContext)

    const post = followPost[0]
    
    const showToast = useShowToast()


    const navigate = useNavigate()

    // Color modes
    const cardBg = useColorModeValue('white', '#252b3b')
    const borderColor = useColorModeValue('#e1e4ea', '#2d3548')
    const textColor = useColorModeValue('gray.800', 'white')
    const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
    
    // Check if this is a Football post with match data
    const isFootballPost = userpro?.username === 'Football' && post?.footballData
    
    // Check if this is a Weather post
    const isWeatherPost = userpro?.username === 'Weather' && post?.weatherData
    
    // Parse football match data
    const [matchesData, setMatchesData] = useState([])
    useEffect(() => {
      if (isFootballPost && post?.footballData) {
        try {
          const parsed = JSON.parse(post.footballData)
          setMatchesData(parsed)
        } catch (e) {
          console.error('Failed to parse football data:', e)
          setMatchesData([])
        }
      } else {
        setMatchesData([])
      }
    }, [post?.footballData, isFootballPost])
    
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

    useEffect(() => {
   
    const getpost = async() => {
    
      const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/${id}`,{
        credentials: "include",
      })

      const data = await res.json()

      if(res.ok){
        setFollowPost([data])
      }
      }

   getpost()
   
   // Refresh post when page becomes visible (in case profile was updated)
   const handleVisibilityChange = () => {
     if (document.visibilityState === 'visible') {
       getpost()
     }
   }
   document.addEventListener('visibilitychange', handleVisibilityChange)
   
   return () => {
     document.removeEventListener('visibilitychange', handleVisibilityChange)
   }
  },[id])




   
  
   if(!userpro && loading){
   
   
    return(
      <Flex justifyContent="center" minH="70vh" alignItems="center">
       <Spinner  size="xl"/>
      </Flex>
    )
  }
  

  console.log(followPost)
  
if(!post) {
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
      // Remove post from context
      setFollowPost([])
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
        
         {user?._id === post?.postedBy && <MdOutlineDeleteOutline onClick={handleDeletepost}/>}
     </Flex>


      </Flex>

    <Text my={3}>{post?.text}</Text>

    {/* Football Match Cards - Visual Table */}
    {isFootballPost && matchesData.length > 0 && (
      <VStack spacing={3} mt={3} mb={2} align="stretch">
        {matchesData.map((match, index) => {
          const isLive = ['1H', '2H', 'HT', 'BT', 'ET', 'P', 'LIVE'].includes(match.status?.short)
          const isFinished = ['FT', 'AET', 'PEN'].includes(match.status?.short)
          const hasScore = match.score?.home !== null && match.score?.home !== undefined
          const goalEvents = (match.events || []).filter(e => e.type === 'Goal')
          
          return (
          <Box
            key={index}
            bg={cardBg}
            borderRadius="lg"
            border="1px solid"
            borderColor={borderColor}
            p={3}
            _hover={{ shadow: 'md' }}
            transition="all 0.2s"
          >
            {/* League Header */}
              <Flex align="center" mb={3} pb={2} borderBottom="1px solid" borderColor={borderColor}>
              {match.league?.logo && (
                <Image src={match.league.logo} boxSize="16px" mr={2} alt={match.league.name} />
              )}
              <Text fontSize="xs" fontWeight="semibold" color={secondaryTextColor}>
                {match.league?.name || 'Premier League'}
              </Text>
                
                {/* Live/Status Badge */}
                {isLive && (
                  <Flex ml="auto" align="center" bg="red.500" px={2} py={0.5} borderRadius="md">
                    <Box w="6px" h="6px" bg="white" borderRadius="full" mr={1} />
                    <Text fontSize="xs" fontWeight="bold" color="white">
                      {match.status?.short === 'HT' ? 'HALF TIME' : `LIVE ${match.status?.elapsed || ''}'`}
                    </Text>
                  </Flex>
                )}
                
                {isFinished && (
                  <Text ml="auto" fontSize="xs" fontWeight="bold" color="gray.500">
                    FT
                  </Text>
                )}
            </Flex>
            
            {/* Match Details */}
              <Flex align="center" justify="space-between" mb={2}>
              {/* Home Team */}
              <Flex align="center" flex={1} mr={2}>
                {match.homeTeam?.logo && (
                    <Image src={match.homeTeam.logo} boxSize="28px" mr={2} alt={match.homeTeam.name} />
                )}
                  <Text fontSize="sm" fontWeight="bold" color={textColor} noOfLines={1}>
                  {match.homeTeam?.name || 'Home'}
                </Text>
              </Flex>
              
                {/* Score or Time */}
                <Flex align="center" justify="center" minW="80px" direction="column">
                  {hasScore ? (
                    <Flex align="center" gap={2}>
                      <Text fontSize="xl" fontWeight="bold" color={textColor}>
                        {match.score.home ?? 0}
                      </Text>
                      <Text fontSize="lg" fontWeight="bold" color={secondaryTextColor}>
                        -
                      </Text>
                      <Text fontSize="xl" fontWeight="bold" color={textColor}>
                        {match.score.away ?? 0}
                      </Text>
                    </Flex>
                  ) : (
                <Text fontSize="xs" fontWeight="bold" color={secondaryTextColor}>
                  ⏰ {match.time}
                </Text>
                  )}
              </Flex>
              
              {/* Away Team */}
              <Flex align="center" flex={1} ml={2} justify="flex-end">
                  <Text fontSize="sm" fontWeight="bold" color={textColor} noOfLines={1} textAlign="right">
                  {match.awayTeam?.name || 'Away'}
                </Text>
                {match.awayTeam?.logo && (
                    <Image src={match.awayTeam.logo} boxSize="28px" ml={2} alt={match.awayTeam.name} />
                )}
              </Flex>
            </Flex>
              
              {/* Goal Events - Grouped by Team */}
              {goalEvents.length > 0 && (
                <Box mt={3} pt={3} borderTop="1px solid" borderColor={borderColor}>
                  <Grid templateColumns="1fr auto 1fr" gap={2} fontSize="xs">
                    {/* Home Team Goals */}
                    <GridItem textAlign="right">
                      {goalEvents
                        .filter(e => e.team === match.homeTeam?.name)
                        .map((event, idx) => (
                          <Text key={idx} color={textColor} mb={1}>
                            {event.player} {event.time !== '?' && event.time ? `${event.time}'` : ''}{event.detail?.includes('Penalty') || event.detail?.includes('PENALTY') ? ' (P)' : ''}
                          </Text>
                        ))}
                    </GridItem>
                    
                    {/* Goal Icon Center */}
                    <GridItem display="flex" alignItems="flex-start" justifyContent="center">
                      <Text color={secondaryTextColor}>⚽</Text>
                    </GridItem>
                    
                    {/* Away Team Goals */}
                    <GridItem textAlign="left">
                      {goalEvents
                        .filter(e => e.team === match.awayTeam?.name)
                        .map((event, idx) => (
                          <Text key={idx} color={textColor} mb={1}>
                            {event.player} {event.time !== '?' && event.time ? `${event.time}'` : ''}{event.detail?.includes('Penalty') || event.detail?.includes('PENALTY') ? ' (P)' : ''}
                          </Text>
                        ))}
                    </GridItem>
                  </Grid>
                </Box>
              )}
          </Box>
          )
        })}
        
        {/* Footer Link */}
        <Text fontSize="xs" color={secondaryTextColor} textAlign="center" mt={1}>
          🔗 Check Football page for live updates!
        </Text>
      </VStack>
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

    <Box borderRadius={16} overflow={"hidden"} border={"1px solid"} borderColor={"gray.light"} my={3}>
      {post?.img && (() => {
        // Check if it's a YouTube embed URL (channel posts use this format)
        const isYouTubeEmbed = post.img.includes('youtube.com/embed')
        
        if (isYouTubeEmbed) {
          // Use the embed URL directly (already in correct format from backend)
          return (
            <Box
              position="relative"
              w="full"
              h="0"
              paddingBottom="56.25%" // 16:9 aspect ratio
              bg="black"
            >
              <iframe
                src={post.img} // Use URL directly (already includes autoplay=1&mute=0)
                title="Live Stream"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  border: 'none'
                }}
              />
            </Box>
          )
        }
        
        // Check if it's a regular YouTube URL (youtu.be or watch format)
        const isYouTube = post.img.includes('youtu.be') || post.img.includes('youtube.com/watch')
        if (isYouTube) {
          // Extract YouTube video ID and convert to embed format
          let videoId = ''
          if (post.img.includes('youtu.be/')) {
            videoId = post.img.split('youtu.be/')[1]?.split('?')[0] || ''
          } else if (post.img.includes('youtube.com/watch?v=')) {
            videoId = post.img.split('v=')[1]?.split('&')[0] || ''
          }
          
          if (videoId) {
            return (
              <Box
                position="relative"
                w="full"
                h="0"
                paddingBottom="56.25%"
                bg="black"
              >
                <iframe
                  src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
                  title="Live Stream"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    border: 'none'
                  }}
                />
              </Box>
            )
          }
        }
        
        // Check if it's a video file
        if (post.img.match(/\.(mp4|webm|ogg|mov)$/i) || post.img.includes('/video/upload/')) {
          return (
        <Box
          as="video"
          src={post.img}
          controls
          w="full"
          maxH="500px"
        />
          )
        }
        
        // Default to image
        return <Image src={post?.img} w={"full"} objectFit="contain" maxH="500px" />
      })()}
    </Box>


       
     
     <Flex my={3} gap={3}>
        <Actions post={post}/>
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

    {/* Comments section - for auto-scrolling after adding comment */}
    <Box data-comments-section>
      {/* Show only top-level comments (parentReplyId is null or undefined) */}
      {post.replies
      .filter((reply) => !reply.parentReplyId)
      .map((reply) => (
        <Box key={reply._id} data-comment-id={reply._id}>  {/* Add data attribute for scrolling */}
          <Comment 
            reply={reply} 
            postId={post._id}
            allReplies={post.replies}  // Pass all replies so Comment can find nested ones
            postedBy={post.postedBy}  // Pass post owner so Comment can check delete permissions
          />
        </Box>
      ))}
    </Box>
   
 
     
    </Box>
  )
}

export default PostPage