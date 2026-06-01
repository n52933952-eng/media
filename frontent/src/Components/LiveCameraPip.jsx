/**
 * Lightweight LIVE badge while sharing on home / chess (no local video decode).
 */

import { Box, Text } from '@chakra-ui/react';
import { useLocation } from 'react-router-dom';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';

const LiveCameraPip = () => {
  const location = useLocation();
  const { isLive, isSharing } = useLiveBroadcast();

  const onLivePage = location.pathname === '/live/broadcast';
  const visible = isLive && isSharing && !onLivePage;
  if (!visible) return null;

  return (
    <Box
      position="fixed"
      top="72px"
      right="12px"
      zIndex={1690}
      px={3}
      py={2}
      borderRadius="full"
      bg="rgba(180, 30, 30, 0.92)"
      border="1px solid"
      borderColor="whiteAlpha.400"
      display="flex"
      alignItems="center"
      gap={2}
      pointerEvents="none"
    >
      <Box w="8px" h="8px" borderRadius="full" bg="white" />
      <Text color="white" fontSize="xs" fontWeight="800" letterSpacing="0.04em">
        LIVE
      </Text>
    </Box>
  );
};

export default LiveCameraPip;
