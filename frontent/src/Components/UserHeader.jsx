import React,{useContext,useState,useEffect} from 'react'
import{Button,VStack,Box,Avatar,Text,Flex,Menu,MenuItem,Portal,MenuList,MenuButton} from '@chakra-ui/react'
import { FaSquareInstagram } from "react-icons/fa6";
import { FaRegCopy } from "react-icons/fa";
import{useToast} from '@chakra-ui/toast'
import{UserContext} from '../context/UserContext'
import {Link} from 'react-router-dom'
import useShowToast from '../hooks/useShowToast.js'

const UserHeader = ({users}) => {
   
    const toast =useToast()
    
   
     const{user,setUser}=useContext(UserContext)
     
     const currentUser = user
      
     const[following,setFollowing]=useState(users?.followers?.includes(currentUser?._id))
     
       
 
   
  
  console.log({"followers":following})
  
  const showToast=useShowToast()
    
 
    
    
      const[updating,setUpdating]=useState(false)


    
     const copyUrl = () => {
   
        const currentUrl = window.location.href 
        navigator.clipboard.writeText(currentUrl).then(() => {
            toast({description:"Copied"})
        })
       }


  
  
       const handleFollowAndUnfollow =async() => {
        
        if(!currentUser){
          showToast("Error","Pleae login to follow","error")
          return
        }
          
        if(updating) return 
        
         setUpdating(true)

        try{
     
        const res = await fetch(`http://localhost:5000/api/user/follow/${users._id}`,{
     
         credentials:"include",
         method:"POST",
         
         headers:{
          "Content-Type" : "application/json"
         }
        })


        const data = await res.json()
        console.log(data)
        if(data.error){
          showToast("Error",data.error,"error")
        }
      
        
          
        
         if(following){
           showToast("Success",`unfollowed ${users.name}`,"success")
           users.followers.pop()
         }else{
          showToast("Success",`you Followed ${users.name}`,"success")
          users.followers.push(currentUser._id)
         }

           if(data.current){
            setUser(data.current)
            localStorage.setItem("userInfo",JSON.stringify(data.current))
           }
      
         setFollowing(!following)
       
       
        }
    catch(error){
     showToast("error",error,"error")
    }finally{
      setUpdating(false)
    }
  }







    return (
    
    <VStack alignItems="start" gap={2}>

        <Flex w="full" justifyContent="space-between">
     
        <Box>
        <Text fontSize="2xl" fontWeight="bold">{users?.name}</Text>
       
       <Flex gap={2} alignItems="center">
        <Text fontSize="sm">{users?.username}</Text>
        <Text fontSize="xs" bg="gray.dark" color="gray.light" p={1} borderRadius="full">thrades.net</Text>
       </Flex>
       
        </Box>
    
      
        <Box>
         {users?.profilePic && (
         <Avatar src={users?.profilePic} size={{base:"md",md:"lg"}} />
         )
         }
       
         {!users?.profilePic && (
            <Avatar name={user?.name} size={{base:"md",md:"lg"}} />
         )}
       
        </Box>
     
     
       </Flex>
    
    
    <Text>{users?.bio}</Text>
   
    {currentUser?._id === users?._id &&
     <Link to="/update">
     <Button>update Profile</Button>
     </Link>

    }


    {currentUser?._id !== users?._id && <Button onClick={handleFollowAndUnfollow} isLoading={updating}>
      {following ? "unfollow" : "follow"}
      </Button>}
  
    
    <Flex w="full" justifyContent="space-between" >
   
    <Flex alignItems="center" gap={2}>
        <Text color="gray.light">{users?.followers?.length} followers</Text>
        <Box w={"1"} h="1" bg="gray.light" borderRadius="full"></Box>
        <Link>instgram.com</Link>
    </Flex>
    
    
    <Flex>
      
       <Box className="icon-container">
        <FaSquareInstagram size={24} cursor="pointer" />
       </Box>

      
     
       <Box className="icon-container">
          <Menu>
            <MenuButton>
            <FaRegCopy size={24} cursor="pointer" />
           </MenuButton>
         <Portal>
        <MenuList bg="gray.light">
            <MenuItem bg="gray.light" onClick={copyUrl}>Copy Link</MenuItem>
             
        </MenuList>
    </Portal>
     </Menu>
     </Box>
      
    </Flex>
  
  
   </Flex>
  
  
 

   <Flex>

    </Flex>



  <Flex w="full">

  <Flex flex="1" borderBottom="1.5px solid white" pb={3} cursor="pinter">
    <Text>threads</Text>
  </Flex>


 <Flex flex="1" borderBottom="1.5px solid gray" pb={3} cursor="pinter">
    <Text>Replies</Text>
 </Flex>



  </Flex>





    </VStack>
  )
}

export default UserHeader