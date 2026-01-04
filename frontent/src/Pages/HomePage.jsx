import React,{useEffect,useState,useContext,useRef,useCallback} from 'react'
import useShowToast from '../hooks/useShowToast.js'
import{Spinner,Flex,Box,Text,useColorModeValue} from '@chakra-ui/react'
import Post from '../Components/Post'
import {PostContext} from '../context/PostContext'
import {SocketContext} from '../context/SocketContext'
import SuggestedUsers from '../Components/SuggestedUsers'
import SuggestedChannels from '../Components/SuggestedChannels'
import ChessChallenge from '../Components/ChessChallenge'
import ChessNotification from '../Components/ChessNotification'
import ActivityFeed from '../Components/ActivityFeed'



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
  const followPostCountRef = useRef(0) // Track current post count for pagination



  // Fetch last 3 posts from a specific user (when they're followed)
  const fetchUserPosts = useCallback(async (userId) => {
    try {
      // First, check if this is the Football account by fetching user profile
      // The getUserPro endpoint accepts both username and userId
      let isFootballAccount = false
      try {
        const userRes = await fetch(
          `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/getUserPro/${userId}`,
          { credentials: "include" }
        )
        const userData = await userRes.json()
        if (userRes.ok && userData.username === 'Football') {
          isFootballAccount = true
        }
      } catch (e) {
        console.error('Error checking if Football account:', e)
      }
      
      // If following Football account, refresh the entire feed to ensure Football post is included
      if (isFootballAccount) {
        console.log('⚽ [fetchUserPosts] Following Football, refreshing entire feed...')
        // Reset and reload feed to ensure Football post is included
        followPostCountRef.current = 0
        getFeedPost(false) // Reload feed from scratch
        return
      }
      
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
          
          // Update ref with new count
          followPostCountRef.current = unique.length
          
          return unique
        })
      }
    } catch (error) {
      // Silently fail - don't show error for background fetch
      console.error('Error fetching user posts:', error)
    }
  }, [setFollowPost, getFeedPost])

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
      // Calculate skip: for loadMore, use ref value (always up-to-date)
      const skip = loadMore ? followPostCountRef.current : 0
      
      console.log(`📥 [getFeedPost] Fetching posts: loadMore=${loadMore}, skip=${skip}, currentCount=${followPostCountRef.current}`)
      
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
          // When loading more, check for duplicates
          setFollowPost(prev => {
            const existingIds = new Set(prev.map(p => p._id?.toString()))
            const newPosts = (data.posts || []).filter(p => !existingIds.has(p._id?.toString()))
            
            console.log(`📥 [getFeedPost] LoadMore: received ${data.posts?.length || 0} posts, ${newPosts.length} new posts, current feed has ${prev.length} posts`)
            
            // If no new posts, set hasMore to false to stop infinite loading
            if (newPosts.length === 0) {
              console.log('⚠️ [getFeedPost] No new posts, stopping pagination')
              setHasMore(false)
              return prev
            }
            
            const updated = [...prev, ...newPosts]
            // Update ref with new count
            followPostCountRef.current = updated.length
            return updated
          })
        } else {
          // Initial load: Remove duplicates from the response itself (in case backend returns duplicates)
          const posts = data.posts || []
          const uniquePosts = posts.filter((post, index, self) => 
            index === self.findIndex(p => p._id?.toString() === post._id?.toString())
          )
          console.log(`📥 [getFeedPost] Initial load: received ${posts.length} posts, ${uniquePosts.length} unique posts`)
          setFollowPost(uniquePosts)
          // Update ref with initial count
          followPostCountRef.current = uniquePosts.length
        }
        
        const hasMoreValue = data.hasMore !== undefined ? data.hasMore : false
        console.log(`📥 [getFeedPost] Setting hasMore to: ${hasMoreValue}, totalCount: ${data.totalCount || 'N/A'}`)
        setHasMore(hasMoreValue)
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
      // Add new post to the top of the feed, maintaining "3 newest posts per user" rule
      setFollowPost(prev => {
        // Check if post already exists (prevent duplicates) - compare by _id string
        const exists = prev.some(p => {
          const prevId = p._id?.toString()
          const newId = newPost._id?.toString()
          return prevId === newId
        })
        if (exists) {
          console.log('⚠️ [HomePage] Duplicate post detected, skipping:', newPost._id)
          return prev
        }
        
        // Get the author ID of the new post
        const newPostAuthorId = newPost.postedBy?._id?.toString() || newPost.postedBy?.toString()
        
        if (!newPostAuthorId) {
          console.log('⚠️ [HomePage] New post has no author, skipping:', newPost._id)
          return prev
        }
        
        // Filter out posts from the same author
        const postsFromOtherAuthors = prev.filter(p => {
          const postAuthorId = p.postedBy?._id?.toString() || p.postedBy?.toString()
          return postAuthorId !== newPostAuthorId
        })
        
        // Get posts from the same author (excluding the new one)
        const postsFromSameAuthor = prev.filter(p => {
          const postAuthorId = p.postedBy?._id?.toString() || p.postedBy?.toString()
          return postAuthorId === newPostAuthorId
        })
        
        // Sort same author posts by createdAt (newest first)
        postsFromSameAuthor.sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime()
          const dateB = new Date(b.createdAt).getTime()
          return dateB - dateA
        })
        
        // Keep only the 2 newest posts from same author (new post will be the 3rd)
        // This maintains the "3 newest posts per user" rule
        const keptSameAuthorPosts = postsFromSameAuthor.slice(0, 2)
        
        // Combine: new post + kept same author posts + other authors' posts
        const updatedFeed = [newPost, ...keptSameAuthorPosts, ...postsFromOtherAuthors]
        
        // Sort all by createdAt (newest first) to maintain chronological order
        updatedFeed.sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime()
          const dateB = new Date(b.createdAt).getTime()
          return dateB - dateA
        })
        
        // Update ref with new count
        followPostCountRef.current = updatedFeed.length
        
        console.log(`✅ [HomePage] Added new post to feed (maintained 3 newest per user rule):`, newPost._id)
        return updatedFeed
      })
    }

    const handlePostDeleted = ({ postId }) => {
      console.log('🗑️ Post deleted via socket:', postId)
      setFollowPost(prev => {
        const updated = prev.filter(p => p._id !== postId)
        followPostCountRef.current = updated.length
        return updated
      })
    }

    const handlePostUpdated = (updatedPost) => {
      console.log('✏️ Post updated via socket:', updatedPost._id)
      setFollowPost(prev => 
        prev.map(p => p._id === updatedPost._id ? updatedPost : p)
      )
    }

    // Handle real-time football match updates
    const handleFootballMatchUpdate = (data) => {
      const { postId, matchData } = data
      console.log('⚽ Real-time match update received:', postId)
      
      setFollowPost(prev => {
        // Find the post that was updated
        const postIndex = prev.findIndex(p => p._id?.toString() === postId?.toString())
        
        if (postIndex !== -1) {
          // Update the post with new match data
          const updated = {
            ...prev[postIndex],
            footballData: JSON.stringify(matchData),
            updatedAt: new Date() // Update timestamp for sorting
          }
          
          // Remove the old post and move updated one to the top
          const filtered = prev.filter((p, idx) => idx !== postIndex)
          return [updated, ...filtered]
        }
        
        // If post not found, just return previous state (don't add as new post)
        console.log('⚠️ [HomePage] Football post not found in feed, skipping update')
        return prev
      })
    }

    socket.on('newPost', handleNewPost)
    socket.on('postDeleted', handlePostDeleted)
    socket.on('postUpdated', handlePostUpdated)
    socket.on('footballMatchUpdate', handleFootballMatchUpdate)

    return () => {
      socket.off('newPost', handleNewPost)
      socket.off('postDeleted', handlePostDeleted)
      socket.off('postUpdated', handlePostUpdated)
      socket.off('footballMatchUpdate', handleFootballMatchUpdate)
    }
  }, [socket, setFollowPost])
 
 

 


  const bgColor = useColorModeValue('white', '#101010')
  const textColor = useColorModeValue('gray.600', 'gray.400')

  return (
    <Flex gap={6} alignItems="flex-start">
      {/* Suggested Channels & News - Left Side */}
      <Box 
        flex={{ base: '0', lg: '0 0 22%' }} 
        display={{ base: 'none', lg: 'block' }}
        maxW={{ base: '0', lg: '22%' }}
        minW={{ lg: '220px' }}
      >
        <SuggestedChannels onUserFollowed={fetchUserPosts} />
        <ChessChallenge />
      </Box>

      {/* Main Feed - Center */}
      <Box 
        flex={{ base: 1, lg: '0 0 50%' }} 
        maxW={{ base: '100%', lg: '50%' }}
      >
        {/* Chess Challenges - Always at top */}
        <ChessNotification />

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
        <ActivityFeed />
        <SuggestedUsers onUserFollowed={fetchUserPosts} />
      </Box>
    </Flex>
  )
}

export default HomePage
