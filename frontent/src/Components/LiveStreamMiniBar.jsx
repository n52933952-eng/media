/**
 * Floating bar while the host is live but left the broadcast page (home / chess / card / race).
 */

import { Box, Flex, Text, Button, keyframes } from '@chakra-ui/react';
import { useLocation } from 'react-router-dom';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import { liveBroadcastNav } from '../services/liveBroadcastNav';

const pulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.55; }
  50% { transform: scale(1.55); opacity: 0; }
`;

const LiveStreamMiniBar = () => {
  const location = useLocation();
  const {
    isLive, isMinimized, isSharing, viewerCount, hostPipVisible,
    returnToLiveControls, endLive, showHostPip,
  } = useLiveBroadcast();

  const onLivePage = location.pathname === '/live/broadcast';
  if (!isLive || !isMinimized || onLivePage) return null;

  const onReturn = () => {
    returnToLiveControls();
    liveBroadcastNav.returnToLive?.();
  };

  return (
    <Flex
      position="fixed"
      left="50%"
      transform="translateX(-50%)"
      bottom={{ base: '18px', md: '22px' }}
      w={{ base: 'calc(100% - 20px)', sm: 'auto' }}
      maxW="520px"
      zIndex={1700}
      gap={2}
      align="stretch"
      pointerEvents="auto"
    >
      <Flex
        flex={1}
        align="center"
        gap={3}
        px={4}
        py={3}
        bg="red.600"
        borderRadius="2xl"
        border="1px solid"
        borderColor="whiteAlpha.300"
        boxShadow="0 8px 28px rgba(0,0,0,0.45)"
        cursor="pointer"
        onClick={onReturn}
        _hover={{ bg: 'red.500' }}
        minH="52px"
      >
        <Box position="relative" w="10px" h="10px" flexShrink={0} mt={1} alignSelf="flex-start">
          <Box w="10px" h="10px" borderRadius="full" bg="white" />
          <Box
            position="absolute"
            inset={0}
            borderRadius="full"
            bg="white"
            css={{ animation: `${pulse} 1.4s ease-out infinite` }}
          />
        </Box>
        <Box flex={1} minW={0}>
          <Flex align="center" gap={2} flexWrap="wrap">
            <Text color="white" fontWeight="800" fontSize="sm">🔴 LIVE</Text>
            {isSharing ? (
              <Text fontSize="xs" color="white" bg="whiteAlpha.200" px={2} py={0.5} borderRadius="full">
                🖥 sharing
              </Text>
            ) : null}
            {isSharing && !hostPipVisible ? (
              <Text
                as="button"
                type="button"
                fontSize="xs"
                color="white"
                bg="whiteAlpha.200"
                px={2}
                py={0.5}
                borderRadius="full"
                cursor="pointer"
                onClick={(e) => { e.stopPropagation(); showHostPip(); }}
              >
                📷 camera
              </Text>
            ) : null}
            <Text color="whiteAlpha.900" fontSize="xs">👁 {viewerCount}</Text>
          </Flex>
          <Text color="whiteAlpha.800" fontSize="xs" fontWeight="600" mt={0.5}>
            Tap to return to live controls
          </Text>
        </Box>
      </Flex>
      <Button
        colorScheme="red"
        variant="solid"
        borderRadius="2xl"
        minH="52px"
        px={6}
        onClick={(e) => { e.stopPropagation(); void endLive(); }}
        flexShrink={0}
      >
        End
      </Button>
    </Flex>
  );
};

export default LiveStreamMiniBar;
