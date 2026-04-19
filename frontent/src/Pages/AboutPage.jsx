import { useEffect } from 'react'
import { Box, Heading, Text, VStack, Button, useColorModeValue, Link as ChakraLink, List, ListItem, ListIcon } from '@chakra-ui/react'
import { Link } from 'react-router-dom'
import { CheckIcon } from '@chakra-ui/icons'

const PAGE_TITLE = 'About playsocial — social feed, live stream, chat & games'

/**
 * Public About page for SEO and sign-up context. No login required.
 */
export default function AboutPage() {
  const muted = useColorModeValue('gray.600', 'gray.400')
  const cardBg = useColorModeValue('white', 'gray.900')
  const border = useColorModeValue('gray.200', 'whiteAlpha.200')

  useEffect(() => {
    const prev = document.title
    document.title = PAGE_TITLE
    return () => {
      document.title = prev
    }
  }, [])

  return (
    <Box py={10} px={4}>
      <VStack align="stretch" spacing={6} maxW="720px" mx="auto">
        <Box>
          <Heading as="h1" size="xl" mb={2}>
            About playsocial
          </Heading>
          <Text color={muted} fontSize="md" lineHeight="tall">
            playsocial is a social network where you follow friends, share a feed and stories, chat in direct messages and
            groups, make voice and video calls (including group calls), go live to your followers, and play games together —
            chess, Go Fish, and street racing — while keeping up with football scores, weather, and news channels in one
            place.
          </Text>
        </Box>

        <Box bg={cardBg} borderWidth="1px" borderColor={border} borderRadius="lg" p={6}>
          <Heading as="h2" size="md" mb={4}>
            What you can do on playsocial
          </Heading>
          <List spacing={3} fontSize="sm" color={muted}>
            <ListItem display="flex" alignItems="flex-start">
              <ListIcon as={CheckIcon} color="green.400" mt={1} />
              <Text>
                <strong>Feed &amp; stories</strong> — post text, photos and video; see updates from people you follow.
              </Text>
            </ListItem>
            <ListItem display="flex" alignItems="flex-start">
              <ListIcon as={CheckIcon} color="green.400" mt={1} />
              <Text>
                <strong>Chat</strong> — direct messages and group chats; stay in sync with real-time messaging.
              </Text>
            </ListItem>
            <ListItem display="flex" alignItems="flex-start">
              <ListIcon as={CheckIcon} color="green.400" mt={1} />
              <Text>
                <strong>Calls</strong> — voice and video calls, including group video and voice calls when you’re in a
                group conversation.
              </Text>
            </ListItem>
            <ListItem display="flex" alignItems="flex-start">
              <ListIcon as={CheckIcon} color="green.400" mt={1} />
              <Text>
                <strong>Live streaming</strong> — broadcast live to followers who can watch and interact.
              </Text>
            </ListItem>
            <ListItem display="flex" alignItems="flex-start">
              <ListIcon as={CheckIcon} color="green.400" mt={1} />
              <Text>
                <strong>Games</strong> — play chess, Go Fish (cards), and street racing challenges with friends online.
              </Text>
            </ListItem>
            <ListItem display="flex" alignItems="flex-start">
              <ListIcon as={CheckIcon} color="green.400" mt={1} />
              <Text>
                <strong>Football &amp; weather</strong> — follow live scores and personalized weather updates in your feed.
              </Text>
            </ListItem>
            <ListItem display="flex" alignItems="flex-start">
              <ListIcon as={CheckIcon} color="green.400" mt={1} />
              <Text>
                <strong>News-style channels</strong> — discover and follow channels for updates you care about.
              </Text>
            </ListItem>
          </List>
        </Box>

        <Text fontSize="sm" color={muted}>
          Create a free account to get started. We offer sign-in with username and password or Continue with Google where
          available.
        </Text>

        <VStack spacing={3} pt={2}>
          <Button as={Link} to="/sign" colorScheme="blue" size="lg" w="full">
            Create account
          </Button>
          <Button as={Link} to="/" variant="outline" size="md" w="full">
            Sign in
          </Button>
        </VStack>

        <Text fontSize="sm" color={muted} textAlign="center">
          <ChakraLink as={Link} to="/welcome" color="blue.400" mr={3}>
            Welcome
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
