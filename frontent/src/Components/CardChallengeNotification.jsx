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
import { useNavigate } from 'react-router-dom'
import { SocketContext } from '../context/SocketContext'

const CardChallengeNotification = () => {
    const { cardChallenge, acceptCardChallenge, declineCardChallenge } = useContext(SocketContext)
    const navigate = useNavigate()

    const bgColor = useColorModeValue('white', '#1a1a1a')
    const borderColor = useColorModeValue('purple.200', 'purple.700')

    if (!cardChallenge || !cardChallenge.isReceivingChallenge) return null

    const handleAccept = () => {
        // IMPORTANT: call acceptCardChallenge() FIRST so localStorage.cardRoomId is set
        // synchronously before CardGamePage mounts.  The old pattern (navigate → 100ms
        // timeout → acceptCardChallenge) caused roomId to be empty on mount, leaving the
        // accepter stuck on "Waiting for the game to start..." forever.
        const fromId = cardChallenge.from  // capture before acceptCardChallenge clears state
        acceptCardChallenge()
        navigate(`/card/${fromId}`)
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
            zIndex={9998}
            minW="300px"
            maxW="400px"
            animation="cardSlideIn 0.3s ease-out"
        >
            <VStack spacing={3} align="stretch">
                <Flex align="center" gap={3}>
                    <Avatar
                        size="md"
                        name={cardChallenge.fromName || 'Unknown'}
                        src={cardChallenge.fromProfilePic}
                    />
                    <VStack align="start" spacing={0} flex={1}>
                        <Text fontWeight="bold" fontSize="lg">
                            {cardChallenge.fromName || 'Unknown User'}
                        </Text>
                        <HStack spacing={1}>
                            <Text fontSize="md">🃏</Text>
                            <Text fontSize="sm" color="purple.500">
                                Go Fish Challenge!
                            </Text>
                        </HStack>
                    </VStack>
                </Flex>

                <Box textAlign="center" py={1}>
                    <Text fontSize="sm" color="purple.400" animation="pulse 1.5s ease-in-out infinite">
                        Waiting for your response...
                    </Text>
                </Box>

                <HStack spacing={2} w="full">
                    <Button colorScheme="green" size="md" flex={1} onClick={handleAccept}>
                        ✅ Accept
                    </Button>
                    <Button colorScheme="red" size="md" flex={1} onClick={declineCardChallenge}>
                        ❌ Decline
                    </Button>
                </HStack>
            </VStack>

            <style>{`
                @keyframes cardSlideIn {
                    from { transform: translateX(400px); opacity: 0; }
                    to   { transform: translateX(0);     opacity: 1; }
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50%       { opacity: 0.5; }
                }
            `}</style>
        </Box>
    )
}

export default CardChallengeNotification
