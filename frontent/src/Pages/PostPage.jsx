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
      showToast("Success","POST deleted","success")
     }
     navigate(`/${user.username}`)
    }
    catch(error){
      console.log(error)
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

    <Box borderRadius={16} overflow={"hidden"} border={"1px solid"} borderColor={"gray.light"}>
    <Image src={post?.img} w={"full"} objectFit="contain" maxH="300px" />
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