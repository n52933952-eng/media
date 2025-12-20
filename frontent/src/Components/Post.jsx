import React,{useEffect,useState,useContext} from 'react'
import{Link} from 'react-router-dom'
import{Flex,Avatar,Box,Text,Image,Button} from '@chakra-ui/react'
import { HiOutlineDotsHorizontal } from "react-icons/hi";
import Actions from '../Components/Actions'
import useShowToast from '../hooks/useShowToast.js'
import{useNavigate} from 'react-router-dom'
import{formatDistanceToNow} from 'date-fns'
import { MdOutlineDeleteOutline } from "react-icons/md";
import{UserContext} from '../context/UserContext'



const Post = ({post,postedBy}) => {
    

  const navigate = useNavigate()

const showToast = useShowToast()

 console.log({"postby":postedBy})

  const{user}=useContext(UserContext)


  const handleDeletepost = async(e) => {
    e.preventDefault()

    try{
    if(!window.confirm("Are you sure you want to delete this post"))return
   
    const res = await fetch(`http://localhost:5000/api/post/${post._id}`,{
      credentials:"include",
      method:"DELETE"
    })
   
    const data = await res.json()

     if(res.ok){
      showToast("Success","POST deleted","success")
     }
    }
    catch(error){
      console.log(error)
    }
  }
   
  
  
  const postContent = (
    <Flex gap={3}  mb="4" py={5}>
        
        
        <Flex flexDirection="column" alignItems="center">
           
            <Avatar 
              size="md" 
              src={postedBy?.profilePic} 
              name={postedBy?.name}
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
  
  {post?.img && (
    <Box borderRadius={6} overflow="hidden" border="1px solid" borderColor="gray.light">
      <Image src={post?.img} w="full" objectFit="contain" maxH="300px" />
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

export default Post
