/**
 * Floating bar while the host is live but left the broadcast page (App home).
 */

import { Box, Flex, Text, Button, keyframes } from '@chakra-ui/react';
import { useLocation } from 'react-router-dom';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';

const pulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.55; }
  50% { transform: scale(1.55); opacity: 0; }
`;

const LiveStreamMiniBar = () => {
  const location = useLocation();
  const {
    isLive, isMinimized, isSharing, viewerCount,
    returnToLiveControls, endLive,
  } = useLiveBroadcast();

  const onLivePage = location.pathname === '/live/broadcast';
  if (!isLive || !isMinimized || onLivePage) return null;

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
      px={{ base: 0, sm: 0 }}
    >
      <Flex
        flex={1}
        align="center"
        minH="56px"
        px={4}
        py={2}
        cursor="pointer"
        onClick={returnToLiveControls}
        bg="rgba(12, 12, 14, 0.88)"
        backdropFilter="blur(18px)"
        borderRadius="full"
        border="1px solid"
        borderColor="whiteAlpha.200"
        boxShadow="0 10px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)"
        transition="background 0.2s, transform 0.15s"
        _hover={{ bg: 'rgba(22, 22, 26, 0.94)', transform: 'translateY(-1px)' }}
        _active={{ transform: 'translateY(0)' }}
      >
        <Box position="relative" w="12px" h="12px" mr={3} flexShrink={0}>
          <Box
            position="absolute"
            inset="-3px"
            borderRadius="full"
            bg="red.400"
            css={{ animation: `${pulse} 2s ease-out infinite` }}
          />
          <Box position="relative" w="12px" h="12px" borderRadius="full" bg="red.500" boxShadow="0 0 10px rgba(239,68,68,0.8)" />
        </Box>

        <Box flex={1} minW={0}>
          <Flex align="center" gap={2} flexWrap="wrap">
            <Text
              color="white"
              fontWeight="800"
              fontSize="xs"
              letterSpacing="0.12em"
              textTransform="uppercase"
            >
              Live
            </Text>
            {isSharing ? (
              <Text
                color="white"
                fontSize="10px"
                fontWeight="700"
                bg="whiteAlpha.150"
                px={2}
                py={0.5}
                borderRadius="full"
                border="1px solid"
                borderColor="whiteAlpha.200"
              >
                🖥 Sharing
              </Text>
            ) : null}
            <Text color="whiteAlpha.800" fontSize="xs" fontWeight="600">
              👁 {viewerCount}
            </Text>
          </Flex>
          <Text color="whiteAlpha.700" fontSize="xs" fontWeight="500" mt={0.5} noOfLines={1}>
            Tap to return to broadcast
          </Text>
        </Box>

        <Text color="whiteAlpha.600" fontSize="lg" ml={2} flexShrink={0} aria-hidden>
          →
        </Text>
      </Flex>

      <Button
        minH="56px"
        h="56px"
        px={6}
        borderRadius="full"
        colorScheme="red"
        fontWeight="800"
        fontSize="sm"
        flexShrink={0}
        boxShadow="0 8px 24px rgba(229, 62, 62, 0.35)"
        onClick={(e) => {
          e.stopPropagation();
          void endLive();
        }}
      >
        End
      </Button>
    </Flex>
  );
};

export default LiveStreamMiniBar;
