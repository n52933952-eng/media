import React,{useContext,useState,useEffect} from 'react'
import{Button,VStack,Box,Avatar,Text,Flex,Menu,MenuItem,Portal,MenuList,MenuButton,Input,useColorModeValue} from '@chakra-ui/react'
import { FaSquareInstagram } from "react-icons/fa6";
import { FaRegCopy } from "react-icons/fa";
import{useToast} from '@chakra-ui/toast'
import{UserContext} from '../context/UserContext'
import {Link} from 'react-router-dom'
import useShowToast from '../hooks/useShowToast.js'

const UserHeader = ({users, activeTab, setActiveTab, onUserFollowed}) => {
   
    const toast =useToast()
    
    
     const{user,setUser}=useContext(UserContext)
     
     const currentUser = user
      
     const[following,setFollowing]=useState(users?.followers?.includes(currentUser?._id))
     
       
 
   
  
  console.log({"followers":following})
  
  const showToast=useShowToast()
  
  // Update instagramUrl when users prop changes
  useEffect(() => {
    setInstagramUrl(users?.instagram || "")
  }, [users?.instagram])
  
  // Handle Instagram URL save
  const handleSaveInstagram = async () => {
    if (!currentUser || currentUser._id !== users?._id) return
    
    setSavingInstagram(true)
    try {
      const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/update/${currentUser._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          instagram: instagramUrl.trim()
        })
      })
      
      const data = await res.json()
      
      if (res.ok) {
        // Update local user state
        if (data.instagram !== undefined) {
          setUser({ ...currentUser, instagram: data.instagram })
          localStorage.setItem('userInfo', JSON.stringify({ ...currentUser, instagram: data.instagram }))
        }
        // Update users prop (for immediate UI update)
        users.instagram = instagramUrl.trim()
        setShowInstagramInput(false)
        showToast('Success', 'Instagram URL saved!', 'success')
      } else {
        showToast('Error', data.error || 'Failed to save Instagram URL', 'error')
      }
    } catch (error) {
      console.error('Error saving Instagram URL:', error)
      showToast('Error', 'Failed to save Instagram URL', 'error')
    } finally {
      setSavingInstagram(false)
    }
  }
  
  // Handle Instagram link click
  const handleInstagramClick = (e) => {
    if (!users?.instagram) return
    e.preventDefault()
    
    // Ensure URL has https://
    let url = users.instagram.trim()
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }
    
    window.open(url, '_blank', 'noopener,noreferrer')
  }
    
 
    
    
      const[updating,setUpdating]=useState(false)
    const[showInstagramInput,setShowInstagramInput]=useState(false)
    const[instagramUrl,setInstagramUrl]=useState(users?.instagram || "")
    const[savingInstagram,setSavingInstagram]=useState(false)
    
    const inputBg = useColorModeValue('white', 'gray.700')
    const borderColor = useColorModeValue('gray.200', 'gray.600')


    
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
     
        const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/user/follow/${users._id}`,{
     
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
          
          // Call onUserFollowed callback to fetch user's posts and add to feed
          if (onUserFollowed && users._id) {
            onUserFollowed(users._id)
          }
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
        {users?.instagram ? (
          <Text 
            as="a" 
            href={users.instagram} 
            onClick={handleInstagramClick}
            color="blue.400"
            cursor="pointer"
            _hover={{ textDecoration: 'underline' }}
          >
            {users.instagram.replace(/^https?:\/\//, '').replace(/^www\./, '')}
          </Text>
        ) : (
          <Text color="gray.light">instgram.com</Text>
        )}
    </Flex>
    
    
    <Flex>
      {/* Instagram Icon - Only show on own profile */}
      {currentUser?._id === users?._id && (
        <Box className="icon-container" position="relative">
          <FaSquareInstagram 
            size={24} 
            cursor="pointer" 
            onClick={() => setShowInstagramInput(!showInstagramInput)}
          />
        </Box>
      )}
      
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
   
   {/* Instagram Input - Only show on own profile when icon is clicked */}
   {currentUser?._id === users?._id && showInstagramInput && (
     <Box mt={2} p={3} bg={inputBg} borderRadius="md" border="1px solid" borderColor={borderColor}>
       <Flex gap={2} alignItems="center">
         <Input
           placeholder="Enter Instagram URL (e.g., instagram.com/username)"
           value={instagramUrl}
           onChange={(e) => setInstagramUrl(e.target.value)}
           size="sm"
           bg={useColorModeValue('white', 'gray.800')}
         />
         <Button
           size="sm"
           colorScheme="blue"
           onClick={handleSaveInstagram}
           isLoading={savingInstagram}
         >
           Save
         </Button>
         <Button
           size="sm"
           variant="ghost"
           onClick={() => {
             setShowInstagramInput(false)
             setInstagramUrl(users?.instagram || "")
           }}
         >
           Cancel
         </Button>
       </Flex>
     </Box>
   )}
  
  
 

   <Flex>

    </Flex>



  <Flex w="full">

  <Flex 
    flex="1" 
    borderBottom={activeTab === 'posts' ? "1.5px solid white" : "1.5px solid gray"} 
    pb={3} 
    cursor="pointer"
    onClick={() => setActiveTab('posts')}
  >
    <Text color={activeTab === 'posts' ? 'white' : 'gray.500'}>posts</Text>
  </Flex>


 <Flex 
    flex="1" 
    borderBottom={activeTab === 'replies' ? "1.5px solid white" : "1.5px solid gray"} 
    pb={3} 
    cursor="pointer"
    onClick={() => setActiveTab('replies')}
  >
    <Text color={activeTab === 'replies' ? 'white' : 'gray.500'}>Replies</Text>
 </Flex>



  </Flex>





    </VStack>
  )
}

export default UserHeader