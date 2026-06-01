/**
 * LiveStreamPage — broadcaster uses LiveBroadcastContext (survives App home).
 * Viewers get zoom/pan on shared screen via ScreenShareViewer.
 */

import { useEffect, useRef, useState, useCallback, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Flex, Avatar, Text, VStack, HStack, Input, Button,
  Badge, IconButton, keyframes, useToast,
  Menu, MenuButton, MenuList, MenuItem, MenuDivider,
} from '@chakra-ui/react';
import { CloseIcon, ChevronDownIcon } from '@chakra-ui/icons';
import { css } from '@emotion/react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { UserContext } from '../context/UserContext';
import { SocketContext } from '../context/SocketContext';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import ScreenShareViewer from '../Components/ScreenShareViewer';

const API_BASE = import.meta.env.VITE_API_URL || '';

const isScreenShareSource = (pub, track) =>
  pub?.source === Track.Source.ScreenShare
  || track?.source === Track.Source.ScreenShare
  || pub?.source === 'screen_share'
  || track?.source === 'screen_share';

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
  const toast = useToast();

  const isBroadcaster = !streamerId || streamerId === String(user?._id);

  const broadcast = useLiveBroadcast();
  const {
    isLive: hostLive,
    isSharing: hostSharing,
    viewerCount: hostViewers,
    startingLive,
    localTrack,
    goLive,
    endLive,
    startShare,
    stopShare,
    shareAndGoHome,
    minimizeLive,
    openLiveControls,
    leaveLiveControls,
    registerChatHandler,
    sendChat: sendHostChat,
  } = broadcast;

  // ── viewer-only state ─────────────────────────────────────────────────────
  const [viewerConnected, setViewerConnected] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [remoteVideoTrack, setRemoteVideoTrack] = useState(null);
  const [remoteScreenTrack, setRemoteScreenTrack] = useState(null);

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
  const isSharing = isBroadcaster ? hostSharing : !!remoteScreenTrack;
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
    openLiveControls();
    return () => { leaveLiveControls(); };
    // Stable handlers from context — avoid re-running on every render
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
    if (!remoteVideoRef.current || !remoteVideoTrack || remoteScreenTrack) return;
    const el = remoteVideoRef.current;
    try { remoteVideoTrack.attach(el); } catch (_) {}
    return () => {
      try { remoteVideoTrack.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [remoteVideoTrack, remoteScreenTrack]);

  useEffect(() => {
    if (!remoteCamPipRef.current || !remoteScreenTrack || !remoteVideoTrack) return;
    const el = remoteCamPipRef.current;
    try { remoteVideoTrack.attach(el); } catch (_) {}
    return () => {
      try { remoteVideoTrack.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [remoteScreenTrack, remoteVideoTrack]);

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
    setRemoteVideoTrack(null);
    setRemoteScreenTrack(null);
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

  // ── VIEWER: join stream ───────────────────────────────────────────────────
  useEffect(() => {
    if (isBroadcaster || !streamerId) return;
    let mounted = true;

    const attachRemoteTrack = (track, pub) => {
      if (!mounted || !track) return;
      if (track.kind === 'video') {
        if (isScreenShareSource(pub, track)) setRemoteScreenTrack(track);
        else setRemoteVideoTrack(track);
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
          if (pub.track) attachRemoteTrack(pub.track, pub);
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

        room.on(RoomEvent.TrackSubscribed, (track, pub) => {
          attachRemoteTrack(track, pub);
        });
        room.on(RoomEvent.TrackUnsubscribed, (track, pub) => {
          if (!mounted) return;
          if (track.kind === 'video') {
            if (isScreenShareSource(pub, track)) setRemoteScreenTrack(null);
            else setRemoteVideoTrack(null);
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

  return (
    <Box position="fixed" inset={0} w="100vw" h="100dvh" bg="black" zIndex={1600} overflow="hidden">
      {isBroadcaster && localTrack ? (
        <Box as="video" ref={localVideoRef} autoPlay muted playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : !isBroadcaster && remoteScreenTrack ? (
        <Box position="absolute" inset={0}>
          <ScreenShareViewer track={remoteScreenTrack} name="Live stream" flex={1} minH="100dvh" />
        </Box>
      ) : !isBroadcaster && remoteVideoTrack ? (
        <Box as="video" ref={remoteVideoRef} autoPlay playsInline
          key={remoteVideoTrack?.sid || 'cam'}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <Flex h="100%" alignItems="center" justifyContent="center" bg="gray.900">
          <Avatar src={user?.profilePic} name={user?.name || user?.username || 'User'} size="2xl" />
        </Flex>
      )}

      {!isBroadcaster && remoteScreenTrack && remoteVideoTrack && (
        <Box position="absolute" top="80px" right="12px" w={{ base: '96px', md: '150px' }}
          h={{ base: '128px', md: '200px' }} borderRadius="xl" overflow="hidden"
          border="2px solid" borderColor="whiteAlpha.500" bg="black" zIndex={16}
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
            isSharing ? (
              <>
                <Button size="sm" borderRadius="full" colorScheme="teal" onClick={() => void stopShare()}>
                  Stop share
                </Button>
                <Button size="sm" borderRadius="full" variant="outline" colorScheme="whiteAlpha" color="white"
                  onClick={minimizeLive}>
                  🏠 App home
                </Button>
              </>
            ) : (
              <Menu placement="bottom-end">
                <MenuButton
                  as={Button}
                  size="sm"
                  borderRadius="full"
                  colorScheme="whiteAlpha"
                  variant="outline"
                  color="white"
                  rightIcon={<ChevronDownIcon />}
                >
                  🖥️ Share
                </MenuButton>
                <MenuList zIndex={2000} minW="240px">
                  <MenuItem closeOnSelect onClick={() => void startShare()}>
                    <VStack align="flex-start" spacing={0}>
                      <Text fontWeight="600">Share screen or window</Text>
                      <Text fontSize="xs" color="gray.500">Pick any tab, window, or your full screen</Text>
                    </VStack>
                  </MenuItem>
                  <MenuDivider />
                  <MenuItem closeOnSelect onClick={() => { void shareAndGoHome(); }}>
                    <VStack align="flex-start" spacing={0}>
                      <Text fontWeight="600">🏠 App home</Text>
                      <Text fontSize="xs" color="gray.500">Go to home first, then share this tab once</Text>
                    </VStack>
                  </MenuItem>
                </MenuList>
              </Menu>
            )
          )}
          {isBroadcaster && isLive && (
            <Button variant="outline" colorScheme="whiteAlpha" size="sm" borderRadius="full" color="white"
              onClick={async () => { await endLive(); exitLivePage(); }}>
              End
            </Button>
          )}
          <IconButton icon={<CloseIcon boxSize={3} />} size="sm" variant="ghost"
            colorScheme="whiteAlpha" color="white" onClick={safeClose} aria-label="Close"
          />
        </HStack>
      </Flex>

      {isBroadcaster && isLive && isSharing && (
        <HStack position="absolute" bottom="72px" left={4} right={4} zIndex={20} spacing={2}>
          <Button flex={1} size="sm" borderRadius="full" bg="blackAlpha.700" color="white"
            border="1px solid" borderColor="whiteAlpha.300" onClick={minimizeLive}
            _hover={{ bg: 'blackAlpha.800' }}>
            🏠 App home — keep sharing
          </Button>
        </HStack>
      )}

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
