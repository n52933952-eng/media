import React, { useContext } from 'react'
import { Box, Flex, Avatar, Text, Button, VStack, HStack, useColorModeValue } from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { SocketContext } from '../context/SocketContext'

const RacingChallengeNotification = () => {
    const { raceChallenge, acceptRaceChallenge, declineRaceChallenge } = useContext(SocketContext)
    const navigate = useNavigate()

    const bgColor     = useColorModeValue('white', '#0f172a')
    const borderColor = useColorModeValue('red.300', 'red.600')

    if (!raceChallenge?.isReceivingChallenge) return null

    const handleAccept = () => {
        navigate(`/race/${raceChallenge.from}`)
        setTimeout(() => acceptRaceChallenge(), 100)
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
            boxShadow="0 8px 32px rgba(230,57,70,0.35)"
            p={4}
            zIndex={9998}
            minW="300px"
            maxW="400px"
            animation="raceSlideIn 0.3s ease-out"
        >
            <VStack spacing={3} align="stretch">
                <Flex align="center" gap={3}>
                    <Avatar
                        size="md"
                        name={raceChallenge.fromName || 'Unknown'}
                        src={raceChallenge.fromProfilePic}
                    />
                    <VStack align="start" spacing={0} flex={1}>
                        <Text fontWeight="bold" fontSize="lg" color={useColorModeValue('gray.800', 'white')}>
                            {raceChallenge.fromName || 'Unknown User'}
                        </Text>
                        <HStack spacing={1}>
                            <Text fontSize="md">🏎️</Text>
                            <Text fontSize="sm" color="red.400">
                                Race Challenge!
                            </Text>
                        </HStack>
                    </VStack>
                </Flex>

                <Box textAlign="center" py={1}>
                    <Text
                        fontSize="sm"
                        color="red.400"
                        animation="pulseFade 1.5s ease-in-out infinite"
                    >
                        Ready to race?
                    </Text>
                </Box>

                <HStack spacing={2} w="full">
                    <Button colorScheme="green" size="md" flex={1} onClick={handleAccept}>
                        ✅ Accept
                    </Button>
                    <Button colorScheme="red" size="md" flex={1} onClick={declineRaceChallenge}>
                        ❌ Decline
                    </Button>
                </HStack>
            </VStack>

            <style>{`
                @keyframes raceSlideIn {
                    from { transform: translateX(420px); opacity: 0; }
                    to   { transform: translateX(0);     opacity: 1; }
                }
                @keyframes pulseFade {
                    0%, 100% { opacity: 1; }
                    50%       { opacity: 0.4; }
                }
            `}</style>
        </Box>
    )
}

export default RacingChallengeNotification
