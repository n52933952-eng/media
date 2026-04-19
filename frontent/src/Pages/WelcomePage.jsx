import { Box, Heading, Text, VStack, Button, useColorModeValue, Link as ChakraLink } from '@chakra-ui/react'
import { Link } from 'react-router-dom'

/**
 * Public landing copy for crawlers and shares. Does not replace / (login) — link here from marketing or footer.
 */
export default function WelcomePage() {
  const muted = useColorModeValue('gray.600', 'gray.400')
  const cardBg = useColorModeValue('white', 'gray.900')
  const border = useColorModeValue('gray.200', 'whiteAlpha.200')

  return (
    <Box py={10} px={4}>
      <VStack align="stretch" spacing={6} maxW="640px" mx="auto">
        <Heading as="h1" size="xl" textAlign="center">
          playsocial
        </Heading>
        <Text textAlign="center" color={muted} fontSize="md">
          A social app for your feed, direct messages, voice and video calls, and games — chess, Go Fish, and street
          racing with friends.
        </Text>

        <Box bg={cardBg} borderWidth="1px" borderColor={border} borderRadius="lg" p={6}>
          <VStack align="stretch" spacing={4}>
            <Heading as="h2" size="md">
              What you can do
            </Heading>
            <Text color={muted} fontSize="sm" lineHeight="tall">
              Share posts and media, follow people, chat in real time, start calls, challenge friends to games, and see
              football and weather updates in one place. Sign up free to join the community.
            </Text>
            <VStack spacing={3} pt={2}>
              <Button as={Link} to="/sign" colorScheme="blue" size="lg" w="full">
                Create account
              </Button>
              <Button as={Link} to="/" variant="outline" size="md" w="full">
                Sign in
              </Button>
            </VStack>
          </VStack>
        </Box>

        <Text fontSize="sm" color={muted} textAlign="center">
          <ChakraLink as={Link} to="/about" color="blue.400" mr={3}>
            About
          </ChakraLink>
          <ChakraLink as={Link} to="/privacy" color="blue.400" mr={3}>
            Privacy
          </ChakraLink>
          <ChakraLink as={Link} to="/terms" color="blue.400">
            Terms
          </ChakraLink>
        </Text>
      </VStack>
    </Box>
  )
}
