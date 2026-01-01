import React,{useContext,useState,useEffect} from 'react'

import{Image,useColorMode,Flex,Box,Badge} from '@chakra-ui/react'
import { TiHomeOutline } from "react-icons/ti";
import { CgProfile } from "react-icons/cg";
import { FaRegMessage } from "react-icons/fa6";
import { IoNotificationsOutline } from "react-icons/io5";

import{UserContext} from '../context/UserContext'
import{SocketContext} from '../context/SocketContext'
import{Link} from 'react-router-dom'


const Header = () => {
  
  const{colorMode,toggleColorMode}=useColorMode()

   const{user}=useContext(UserContext)
   const {socket, totalUnreadCount, notificationCount} = useContext(SocketContext) || {}
  
  
  
  
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
          
          <Box position="relative">
            <Link to="/notifications">
              <IoNotificationsOutline size={24} />
            </Link>
            {notificationCount > 0 && (
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
                {notificationCount > 99 ? '99+' : notificationCount}
              </Badge>
            )}
          </Box>
          
          <Link to={`/${user?.username}`}>
            <CgProfile size={24} />
          </Link>
        </Flex>
      )}

      
        
        </Flex>
  )
}

export default Header