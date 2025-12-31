import React from 'react'
import { Box, Container, Heading, Text, VStack, useColorModeValue } from '@chakra-ui/react'
import ChessNotification from '../Components/ChessNotification'

const NotificationsPage = () => {
    const bgColor = useColorModeValue('gray.50', '#101010')
    const textColor = useColorModeValue('gray.800', 'white')

    return (
        <Box bg={bgColor} minH="100vh" py={8}>
            <Container maxW="600px">
                <Heading size="lg" mb={6} color={textColor}>
                    🔔 Notifications
                </Heading>

                <VStack spacing={4} align="stretch">
                    {/* Chess Challenges */}
                    <ChessNotification />

                    {/* Placeholder for other notifications */}
                    <Box
                        bg={useColorModeValue('white', '#1a1a1a')}
                        borderRadius="md"
                        p={6}
                        textAlign="center"
                    >
                        <Text color={useColorModeValue('gray.600', 'gray.400')}>
                            Other notifications will appear here 📬
                        </Text>
                    </Box>
                </VStack>
            </Container>
        </Box>
    )
}

export default NotificationsPage

