import React,{useEffect,useState,useContext} from 'react'
import{Avatar,Flex,Text,Image,Box,Divider,Button,Spinner} from '@chakra-ui/react'
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
  },[id])




   
  
   if(!userpro && loading){
   
   
    return(
      <Flex justifyContent="center">
       <Spinner  size="xl"/>
      </Flex>
    )
  }
  

  console.log(followPost)
  
if(!post) return
  
  





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
    
    <>
    <Flex>
    
    <Flex w="full" alignItems="center" gap={3}>
      <Avatar src={userpro?.porfilePic} size="sm" bg="white" name={userpro?.username} />
     
      <Flex>
        <Text fontSize="sm" fontWeight="bold">{userpro?.username}</Text>
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
          />
        </Box>
      ))}
    </Box>
   
 
     
      </>
  )
}

export default PostPage