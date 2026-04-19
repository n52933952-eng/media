import { useEffect } from 'react'
import {
  Box,
  Heading,
  Text,
  VStack,
  Button,
  useColorModeValue,
  Link as ChakraLink,
  List,
  ListItem,
  ListIcon,
} from '@chakra-ui/react'
import { Link } from 'react-router-dom'
import { CheckIcon } from '@chakra-ui/icons'

function SeoFeatureShell({ pageTitle, h1, intro, points }) {
  const muted = useColorModeValue('gray.600', 'gray.400')
  const cardBg = useColorModeValue('white', 'gray.900')
  const border = useColorModeValue('gray.200', 'whiteAlpha.200')

  useEffect(() => {
    const prev = document.title
    document.title = pageTitle
    return () => {
      document.title = prev
    }
  }, [pageTitle])

  return (
    <Box py={10} px={4}>
      <VStack align="stretch" spacing={6} maxW="720px" mx="auto">
        <Box>
          <Heading as="h1" size="xl" mb={2}>
            {h1}
          </Heading>
          <Text color={muted} fontSize="md" lineHeight="tall">
            {intro}
          </Text>
        </Box>

        <Box bg={cardBg} borderWidth="1px" borderColor={border} borderRadius="lg" p={6}>
          <Heading as="h2" size="md" mb={4}>
            On playsocial you can
          </Heading>
          <List spacing={3} fontSize="sm" color={muted}>
            {points.map((line, i) => (
              <ListItem key={i} display="flex" alignItems="flex-start">
                <ListIcon as={CheckIcon} color="green.400" mt={1} />
                <Text>{line}</Text>
              </ListItem>
            ))}
          </List>
        </Box>

        <Text fontSize="sm" color={muted}>
          Create a free account to use these features in the app — on web and mobile.
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
          <ChakraLink as={Link} to="/about" color="blue.400" mr={3}>
            About
          </ChakraLink>
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

/** Public SEO: /chess */
export function ChessSeoPage() {
  return (
    <SeoFeatureShell
      pageTitle="Play chess online with friends — playsocial"
      h1="Chess with friends on playsocial"
      intro="Play chess online with people you follow. Send a challenge from the app, pick your color, and play in real time. playsocial combines a social feed and messaging with built-in chess — no separate chess account needed."
      points={[
        'Challenge friends to a rated-style match from your connections.',
        'Play in the browser with an interactive board while you chat elsewhere in the app.',
        'Works alongside your profile, notifications, and messages.',
      ]}
    />
  )
}

/** Public SEO: /card (Go Fish) */
export function CardSeoPage() {
  return (
    <SeoFeatureShell
      pageTitle="Go Fish card game online with friends — playsocial"
      h1="Go Fish & card games on playsocial"
      intro="Play Go Fish with friends on playsocial: challenge someone online, accept from notifications, and play a full card session inside the app. It’s part of the same social experience as your feed and chat."
      points={[
        'Challenge and accept card games through the app’s real-time system.',
        'Stay connected with chat and calls while you play.',
        'Designed for casual, friendly matches with people you know.',
      ]}
    />
  )
}

/** Public SEO: /race */
export function RaceSeoPage() {
  return (
    <SeoFeatureShell
      pageTitle="Street racing game with friends — playsocial"
      h1="Racing challenges on playsocial"
      intro="Race friends in playsocial’s street-style racing game: send a challenge, join the room, and compete in real time. Racing lives next to your social feed, chess, and cards — one account for everything."
      points={[
        'Challenge online friends when both of you are available.',
        'Full-screen race experience with app-wide notifications.',
        'Part of playsocial’s multiplayer games alongside chess and cards.',
      ]}
    />
  )
}

/** Public SEO: /live */
export function LiveSeoPage() {
  return (
    <SeoFeatureShell
      pageTitle="Go live & live streaming to followers — playsocial"
      h1="Go live on playsocial"
      intro="Broadcast live to your followers on playsocial: start a live stream from the app, let viewers join watch, and stay part of the same community as your posts and stories. Live streaming is integrated with your social graph — not a separate platform."
      points={[
        'Stream to people who follow you; discovery through your feed and channels.',
        'Works with your playsocial profile and notifications.',
        'Combine live video with chat, calls, and the rest of the app.',
      ]}
    />
  )
}

/** Public SEO: /chat */
export function ChatSeoPage() {
  return (
    <SeoFeatureShell
      pageTitle="Group chat & messaging — playsocial"
      h1="Chat and group chat on playsocial"
      intro="Message friends with direct chats and group conversations on playsocial. Create groups, share updates, and jump into voice or video calls when you need more than text. Your inbox sits alongside the feed, games, and live — one place for social life."
      points={[
        'Direct messages and group threads with real-time delivery.',
        'Group spaces for teams, friends, or communities you build.',
        'Connects to voice and video calling and group calls when you’re in a group.',
      ]}
    />
  )
}
