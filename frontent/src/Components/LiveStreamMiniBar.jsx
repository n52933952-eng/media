/**
 * Floating bar while the host is live but left the broadcast page (App home).
 */

import { Box, Flex, Text, Button } from '@chakra-ui/react';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';

const BAR_H = 58;

const LiveStreamMiniBar = () => {
  const {
    isLive, isMinimized, isSharing, viewerCount,
    openLiveControls, endLive,
  } = useLiveBroadcast();

  if (!isLive || !isMinimized) return null;

  return (
    <Flex
      position="fixed"
      left={{ base: '10px', md: '16px' }}
      right={{ base: '10px', md: '16px' }}
      bottom={{ base: '16px', md: '20px' }}
      zIndex={1700}
      gap={2}
      align="stretch"
    >
      <Flex
        flex={1}
        align="center"
        minH={`${BAR_H}px`}
        bg="rgba(180, 0, 0, 0.94)"
        borderRadius="16px"
        px={4}
        py={2}
        border="1px solid"
        borderColor="whiteAlpha.300"
        cursor="pointer"
        onClick={openLiveControls}
        _hover={{ bg: 'rgba(200, 0, 0, 0.96)' }}
      >
        <Box w="10px" h="10px" borderRadius="full" bg="white" mr={3} flexShrink={0} />
        <Box flex={1}>
          <Flex align="center" gap={2} flexWrap="wrap">
            <Text color="white" fontWeight="800" fontSize="sm">LIVE</Text>
            {isSharing ? (
              <Text color="white" fontSize="xs" bg="whiteAlpha.200" px={2} py={0.5} borderRadius="full">
                🖥 sharing
              </Text>
            ) : null}
            <Text color="whiteAlpha.900" fontSize="xs">👁 {viewerCount}</Text>
          </Flex>
          <Text color="whiteAlpha.800" fontSize="xs" fontWeight="600" mt={0.5}>
            Tap to return →
          </Text>
        </Box>
      </Flex>
      <Button
        colorScheme="red"
        minH={`${BAR_H}px`}
        borderRadius="16px"
        px={5}
        onClick={() => void endLive()}
      >
        End
      </Button>
    </Flex>
  );
};

export default LiveStreamMiniBar;
