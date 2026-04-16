/**
 * LiveStreamPage
 *
 * /live/broadcast   → streamer: camera preview + go live button + floating chat
 * /live/:streamerId → viewer: full-screen video + floating animated chat
 *
 * Chat is ephemeral (LiveKit data channels — no database).
 */

import { useEffect, useRef, useState, useCallback, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Flex, Avatar, Text, VStack, HStack, Input, Button,
  Badge, IconButton, useColorModeValue, keyframes,
} from '@chakra-ui/react';
import { CloseIcon } from '@chakra-ui/icons';
import { css } from '@emotion/react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { VideoTrack, AudioTrack } from '@livekit/components-react';
import '@livekit/components-styles';
import { UserContext } from '../context/UserContext';
import { SocketContext } from '../context/SocketContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

// ── Floating message animation ────────────────────────────────────────────────
const floatUp = keyframes`
  0%   { transform: translateY(0);   opacity: 1; }
  70%  { transform: translateY(-80px); opacity: 1; }
  100% { transform: translateY(-120px); opacity: 0; }
`;

const FloatingMessage = ({ msg }) => (
  <Box
    position="absolute"
    bottom="16px"
    left="16px"
    right="160px"
    pointerEvents="none"
    css={css`animation: ${floatUp} 4s ease-out forwards;`}
    zIndex={10}
  >
    <Box bg="blackAlpha.700" borderRadius="full" px={3} py={1} display="inline-flex" alignItems="center" gap={2}>
      <Text as="span" fontWeight="bold" color="yellow.300" fontSize="sm">{msg.sender}</Text>
      <Text as="span" color="white" fontSize="sm">{msg.text}</Text>
    </Box>
  </Box>
);

// ── Viewer count badge ────────────────────────────────────────────────────────
const ViewerBadge = ({ count }) => (
  <Badge bg="blackAlpha.700" color="white" borderRadius="full" px={3} py={1} fontSize="sm">
    👁 {count}
  </Badge>
);

