import React,{useEffect,useState,useContext,useRef,useCallback} from 'react'
import { useLocation } from 'react-router-dom'
import useShowToast from '../hooks/useShowToast.js'
import{Spinner,Flex,Box,Text,useColorModeValue} from '@chakra-ui/react'
import Post from '../Components/Post'
import LivePostCard from '../Components/LivePostCard'
import {PostContext} from '../context/PostContext'
import {SocketContext} from '../context/SocketContext'
import {UserContext} from '../context/UserContext'
import SuggestedUsers from '../Components/SuggestedUsers'
import SuggestedChannels from '../Components/SuggestedChannels'
import ActivityFeed from '../Components/ActivityFeed'
import StoryStrip from '../Components/StoryStrip'



const HomePage = () => {
  const location = useLocation()
  const{followPost,setFollowPost}=useContext(PostContext)
  const {socket, liveStreams} = useContext(SocketContext) || {}
  const {user} = useContext(UserContext) || {}
  
  const[loading,setLoading]=useState(true)
  const[loadingMore,setLoadingMore]=useState(false)
  const[hasMore,setHasMore]=useState(true)
  const[error,setError]=useState(null)
  
  const showToast = useShowToast()
  const observerTarget = useRef(null) // For infinite scroll
  const isLoadingRef = useRef(false) // Prevent duplicate requests
  const hasLoadedRef = useRef(false) // Track if initial load happened
  const followPostCountRef = useRef(0) // Total posts in UI (socket / follow inserts)
  /** Matches backend `getFeedPost`: `skip` indexes `feedNormalPosts` only (excludes pinned Football/Weather/channels on page 1). */
  const normalFeedOffsetRef = useRef(0)



  // Fetch last 3 posts from a specific user (when they're followed)
  const fetchUserPosts = useCallback(async (userId) => {
    try {
      // First, check if this is the Football or Weather account by fetching user profile
      // The getUserPro endpoint accepts both username and userId
      let isFootballAccount = false
      let isWeatherAccount = false
      try {
        const userRes = await fetch(
          `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/getUserPro/${userId}`,
          { credentials: "include" }
        )
        const userData = await userRes.json()
        if (userRes.ok) {
          if (userData.username === 'Football') {
            isFootballAccount = true
          } else if (userData.username === 'Weather') {
            isWeatherAccount = true
          }
        }
      } catch (e) {
        console.error('Error checking account type:', e)
      }
      
      // If following Football account, add Football posts smoothly without refreshing entire feed
      // This prevents page jumping - SuggestedChannels component already handles adding Football posts
      if (isFootballAccount) {
        console.log('⚽ [fetchUserPosts] Following Football - posts will be added by SuggestedChannels component')
        // Don't refresh entire feed - let SuggestedChannels handle it smoothly
        // This prevents page jumping
        return
      }
      
      // If following Weather account, SuggestedChannels already handles it
      if (isWeatherAccount) {
        console.log('🌤️ [fetchUserPosts] Following Weather - posts will be added by SuggestedChannels component')
        // Don't refresh entire feed - let SuggestedChannels handle it smoothly
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
        // Save current scroll position to prevent page jumping
        const scrollY = window.scrollY
        
        // Add posts to feed and sort by date (newest first)
        setFollowPost(prev => {
          // Combine existing posts with new posts
          const combined = [...prev, ...data.posts]
          
          // Remove duplicates (in case post already exists)
          const unique = combined.filter((post, index, self) => 
            index === self.findIndex(p => p._id === post._id)
          )
          
          // Sort by updatedAt (or createdAt if no updatedAt) - matches backend sorting logic
          unique.sort((a, b) => {
            const dateA = new Date(a.updatedAt || a.createdAt).getTime()
            const dateB = new Date(b.updatedAt || b.createdAt).getTime()
            return dateB - dateA // Newest first
          })
          
          // Update ref with new count
          followPostCountRef.current = unique.length
          
          return unique
        })
        
        // Restore scroll position after state update to prevent page jumping
        requestAnimationFrame(() => {
          window.scrollTo({ top: scrollY, behavior: 'instant' })
        })
      }
    } catch (error) {
      // Silently fail - don't show error for background fetch
      console.error('Error fetching user posts:', error)
    }
  }, [setFollowPost])

  const getFeedPost = useCallback(async(loadMore = false, options = {}) => {
    const silent = options.silent === true
    // Prevent duplicate requests
    if (isLoadingRef.current) return
    isLoadingRef.current = true
    
    if (loadMore) {
      setLoadingMore(true)
    } else if (!silent) {
      setLoading(true)
      setError(null)
    }
    
    try{
      // Backend: skip=0 returns pinned + up to 12 normal; skip>0 slices feedNormalPosts only.
      // Do NOT use total UI post count as skip (would skip normal rows when pinned exist).
      const skip = loadMore ? normalFeedOffsetRef.current : 0
      
      console.log(`📥 [getFeedPost] Fetching posts: loadMore=${loadMore}, skip=${skip}, normalOffset=${normalFeedOffsetRef.current}`)
      
      const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/feed/feedpost?limit=10&skip=${skip}`,{
        credentials:"include",
      })

      const data = await res.json()

      if(data.error){
        setError(data.error)
        if (!silent) showToast("Error",data.error,"error")
      }

      if(res.ok){
        if (loadMore) {
          const batch = Array.isArray(data.posts) ? data.posts : []
          // Advance normal-feed cursor by what the server returned (page 2+ is normal-only)
          if (batch.length > 0) {
            normalFeedOffsetRef.current += batch.length
          }
          setFollowPost(prev => {
            const existingIds = new Set(prev.map(p => p._id?.toString()))
            const newPosts = batch.filter(p => !existingIds.has(p._id?.toString()))
            
            console.log(`📥 [getFeedPost] LoadMore: received ${batch.length} posts, ${newPosts.length} new posts, current feed has ${prev.length} posts`)
            
            // All duplicates (e.g. already inserted via socket): keep paging if server says hasMore
            if (newPosts.length === 0) {
              if (batch.length === 0) {
                setHasMore(false)
              }
              return prev
            }
            
            const updated = [...prev, ...newPosts]
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
          followPostCountRef.current = uniquePosts.length
          // Page 1 includes up to 12 normal posts from feedNormalPosts; totalCount is full normal list length
          const totalNormal = Number(data.totalCount)
          const safeTotal = Number.isFinite(totalNormal) ? totalNormal : 0
          normalFeedOffsetRef.current = Math.min(12, safeTotal)
        }
        
        const hasMoreValue = data.hasMore !== undefined ? data.hasMore : false
        console.log(`📥 [getFeedPost] Setting hasMore to: ${hasMoreValue}, totalCount: ${data.totalCount || 'N/A'}, normalOffset: ${normalFeedOffsetRef.current}`)
        setHasMore(hasMoreValue)
      }

    }
    catch(error){
      const errorMsg = error?.message || "Failed to fetch posts. Make sure backend server is running."
      setError(errorMsg)
      if (!silent) showToast("Error",errorMsg,"error")
    }finally{
      setLoading(false)
      setLoadingMore(false)
      isLoadingRef.current = false
    }
  }, [showToast, setFollowPost]) // Removed followPost.length to prevent unnecessary re-renders

  // Same as mobile FeedScreen: when user returns to the tab, refresh feed for latest Football/Weather posts
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (location.pathname !== '/home') return
      if (isLoadingRef.current) return
      getFeedPost(false, { silent: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [location.pathname, getFeedPost])
  
  // Initial load - use ref to track if already loaded
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true
      getFeedPost()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  // Keep feed synced with global live stream state (no manual refresh needed)
  useEffect(() => {
    if (!Array.isArray(liveStreams)) return
    setFollowPost(prev => {
      const withoutOldLive = prev.filter(p => !p?.isLive)
      const livePseudo = liveStreams.map(s => ({
        _id: `live_${s.streamerId}`,
        isLive: true,
        liveStreamId: s.streamerId,
        roomName: s.roomName,
        postedBy: {
          _id: s.streamerId,
          name: s.streamerName,
          profilePic: s.streamerProfilePic,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))
      // When liveStreams is empty, this returns only non-live posts,
      // which guarantees stale live cards are removed.
      return [...livePseudo, ...withoutOldLive]
    })
  }, [liveStreams, setFollowPost])

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

        const myId = user?._id?.toString?.()
        const isGamePost = !!(newPost?.chessGameData || newPost?.cardGameData)
        const contributors = newPost?.contributors
        const hasOtherContributor =
          !!newPost?.isCollaborative &&
          Array.isArray(contributors) &&
          contributors.some((c) => {
            const cid = (c?._id != null ? c._id : c)?.toString?.() ?? String(c)
            return cid && cid !== myId
          })
        if (myId && newPostAuthorId === myId && !isGamePost && !hasOtherContributor) {
          console.log('⚠️ [HomePage] Ignoring own post for feed (matches API):', newPost._id)
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
        
        // Sort all by updatedAt (or createdAt if no updatedAt) - matches backend sorting logic
        // This ensures Football posts with updated timestamps appear at the top
        updatedFeed.sort((a, b) => {
          const dateA = new Date(a.updatedAt || a.createdAt).getTime()
          const dateB = new Date(b.updatedAt || b.createdAt).getTime()
          return dateB - dateA // Newest first
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
        // Check if this is a Football post
        const postToDelete = prev.find(p => p._id?.toString() === postId?.toString())
        const isFootballPost = postToDelete?.postedBy?.username === 'Football' || postToDelete?.footballData || postToDelete?.text?.includes('Football Live')
        
        if (isFootballPost) {
          // Check if user still follows Football
          const userInfo = user || JSON.parse(localStorage.getItem('userInfo') || '{}')
          const followsFootball = userInfo?.following?.some(f => {
            if (typeof f === 'object' && f.username) {
              return f.username === 'Football'
            }
            return false
          }) || false
          
          // Only remove if user doesn't follow Football (unfollow action)
          if (!followsFootball) {
            console.log('✅ [handlePostDeleted] Removing Football post - user unfollowed Football')
            const updated = prev.filter(p => p._id?.toString() !== postId?.toString())
            followPostCountRef.current = updated.length
            return updated
          } else {
            console.log('⚠️ [handlePostDeleted] Ignoring Football post deletion - user still follows Football')
            return prev
          }
        }
        
        // For non-Football posts, always remove
        const updated = prev.filter(p => p._id?.toString() !== postId?.toString())
        followPostCountRef.current = updated.length
        console.log(`🗑️ [handlePostDeleted] Removed post ${postId}, feed now has ${updated.length} posts`)
        return updated
      })
    }

    const handlePostUpdated = (data) => {
      // Handle both formats: { postId, post } or just post object
      const postId = data.postId || data._id
      const updatedPost = data.post || data
      
      console.log('✏️ Post updated via socket:', postId)
      setFollowPost(prev => {
        const updatedPostIdStr = postId?.toString()
        if (!updatedPostIdStr) return prev

        const idx = prev.findIndex(p => p._id?.toString() === updatedPostIdStr)
        if (idx === -1) {
          // Post not in feed yet; don't add it here (new posts come via newPost or initial fetch)
          return prev
        }

        // Replace, then move/sort by updatedAt to make the update visible (Weather/Football updates)
        const replaced = {
          ...prev[idx],
          ...updatedPost,
        }

        const next = [replaced, ...prev.filter((_, i) => i !== idx)]

        next.sort((a, b) => {
          const dateA = new Date(a.updatedAt || a.createdAt).getTime()
          const dateB = new Date(b.updatedAt || b.createdAt).getTime()
          return dateB - dateA
        })

        followPostCountRef.current = next.length
        return next
      })
    }

    // Same as mobile FeedScreen: full feed refetch on Football/Weather socket events (live matches + cron page updates)
    const handleFootballFeedSync = () => {
      console.log('⚽ [HomePage] Football socket — silent feed refresh (matches mobile)')
      getFeedPost(false, { silent: true })
    }
    const handleWeatherFeedSync = () => {
      console.log('🌤️ [HomePage] Weather socket — silent feed refresh (matches mobile)')
      getFeedPost(false, { silent: true })
    }

    // Live stream: inject pseudo-post at the top when a followed user goes live
    const handleStreamStarted = (data) => {
      const pseudo = {
        _id:           `live_${data.streamerId}`,
        isLive:        true,
        liveStreamId:  data.streamerId,
        roomName:      data.roomName,
        postedBy:      { _id: data.streamerId, name: data.streamerName, profilePic: data.streamerProfilePic },
        createdAt:     new Date().toISOString(),
        updatedAt:     new Date().toISOString(),
      }
      setFollowPost(prev => {
        if (prev.some(p => p._id === pseudo._id)) return prev
        return [pseudo, ...prev]
      })
    }
    const handleStreamEnded = ({ streamerId }) => {
      setFollowPost(prev => prev.filter(p => p._id !== `live_${streamerId}`))
    }

    socket.on('newPost', handleNewPost)
    socket.on('postDeleted', handlePostDeleted)
    socket.on('postUpdated', handlePostUpdated)
    socket.on('footballPageUpdate', handleFootballFeedSync)
    socket.on('footballMatchUpdate', handleFootballFeedSync)
    socket.on('weatherUpdate', handleWeatherFeedSync)
    socket.on('livekit:streamStarted', handleStreamStarted)
    socket.on('livekit:streamEnded',   handleStreamEnded)

    return () => {
      socket.off('newPost', handleNewPost)
      socket.off('postDeleted', handlePostDeleted)
      socket.off('postUpdated', handlePostUpdated)
      socket.off('footballPageUpdate', handleFootballFeedSync)
      socket.off('footballMatchUpdate', handleFootballFeedSync)
      socket.off('weatherUpdate', handleWeatherFeedSync)
      socket.off('livekit:streamStarted', handleStreamStarted)
      socket.off('livekit:streamEnded',   handleStreamEnded)
    }
  }, [socket, setFollowPost, getFeedPost, user])
 
 

 


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
      </Box>

      {/* Main Feed - Center */}
      <Box 
        flex={{ base: 1, lg: '0 0 50%' }} 
        maxW={{ base: '100%', lg: '50%' }}
      >
        <StoryStrip />

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
            {followPost.map((post) =>
              post.isLive
                ? <LivePostCard key={post._id} post={post} />
                : <Post key={post._id} post={post} postedBy={post.postedBy} visibleVideoOnly />
            )}
            
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
