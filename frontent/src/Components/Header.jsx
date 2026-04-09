import React,{useContext,useState,useEffect} from 'react'

import{Image,useColorMode,Flex,Box,Badge,Avatar} from '@chakra-ui/react'
import { TiHomeOutline } from "react-icons/ti";
import { FaRegMessage } from "react-icons/fa6";
import { IoNotificationsOutline } from "react-icons/io5";

import{UserContext} from '../context/UserContext'
import{SocketContext} from '../context/SocketContext'
import{Link, useNavigate} from 'react-router-dom'


const Header = () => {
  
  const{colorMode,toggleColorMode}=useColorMode()

   const{user}=useContext(UserContext)
   const {socket, totalUnreadCount, notificationCount, endChessGameOnNavigate, endCardGameOnNavigate} = useContext(SocketContext) || {}
   const navigate = useNavigate()

   // End any active game before navigating away
   const handleNavigation = (path, e) => {
     const gameLive = localStorage.getItem('gameLive') === 'true'
     const cardRoomId = localStorage.getItem('cardRoomId')

     if (gameLive && endChessGameOnNavigate) {
       endChessGameOnNavigate()
     }
     if (cardRoomId && endCardGameOnNavigate) {
       endCardGameOnNavigate()
     }

     navigate(path)
   }
  
  
  
  
    return (
    
     <Flex 
       justifyContent="space-between"
       alignItems="center"
       py="4"
       px="4"
     >
        
       

      {user &&
      <Box
        as="button"
        onClick={(e) => {
          e.preventDefault()
          handleNavigation('/home', e)
        }}
        cursor="pointer"
        display="flex"
        alignItems="center"
      >
        <TiHomeOutline size={24}/>
      </Box>
      }

    

      
      
       <Image
         cursor="pointer"
         boxSize="32px"
         objectFit="contain"
         src="/playsocial-icon.png"
         alt="playsocial"
         onClick={toggleColorMode}
         borderRadius="md"
       />


      {user && (
        <Flex gap={4} alignItems="center">
          <Box position="relative" display="flex" alignItems="center">
            <Box
              as="button"
              onClick={(e) => {
                e.preventDefault()
                handleNavigation('/messages', e)
              }}
              cursor="pointer"
              display="flex"
              alignItems="center"
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
          
          <Box position="relative" display="flex" alignItems="center">
            <Box
              as="button"
              onClick={(e) => {
                e.preventDefault()
                handleNavigation('/notifications', e)
              }}
              cursor="pointer"
              display="flex"
              alignItems="center"
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
            display="flex"
            alignItems="center"
            lineHeight="0"
          >
            <Avatar
              src={user?.profilePic}
              name={user?.name || user?.username}
              style={{ width: '26px', height: '26px', minWidth: '26px', display: 'block' }}
            />
          </Box>
        </Flex>
      )}

      
        
        </Flex>
  )
}

export default Header