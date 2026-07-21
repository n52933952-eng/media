import React,{useEffect,useState,useContext,useRef,useCallback} from 'react'
import { useLocation } from 'react-router-dom'
import useShowToast from '../hooks/useShowToast.js'
import{Spinner,Flex,Box,Text,useColorModeValue} from '@chakra-ui/react'
import Post from '../Components/Post'
import LivePostCard from '../Components/LivePostCard'
import {PostContext} from '../context/PostContext'
import {SocketContext} from '../context/SocketContext'
import {UserContext} from '../context/UserContext'
import { useLiveBroadcast } from '../context/LiveBroadcastContext'
import SuggestedUsers from '../Components/SuggestedUsers'
import SuggestedChannels from '../Components/SuggestedChannels'
import ActivityFeed from '../Components/ActivityFeed'
import StoryStrip from '../Components/StoryStrip'
import MobileHomePanel from '../Components/MobileHomePanel'
import { dedupeGamePostsForFeed } from '../utils/dedupeGameFeedPosts.js'
import {
  getGameFeedDedupeKey,
  isGoFishFeedPost,
  mergeGameFeedPostData,
  isChessFeedPost,
} from '../utils/gameFeedPostUtils.js'
import { isFollowingUserId, mergePostUpdate } from '../utils/postUtils.js'
import { applyPostEngagement } from '../hooks/usePostEngagementSubscription.js'
import AdsterraFeedNative, { getAdsterraFeedEvery } from '../Components/ads/AdsterraFeedNative.jsx'



