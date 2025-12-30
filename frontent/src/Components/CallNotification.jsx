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
import { FaPhone, FaVideo, FaPhoneSlash } from 'react-icons/fa'
import { SocketContext } from '../context/SocketContext'

const CallNotification = () => {
  const { call, answerCall, leaveCall, callType } = useContext(SocketContext)

  const bgColor = useColorModeValue('white', '#1a1a1a')
  const borderColor = useColorModeValue('gray.200', 'gray.700')

  // Only show if receiving a call (not when making a call)
  if (!call || !call.isReceivingCall || call.isCalling) {
    return null
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
        {/* Caller Info */}
        <Flex align="center" gap={3}>
          <Avatar size="md" name={call.name || 'Unknown'} />
          <VStack align="start" spacing={0} flex={1}>
            <Text fontWeight="bold" fontSize="lg">
              {call.name || 'Unknown User'}
            </Text>
            <HStack spacing={1}>
              {callType === 'video' ? (
                <FaVideo size={14} color="gray" />
              ) : (
                <FaPhone size={14} color="gray" />
              )}
              <Text fontSize="sm" color="gray.500">
                Incoming {callType === 'video' ? 'Video' : 'Audio'} Call
              </Text>
            </HStack>
          </VStack>
        </Flex>

        {/* Call Animation */}
        <Box textAlign="center" py={2}>
          <Text
            fontSize="sm"
            color="blue.500"
            animation="pulse 1.5s ease-in-out infinite"
          >
            Ringing...
          </Text>
        </Box>

        {/* Action Buttons */}
        <HStack spacing={2} w="full">
          <Button
            leftIcon={callType === 'video' ? <FaVideo /> : <FaPhone />}
            colorScheme="green"
            size="md"
            flex={1}
            onClick={answerCall}
          >
            Answer
          </Button>
          <Button
            leftIcon={<FaPhoneSlash />}
            colorScheme="red"
            size="md"
            flex={1}
            onClick={leaveCall}
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

export default CallNotification