const LiveStreamPage = () => {
  const { streamerId } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(UserContext);
  const { socket } = useContext(SocketContext) || {};

  const isBroadcaster = !streamerId || streamerId === String(user?._id);

  // ── state ─────────────────────────────────────────────────────────────────
  const [isLive,          setIsLive]          = useState(false);
  const [viewerCount,     setViewerCount]      = useState(0);
  const [chatInput,       setChatInput]        = useState('');
  // floating messages: { id, sender, text }
  const [floatingMsgs,   setFloatingMsgs]     = useState([]);
  // persistent log (right panel)
  const [chatLog,         setChatLog]          = useState([]);
  const [localVideoTrack, setLocalVideoTrack]  = useState(null);
  const [remoteVideoTrack,setRemoteVideoTrack] = useState(null);
  const [remoteAudioTrack,setRemoteAudioTrack] = useState(null);
  const [roomName,        setRoomName]         = useState('');

  const roomRef    = useRef(null);
  const chatLogRef = useRef(null);
  let floatIdCounter = useRef(0);

  // ── scroll chat log ───────────────────────────────────────────────────────
  useEffect(() => {
    chatLogRef.current?.scrollTo(0, chatLogRef.current.scrollHeight);
  }, [chatLog]);

  // ── helpers ───────────────────────────────────────────────────────────────
  const addMessage = (sender, text) => {
    const id = ++floatIdCounter.current;
    setChatLog(prev => [...prev.slice(-100), { id, sender, text }]);
    setFloatingMsgs(prev => [...prev.slice(-5), { id, sender, text }]);
    // Remove floating msg after animation
    setTimeout(() => setFloatingMsgs(prev => prev.filter(m => m.id !== id)), 4100);
  };

  const fetchToken = useCallback(async (targetId, type) => {
    const res = await fetch(`${API_BASE}/api/call/token`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ type, targetId }),
    });
    if (!res.ok) throw new Error('Token error');
    return res.json();
  }, []);

  const disconnectRoom = useCallback(async () => {
    if (roomRef.current) {
      try { await roomRef.current.disconnect(); } catch (_) {}
      roomRef.current = null;
    }
    setLocalVideoTrack(null);
    setRemoteVideoTrack(null);
    setRemoteAudioTrack(null);
  }, []);

  // ── BROADCASTER: start stream ─────────────────────────────────────────────
  const startStream = useCallback(async () => {
    if (!user || !socket) return;
    try {
      const { token, roomName: rn, livekitUrl } = await fetchToken(String(user._id), 'livestream');
      setRoomName(rn);
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.ParticipantConnected,    () => setViewerCount(c => c + 1));
      room.on(RoomEvent.ParticipantDisconnected, () => setViewerCount(c => Math.max(0, c - 1)));
      room.on(RoomEvent.DataReceived, (payload) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (msg.type === 'chat') addMessage(msg.sender, msg.text);
        } catch (_) {}
      });

      await room.connect(livekitUrl, token);
      await room.localParticipant.enableCameraAndMicrophone();
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub?.track) setLocalVideoTrack(camPub.track);

      setIsLive(true);
      socket.emit('livekit:goLive', {
        streamerId:         String(user._id),
        streamerName:       user.name || user.username,
        streamerProfilePic: user.profilePic,
        roomName:           rn,
      });
    } catch (err) {
      console.error('[LiveStream] startStream:', err.message);
    }
  }, [user, socket, fetchToken]);

  // ── BROADCASTER: end stream ───────────────────────────────────────────────
  const endStream = useCallback(async () => {
    if (socket) socket.emit('livekit:endLive', { streamerId: String(user._id), roomName });
    await disconnectRoom();
    setIsLive(false);
    navigate(-1);
  }, [socket, user, roomName, disconnectRoom, navigate]);

  // ── VIEWER: join stream ───────────────────────────────────────────────────
  useEffect(() => {
    if (isBroadcaster || !streamerId) return;
    let mounted = true;

    const join = async () => {
      try {
        const { token, livekitUrl } = await fetchToken(streamerId, 'viewer');
        if (!mounted) return;
        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (!mounted) return;
          if (track.kind === 'video') setRemoteVideoTrack(track);
          if (track.kind === 'audio') setRemoteAudioTrack(track);
        });
        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          if (track.kind === 'video') setRemoteVideoTrack(null);
          if (track.kind === 'audio') setRemoteAudioTrack(null);
        });
        room.on(RoomEvent.ParticipantConnected,    () => mounted && setViewerCount(c => c + 1));
        room.on(RoomEvent.ParticipantDisconnected, () => mounted && setViewerCount(c => Math.max(0, c - 1)));
        room.on(RoomEvent.Disconnected, () => mounted && navigate(-1));
        room.on(RoomEvent.DataReceived, (payload) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload));
            if (msg.type === 'chat') addMessage(msg.sender, msg.text);
          } catch (_) {}
        });

        await room.connect(livekitUrl, token);
        if (mounted) {
          setIsLive(true);
          setViewerCount(room.remoteParticipants.size);
        }
      } catch (err) {
        if (mounted) navigate(-1);
      }
    };

    join();
    return () => { mounted = false; disconnectRoom(); };
  }, [isBroadcaster, streamerId]);

  // ── socket: stream ended (viewer) ─────────────────────────────────────────
  useEffect(() => {
    if (!socket || isBroadcaster) return;
    const onEnded = ({ streamerId: sid }) => {
      if (sid === streamerId) { disconnectRoom(); navigate(-1); }
    };
    socket.on('livekit:streamEnded', onEnded);
    return () => socket.off('livekit:streamEnded', onEnded);
  }, [socket, isBroadcaster, streamerId, navigate, disconnectRoom]);

  // ── send chat message ─────────────────────────────────────────────────────
  const sendChat = useCallback(async () => {
    if (!chatInput.trim() || !roomRef.current) return;
    const msg = { type: 'chat', sender: user?.name || user?.username || 'Viewer', text: chatInput.trim() };
    const encoded = new TextEncoder().encode(JSON.stringify(msg));
    await roomRef.current.localParticipant.publishData(encoded, { reliable: true });
    addMessage(msg.sender, msg.text);
    setChatInput('');
  }, [chatInput, user]);

  useEffect(() => () => { disconnectRoom(); }, []);

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <Box h="100vh" bg="black" position="relative" overflow="hidden">
      {/* ── Video layer ── */}
      {isBroadcaster && localVideoTrack ? (
        <VideoTrack
          trackRef={{ publication: localVideoTrack }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          local
        />
      ) : !isBroadcaster && remoteVideoTrack ? (
        <>
          <VideoTrack
            trackRef={{ publication: remoteVideoTrack }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {remoteAudioTrack && <AudioTrack trackRef={{ publication: remoteAudioTrack }} />}
        </>
      ) : (
        <Flex h="100%" alignItems="center" justifyContent="center" bg="gray.900">
          <Avatar src={user?.profilePic} name={user?.name} size="2xl" />
        </Flex>
      )}

      {/* ── Top bar ── */}
      <Flex
        position="absolute" top={0} left={0} right={0} zIndex={20}
        px={4} pt={4} pb={2}
        bg="linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)"
        alignItems="center" justifyContent="space-between"
      >
        <HStack spacing={3}>
          <Avatar src={user?.profilePic} name={user?.name} size="sm" />
          <VStack spacing={0} align="flex-start">
            <Text color="white" fontWeight="bold" fontSize="sm">
              {user?.name || user?.username}
            </Text>
            {isLive && (
              <HStack spacing={2}>
                <Badge colorScheme="red" fontSize="xs" px={2} borderRadius="full"
                  sx={{ animation: 'pulse 1.5s infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.5 } } }}>
                  🔴 LIVE
                </Badge>
                <ViewerBadge count={viewerCount} />
              </HStack>
            )}
          </VStack>
        </HStack>
        <HStack spacing={2}>
          {isBroadcaster && !isLive && (
            <Button colorScheme="red" size="sm" borderRadius="full" onClick={startStream}>Go Live</Button>
          )}
          {isBroadcaster && isLive && (
            <Button variant="outline" colorScheme="whiteAlpha" size="sm" borderRadius="full" color="white" onClick={endStream}>
              End
            </Button>
          )}
          <IconButton
            icon={<CloseIcon boxSize={3} />} size="sm" variant="ghost"
            colorScheme="whiteAlpha" color="white"
            onClick={() => { disconnectRoom(); navigate(-1); }}
            aria-label="Close"
          />
        </HStack>
      </Flex>

      {/* ── Floating messages ── */}
      <Box position="absolute" bottom="80px" left={0} right={0} pointerEvents="none" zIndex={15}>
        {floatingMsgs.map(m => <FloatingMessage key={m.id} msg={m} />)}
      </Box>

      {/* ── Chat log (right side — desktop) ── */}
      <Box
        position="absolute" top="60px" bottom="70px" right={0}
        w={{ base: '0', md: '280px' }} overflowY="auto"
        bg="blackAlpha.500"
        display={{ base: 'none', md: 'flex' }}
        flexDir="column"
        ref={chatLogRef}
        css={{ scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}
        px={3} py={2} gap={1}
        zIndex={15}
      >
        {chatLog.map(m => (
          <Box key={m.id}>
            <Text fontSize="sm" color="white">
              <Text as="span" fontWeight="bold" color="yellow.300">{m.sender}: </Text>
              {m.text}
            </Text>
          </Box>
        ))}
      </Box>

      {/* ── Chat input ── */}
      <Flex
        position="absolute" bottom={0} left={0} right={0} zIndex={20}
        px={4} py={3}
        bg="linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)"
        gap={2} alignItems="center"
      >
        <Input
          flex={1}
          size="sm"
          borderRadius="full"
          bg="blackAlpha.600"
          color="white"
          border="1px solid"
          borderColor="whiteAlpha.300"
          placeholder="Say something…"
          _placeholder={{ color: 'gray.400' }}
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendChat()}
        />
        <Button size="sm" colorScheme="blue" borderRadius="full" onClick={sendChat} flexShrink={0}>
          Send
        </Button>
      </Flex>
    </Box>
  );
};

export default LiveStreamPage;
