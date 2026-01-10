import React,{useState,useEffect,useContext,useCallback} from 'react'
import UserHeader from '../Components/UserHeader'
import UserPost from '../Components/UserPost'
import{useParams} from 'react-router-dom'
import useShowToast from '../hooks/useShowToast'
import{Spinner,Flex,Button,Text,Box,Avatar,useColorModeValue} from '@chakra-ui/react'
import Post from '../Components/Post'
import{UserContext} from '../context/UserContext'
import{PostContext} from '../context/PostContext'

const UserPage = () => {
 
  
   const[user,setUser]=useState(null)
   const[loading,setLoading]=useState(true)
   
   const[loadingpost,setLoadingpost]=useState(true)
   const[loadingMore,setLoadingMore]=useState(false)
   const[hasMore,setHasMore]=useState(true)
   const[skip,setSkip]=useState(0)
   const POSTS_PER_PAGE = 9

   const{username}=useParams()
   const{user:currentUser}=useContext(UserContext)
   const{followPost,setFollowPost}=useContext(PostContext)
    
   const showToast = useShowToast()
   
   const[posts,setPosts]=useState([])
   const[activeTab,setActiveTab]=useState('posts')
   const[comments,setComments]=useState([])
   const[loadingComments,setLoadingComments]=useState(false)
  const[loadingMoreComments,setLoadingMoreComments]=useState(false)
  const[hasMoreComments,setHasMoreComments]=useState(true)
  const[commentsSkip,setCommentsSkip]=useState(0)
  const COMMENTS_PER_PAGE = 9
   
   
   // Fetch last 3 posts from a specific user (when they're followed)
   const fetchFollowedUserPosts = useCallback(async (userId) => {
     try {
       // First, check if this is the Weather account
       let isWeatherAccount = false
       try {
         const userRes = await fetch(
           `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/getUserPro/${userId}`,
           { credentials: "include" }
         )
         const userData = await userRes.json()
         if (userRes.ok && userData.username === 'Weather') {
           isWeatherAccount = true
         }
       } catch (e) {
         console.error('Error checking if Weather account:', e)
       }
       
       // If following Weather account, create onboarding post
       if (isWeatherAccount) {
         console.log('🌤️ [UserPage] Following Weather - creating onboarding post')
         const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
         
         setTimeout(async () => {
           try {
             // Fetch weather account details
             const userRes = await fetch(
               `${baseUrl}/api/user/getUserPro/Weather`,
               { credentials: "include" }
             )
             const weatherAccount = await userRes.json()
             
             if (userRes.ok && weatherAccount) {
               // Create onboarding post
               const onboardingPost = {
                 _id: `weather-onboarding-${Date.now()}`,
                 postedBy: weatherAccount,
                 text: `🌤️ Welcome to Weather Updates!\n\n👉 Visit the Weather page to select your cities and see personalized weather in your feed.\n\nClick below to get started! ⬇️`,
                 weatherOnboarding: true, // Special flag for onboarding
                 createdAt: new Date().toISOString(),
                 updatedAt: new Date().toISOString(),
                 likes: [],
                 replies: []
               }
               
               // Save scroll position to prevent page jumping
               const scrollY = window.scrollY
               
               // Add onboarding post to feed immediately
               setFollowPost(prev => {
                 // Check if onboarding post already exists
                 const exists = prev.some(p => p.weatherOnboarding === true)
                 if (exists) {
                   console.log('⚠️ [UserPage] Weather onboarding post already in feed')
                   return prev
                 }
                 // Add to top of feed
                 console.log('✅ [UserPage] Added Weather onboarding post to feed')
                 return [onboardingPost, ...prev]
               })
               
               // Restore scroll position after state update
               requestAnimationFrame(() => {
                 window.scrollTo({ top: scrollY, behavior: 'instant' })
               })
             }
           } catch (err) {
             console.error('Weather onboarding post error:', err)
           }
         }, 500) // 500ms delay to ensure follow is saved
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
   
   const fetchUser = async() => {
       setLoading(true)
      try{
     const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/getUserPro/${username}`,{
       credentials: "include",
     })
      
      const data = await res.json()
       
      if(data.error){
        showToast("error",data.error,"error")
      }
      if(res.ok){
        setUser(data)
      }
      }
      catch(error){
        console.log(error)
      }finally{
        setLoading(false)
      }
    }


   useEffect(() => {
    fetchUser()
   },[username,showToast])
  


 const fetchUserPost = async(isLoadMore = false) => {
   if (isLoadMore) {
     setLoadingMore(true)
   } else {
     setLoadingpost(true)
     setSkip(0)
     setPosts([])
   }
  
  try{
    const currentSkip = isLoadMore ? skip : 0
    const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/user/${username}?limit=${POSTS_PER_PAGE}&skip=${currentSkip}`,{
      credentials:"include",
    })

   const data = await res.json()

   if(res.ok){
     const newPosts = data.posts || data || []
     
     if (isLoadMore) {
       // Append new posts to existing ones
       setPosts(prev => [...prev, ...newPosts])
       setSkip(prev => prev + POSTS_PER_PAGE)
     } else {
       // Replace posts for initial load
       setPosts(newPosts)
       setSkip(POSTS_PER_PAGE)
     }
     
     // Check if there are more posts
     setHasMore(newPosts.length === POSTS_PER_PAGE)
   } 

  }
  catch(error){
    console.log(error)
    showToast("Error", "Failed to load posts", "error")
  }finally{
    setLoadingpost(false)
    setLoadingMore(false)
  }
 }
 
 const handleLoadMore = () => {
   fetchUserPost(true)
 }
 
 // Fetch user comments/replies
 const fetchUserComments = async (isLoadMore = false) => {
   if (isLoadMore) {
     setLoadingMoreComments(true)
   } else {
     setLoadingComments(true)
     setCommentsSkip(0)
     setComments([])
   }
   
   try {
     // Calculate skip: for loadMore, use current comments length (more reliable than state)
     const currentSkip = isLoadMore ? comments.length : 0
     const res = await fetch(
       `${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/comments/user/${username}?limit=${COMMENTS_PER_PAGE}&skip=${currentSkip}`,
       { credentials: "include" }
     )
     
     const data = await res.json()
     
     if (res.ok && data.comments) {
       if (isLoadMore) {
         setComments(prev => [...prev, ...data.comments])
         setCommentsSkip(prev => prev + COMMENTS_PER_PAGE)
       } else {
         setComments(data.comments)
         setCommentsSkip(COMMENTS_PER_PAGE)
       }
       setHasMoreComments(data.hasMore !== undefined ? data.hasMore : false)
     } else {
       showToast("Error", data.error || "Failed to load comments", "error")
     }
   } catch (error) {
     console.error('Error fetching comments:', error)
     showToast("Error", "Failed to load comments", "error")
   } finally {
     setLoadingComments(false)
     setLoadingMoreComments(false)
   }
 }
 
 // Fetch comments when Replies tab is active
 useEffect(() => {
   if (activeTab === 'replies' && user) {
     fetchUserComments()
   }
   // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [activeTab, username, user])



  useEffect(() => {
   fetchUserPost()
   setSkip(0)
   setHasMore(true)
   setActiveTab('posts') // Reset to posts tab when username changes
  },[username])

  // Listen for new posts created by current user and add them immediately to profile page
  useEffect(() => {
    // Only update if viewing own profile page
    if (!currentUser || !username || currentUser.username !== username) return
    if (!followPost || followPost.length === 0) return
    
    // Find the newest post that belongs to this user and isn't already in posts
    const newPost = followPost.find(p => {
      const postUsername = p.postedBy?.username || p.postedBy?.username
      return postUsername === username && !posts.some(existingPost => existingPost._id === p._id)
    })
    
    if (newPost) {
      // Add new post at the top of the list immediately
      setPosts(prev => {
        // Double check to prevent duplicates
        const exists = prev.some(p => p._id === newPost._id)
        if (exists) return prev
        return [newPost, ...prev]
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followPost, username, currentUser])


if(!user && loading){
  return(
    <Flex justifyContent="center" minH="60vh" alignItems="center">
      <Spinner size="xl"  />
    </Flex>
    
  )
}

  if(!user && !loading) return <h1>no user found</h1>
  

  

 if(!posts)return


  
   return (
   
   <Box minH="100vh">
    
      <UserHeader users={user} activeTab={activeTab} setActiveTab={setActiveTab} onUserFollowed={fetchFollowedUserPosts}/>
      
      {activeTab === 'posts' ? (
        <>
          {loadingpost ? (
            <Flex justifyContent="center" py={8} minH="400px" alignItems="center" transition="opacity 0.2s">
              <Spinner size="xl" />
            </Flex>
          ) : (
            <Box transition="opacity 0.2s">
              {posts && posts.length > 0 ? (
                <>
                  {posts.map((post) => (
                    <Post 
                      key={post._id} 
                      post={post} 
                      postedBy={post.postedBy}
                      onDelete={(postId) => {
                        // Remove post from local state immediately
                        setPosts(prev => prev.filter(p => p._id !== postId))
                      }}
                    />
                  ))}
                  
                  {hasMore && (
                    <Flex justifyContent="center" py={6}>
                      <Button
                        onClick={handleLoadMore}
                        isLoading={loadingMore}
                        loadingText="Loading..."
                        colorScheme="blue"
                        size="md"
                      >
                        Load More
                      </Button>
                    </Flex>
                  )}
                </>
              ) : (
                <Box textAlign="center" py={8}>
                  <Text fontSize="lg" color="gray.500">
                    No posts yet
                  </Text>
                </Box>
              )}
            </Box>
          )}
        </>
      ) : (
        <>
          {loadingComments ? (
            <Flex justifyContent="center" py={8} minH="400px" alignItems="center" transition="opacity 0.2s">
              <Spinner size="xl" />
            </Flex>
          ) : (
            <Box transition="opacity 0.2s">
              {comments && comments.length > 0 ? (
                <>
                  {comments.map((comment) => (
                    <Box key={comment._id} mb={4} p={4} bg={useColorModeValue('white', '#1a1a1a')} borderRadius="md" border="1px solid" borderColor={useColorModeValue('gray.200', '#2d2d2d')}>
                      <Flex gap={3} mb={2}>
                        <Avatar 
                          src={comment.userProfilePic} 
                          name={comment.username} 
                          size="sm" 
                        />
                        <Box flex={1}>
                          <Flex align="center" gap={2} mb={1}>
                            <Text fontWeight="bold" fontSize="sm">{comment.username}</Text>
                            <Text fontSize="xs" color="gray.500">
                              {new Date(comment.date).toLocaleDateString()}
                            </Text>
                          </Flex>
                          <Text fontSize="sm" mb={3}>{comment.text}</Text>
                          
                          {/* Show the post this comment is on */}
                          <Box 
                            p={2} 
                            bg={useColorModeValue('gray.50', '#2d2d2d')} 
                            borderRadius="md" 
                            cursor="pointer"
                            onClick={() => window.location.href = `/${comment.post.postedBy?.username || 'post'}/post/${comment.post._id}`}
                            _hover={{ bg: useColorModeValue('gray.100', '#3d3d3d') }}
                          >
                            <Flex gap={2} align="center" mb={1}>
                              <Avatar 
                                src={comment.post.postedBy?.profilePic} 
                                name={comment.post.postedBy?.name} 
                                size="xs" 
                              />
                              <Text fontSize="xs" fontWeight="semibold">
                                {comment.post.postedBy?.name}
                              </Text>
                            </Flex>
                            {comment.post.text && (
                              <Text fontSize="xs" color="gray.500" noOfLines={2}>
                                {comment.post.text}
                              </Text>
                            )}
                            {comment.post.img && (
                              <Text fontSize="xs" color="blue.400" mt={1}>
                                📷 Image
                              </Text>
                            )}
                          </Box>
                        </Box>
                      </Flex>
                    </Box>
                  ))}
                  
                  {hasMoreComments && (
                    <Flex justifyContent="center" py={6}>
                      <Button
                        onClick={() => fetchUserComments(true)}
                        isLoading={loadingMoreComments}
                        loadingText="Loading..."
                        colorScheme="blue"
                        size="md"
                      >
                        Load More
                      </Button>
                    </Flex>
                  )}
                </>
              ) : (
                <Box textAlign="center" py={8}>
                  <Text fontSize="lg" color="gray.500">
                    No comments yet
                  </Text>
                </Box>
              )}
            </Box>
          )}
        </>
      )}
    
    </Box>
  )
}

export default UserPage