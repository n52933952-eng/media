import React,{useEffect,useState,useContext, memo} from 'react'
import{Link} from 'react-router-dom'
import{Flex,Avatar,Box,Text,Image,Button, VStack, HStack, Grid, GridItem, useColorModeValue} from '@chakra-ui/react'
import { HiOutlineDotsHorizontal } from "react-icons/hi";
import Actions from '../Components/Actions'
import useShowToast from '../hooks/useShowToast.js'
import{useNavigate} from 'react-router-dom'
import{formatDistanceToNow} from 'date-fns'
import { MdOutlineDeleteOutline } from "react-icons/md";
import{UserContext} from '../context/UserContext'
import{PostContext} from '../context/PostContext'



const Post = ({post,postedBy}) => {
    

  const navigate = useNavigate()

const showToast = useShowToast()

 console.log({"postby":postedBy})

  const{user}=useContext(UserContext)
  const{followPost,setFollowPost}=useContext(PostContext)
  
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
  
  // Debug Al Jazeera posts
  if (postedBy?.username === 'AlJazeera') {
    console.log('🔴 Al Jazeera Post Data:', {
      username: postedBy.username,
      hasImg: !!post?.img,
      imgUrl: post?.img,
      isYouTube: post?.img?.includes('youtube')
    })
  }
  
  let matchesData = []
  if (isFootballPost) {
    try {
      matchesData = JSON.parse(post.footballData)
    } catch (e) {
      console.error('Failed to parse football data:', e)
    }
  }
  
  let chessGameData = null
  if (isChessPost) {
    try {
      chessGameData = JSON.parse(post.chessGameData)
    } catch (e) {
      console.error('Failed to parse chess game data:', e)
    }
  }
  
  const handleChessPostClick = () => {
    if (chessGameData) {
      // Navigate to chess page to view/spectate
      // Determine which player is the "opponent" from current user's perspective
      const currentUserId = user?._id?.toString()
      const player1Id = chessGameData.player1?._id
      const player2Id = chessGameData.player2?._id
      
      // Navigate to view the game (use player1 as opponent for now)
      navigate(`/chess/${player1Id}`)
    }
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
   
  
  
  const postContent = (
    <Flex gap={3}  mb="4" py={5}>
        
        
        <Flex flexDirection="column" alignItems="center">
           
            <Avatar 
              size="md" 
              src={postedBy?.profilePic} 
              name={postedBy?.name}
              loading="lazy"
              onClick={(e) => {
                e.preventDefault()
                navigate(`/${postedBy?.username}`)
              }}
            />
           
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
          onClick={(e) => {
            e.preventDefault()
            navigate(`/${postedBy?.username}`)
          }}
          cursor="pointer"
        >
         {postedBy?.name}
         </Text>
      
        <Image src="/verified.png" w={4} h={4} ml={1} />
     </Flex>
    
    
    
     <Flex alignItems="center" gap={2}>
        <Text fontSize="sm" color="gray.light" textAlign="right" width={36}>
         {post?.createdAt && formatDistanceToNow(new Date(post.createdAt))} ago </Text>
        
         {user?._id === postedBy?._id && <MdOutlineDeleteOutline onClick={handleDeletepost}/>}
     </Flex>
   
  
    </Flex>
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
  
  {/* Chess Game Post Display */}
  {isChessPost && chessGameData && (
    <Box
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
      
      <Flex align="center" justify="space-around" gap={4}>
        {/* Player 1 */}
        <VStack spacing={1}>
          <Avatar
            src={chessGameData.player1?.profilePic}
            name={chessGameData.player1?.name}
            size="md"
          />
          <Text fontSize="xs" fontWeight="semibold" color={textColor} textAlign="center">
            {chessGameData.player1?.name}
          </Text>
          <Text fontSize="xs" color={secondaryTextColor}>
            @{chessGameData.player1?.username}
          </Text>
        </VStack>
        
        <Text fontSize="xl" color={textColor} fontWeight="bold">
          vs
        </Text>
        
        {/* Player 2 */}
        <VStack spacing={1}>
          <Avatar
            src={chessGameData.player2?.profilePic}
            name={chessGameData.player2?.name}
            size="md"
          />
          <Text fontSize="xs" fontWeight="semibold" color={textColor} textAlign="center">
            {chessGameData.player2?.name}
          </Text>
          <Text fontSize="xs" color={secondaryTextColor}>
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
  
  
  <Flex gap={3} my={1}>
    <Actions post={post}/>
  </Flex>
  
   </Flex>
   
    </Flex>
  )

  return (
    <Link to={`/${postedBy?.username}/post/${post._id}`}>
      {postContent}
    </Link>
  )
}

// Memoize Post component to prevent unnecessary re-renders
export default memo(Post)
