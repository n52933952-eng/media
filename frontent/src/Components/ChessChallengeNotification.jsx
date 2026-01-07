import React, { useContext } from 'react'
import {
  Box,
  Flex,
  Avatar,
  Text,
  Button,
  useColorModeValue,
  VStack,
  HStack,
} from '@chakra-ui/react'
import { FaChessPawn } from 'react-icons/fa'
import { useNavigate } from 'react-router-dom'
import { SocketContext } from '../context/SocketContext'

const ChessChallengeNotification = () => {
  const { chessChallenge, acceptChessChallenge, declineChessChallenge } = useContext(SocketContext)
  const navigate = useNavigate()

  const bgColor = useColorModeValue('white', '#1a1a1a')
  const borderColor = useColorModeValue('gray.200', 'gray.700')

  // Only show if receiving a challenge
  if (!chessChallenge || !chessChallenge.isReceivingChallenge) {
    return null
  }

  const handleAccept = () => {
    // Navigate first, then accept (this ensures navigation happens)
    navigate(`/chess/${chessChallenge.from}`)
    // Small delay to ensure navigation starts, then accept
    setTimeout(() => {
      acceptChessChallenge()
    }, 100)
  }

  return (
    <Box
      position="fixed"
      top="80px"
      right="20px"
      bg={bgColor}
      border="2px solid"
      borderColor={borderColor}
      borderRadius="xl"
      boxShadow="2xl"
      p={4}
      zIndex={9999}
      minW="300px"
      maxW="400px"
      animation="slideIn 0.3s ease-out"
    >
      <VStack spacing={3} align="stretch">
        {/* Challenger Info */}
        <Flex align="center" gap={3}>
          <Avatar 
            size="md" 
            name={chessChallenge.fromName || 'Unknown'}
            src={chessChallenge.fromProfilePic}
          />
          <VStack align="start" spacing={0} flex={1}>
            <Text fontWeight="bold" fontSize="lg">
              {chessChallenge.fromName || 'Unknown User'}
            </Text>
            <HStack spacing={1}>
              <FaChessPawn size={14} color="gray" />
              <Text fontSize="sm" color="gray.500">
                Chess Challenge
              </Text>
            </HStack>
          </VStack>
        </Flex>

        {/* Challenge Animation */}
        <Box textAlign="center" py={2}>
          <Text
            fontSize="sm"
            color="purple.500"
            animation="pulse 1.5s ease-in-out infinite"
          >
            Waiting for response...
          </Text>
        </Box>

        {/* Action Buttons */}
        <HStack spacing={2} w="full">
          <Button
            leftIcon={<FaChessPawn />}
            colorScheme="green"
            size="md"
            flex={1}
            onClick={handleAccept}
          >
            Accept
          </Button>
          <Button
            colorScheme="red"
            size="md"
            flex={1}
            onClick={declineChessChallenge}
          >
            Decline
          </Button>
        </HStack>
      </VStack>

      <style>
        {`
          @keyframes slideIn {
            from {
              transform: translateX(400px);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
          
          @keyframes pulse {
            0%, 100% {
              opacity: 1;
            }
            50% {
              opacity: 0.5;
            }
          }
        `}
      </style>
    </Box>
  )
}

export default ChessChallengeNotification

