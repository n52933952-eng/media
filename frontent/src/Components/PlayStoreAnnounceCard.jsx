import { Box, Flex, Image, Text, useColorModeValue } from '@chakra-ui/react'
import { PLAY_STORE_URL } from '../utils/postUtils.js'

/** Home-feed announcement: send web visitors to Play Social on Google Play. */
const PlayStoreAnnounceCard = () => {
  const cardBg = useColorModeValue('white', '#161616')
  const border = useColorModeValue('blackAlpha.200', 'whiteAlpha.200')
  const muted = useColorModeValue('gray.600', 'gray.400')
  const title = useColorModeValue('gray.900', 'white')
  const chipBg = useColorModeValue('#E8F5E9', 'rgba(61, 220, 132, 0.14)')
  const chipFg = useColorModeValue('#01875f', '#3DDC84')

  return (
    <Box
      as="a"
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      display="block"
      mb={4}
      mt={3}
      p={{ base: 4, md: 5 }}
      borderRadius="16px"
      borderWidth="2px"
      borderColor={chipFg}
      bg={cardBg}
      cursor="pointer"
      aria-label="Visit Play Social on Google Play"
      _hover={{ boxShadow: 'lg', transform: 'translateY(-1px)' }}
      transition="all 0.15s ease"
    >
      <Flex align="center" gap={{ base: 3, md: 4 }} wrap="wrap">
        <Image
          src="/playsocial-icon.png"
          alt="Play Social"
          boxSize={{ base: '52px', md: '60px' }}
          borderRadius="14px"
          flexShrink={0}
        />
        <Box flex="1" minW="200px">
          <Text
            as="span"
            display="inline-block"
            fontSize="11px"
            fontWeight="800"
            letterSpacing="0.08em"
            textTransform="uppercase"
            color={chipFg}
            bg={chipBg}
            px={2}
            py="2px"
            borderRadius="999px"
            mb={1}
          >
            Announcement
          </Text>
          <Text fontSize={{ base: 'lg', md: 'xl' }} fontWeight="800" color={title} lineHeight="1.25">
            Visit Play Social on Google Play
          </Text>
          <Text fontSize="sm" color={muted} mt={1}>
            Get the app for chat, live, and a better phone experience.
          </Text>
        </Box>
        <Box
          as="span"
          bg="#01875f"
          color="white"
          fontWeight="700"
          fontSize="sm"
          px={5}
          py={2.5}
          borderRadius="999px"
          whiteSpace="nowrap"
        >
          Open Google Play
        </Box>
      </Flex>
    </Box>
  )
}

export default PlayStoreAnnounceCard
