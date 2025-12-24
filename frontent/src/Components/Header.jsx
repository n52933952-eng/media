import React,{useContext,useState,useEffect} from 'react'

import{Image,useColorMode,Flex,Box,Badge} from '@chakra-ui/react'
import { TiHomeOutline } from "react-icons/ti";
import { CgProfile } from "react-icons/cg";
import { FaRegMessage } from "react-icons/fa6";
import { IoNotificationsOutline } from "react-icons/io5";

import{UserContext} from '../context/UserContext'
import{Link} from 'react-router-dom'


const Header = () => {
  
  const{colorMode,toggleColorMode}=useColorMode()

   const{user}=useContext(UserContext)
   const [totalUnreadCount, setTotalUnreadCount] = useState(0)

   // Fetch total unread count
   useEffect(() => {
     if (!user) {
       setTotalUnreadCount(0)
       return
     }

     const fetchUnreadCount = async () => {
       try {
         const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/message/conversations`, {
           credentials: 'include',
         })
         const data = await res.json()
         if (res.ok) {
           const total = data.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0)
           setTotalUnreadCount(total)
         }
       } catch (error) {
         console.log('Error fetching unread count:', error)
       }
     }

     fetchUnreadCount()
     
     // Refresh every 5 seconds to get real-time updates
     const interval = setInterval(fetchUnreadCount, 5000)
     return () => clearInterval(interval)
   }, [user])
  
  
  
  
    return (
    
     <Flex justifyContent="space-between" mt="6" mb="12">
        
       

       {user &&
       <Link to="/home">
        <TiHomeOutline size={24}/>
       </Link>
       
       }

    

      
      
       <Image cursor="pointer"
       w={6} 
       src={colorMode === "dark" ? "/light-logo.svg" : "/dark-logo.svg"}
       onClick={toggleColorMode}
       />


      {user && (
        <Flex gap={4} alignItems="center">
          <Box position="relative">
            <Link to="/messages">
              <FaRegMessage size={24} />
            </Link>
            {totalUnreadCount > 0 && (
              <Badge
                position="absolute"
                top="-8px"
                right="-8px"
                borderRadius="full"
                bg="red.500"
                color="white"
                fontSize="10px"
                minW="18px"
                h="18px"
                display="flex"
                alignItems="center"
                justifyContent="center"
                px={1}
              >
                {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
              </Badge>
            )}
          </Box>
          
          <Link to="/notifications">
            <IoNotificationsOutline size={24} />
          </Link>
          
          <Link to={`/${user?.username}`}>
            <CgProfile size={24} />
          </Link>
        </Flex>
      )}

      
        
        </Flex>
  )
}

export default Header