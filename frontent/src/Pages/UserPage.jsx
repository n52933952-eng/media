import React,{useState,useEffect,useContext} from 'react'
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
   const{followPost}=useContext(PostContext)
    
   const showToast = useShowToast()
   
   const[posts,setPosts]=useState([])
   const[activeTab,setActiveTab]=useState('posts')
   const[comments,setComments]=useState([])
   const[loadingComments,setLoadingComments]=useState(false)
  const[loadingMoreComments,setLoadingMoreComments]=useState(false)
  const[hasMoreComments,setHasMoreComments]=useState(true)
  const[commentsSkip,setCommentsSkip]=useState(0)
  const COMMENTS_PER_PAGE = 9
   
   
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
    <Flex justifyContent="center">
      <Spinner size="xl"  />
    </Flex>
    
  )
}

  if(!user && !loading) return <h1>no user found</h1>
  

  

 if(!posts)return


  
   return (
   
   <>
    
      <UserHeader users={user} activeTab={activeTab} setActiveTab={setActiveTab}/>
      
      {activeTab === 'posts' ? (
        <>
          {loadingpost ? (
            <Flex justifyContent="center" py={8}>
              <Spinner size="xl" />
            </Flex>
          ) : (
            <>
              {posts && posts.length > 0 ? (
                <>
                  {posts.map((post) => (
                    <Post key={post._id} post={post} postedBy={post.postedBy} />
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
            </>
          )}
        </>
      ) : (
        <>
          {loadingComments ? (
            <Flex justifyContent="center" py={8}>
              <Spinner size="xl" />
            </Flex>
          ) : (
            <>
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
            </>
          )}
        </>
      )}
    
    </>
  )
}

export default UserPage