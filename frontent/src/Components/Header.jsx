import React,{useContext,useState,useEffect} from 'react'

import{Image,useColorMode,Flex,Box,Badge,useColorModeValue} from '@chakra-ui/react'
import { TiHomeOutline } from "react-icons/ti";
import { CgProfile } from "react-icons/cg";
import { FaRegMessage } from "react-icons/fa6";
import { IoNotificationsOutline } from "react-icons/io5";

import{UserContext} from '../context/UserContext'
import{SocketContext} from '../context/SocketContext'
import{Link, useNavigate} from 'react-router-dom'


const Header = () => {
  
  const{colorMode,toggleColorMode}=useColorMode()
  const bgColor = useColorModeValue('white', '#101010')
  const borderColor = useColorModeValue('gray.200', 'gray.700')

   const{user}=useContext(UserContext)
   const {socket, totalUnreadCount, notificationCount, endChessGameOnNavigate} = useContext(SocketContext) || {}
   const navigate = useNavigate()

   // Function to handle navigation with chess game cleanup
   const handleNavigation = (path, e) => {
     // Check if a chess game is currently live
     const gameLive = localStorage.getItem('gameLive') === 'true'
     
     if (gameLive) {
       // End the chess game before navigating
       if (endChessGameOnNavigate) {
         endChessGameOnNavigate()
       }
     }
     
     // Navigate to the new path
     navigate(path)
   }
  
  
  
  
    return (
    
     <Flex 
       justifyContent="space-between" 
       py="4"
       px="4"
       bg={bgColor}
       backdropFilter="blur(10px)"
       bgGradient={colorMode === 'dark' ? 'linear(to-b, #101010, #101010)' : 'linear(to-b, white, white)'}
     >
        
       

       {user &&
       <Box 
         as="button"
         onClick={(e) => {
           e.preventDefault()
           handleNavigation('/home', e)
         }}
         cursor="pointer"
       >
        <TiHomeOutline size={24}/>
       </Box>
       
       }

    

      
      
       <Image cursor="pointer"
       w={6} 
       src={colorMode === "dark" ? "/light-logo.svg" : "/dark-logo.svg"}
       onClick={toggleColorMode}
       />


      {user && (
        <Flex gap={4} alignItems="center">
          <Box position="relative">
            <Box
              as="button"
              onClick={(e) => {
                e.preventDefault()
                handleNavigation('/messages', e)
              }}
              cursor="pointer"
            >
              <FaRegMessage size={24} />
            </Box>
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
            <Box
              as="button"
              onClick={(e) => {
                e.preventDefault()
                handleNavigation('/notifications', e)
              }}
              cursor="pointer"
            >
              <IoNotificationsOutline size={24} />
            </Box>
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
          
          <Box
            as="button"
            onClick={(e) => {
              e.preventDefault()
              handleNavigation(`/${user?.username}`, e)
            }}
            cursor="pointer"
          >
            <CgProfile size={24} />
          </Box>
        </Flex>
      )}

      
        
        </Flex>
  )
}

export default Header