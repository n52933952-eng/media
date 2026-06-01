/**
 * Host camera pip while sharing: overlay (drag/resize/close) or restore chip when hidden.
 */

import { Box, Text } from '@chakra-ui/react';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import HostCameraPipOverlay from './HostCameraPipOverlay';

const HostCameraPipHost = ({ track, active = true, defaultTop = 72, zIndex = 1690 }) => {
  const { hostPipVisible, showHostPip, hideHostPip } = useLiveBroadcast();

  if (!active || !track) return null;

  if (!hostPipVisible) {
    return (
      <Box
        as="button"
        type="button"
        position="fixed"
        top={`${defaultTop}px`}
        right="12px"
        zIndex={zIndex}
        display="flex"
        alignItems="center"
        gap={2}
        px={3}
        py={2}
        borderRadius="full"
        bg="blackAlpha.800"
        border="1px solid"
        borderColor="whiteAlpha.400"
        color="white"
        fontSize="sm"
        fontWeight="700"
        cursor="pointer"
        boxShadow="md"
        _hover={{ bg: 'blackAlpha.700' }}
        onClick={showHostPip}
        aria-label="Show camera preview"
      >
        <Text as="span" fontSize="md" lineHeight={1}>📷</Text>
        <Text as="span">Camera</Text>
      </Box>
    );
  }

  return (
    <HostCameraPipOverlay
      track={track}
      visible
      onClose={hideHostPip}
      defaultTop={defaultTop}
      zIndex={zIndex}
    />
  );
};

export default HostCameraPipHost;
