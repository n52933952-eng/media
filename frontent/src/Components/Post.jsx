import React,{useEffect,useState,useContext, memo} from 'react'
import{Link} from 'react-router-dom'
import{Flex,Avatar,Box,Text,Image,Button, VStack, HStack, Grid, GridItem, useColorModeValue, useDisclosure, Menu, MenuButton, MenuList, MenuItem, IconButton, Tooltip} from '@chakra-ui/react'
import { HiOutlineDotsHorizontal } from "react-icons/hi";
import { MdOutlineDeleteOutline, MdPersonRemove } from "react-icons/md";
import { BsThreeDotsVertical } from "react-icons/bs";
import Actions from '../Components/Actions'
import useShowToast from '../hooks/useShowToast.js'
import{useNavigate} from 'react-router-dom'
import{formatDistanceToNow} from 'date-fns'
import{UserContext} from '../context/UserContext'
import{PostContext} from '../context/PostContext'
import AddContributorModal from './AddContributorModal'
import ManageContributorsModal from './ManageContributorsModal'
import FootballIcon from './FootballIcon'



const Post = ({post,postedBy}) => {
    

  const navigate = useNavigate()

const showToast = useShowToast()

 console.log({"postby":postedBy})

  // Debug: Log collaborative post data
  useEffect(() => {
    if (post?.isCollaborative) {
      console.log('🔵 Collaborative Post Data:', {
        postId: post._id,
        owner: post.postedBy,
        contributors: post.contributors,
        contributorsCount: post.contributors?.length,
        contributorsData: post.contributors?.map(c => ({
          id: c?._id || c,
          name: c?.name,
          username: c?.username,
          profilePic: c?.profilePic
        }))
      })
    }
  }, [post?.isCollaborative, post?.contributors])

  const{user}=useContext(UserContext)
  const{followPost,setFollowPost}=useContext(PostContext)
  const { isOpen: isAddContributorOpen, onOpen: onAddContributorOpen, onClose: onAddContributorClose } = useDisclosure()
  const { isOpen: isManageContributorsOpen, onOpen: onManageContributorsOpen, onClose: onManageContributorsClose } = useDisclosure()
  
  // Color modes
  const bgColor = useColorModeValue('#f7f9fc', '#1a1d2e')
  const cardBg = useColorModeValue('white', '#252b3b')
  const borderColor = useColorModeValue('#e1e4ea', '#2d3548')
  const textColor = useColorModeValue('gray.800', 'white')
  const secondaryTextColor = useColorModeValue('gray.600', 'gray.400')
  
  // Check if this is a Football post with match data
  const isFootballPost = postedBy?.username === 'Football' && post?.footballData
  
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
  
  // Don't render the entire post if it should be hidden
  if (hideChessPost) {
    return null
  }
  
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
  
  // Parse initial football data
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
  
  // Listen for real-time football match updates
  useEffect(() => {
    if (!isFootballPost || !post?._id) return
    
    const handleMatchUpdate = (event) => {
      const { postId, matchData, updatedAt } = event.detail
      
      // Only update if this is the correct post
      if (postId === post._id.toString()) {
        console.log('⚽ Updating match data for post:', postId)
        setMatchesData(matchData)
        
        // Move post to top of feed
        if (setFollowPost) {
          setFollowPost(prev => {
            const filtered = prev.filter(p => p._id !== post._id)
            // Get updated post and move to top
            const updatedPost = { ...post, footballData: JSON.stringify(matchData) }
            return [updatedPost, ...filtered]
          })
        }
      }
    }
    
    window.addEventListener('footballMatchUpdate', handleMatchUpdate)
    
    return () => {
      window.removeEventListener('footballMatchUpdate', handleMatchUpdate)
    }
  }, [isFootballPost, post?._id, post, setFollowPost])
  
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
        <Text fontSize="sm" color="gray.light" textAlign="right" width={36}>
         {post?.createdAt && formatDistanceToNow(new Date(post.createdAt))} ago </Text>
        
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
          // Filter out the owner from contributors list for display (owner is shown separately)
          // Handle both cases: postedBy as object with _id, or as direct ID
          const ownerId = postedBy?._id?.toString() || post.postedBy?._id?.toString() || post.postedBy?.toString() || postedBy?.toString()
          const displayContributors = post.contributors.filter((contributor) => {
            const contributorId = (contributor?._id || contributor)?.toString()
            // Skip if this contributor is the owner
            return contributorId && contributorId !== ownerId
          }).slice(0, 5)
          
          // If no contributors after filtering (only owner), don't show contributors section
          if (displayContributors.length === 0) return null
          
          return (
            <Flex align="center" gap={1} ml="auto" flexWrap="wrap">
              <Text fontSize="xs" color={secondaryTextColor}>
                Contributors:
              </Text>
              {displayContributors.map((contributor, idx) => {
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
    
     <Text>{post.text}</Text>
  
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
          cursor="pointer"
          onClick={() => {
            if (post?._id && postedBy?.username) {
              navigate(`/${postedBy.username}/post/${post._id}`)
            }
          }}
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
                    <Text color="white" filter="drop-shadow(0 0 1px rgba(0,0,0,0.5))">⚽</Text>
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
  
  {post?.img && !isFootballPost && !isChessPost && (
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
          src={post.img}
          controls
          w="full"
          maxH="400px"
        />
      ) : (
        <Image 
          src={post?.img} 
          w="full" 
          objectFit="contain" 
          maxH="400px"
          loading="lazy"
          alt="Post image"
        />
      )}
    </Box>
  )}
  
  
  <Flex gap={3} my={1} align="center">
    <Actions post={post}/>
    
    {/* Collaborative Post Actions */}
    {post?.isCollaborative && (
      (user?._id === postedBy?._id || 
       (post?.contributors && Array.isArray(post.contributors) && 
        post.contributors.some(c => (c._id || c).toString() === user?._id?.toString()))) && (
      <HStack spacing={2}>
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
        
        {/* Manage Contributors Menu (only for owner) */}
        {user?._id === postedBy?._id && post?.contributors && post.contributors.length > 0 && (
          <Menu>
            <MenuButton
              as={IconButton}
              icon={<BsThreeDotsVertical />}
              size="xs"
              variant="ghost"
              aria-label="Manage contributors"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
            />
            <MenuList>
              <MenuItem
                icon={<MdPersonRemove />}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onManageContributorsOpen()
                }}
              >
                Manage Contributors
              </MenuItem>
            </MenuList>
          </Menu>
        )}
      </HStack>
      )
    )}
    
    {/* Add Contributor Modal */}
    <AddContributorModal
      isOpen={isAddContributorOpen}
      onClose={onAddContributorClose}
      post={post}
      onContributorAdded={async () => {
        // Refresh post data
        try {
          const postRes = await fetch(
            `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/${post._id}`,
            { credentials: 'include' }
          )
          const postData = await postRes.json()
          if (postRes.ok && postData) {
            // Update post in feed
            setFollowPost(prev => prev.map(p => p._id === post._id ? postData : p))
          }
        } catch (error) {
          console.error('Error refreshing post:', error)
        }
      }}
    />
    
    {/* Manage Contributors Modal */}
    <ManageContributorsModal
      isOpen={isManageContributorsOpen}
      onClose={onManageContributorsClose}
      post={post}
      onContributorRemoved={async () => {
        // Refresh post data
        try {
          const postRes = await fetch(
            `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/${post._id}`,
            { credentials: 'include' }
          )
          const postData = await postRes.json()
          if (postRes.ok && postData) {
            // Update post in feed
            setFollowPost(prev => prev.map(p => p._id === post._id ? postData : p))
          }
        } catch (error) {
          console.error('Error refreshing post:', error)
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

  return (
    <Link to={`/${postedBy?.username}/post/${post._id}`}>
      {postContent}
    </Link>
  )
}

// Memoize Post component to prevent unnecessary re-renders
export default memo(Post)
