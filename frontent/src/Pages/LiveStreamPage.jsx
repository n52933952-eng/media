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
import { Room, RoomEvent, ConnectionState } from 'livekit-client';
import { UserContext } from '../context/UserContext';
import { SocketContext } from '../context/SocketContext';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import ScreenShareViewer from '../Components/ScreenShareViewer';
import HostCameraPipHost from '../Components/HostCameraPipHost';
import {
  isScreenSharePublication,
  isVideoPublication,
  collectRemoteVideoTracks,
  applyRemoteVideoTrack,
} from '../utils/liveKitTracks';

const API_BASE = import.meta.env.VITE_API_URL || '';
const MAX_VIEWER_RECONNECT = 2;

const floatUp = keyframes`
  0%   { transform: translateY(0);   opacity: 1; }
  70%  { transform: translateY(-80px); opacity: 1; }
  100% { transform: translateY(-120px); opacity: 0; }
`;

const floatReactionUp = keyframes`
  0%   { transform: translateY(0) scale(0.4); opacity: 1; }
  15%  { transform: translateY(-20px) scale(1); opacity: 1; }
  100% { transform: translateY(-220px) scale(1); opacity: 0; }
`;

const FloatingReaction = ({ reaction }) => (
  <Box
    position="absolute"
    bottom={0}
    pointerEvents="none"
    css={css`animation: ${floatReactionUp} 2.8s ease-out forwards;`}
    style={{ transform: `translateX(${reaction.driftX}px)` }}
    zIndex={12}
  >
    <Text fontSize="42px" lineHeight={1} userSelect="none">{reaction.emoji}</Text>
  </Box>
);

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
    isSharing,
    goLive,
    endLive,
    toggleShare,
    shareAndGoAppHome,
    shareWindow,
    setLiveControlsFocused,
    registerChatHandler,
    sendChat: sendHostChat,
  } = useLiveBroadcast();

  const [viewerConnected, setViewerConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [remoteScreenTrack, setRemoteScreenTrack] = useState(null);
  const [remoteCameraTrack, setRemoteCameraTrack] = useState(null);

  const [chatInput, setChatInput] = useState('');
  const [floatingMsgs, setFloatingMsgs] = useState([]);
  const [floatingReactions, setFloatingReactions] = useState([]);
  const [chatLog, setChatLog] = useState([]);

  const roomRef = useRef(null);
  const chatLogRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const audioElRef = useRef(null);
  const closingRef = useRef(false);
  const intentionalLeaveRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  let floatIdCounter = useRef(0);
  let reactionIdCounter = useRef(0);

  const verifyStreamStillActive = useCallback(async () => {
    if (!streamerId) return false;
    try {
      const res = await fetch(
        `${API_BASE}/api/call/livestream/${encodeURIComponent(streamerId)}/status`,
        { credentials: 'include' },
      );
      if (!res.ok) return true;
      const st = await res.json().catch(() => ({}));
      return st?.active !== false;
    } catch {
      return true;
    }
  }, [streamerId]);

  const isLive = isBroadcaster ? hostLive : viewerConnected;
  const displayViewers = isBroadcaster ? hostViewers : viewerCount;

  const addMessage = useCallback((sender, text) => {
    const id = ++floatIdCounter.current;
    setChatLog(prev => [...prev.slice(-100), { id, sender, text }]);
    setFloatingMsgs(prev => [...prev.slice(-5), { id, sender, text }]);
    setTimeout(() => setFloatingMsgs(prev => prev.filter(m => m.id !== id)), 4100);
  }, []);

  const addEmojiFloat = useCallback((emoji) => {
    const id = ++reactionIdCounter.current;
    const driftX = Math.round((Math.random() - 0.5) * 48);
    const reaction = { id, emoji, driftX };
    setFloatingReactions(prev => [...prev.slice(-10), reaction]);
    setTimeout(() => {
      setFloatingReactions(prev => prev.filter(r => r.id !== id));
    }, 3000);
  }, []);

  const liveWatchStreamerId = isBroadcaster ? String(user?._id || '') : String(streamerId || '');

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
    if (!isBroadcaster) return undefined;
    setLiveControlsFocused(true);
    return () => setLiveControlsFocused(false);
  }, [isBroadcaster, setLiveControlsFocused]);

  useEffect(() => {
    if (!localTrack || !isBroadcaster || !hostLive) return undefined;
    let cancelled = false;
    const attach = () => {
      if (cancelled) return;
      if (isSharing) return;
      const el = localVideoRef.current;
      if (!el) return;
      try { localTrack.attach(el); } catch (_) {}
    };
    attach();
    const raf = requestAnimationFrame(attach);
    const t1 = setTimeout(attach, 50);
    const t2 = setTimeout(attach, 250);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      try { localTrack.detach(); } catch (_) {}
    };
  }, [localTrack, isSharing, isBroadcaster, hostLive]);

  useEffect(() => {
    if (!remoteVideoRef.current || !remoteCameraTrack || remoteScreenTrack) return;
    const el = remoteVideoRef.current;
    try { remoteCameraTrack.attach(el); } catch (_) {}
    return () => {
      try { remoteCameraTrack.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [remoteCameraTrack, remoteScreenTrack]);

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
    intentionalLeaveRef.current = true;
    closingRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
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
    intentionalLeaveRef.current = false;
    closingRef.current = false;
    reconnectAttemptsRef.current = 0;

    const attachRemoteTrack = (track, pub) => {
      if (!mounted || !track) return;
      if (track.kind === 'video' && isVideoPublication(pub)) {
        applyRemoteVideoTrack(track, pub, setRemoteScreenTrack, setRemoteCameraTrack);
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

    const onRemotePublication = async (pub) => {
      if (!mounted || !isVideoPublication(pub)) return;
      if (!pub.isSubscribed) {
        try { await pub.setSubscribed(true); } catch (_) {}
      }
      if (pub.track) attachRemoteTrack(pub.track, pub);
    };

    const bindRoomEvents = (room) => {
      room.on(RoomEvent.TrackSubscribed, (track, pub) => attachRemoteTrack(track, pub));
      room.on(RoomEvent.TrackPublished, (pub) => { void onRemotePublication(pub); });
      room.on(RoomEvent.TrackUnsubscribed, (track, pub) => {
        if (!mounted) return;
        if (track.kind === 'video') {
          if (isScreenSharePublication(pub, track)) setRemoteScreenTrack(null);
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
      room.on(RoomEvent.Reconnecting, () => {
        if (mounted) setIsReconnecting(true);
      });
      room.on(RoomEvent.Reconnected, () => {
        if (mounted) {
          setIsReconnecting(false);
          setViewerConnected(true);
          void collectRemoteVideoTracks(room).then(({ screen, camera }) => {
            if (!mounted) return;
            if (screen) setRemoteScreenTrack(screen);
            if (camera) setRemoteCameraTrack(camera);
          });
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        if (!mounted || intentionalLeaveRef.current || closingRef.current) return;
        setViewerConnected(false);
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          void (async () => {
            if (!mounted || intentionalLeaveRef.current || closingRef.current) return;
            const stillActive = await verifyStreamStillActive();
            if (!stillActive) {
              closingRef.current = true;
              exitLivePage();
              return;
            }
            if (reconnectAttemptsRef.current < MAX_VIEWER_RECONNECT) {
              reconnectAttemptsRef.current += 1;
              setIsReconnecting(true);
              try { await roomRef.current?.disconnect(); } catch (_) {}
              roomRef.current = null;
              void join();
              return;
            }
            closingRef.current = true;
            exitLivePage();
          })();
        }, 2800);
      });
      room.on(RoomEvent.DataReceived, (payload) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (msg.type === 'chat') addMessage(msg.sender, msg.text);
        } catch (_) {}
      });
    };

    const join = async () => {
      try {
        const [statusRes, tokenRes] = await Promise.all([
          fetch(`${API_BASE}/api/call/livestream/${encodeURIComponent(streamerId)}/status`, {
            credentials: 'include',
          }),
          fetch(`${API_BASE}/api/call/token`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'viewer', targetId: streamerId }),
          }),
        ]);
        if (statusRes.ok && mounted) {
          const st = await statusRes.json().catch(() => ({}));
          if (st?.active === false) {
            if (mounted) exitLivePage();
            return;
          }
        }
        if (!tokenRes.ok || !mounted) return;
        const { token, livekitUrl } = await tokenRes.json();
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          autoSubscribe: true,
        });
        roomRef.current = room;
        bindRoomEvents(room);

        await room.connect(livekitUrl, token);
        const { screen, camera } = await collectRemoteVideoTracks(room);
        if (mounted) {
          if (screen) setRemoteScreenTrack(screen);
          if (camera) setRemoteCameraTrack(camera);
          setIsReconnecting(false);
          setViewerConnected(true);
          setViewerCount(room.remoteParticipants.size);
        }
      } catch (_) {
        if (!mounted || intentionalLeaveRef.current || closingRef.current) return;
        const stillActive = await verifyStreamStillActive();
        if (stillActive && reconnectAttemptsRef.current < MAX_VIEWER_RECONNECT) {
          reconnectAttemptsRef.current += 1;
          setIsReconnecting(true);
          reconnectTimerRef.current = setTimeout(() => {
            if (mounted) void join();
          }, 2000);
          return;
        }
        if (mounted) exitLivePage();
      }
    };

    if (socket && streamerId) {
      socket.emit('livekit:joinLiveWatch', { streamerId: String(streamerId) });
    }

    join();
    return () => {
      mounted = false;
      intentionalLeaveRef.current = true;
      if (socket && streamerId) {
        socket.emit('livekit:leaveLiveWatch', { streamerId: String(streamerId) });
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      disconnectViewerRoom();
    };
  }, [isBroadcaster, streamerId, socket, disconnectViewerRoom, exitLivePage, addMessage, verifyStreamStillActive]);

  useEffect(() => {
    if (!socket || !liveWatchStreamerId) return undefined;
    if (isBroadcaster && !hostLive) return undefined;
    const onReaction = (payload) => {
      if (String(payload?.streamerId || '') !== liveWatchStreamerId) return;
      if (payload?.emoji) addEmojiFloat(payload.emoji);
    };
    socket.on('livekit:liveReaction', onReaction);
    return () => { socket.off('livekit:liveReaction', onReaction); };
  }, [socket, liveWatchStreamerId, addEmojiFloat, isBroadcaster, hostLive]);

  useEffect(() => {
    if (!socket || isBroadcaster) return;
    const onEnded = async (payload) => {
      const sid = payload?.streamerId != null ? String(payload.streamerId) : '';
      if (!sid || sid !== String(streamerId) || closingRef.current) return;
      const room = roomRef.current;
      if (
        room
        && (room.state === ConnectionState.Connected || room.state === ConnectionState.Reconnecting)
      ) {
        const stillActive = await verifyStreamStillActive();
        if (stillActive) return;
      }
      closingRef.current = true;
      disconnectViewerRoom();
      exitLivePage();
    };
    socket.on('livekit:streamEnded', onEnded);
    return () => socket.off('livekit:streamEnded', onEnded);
  }, [socket, isBroadcaster, streamerId, exitLivePage, disconnectViewerRoom, verifyStreamStillActive]);

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
      {isBroadcaster && hostLive && (
        <>
          <Box
            as="video"
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            display={isSharing ? 'none' : 'block'}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'contain', objectPosition: 'center', backgroundColor: '#000',
            }}
          />
          {isSharing && (
            <Flex position="absolute" inset={0} align="center" justify="center" bg="gray.900" px={6}>
              <Text color="white" fontSize="lg" fontWeight="bold" textAlign="center">
                🖥 Sharing — viewers see your screen. Use the bar to return.
              </Text>
            </Flex>
          )}
          {isSharing && localTrack && (
            <HostCameraPipHost track={localTrack} active zIndex={18} defaultTop={72} />
          )}
        </>
      )}
      {!isBroadcaster && remoteScreenTrack ? (
        <Box position="absolute" inset={0} display="flex" flexDir="column" p={2}>
          <ScreenShareViewer
            track={remoteScreenTrack}
            name={user?.name || user?.username || 'Streamer'}
            flex={1}
            minH="0"
            controlsBottom="88px"
          />
        </Box>
      ) : !isBroadcaster && remoteMainCamera ? (
        <Box as="video" ref={remoteVideoRef} autoPlay playsInline
          key={remoteMainCamera?.sid || 'cam'}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }}
        />
      ) : (
        <Flex h="100%" alignItems="center" justifyContent="center" bg="gray.900" px={6}>
          <Text color="gray.400" fontSize="md" textAlign="center">
            {!isBroadcaster
              ? (isReconnecting ? 'Reconnecting…' : viewerConnected ? 'Waiting for video…' : 'Connecting…')
              : (hostLive ? 'Starting camera…' : 'Tap Go Live to start')}
          </Text>
        </Flex>
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
              <Button size="sm" borderRadius="full" colorScheme="teal" color="white" onClick={shareAndGoAppHome}>
                🏠 Share app
              </Button>
              <Button size="sm" borderRadius="full" colorScheme="blue" color="white" onClick={shareWindow}>
                🖥 Share window
              </Button>
              {isSharing && (
                <Button size="sm" borderRadius="full" variant="outline" colorScheme="whiteAlpha" color="white"
                  onClick={toggleShare}>
                  Stop share
                </Button>
              )}
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

      <Box
        position="absolute"
        top="40%"
        left={0}
        right={0}
        h="280px"
        display="flex"
        alignItems="flex-end"
        justifyContent="center"
        pointerEvents="none"
        zIndex={14}
      >
        {floatingReactions.map(r => <FloatingReaction key={r.id} reaction={r} />)}
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