const HomePage = () => {
  const location = useLocation()
  const{followPost,setFollowPost}=useContext(PostContext)
  const filterFeedPosts = useContext(PostContext)?.filterFeedPosts ?? ((list) => list)
  const {socket, liveStreams} = useContext(SocketContext) || {}
  const {user} = useContext(UserContext) || {}
  const { isLive } = useLiveBroadcast()
  const myUserId = user?._id != null ? String(user._id) : ''

  const isOwnLivePost = useCallback((post) => {
    if (!myUserId || !post?.isLive) return false
    const authorId = post.postedBy?._id != null ? String(post.postedBy._id) : ''
    const postId = post._id != null ? String(post._id) : ''
    return authorId === myUserId || postId === `live_${myUserId}`
  }, [myUserId])
  
  const[loading,setLoading]=useState(true)
  const[loadingMore,setLoadingMore]=useState(false)
  const[hasMore,setHasMore]=useState(true)
  const[error,setError]=useState(null)
  
  const showToast = useShowToast()
  const observerTarget = useRef(null) // For infinite scroll
  const isLoadingRef = useRef(false) // Prevent duplicate requests
  const hasLoadedRef = useRef(false) // Track if initial load happened
  const followPostCountRef = useRef(0) // Total posts in UI (socket / follow inserts)
  const feedCursorRef = useRef(null)
  const footballUserIdRef = useRef(null)



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
          const dedupedGame = dedupeGamePostsForFeed(unique)
          
          // Sort by updatedAt (or createdAt if no updatedAt) - matches backend sorting logic
          dedupedGame.sort((a, b) => {
            const dateA = new Date(a.updatedAt || a.createdAt).getTime()
            const dateB = new Date(b.updatedAt || b.createdAt).getTime()
            return dateB - dateA // Newest first
          })
          
          const filtered = filterFeedPosts(dedupedGame)
          followPostCountRef.current = filtered.length
          
          return filtered
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
  }, [setFollowPost, filterFeedPosts])

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
      const limit = 10
      let url = `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/feed/feedpost?limit=${limit}`

      if (loadMore) {
        const token = feedCursorRef.current
        if (!token) {
          isLoadingRef.current = false
          setLoadingMore(false)
          return
        }
        if (token.startsWith('skip:')) {
          url += `&skip=${encodeURIComponent(token.slice(5))}`
        } else {
          url += `&cursor=${encodeURIComponent(token)}`
        }
      } else {
        feedCursorRef.current = null
      }

      console.log(`📥 [getFeedPost] Fetching posts: loadMore=${loadMore}, cursor=${feedCursorRef.current || 'none'}`)
      
      const res = await fetch(url, {
        credentials:"include",
      })

      const data = await res.json()

      if(data.error){
        setError(data.error)
        if (!silent) showToast("Error",data.error,"error")
      }

      if(res.ok){
        const batch = Array.isArray(data.posts) ? data.posts : []
        const responseHasMore = data.hasMore !== undefined ? data.hasMore : batch.length === limit

        if (data.nextCursor != null && String(data.nextCursor).trim() !== '') {
          feedCursorRef.current = String(data.nextCursor)
        } else if (responseHasMore && typeof data.nextSkip === 'number') {
          feedCursorRef.current = `skip:${data.nextSkip}`
        } else {
          feedCursorRef.current = null
        }

        if (loadMore) {
          setFollowPost(prev => {
            const existingIds = new Set(prev.map(p => p._id?.toString()))
            const newPosts = batch.filter(p => !existingIds.has(p._id?.toString()))
            
            console.log(`📥 [getFeedPost] LoadMore: received ${batch.length} posts, ${newPosts.length} new posts, current feed has ${prev.length} posts`)
            
            if (newPosts.length === 0) {
              if (batch.length === 0) {
                setHasMore(false)
              }
              return prev
            }
            
            const updated = dedupeGamePostsForFeed([...prev, ...newPosts])
            followPostCountRef.current = updated.length
            return filterFeedPosts(updated)
          })
        } else {
          const uniquePosts = batch.filter((post, index, self) => 
            index === self.findIndex(p => p._id?.toString() === post._id?.toString())
          )
          const dedupedPosts = dedupeGamePostsForFeed(uniquePosts)
          console.log(`📥 [getFeedPost] Initial load: received ${batch.length} posts, ${dedupedPosts.length} after dedupe`)
          setFollowPost(filterFeedPosts(dedupedPosts))
          followPostCountRef.current = dedupedPosts.length
        }
        
        console.log(`📥 [getFeedPost] Setting hasMore to: ${responseHasMore}, cursor: ${feedCursorRef.current || 'none'}`)
        setHasMore(responseHasMore)
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
  }, [showToast, setFollowPost, filterFeedPosts])

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

  // Cache Football account id for follow checks (following[] is id list, not { username })
  useEffect(() => {
    if (footballUserIdRef.current) return
    const base = import.meta.env.PROD ? window.location.origin : 'http://localhost:5000'
    fetch(`${base}/api/user/getUserPro/Football`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        const id = data?._id || data?.user?._id
        if (id) footballUserIdRef.current = String(id)
      })
      .catch(() => {})
  }, [])

  // Keep feed synced with global live stream state (no manual refresh needed)
  useEffect(() => {
    if (!Array.isArray(liveStreams)) return
    setFollowPost(prev => {
      const withoutOldLive = prev.filter(p => !p?.isLive)
      const livePseudo = liveStreams
        .filter(s => !(isLive && myUserId && String(s.streamerId) === myUserId))
        .map(s => ({
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
  }, [liveStreams, setFollowPost, isLive, myUserId])

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

        const newGameKey = getGameFeedDedupeKey(newPost)
        if (newGameKey) {
          const dupIdx = prev.findIndex((p) => getGameFeedDedupeKey(p) === newGameKey)
          if (dupIdx >= 0) {
            const merged = mergeGameFeedPostData(prev[dupIdx], newPost)
            if (merged !== prev[dupIdx]) {
              const next = [...prev]
              next[dupIdx] = merged
              return next
            }
            console.log('⚠️ [HomePage] Same chess/card game already in feed, skipping:', newGameKey)
            return prev
          }
        }
        
        // Get the author ID of the new post
        const newPostAuthorId = newPost.postedBy?._id?.toString() || newPost.postedBy?.toString()
        
        if (!newPostAuthorId) {
          console.log('⚠️ [HomePage] New post has no author, skipping:', newPost._id)
          return prev
        }

        const myId = user?._id?.toString?.()
        const isGamePost = isChessFeedPost(newPost) || isGoFishFeedPost(newPost)
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
        
        const dedupedFeed = dedupeGamePostsForFeed(updatedFeed)
        const filtered = filterFeedPosts(dedupedFeed)
        followPostCountRef.current = filtered.length
        
        console.log(`✅ [HomePage] Added new post to feed (maintained 3 newest per user rule):`, newPost._id)
        return filtered
      })
    }

    const handlePostDeleted = ({ postId }) => {
      console.log('🗑️ Post deleted via socket:', postId)
      setFollowPost(prev => {
        // Check if this is a Football post
        const postToDelete = prev.find(p => p._id?.toString() === postId?.toString())
        const isFootballPost = postToDelete?.postedBy?.username === 'Football' || postToDelete?.footballData || postToDelete?.text?.includes('Football Live')
        
        if (isFootballPost) {
          const footballUserId =
            postToDelete?.postedBy?._id?.toString() ||
            footballUserIdRef.current ||
            null
          if (footballUserId) footballUserIdRef.current = footballUserId

          const userInfo = user || JSON.parse(localStorage.getItem('userInfo') || '{}')
          const followsFootball = footballUserId
            ? isFollowingUserId(userInfo?.following, footballUserId)
            : false
          
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
        const replaced = mergePostUpdate(prev[idx], updatedPost)

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

    const normalizeStreamerId = (raw) => {
      if (raw == null || raw === '') return ''
      if (typeof raw === 'string') return raw.trim()
      if (typeof raw === 'object' && raw != null && typeof raw.toString === 'function') {
        return String(raw.toString()).trim()
      }
      return String(raw).trim()
    }

    // Live stream: inject pseudo-post at the top when a followed user goes live
    const handleStreamStarted = (data) => {
      const sid = normalizeStreamerId(data?.streamerId)
      if (!sid) return
      if (myUserId && sid === myUserId && isLive) return
      const pseudo = {
        _id:           `live_${sid}`,
        isLive:        true,
        liveStreamId:  sid,
        roomName:      data.roomName,
        postedBy:      { _id: sid, name: data.streamerName, profilePic: data.streamerProfilePic },
        createdAt:     new Date().toISOString(),
        updatedAt:     new Date().toISOString(),
      }
      setFollowPost(prev => {
        if (prev.some(p => String(p._id) === pseudo._id)) return prev
        return [pseudo, ...prev]
      })
    }
    const handleStreamEnded = (payload) => {
      const sid = normalizeStreamerId(payload?.streamerId)
      if (!sid) return
      const liveId = `live_${sid}`
      setFollowPost(prev => prev.filter(p => String(p._id) !== liveId))
    }

    const handlePostEngagement = (data) => {
      const postId = data?.postId?.toString?.()
      if (!postId) return
      setFollowPost((prev) =>
        prev.map((p) => (p._id?.toString?.() === postId ? applyPostEngagement(p, data) : p)),
      )
    }

    socket.on('newPost', handleNewPost)
    socket.on('postDeleted', handlePostDeleted)
    socket.on('postUpdated', handlePostUpdated)
    socket.on('postEngagement', handlePostEngagement)
    socket.on('footballPageUpdate', handleFootballFeedSync)
    socket.on('footballMatchUpdate', handleFootballFeedSync)
    socket.on('weatherUpdate', handleWeatherFeedSync)
    socket.on('livekit:streamStarted', handleStreamStarted)
    socket.on('livekit:streamEnded',   handleStreamEnded)

    return () => {
      socket.off('newPost', handleNewPost)
      socket.off('postDeleted', handlePostDeleted)
      socket.off('postUpdated', handlePostUpdated)
      socket.off('postEngagement', handlePostEngagement)
      socket.off('footballPageUpdate', handleFootballFeedSync)
      socket.off('footballMatchUpdate', handleFootballFeedSync)
      socket.off('weatherUpdate', handleWeatherFeedSync)
      socket.off('livekit:streamStarted', handleStreamStarted)
      socket.off('livekit:streamEnded',   handleStreamEnded)
    }
  }, [socket, setFollowPost, getFeedPost, user, myUserId, isLive, filterFeedPosts])

 


  const bgColor = useColorModeValue('white', '#101010')
  const textColor = useColorModeValue('gray.600', 'gray.400')

  return (
    <Box w="100%" maxW="100%" overflow="hidden">
      <Box display={{ base: 'block', lg: 'none' }} px={{ base: 3, md: 4 }}>
        <MobileHomePanel />
        <Box mt={3} mb={4}>
          <SuggestedUsers onUserFollowed={fetchUserPosts} embedded />
        </Box>
      </Box>

    <Flex gap={{ base: 3, md: 6 }} alignItems="flex-start" flexDirection={{ base: 'column', md: 'row' }} w="100%">
      {/* Suggested Channels & News - Left Side */}
      <Box 
        flex={{ base: '0', lg: '0 0 22%' }} 
        display={{ base: 'none', lg: 'block' }}
        maxW={{ base: '0', lg: '22%' }}
        minW={{ lg: '220px' }}
      >
        <SuggestedChannels />
      </Box>

      {/* Main Feed - Center */}
      <Box
        id="home-feed-anchor"
        flex={{ base: 1, lg: '0 0 50%' }}
        w={{ base: '100%', lg: 'auto' }}
        minW={0}
        maxW={{ base: '100%', lg: '50%' }}
        px={{ base: 0, md: 0 }}
      >
        <Box px={{ base: 3, md: 0 }} w="100%">
          <StoryStrip />
        </Box>

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

        {/* Posts list — Native Banner (Adsterra) every N posts when env is set */}
        {!loading && followPost.length > 0 && (
          <>
            {(() => {
              const visible = followPost.filter((p) => !isLive || !isOwnLivePost(p))
              const every = getAdsterraFeedEvery()
              const nodes = []
              visible.forEach((post, index) => {
                nodes.push(
                  post.isLive
                    ? <LivePostCard key={post._id} post={post} />
                    : <Post key={post._id} post={post} postedBy={post.postedBy} visibleVideoOnly showFeedExtras />,
                )
                // After every Nth post (default N=1 → post, ad, post, ad…)
                if ((index + 1) % every === 0) {
                  nodes.push(
                    <AdsterraFeedNative key={`adsterra-native-${post._id || index}`} slotKey={`feed-${index}`} />,
                  )
                }
              })
              return nodes
            })()}
            
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

    </Box>
  )
}

export default HomePage
