import React from 'react'
import { Box, Text, Flex, Button, HStack, useColorModeValue } from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import ChessChallenge from './ChessChallenge'
import CardChallenge from './CardChallenge'
import RaceChallenge from './RaceChallenge'
import MobileChannelsStrip from './MobileChannelsStrip'

/** Games + explore shortcuts — visible on phones only; desktop keeps left sidebar. */
const MobileHomePanel = () => {
  const navigate = useNavigate()
  const bg = useColorModeValue('white', '#1a1a1a')
  const border = useColorModeValue('gray.200', '#2d2d2d')
  const label = useColorModeValue('gray.800', 'white')

  return (
    <Box
      display={{ base: 'block', lg: 'none' }}
      bg={bg}
      borderRadius="md"
      border="1px solid"
      borderColor={border}
      p={3}
      mb={3}
      w="100%"
    >
      <Text fontSize="sm" fontWeight="bold" color={label} mb={2}>
        Games
      </Text>
      <Flex gap={2} w="full" align="stretch" mb={4}>
        <Box flex="1" minW={0}>
          <ChessChallenge compact />
        </Box>
        <Box flex="1" minW={0}>
          <CardChallenge compact />
        </Box>
        <Box flex="1" minW={0}>
          <RaceChallenge compact />
        </Box>
      </Flex>

      <Text fontSize="sm" fontWeight="bold" color={label} mb={2}>
        Explore
      </Text>
      <HStack spacing={2} overflowX="auto" pb={1} sx={{ WebkitOverflowScrolling: 'touch' }}>
        <Button size="sm" flexShrink={0} colorScheme="blue" variant="outline" onClick={() => navigate('/football')}>
          ⚽ Football
        </Button>
        <Button size="sm" flexShrink={0} colorScheme="blue" variant="outline" onClick={() => navigate('/weather')}>
          🌤️ Weather
        </Button>
      </HStack>

      <Box mt={4}>
        <MobileChannelsStrip />
      </Box>
    </Box>
  )
}

export default MobileHomePanel
