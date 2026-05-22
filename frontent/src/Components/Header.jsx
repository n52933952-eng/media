import React,{useContext,useState,useEffect} from 'react'

import{Image,useColorMode,Flex,Box,Badge,Avatar,Text,Button} from '@chakra-ui/react'
import { IoIosLogOut } from 'react-icons/io'
import useShowToast from '../hooks/useShowToast.js'
import { TiHomeOutline } from "react-icons/ti";
import { FaRegMessage } from "react-icons/fa6";
import { IoNotificationsOutline } from "react-icons/io5";

import{UserContext} from '../context/UserContext'
import{SocketContext} from '../context/SocketContext'
import{Link, useNavigate} from 'react-router-dom'


const Header = () => {
  
  const{colorMode,toggleColorMode}=useColorMode()

   const{user,setUser}=useContext(UserContext)
   const {socket, totalUnreadCount, notificationCount, endChessGameOnNavigate, endCardGameOnNavigate, endRaceGameOnNavigate} = useContext(SocketContext) || {}
   const navigate = useNavigate()
   const showToast = useShowToast()

   const handleLogout = async () => {
     try {
       if (endChessGameOnNavigate) endChessGameOnNavigate()

       const res = await fetch(
         `${import.meta.env.PROD ? window.location.origin : 'http://localhost:5000'}/api/user/logout`,
         {
           method: 'POST',
           credentials: 'include',
           headers: { 'Content-Type': 'application/json' },
         }
       )
       const data = await res.json()
       if (data.error) {
         showToast('Error', data.error, 'error')
         return
       }

       localStorage.removeItem('chessOrientation')
       localStorage.removeItem('gameLive')
       localStorage.removeItem('chessRoomId')
       localStorage.removeItem('chessFEN')
       localStorage.removeItem('capturedWhite')
       localStorage.removeItem('capturedBlack')
       localStorage.removeItem('userInfo')
       setUser(null)
       navigate('/', { replace: true })
     } catch (error) {
       console.log(error)
     }
   }

   // End any active game before navigating away
   const handleNavigation = (path, e) => {
     const gameLive  = localStorage.getItem('gameLive') === 'true'
     const cardRoomId = localStorage.getItem('cardRoomId')
     const raceRoomId = localStorage.getItem('raceRoomId')

     if (gameLive && endChessGameOnNavigate)    endChessGameOnNavigate()
     if (cardRoomId && endCardGameOnNavigate)   endCardGameOnNavigate()
     if (raceRoomId && endRaceGameOnNavigate)   endRaceGameOnNavigate()

     navigate(path)
   }
  
  
  
  
    return (
    
     <Flex 
       justifyContent="space-between"
       alignItems="center"
       py="4"
       px="4"
       w="100%"
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
        <Flex gap={4} alignItems="center" flexShrink={0}>
          <Flex display={{ base: 'none', sm: 'flex' }} alignItems="center" gap={2} fontSize="10px" color="gray.500">
            <Text as={Link} to="/privacy" _hover={{ color: 'blue.400' }}>
              Privacy
            </Text>
            <Text as="span" opacity={0.5}>
              ·
            </Text>
            <Text as={Link} to="/terms" _hover={{ color: 'blue.400' }}>
              Terms
            </Text>
          </Flex>
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
              src={
                typeof user?.profilePic === 'string' && user.profilePic.trim()
                  ? user.profilePic.trim()
                  : undefined
              }
              name={
                typeof user?.profilePic === 'string' && user.profilePic.trim()
                  ? undefined
                  : user?.name || user?.username
              }
              style={{ width: '26px', height: '26px', minWidth: '26px', display: 'block' }}
            />
          </Box>

          <Button size="sm" onClick={handleLogout} aria-label="Log out" flexShrink={0}>
            <IoIosLogOut size={22} />
          </Button>
        </Flex>
      )}

      
        
        </Flex>
  )
}

export default Header