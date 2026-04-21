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
import { usePublicSeo } from '../hooks/usePublicSeo'

function SeoFeatureShell({ pageTitle, h1, intro, points, path, keywordSectionTitle, keywordText, faqs = [] }) {
  const muted = useColorModeValue('gray.600', 'gray.400')
  const cardBg = useColorModeValue('white', 'gray.900')
  const border = useColorModeValue('gray.200', 'whiteAlpha.200')

  usePublicSeo({
    title: pageTitle,
    description: intro,
    path,
  })

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

        {keywordText ? (
          <Box bg={cardBg} borderWidth="1px" borderColor={border} borderRadius="lg" p={6}>
            <Heading as="h2" size="md" mb={3}>
              {keywordSectionTitle || 'How it works'}
            </Heading>
            <Text color={muted} fontSize="sm" lineHeight="tall">
              {keywordText}
            </Text>
          </Box>
        ) : null}

        {faqs.length ? (
          <Box bg={cardBg} borderWidth="1px" borderColor={border} borderRadius="lg" p={6}>
            <Heading as="h2" size="md" mb={4}>
              FAQ
            </Heading>
            <VStack align="stretch" spacing={4}>
              {faqs.map((item, idx) => (
                <Box key={idx}>
                  <Heading as="h3" size="sm" mb={1}>
                    {item.q}
                  </Heading>
                  <Text color={muted} fontSize="sm" lineHeight="tall">
                    {item.a}
                  </Text>
                </Box>
              ))}
            </VStack>
          </Box>
        ) : null}

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
      path="/chess"
      points={[
        'Challenge friends to a rated-style match from your connections.',
        'Play in the browser with an interactive board while you chat elsewhere in the app.',
        'Works alongside your profile, notifications, and messages.',
      ]}
      keywordSectionTitle="Play chess online with friends"
      keywordText="To play chess online, open playsocial, connect with friends, send a challenge, and start a live match. You can play chess in real time while staying connected through chat and your social feed."
      faqs={[
        { q: 'Can I play chess online for free?', a: 'Yes. You can create a free playsocial account and start chess challenges with friends.' },
        { q: 'Can I play chess with my friends?', a: 'Yes. Chess is built around your existing social connections, so you can challenge people you already follow.' },
        { q: 'Do I need a separate chess account?', a: 'No. Chess is part of playsocial, so your main account is enough.' },
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
      path="/card"
      points={[
        'Challenge and accept card games through the app’s real-time system.',
        'Stay connected with chat and calls while you play.',
        'Designed for casual, friendly matches with people you know.',
      ]}
      keywordSectionTitle="Go Fish card game online"
      keywordText="Looking for a free online card game with friends? playsocial includes Go Fish in real time. Start a card challenge, accept instantly, and play inside the same app where you chat and share updates."
      faqs={[
        { q: 'What card game is on this page?', a: 'This page focuses on Go Fish multiplayer card matches in playsocial.' },
        { q: 'Can I play cards online with friends?', a: 'Yes. You can challenge friends directly and start playing in real time.' },
        { q: 'Is the card game free to use?', a: 'Yes. Create an account and play with friends for free.' },
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
      path="/race"
      points={[
        'Challenge online friends when both of you are available.',
        'Full-screen race experience with app-wide notifications.',
        'Part of playsocial’s multiplayer games alongside chess and cards.',
      ]}
      keywordSectionTitle="Race friends online in real time"
      keywordText="playsocial racing lets you race friends online in a live head-to-head match. Both players join the same race room, wait for ready status, then start together after GO for fair gameplay."
      faqs={[
        { q: 'Can I race friends online?', a: 'Yes. Send a race challenge and join your friend in the same live race room.' },
        { q: 'When does a race start?', a: 'The race starts only after both players are connected, loaded, and ready.' },
        { q: 'Can players use voice in race?', a: 'Yes. In-race voice is available so opponents can talk while racing.' },
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
      path="/live"
      points={[
        'Stream to people who follow you; discovery through your feed and channels.',
        'Works with your playsocial profile and notifications.',
        'Combine live video with chat, calls, and the rest of the app.',
      ]}
      keywordSectionTitle="Live stream to your followers"
      keywordText="Go live from playsocial and stream to your followers in real time. Viewers can join your live session directly from the app experience they already use for posts, chat, and multiplayer games."
      faqs={[
        { q: 'Can I go live for free?', a: 'Yes. You can start live streaming from your playsocial account.' },
        { q: 'Who can watch my stream?', a: 'Your followers can discover and join your live stream from the app.' },
        { q: 'Is live streaming separate from social features?', a: 'No. Live is integrated with your profile, feed, and notifications.' },
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
      path="/chat"
      points={[
        'Direct messages and group threads with real-time delivery.',
        'Group spaces for teams, friends, or communities you build.',
        'Connects to voice and video calling and group calls when you’re in a group.',
      ]}
      keywordSectionTitle="Online chat and group messaging"
      keywordText="playsocial chat supports direct messaging and group conversations in real time. You can move from text chat to voice or video calls without leaving the app."
      faqs={[
        { q: 'Can I create group chats?', a: 'Yes. You can create groups, add members, and chat in real time.' },
        { q: 'Does chat support voice and video calls?', a: 'Yes. Chat connects with built-in voice and video calling.' },
        { q: 'Is messaging real time?', a: 'Yes. Messages and updates are delivered live across conversations.' },
      ]}
    />
  )
}
