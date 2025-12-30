import React,{useEffect,useState,useContext,useRef,useCallback} from 'react'
import useShowToast from '../hooks/useShowToast.js'
import{Spinner,Flex,Box,Text,useColorModeValue} from '@chakra-ui/react'
import Post from '../Components/Post'
import {PostContext} from '../context/PostContext'
import {SocketContext} from '../context/SocketContext'
import SuggestedUsers from '../Components/SuggestedUsers'
import FootballWidget from '../Components/FootballWidget'



const HomePage = () => {
  const{followPost,setFollowPost}=useContext(PostContext)
  const {socket} = useContext(SocketContext) || {}
  
  const[loading,setLoading]=useState(true)
  const[loadingMore,setLoadingMore]=useState(false)
  const[hasMore,setHasMore]=useState(true)
  const[error,setError]=useState(null)
  
  const showToast = useShowToast()
  const observerTarget = useRef(null) // For infinite scroll
  const isLoadingRef = useRef(false) // Prevent duplicate requests
  const hasLoadedRef = useRef(false) // Track if initial load happened



  // Fetch last 3 posts from a specific user (when they're followed)
  const fetchUserPosts = useCallback(async (userId) => {
    try {
      const res = await fetch(
        `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/user/id/${userId}?limit=3`,
        {
          credentials: "include",
        }
      )

      const data = await res.json()

      if (res.ok && data.posts && data.posts.length > 0) {
        // Add posts to feed and sort by date (newest first)
        setFollowPost(prev => {
          // Combine existing posts with new posts
          const combined = [...prev, ...data.posts]
          
          // Remove duplicates (in case post already exists)
          const unique = combined.filter((post, index, self) => 
            index === self.findIndex(p => p._id === post._id)
          )
          
          // Sort by createdAt (newest first) - same logic as feed
          unique.sort((a, b) => {
            const dateA = new Date(a.createdAt).getTime()
            const dateB = new Date(b.createdAt).getTime()
            return dateB - dateA
          })
          
          return unique
        })
      }
    } catch (error) {
      // Silently fail - don't show error for background fetch
    }
  }, [setFollowPost])

  const getFeedPost = useCallback(async(loadMore = false) => {
    // Prevent duplicate requests
    if (isLoadingRef.current) return
    isLoadingRef.current = true
    
    if (loadMore) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setError(null)
    }
    
    try{
      const skip = loadMore ? followPost.length : 0
      const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/feed/feedpost?limit=10&skip=${skip}`,{
        credentials:"include",
      })

      const data = await res.json()

      if(data.error){
        setError(data.error)
        showToast("Error",data.error,"error")
      }

      if(res.ok){
        if (loadMore) {
          setFollowPost(prev => [...prev, ...(data.posts || [])])
        } else {
          setFollowPost(data.posts || [])
        }
        setHasMore(data.hasMore || false)
      }

    }
    catch(error){
      const errorMsg = error?.message || "Failed to fetch posts. Make sure backend server is running."
      setError(errorMsg)
      showToast("Error",errorMsg,"error")
    }finally{
      setLoading(false)
      setLoadingMore(false)
      isLoadingRef.current = false
    }
  }, [showToast, setFollowPost]) // Removed followPost.length to prevent unnecessary re-renders
  
  // Initial load - use ref to track if already loaded
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true
      getFeedPost()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  // Infinite scroll with Intersection Observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          getFeedPost(true)
        }
      },
      { threshold: 0.1 }
    )

    const currentTarget = observerTarget.current
    if (currentTarget) {
      observer.observe(currentTarget)
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget)
      }
    }
  }, [hasMore, loadingMore, loading, getFeedPost])

  // Real-time post updates via Socket.IO
  useEffect(() => {
    if (!socket) return

    const handleNewPost = (newPost) => {
      console.log('📨 New post received via socket:', newPost._id)
      // Add new post to the top of the feed
      setFollowPost(prev => {
        // Check if post already exists (prevent duplicates)
        const exists = prev.some(p => p._id === newPost._id)
        if (exists) return prev
        return [newPost, ...prev]
      })
    }

    const handlePostDeleted = ({ postId }) => {
      console.log('🗑️ Post deleted via socket:', postId)
      setFollowPost(prev => prev.filter(p => p._id !== postId))
    }

    const handlePostUpdated = (updatedPost) => {
      console.log('✏️ Post updated via socket:', updatedPost._id)
      setFollowPost(prev => 
        prev.map(p => p._id === updatedPost._id ? updatedPost : p)
      )
    }

    socket.on('newPost', handleNewPost)
    socket.on('postDeleted', handlePostDeleted)
    socket.on('postUpdated', handlePostUpdated)

    return () => {
      socket.off('newPost', handleNewPost)
      socket.off('postDeleted', handlePostDeleted)
      socket.off('postUpdated', handlePostUpdated)
    }
  }, [socket, setFollowPost])
 
 

 


  const bgColor = useColorModeValue('white', '#101010')
  const textColor = useColorModeValue('gray.600', 'gray.400')

  return (
    <Flex gap={6} alignItems="flex-start">
      {/* Football Widget - Left Side */}
      <Box 
        flex={{ base: '0', lg: '0 0 22%' }} 
        display={{ base: 'none', lg: 'block' }}
        maxW={{ base: '0', lg: '22%' }}
        minW={{ lg: '220px' }}
      >
        <FootballWidget />
      </Box>

      {/* Main Feed - Center */}
      <Box 
        flex={{ base: 1, lg: '0 0 50%' }} 
        maxW={{ base: '100%', lg: '50%' }}
      >
        {/* Error state */}
        {error && !loading && (
          <Box textAlign="center" p={8} bg={bgColor} borderRadius="md" mb={4}>
            <Text color="red.500">{error}</Text>
          </Box>
        )}

        {/* Empty state */}
        {!loading && followPost.length === 0 && !error && (
          <Box textAlign="center" p={12} bg={bgColor} borderRadius="md">
            <Text fontSize="xl" fontWeight="bold" mb={2}>
              No posts yet
            </Text>
            <Text color={textColor}>
              Follow some users to see their posts in your feed
            </Text>
          </Box>
        )}
        
        {/* Initial loading */}
        {loading && (
          <Flex justifyContent="center" p={8}>
            <Spinner size="xl" thickness="4px" speed="0.65s" />
          </Flex>
        )}

        {/* Posts list */}
        {!loading && followPost.length > 0 && (
          <>
            {followPost.map((post) => (
              <Post key={post._id} post={post} postedBy={post.postedBy} />
            ))}
            
            {/* Infinite scroll trigger element */}
            <Box ref={observerTarget} h="20px" />
            
            {/* Loading more indicator */}
            {loadingMore && (
              <Flex justifyContent="center" p={4}>
                <Spinner size="md" thickness="3px" />
              </Flex>
            )}
            
            {/* End of feed message */}
            {!hasMore && followPost.length > 0 && (
              <Box textAlign="center" p={8}>
                <Text color={textColor} fontSize="sm">
                  You've reached the end of your feed
                </Text>
              </Box>
            )}
          </>
        )}
      </Box>

      {/* Suggested Users Sidebar - Right Side */}
      <Box 
        flex={{ base: '0 0 100%', md: '0 0 35%', lg: '0 0 25%' }} 
        display={{ base: 'none', md: 'block' }}
        maxW={{ base: '100%', md: '35%', lg: '25%' }}
        pl={{ md: 6, lg: 4 }}
        pt={4}
      >
        <SuggestedUsers onUserFollowed={fetchUserPosts} />
      </Box>
    </Flex>
  )
}

export default HomePage
