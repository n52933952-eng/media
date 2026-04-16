/**
 * LivePostCard — renders a live stream inside the normal feed.
 *
 * Shows: streamer avatar, name, LIVE badge, live video preview (muted),
 * viewer count, and a "Watch Live" button.
 *
 * Clicking the card or button navigates to /live/:streamerId (full viewer).
 */

import { useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Flex, Avatar, Text, Badge, Button, VStack,
  useColorModeValue,
} from '@chakra-ui/react';
import { Room, RoomEvent } from 'livekit-client';
import { VideoTrack } from '@livekit/components-react';
import { UserContext } from '../context/UserContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

const LivePostCard = ({ post }) => {
  const navigate = useNavigate();
  const { user }  = useContext(UserContext);
  const bg        = useColorModeValue('white', 'gray.900');
  const border    = useColorModeValue('gray.200', 'gray.700');

  const streamer   = post.postedBy;
  const roomName   = post.roomName;
  const streamerId = streamer?._id;

  const [previewTrack, setPreviewTrack] = useState(null);
  const [viewerCount,  setViewerCount]  = useState(0);
  const roomRef = useRef(null);

  // ── Join as silent viewer to get a preview track ─────────────────────────
  useEffect(() => {
    if (!roomName || !user) return;
    let mounted = true;

    const join = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/call/token`, {
          method:      'POST',
          credentials: 'include',
          headers:     { 'Content-Type': 'application/json' },
          body:        JSON.stringify({ type: 'viewer', targetId: String(streamerId) }),
        });
        if (!res.ok || !mounted) return;
        const { token, livekitUrl } = await res.json();

        const room = new Room();
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === 'video' && mounted) setPreviewTrack(track);
        });
        room.on(RoomEvent.TrackUnsubscribed, () => {
          if (mounted) setPreviewTrack(null);
        });
        room.on(RoomEvent.ParticipantConnected,    () => mounted && setViewerCount(c => c + 1));
        room.on(RoomEvent.ParticipantDisconnected, () => mounted && setViewerCount(c => Math.max(0, c - 1)));

        await room.connect(livekitUrl, token);
        if (mounted) setViewerCount(room.remoteParticipants.size);
      } catch (_) {}
    };

    join();
    return () => {
      mounted = false;
      roomRef.current?.disconnect().catch(() => {});
    };
  }, [roomName, streamerId, user]);

  const goWatch = () => navigate(`/live/${streamerId}`);

  return (
    <Box
      bg={bg}
      border="1px solid"
      borderColor={border}
      borderRadius="2xl"
      overflow="hidden"
      cursor="pointer"
      onClick={goWatch}
      _hover={{ transform: 'translateY(-2px)', boxShadow: 'lg', transition: 'all 0.2s' }}
      transition="all 0.2s"
    >
      {/* Video preview */}
      <Box position="relative" h="240px" bg="black">
        {previewTrack ? (
          <VideoTrack
            trackRef={{ publication: previewTrack }}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <Flex h="100%" alignItems="center" justifyContent="center" bg="gray.900">
            <Avatar src={streamer?.profilePic} name={streamer?.name} size="xl" />
          </Flex>
        )}

        {/* LIVE badge */}
        <Box position="absolute" top={3} left={3}>
          <Badge
            colorScheme="red" fontSize="sm" px={3} py={1} borderRadius="full"
            bg="red.500" color="white" fontWeight="bold"
            animation="pulse 1.5s ease-in-out infinite"
            sx={{
              '@keyframes pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.6 },
              },
            }}
          >
            🔴 LIVE
          </Badge>
        </Box>

        {/* Viewer count */}
        <Box position="absolute" top={3} right={3}>
          <Badge bg="blackAlpha.700" color="white" borderRadius="full" px={2} py={1} fontSize="xs">
            👁 {viewerCount}
          </Badge>
        </Box>
      </Box>

      {/* Footer */}
      <Flex p={3} alignItems="center" gap={3}>
        <Avatar src={streamer?.profilePic} name={streamer?.name} size="sm" />
        <VStack spacing={0} align="flex-start" flex={1}>
          <Text fontWeight="bold" fontSize="sm" noOfLines={1}>
            {streamer?.name || streamer?.username}
          </Text>
          <Text fontSize="xs" color="gray.500">Live now</Text>
        </VStack>
        <Button size="sm" colorScheme="red" borderRadius="full" onClick={e => { e.stopPropagation(); goWatch(); }}>
          Watch
        </Button>
      </Flex>
    </Box>
  );
};

export default LivePostCard;
