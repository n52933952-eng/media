/**
 * LiveStreamPage — broadcaster uses LiveBroadcastContext; viewers watch camera stream.
 */

import { useEffect, useRef, useState, useCallback, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Flex, Avatar, Text, VStack, HStack, Input, Button,
  Badge, IconButton, keyframes,
} from '@chakra-ui/react';
import { CloseIcon } from '@chakra-ui/icons';
import { css } from '@emotion/react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { UserContext } from '../context/UserContext';
import { SocketContext } from '../context/SocketContext';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import ScreenShareViewer from '../Components/ScreenShareViewer';

const API_BASE = import.meta.env.VITE_API_URL || '';

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

  const {
    isLive: hostLive,
    viewerCount: hostViewers,
    startingLive,
    localTrack,
    localScreenTrack,
    isSharing,
    goLive,
    endLive,
    toggleShare,
    registerChatHandler,
    sendChat: sendHostChat,
  } = useLiveBroadcast();

  const [viewerConnected, setViewerConnected] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [remoteScreenTrack, setRemoteScreenTrack] = useState(null);
  const [remoteCameraTrack, setRemoteCameraTrack] = useState(null);

  const [chatInput, setChatInput] = useState('');
  const [floatingMsgs, setFloatingMsgs] = useState([]);
  const [chatLog, setChatLog] = useState([]);

  const roomRef = useRef(null);
  const chatLogRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteCamPipRef = useRef(null);
  const audioElRef = useRef(null);
  const closingRef = useRef(false);
  let floatIdCounter = useRef(0);

  const isLive = isBroadcaster ? hostLive : viewerConnected;
  const displayViewers = isBroadcaster ? hostViewers : viewerCount;

  const addMessage = useCallback((sender, text) => {
    const id = ++floatIdCounter.current;
    setChatLog(prev => [...prev.slice(-100), { id, sender, text }]);
    setFloatingMsgs(prev => [...prev.slice(-5), { id, sender, text }]);
    setTimeout(() => setFloatingMsgs(prev => prev.filter(m => m.id !== id)), 4100);
  }, []);

  useEffect(() => {
    chatLogRef.current?.scrollTo(0, chatLogRef.current.scrollHeight);
  }, [chatLog]);

  useEffect(() => {
    if (!isBroadcaster) return undefined;
    registerChatHandler(addMessage);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBroadcaster]);

  useEffect(() => {
    if (!localVideoRef.current || !localTrack) return;
    const el = localVideoRef.current;
    try { localTrack.attach(el); } catch (_) {}
    return () => {
      try { localTrack.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [localTrack]);

  useEffect(() => {
    if (!remoteVideoRef.current || !remoteCameraTrack || remoteScreenTrack) return;
    const el = remoteVideoRef.current;
    try { remoteCameraTrack.attach(el); } catch (_) {}
    return () => {
      try { remoteCameraTrack.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [remoteCameraTrack, remoteScreenTrack]);

  useEffect(() => {
    if (!remoteCamPipRef.current || !remoteCameraTrack || !remoteScreenTrack) return;
    const el = remoteCamPipRef.current;
    try { remoteCameraTrack.attach(el); } catch (_) {}
    return () => {
      try { remoteCameraTrack.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [remoteCameraTrack, remoteScreenTrack]);

  const fetchToken = useCallback(async (targetId, type) => {
    const res = await fetch(`${API_BASE}/api/call/token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, targetId }),
    });
    if (!res.ok) throw new Error('Token error');
    return res.json();
  }, []);

  const disconnectViewerRoom = useCallback(async () => {
    if (roomRef.current) {
      try { await roomRef.current.disconnect(); } catch (_) {}
      roomRef.current = null;
    }
    setRemoteScreenTrack(null);
    setRemoteCameraTrack(null);
    if (audioElRef.current) {
      try { audioElRef.current.remove(); } catch (_) {}
      audioElRef.current = null;
    }
  }, []);

  const exitLivePage = useCallback(() => {
    navigate(-1);
    setTimeout(() => {
      if (window.location.pathname.startsWith('/live/')) {
        navigate('/home', { replace: true });
      }
    }, 80);
  }, [navigate]);

  const safeClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (isBroadcaster) {
      await endLive();
    } else {
      await disconnectViewerRoom();
    }
    exitLivePage();
  }, [isBroadcaster, endLive, disconnectViewerRoom, exitLivePage]);

  useEffect(() => {
    if (isBroadcaster || !streamerId) return;
    let mounted = true;

    const isScreenPub = (pub, track) =>
      pub?.source === Track.Source.ScreenShare
      || track?.source === Track.Source.ScreenShare
      || pub?.source === 'screen_share'
      || track?.source === 'screen_share';

    const attachRemoteTrack = (track, pub) => {
      if (!mounted || !track) return;
      if (track.kind === 'video') {
        if (isScreenPub(pub, track)) setRemoteScreenTrack(track);
        else setRemoteCameraTrack(track);
      }
      if (track.kind === 'audio') {
        try {
          const audioEl = track.attach();
          audioEl.autoplay = true;
          audioEl.style.display = 'none';
          document.body.appendChild(audioEl);
          if (audioElRef.current) try { audioElRef.current.remove(); } catch (_) {}
          audioElRef.current = audioEl;
        } catch (_) {}
      }
    };

    const syncExistingRemoteTracks = async (room) => {
      for (const participant of room.remoteParticipants.values()) {
        for (const pub of participant.trackPublications.values()) {
          if (!pub.isSubscribed) {
            try { await pub.setSubscribed(true); } catch (_) {}
          }
          if (pub.track && pub.kind === 'video') attachRemoteTrack(pub.track, pub);
          if (pub.track && pub.kind === 'audio') attachRemoteTrack(pub.track, pub);
        }
      }
    };

    const join = async () => {
      try {
        const statusRes = await fetch(`${API_BASE}/api/call/livestream/${encodeURIComponent(streamerId)}/status`, {
          credentials: 'include',
        });
        if (statusRes.ok && mounted) {
          const st = await statusRes.json().catch(() => ({}));
          if (st?.active === false) {
            if (mounted) exitLivePage();
            return;
          }
        }
        const { token, livekitUrl } = await fetchToken(streamerId, 'viewer');
        if (!mounted) return;
        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track, pub) => attachRemoteTrack(track, pub));
        room.on(RoomEvent.TrackUnsubscribed, (track, pub) => {
          if (!mounted) return;
          if (track.kind === 'video') {
            if (isScreenPub(pub, track)) setRemoteScreenTrack(null);
            else setRemoteCameraTrack(null);
          }
          if (track.kind === 'audio' && audioElRef.current) {
            try {
              track.detach(audioElRef.current);
              audioElRef.current.remove();
            } catch (_) {}
            audioElRef.current = null;
          }
        });
        room.on(RoomEvent.ParticipantConnected, () => mounted && setViewerCount(c => c + 1));
        room.on(RoomEvent.ParticipantDisconnected, () => mounted && setViewerCount(c => Math.max(0, c - 1)));
        room.on(RoomEvent.Disconnected, () => {
          if (!mounted || closingRef.current) return;
          closingRef.current = true;
          exitLivePage();
        });
        room.on(RoomEvent.DataReceived, (payload) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload));
            if (msg.type === 'chat') addMessage(msg.sender, msg.text);
          } catch (_) {}
        });

        await room.connect(livekitUrl, token);
        await syncExistingRemoteTracks(room);
        if (mounted) {
          setViewerConnected(true);
          setViewerCount(room.remoteParticipants.size);
        }
      } catch (_) {
        if (mounted) exitLivePage();
      }
    };

    join();
    return () => {
      mounted = false;
      disconnectViewerRoom();
    };
  }, [isBroadcaster, streamerId, disconnectViewerRoom, exitLivePage, fetchToken, addMessage]);

  useEffect(() => {
    if (!socket || isBroadcaster) return;
    const onEnded = (payload) => {
      const sid = payload?.streamerId != null ? String(payload.streamerId) : '';
      if (sid && sid === String(streamerId) && !closingRef.current) {
        closingRef.current = true;
        disconnectViewerRoom();
        exitLivePage();
      }
    };
    socket.on('livekit:streamEnded', onEnded);
    return () => socket.off('livekit:streamEnded', onEnded);
  }, [socket, isBroadcaster, streamerId, exitLivePage, disconnectViewerRoom]);

  const sendChat = useCallback(async () => {
    if (!chatInput.trim()) return;
    const sender = user?.name || user?.username || (isBroadcaster ? 'Streamer' : 'Viewer');
    const text = chatInput.trim();
    if (isBroadcaster) {
      await sendHostChat(text, sender);
    } else if (roomRef.current) {
      const msg = { type: 'chat', sender, text };
      const encoded = new TextEncoder().encode(JSON.stringify(msg));
      await roomRef.current.localParticipant.publishData(encoded, { reliable: true });
    }
    addMessage(sender, text);
    setChatInput('');
  }, [chatInput, user, isBroadcaster, sendHostChat, addMessage]);

  const remoteMainCamera = !isBroadcaster && !remoteScreenTrack ? remoteCameraTrack : null;

  return (
    <Box position="fixed" inset={0} w="100vw" h="100dvh" bg="black" zIndex={1600} overflow="hidden">
      {isBroadcaster && localScreenTrack ? (
        <Box position="absolute" inset={0} display="flex" flexDir="column" p={2}>
          <ScreenShareViewer track={localScreenTrack} name="You" flex={1} minH="0" />
        </Box>
      ) : isBroadcaster && localTrack ? (
        <Box as="video" ref={localVideoRef} autoPlay muted playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }}
        />
      ) : !isBroadcaster && remoteScreenTrack ? (
        <Box position="absolute" inset={0} display="flex" flexDir="column" p={2}>
          <ScreenShareViewer
            track={remoteScreenTrack}
            name={user?.name || user?.username || 'Streamer'}
            flex={1}
            minH="0"
          />
        </Box>
      ) : !isBroadcaster && remoteMainCamera ? (
        <Box as="video" ref={remoteVideoRef} autoPlay playsInline
          key={remoteMainCamera?.sid || 'cam'}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }}
        />
      ) : (
        <Flex h="100%" alignItems="center" justifyContent="center" bg="gray.900">
          <Avatar src={user?.profilePic} name={user?.name || user?.username || 'User'} size="2xl" />
        </Flex>
      )}

      {isBroadcaster && isSharing && localTrack && (
        <Box
          position="absolute" top="72px" right={4} w="120px" h="90px"
          borderRadius="lg" overflow="hidden" border="2px solid" borderColor="whiteAlpha.500"
          bg="black" zIndex={18}
        >
          <Box as="video" ref={localVideoRef} autoPlay muted playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Box>
      )}

      {!isBroadcaster && remoteScreenTrack && remoteCameraTrack && (
        <Box
          position="absolute" top="72px" right={4} w="120px" h="90px"
          borderRadius="lg" overflow="hidden" border="2px solid" borderColor="whiteAlpha.500"
          bg="black" zIndex={18}
        >
          <Box as="video" ref={remoteCamPipRef} autoPlay playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Box>
      )}

      <Flex position="absolute" top={0} left={0} right={0} zIndex={20} px={4} pt={4} pb={2}
        bg="linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 100%)"
        alignItems="center" justifyContent="space-between"
      >
        <HStack spacing={3}>
          <Avatar src={user?.profilePic} name={user?.name || user?.username || 'User'} size="sm" />
          <VStack spacing={0} align="flex-start">
            <Text color="white" fontWeight="bold" fontSize="sm">{user?.name || user?.username}</Text>
            {isLive && (
              <HStack spacing={2}>
                <Badge colorScheme="red" fontSize="xs" px={2} borderRadius="full">🔴 LIVE</Badge>
                <ViewerBadge count={displayViewers} />
              </HStack>
            )}
          </VStack>
        </HStack>
        <HStack spacing={2}>
          {isBroadcaster && !isLive && (
            <Button colorScheme="red" size="sm" borderRadius="full" onClick={goLive}
              isLoading={startingLive} loadingText="Starting..." isDisabled={startingLive}>
              Go Live
            </Button>
          )}
          {isBroadcaster && isLive && (
            <>
              <Button
                size="sm" borderRadius="full" color="white"
                colorScheme={isSharing ? 'teal' : 'whiteAlpha'}
                variant={isSharing ? 'solid' : 'outline'}
                onClick={toggleShare}
              >
                {isSharing ? 'Stop share' : 'Share screen'}
              </Button>
              <Button variant="outline" colorScheme="whiteAlpha" size="sm" borderRadius="full" color="white"
                onClick={async () => { await endLive(); exitLivePage(); }}>
                End
              </Button>
            </>
          )}
          <IconButton icon={<CloseIcon boxSize={3} />} size="sm" variant="ghost"
            colorScheme="whiteAlpha" color="white" onClick={safeClose} aria-label="Close"
          />
        </HStack>
      </Flex>

      <Box position="absolute" bottom="108px" left={0} right={0} pointerEvents="none" zIndex={15}>
        {floatingMsgs.map(m => <FloatingMessage key={m.id} msg={m} />)}
      </Box>

      <Box position="absolute" top="66px" bottom="96px" right={0} w={{ base: '0', md: '280px' }}
        overflowY="auto" bg="blackAlpha.350" display={{ base: 'none', md: 'flex' }} flexDir="column"
        ref={chatLogRef} css={{ scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}
        px={3} py={2} gap={1} zIndex={15}
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

      <Flex position="absolute" bottom={0} left={0} right={0} zIndex={20} px={4} pt={2}
        pb="calc(env(safe-area-inset-bottom, 0px) + 12px)"
        bg="linear-gradient(to top, rgba(0,0,0,0.62) 0%, transparent 100%)"
        gap={2} alignItems="center"
      >
        <Input flex={1} size="sm" borderRadius="full" bg="blackAlpha.600" color="white"
          border="1px solid" borderColor="whiteAlpha.300" placeholder="Say something…"
          _placeholder={{ color: 'gray.400' }} value={chatInput}
          onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()}
        />
        <Button size="sm" colorScheme="blue" borderRadius="full" onClick={sendChat} flexShrink={0}>Send</Button>
      </Flex>
    </Box>
  );
};

export default LiveStreamPage;
