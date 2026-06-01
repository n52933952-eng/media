/**
 * Host camera pip while live + sharing on home / chess (not on /live/broadcast — that page has its own pip).
 */

import { useEffect, useRef } from 'react';
import { Box } from '@chakra-ui/react';
import { useLocation } from 'react-router-dom';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';

const LiveCameraPip = () => {
  const location = useLocation();
  const { isLive, isSharing, localTrack } = useLiveBroadcast();
  const videoRef = useRef(null);

  const onLivePage = location.pathname === '/live/broadcast';
  const visible = isLive && isSharing && localTrack && !onLivePage;

  useEffect(() => {
    if (!visible || !localTrack || !videoRef.current) return undefined;
    const el = videoRef.current;
    try { localTrack.attach(el); } catch (_) {}
    return () => {
      try { localTrack.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [visible, localTrack]);

  if (!visible) return null;

  return (
    <Box
      position="fixed"
      top="72px"
      right="12px"
      w="120px"
      h="90px"
      borderRadius="lg"
      overflow="hidden"
      border="2px solid"
      borderColor="whiteAlpha.500"
      bg="black"
      zIndex={1690}
      pointerEvents="none"
    >
      <Box as="video" ref={videoRef} autoPlay muted playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </Box>
  );
};

export default LiveCameraPip;
