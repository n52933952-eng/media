/**
 * LiveStreamPage — broadcaster uses LiveBroadcastContext; viewers watch camera stream.
 */

import { useEffect, useRef, useState, useCallback, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Flex, Avatar, Text, VStack, HStack, Input, Button,
  Badge, IconButton, keyframes, SimpleGrid,
} from '@chakra-ui/react';
import { CloseIcon } from '@chakra-ui/icons';
import { css } from '@emotion/react';
import { Room, RoomEvent, ConnectionState } from 'livekit-client';
import { UserContext } from '../context/UserContext';
import { SocketContext } from '../context/SocketContext';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import ScreenShareViewer from '../Components/ScreenShareViewer';
import HostCameraPipHost from '../Components/HostCameraPipHost';
import LiveActionButton from '../Components/LiveActionButton';
import LiveShareModal from '../Components/LiveShareModal';
import { useLiveScreenMetrics, liveActionStyles } from '../utils/liveScreenLayout';
import {
  isScreenSharePublication,
  isVideoPublication,
  collectRemoteVideoTracks,
  applyRemoteVideoTrack,
} from '../utils/liveKitTracks';

const API_BASE = import.meta.env.VITE_API_URL || '';
const MAX_VIEWER_RECONNECT = 2;
const BROADCASTER_RAIL_SLOTS = 7;
const VIEWER_RAIL_SLOTS = 5;
const LIVE_EMOJIS = ['❤️', '😂', '🔥', '👏', '😍', '🎉', '💯', '🙌'];
/** Space reserved for bottom chat input row. */
const INPUT_BAR_H = 64;
const FLOAT_MSG_MS = 5500;
const CHAT_PANEL_BG = 'rgba(20, 48, 82, 0.88)';
const CHAT_PANEL_BORDER = 'rgba(59, 130, 246, 0.4)';
const floatUp = keyframes`
  0%   { transform: translateY(0);    opacity: 1; }
  70%  { transform: translateY(-180px); opacity: 1; }
  100% { transform: translateY(-260px); opacity: 0; }
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
    bottom={0}
    left={0}
    maxW="85%"
    pointerEvents="none"
    css={css`animation: ${floatUp} ${FLOAT_MSG_MS}ms ease-out forwards;`}
    zIndex={10}
  >
    <Box
      bg="rgba(0,0,0,0.62)"
      borderRadius="full"
      px={3}
      py={1.5}
      display="inline-flex"
      alignItems="center"
      gap={2}
      border="1px solid rgba(255,255,255,0.12)"
    >
      <Text as="span" fontWeight="bold" color="yellow.300" fontSize="sm" noOfLines={1}>{msg.sender}</Text>
      <Text as="span" color="white" fontSize="sm" noOfLines={2}>{msg.text}</Text>
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
    liveRoomName,
    isMicMuted,
    toggleMicMute,
  } = useLiveBroadcast();

  const metrics = useLiveScreenMetrics();
  const ui = liveActionStyles(metrics, isBroadcaster ? BROADCASTER_RAIL_SLOTS : VIEWER_RAIL_SLOTS);
  const [viewerConnected, setViewerConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [remoteScreenTrack, setRemoteScreenTrack] = useState(null);
  const [remoteCameraTrack, setRemoteCameraTrack] = useState(null);

  const [chatInput, setChatInput] = useState('');
  const [floatingMsgs, setFloatingMsgs] = useState([]);
  const [floatingReactions, setFloatingReactions] = useState([]);
  const [chatLog, setChatLog] = useState([]);
  const [showLog, setShowLog] = useState(false);
  const [shareLiveOpen, setShareLiveOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [viewerMuted, setViewerMuted] = useState(false);
  const [videoFitCover, setVideoFitCover] = useState(true);
  const [hostVideoFitCover, setHostVideoFitCover] = useState(true);
  const [hostInfo, setHostInfo] = useState({ name: 'User', profilePic: '', roomName: '' });

  const roomRef = useRef(null);
  const viewerMutedRef = useRef(false);
  const remoteAudioTrackRef = useRef(null);
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

  useEffect(() => {
    viewerMutedRef.current = viewerMuted;
    const track = remoteAudioTrackRef.current;
    if (track?.setVolume) {
      try { track.setVolume(viewerMuted ? 0 : 1); } catch (_) {}
    }
  }, [viewerMuted]);

  useEffect(() => {
    if (isBroadcaster || !streamerId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [profRes, statusRes] = await Promise.all([
          fetch(`${API_BASE}/api/user/getUserPro/${encodeURIComponent(streamerId)}`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/call/livestream/${encodeURIComponent(streamerId)}/status`, { credentials: 'include' }),
        ]);
        if (cancelled) return;
        let name = 'User';
        let profilePic = '';
        let roomName = '';
        if (profRes.ok) {
          const prof = await profRes.json().catch(() => ({}));
          name = prof?.name || prof?.username || name;
          profilePic = prof?.profilePic || '';
        }
        if (statusRes.ok) {
          const st = await statusRes.json().catch(() => ({}));
          roomName = st?.roomName || '';
        }
        setHostInfo({ name, profilePic, roomName });
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [isBroadcaster, streamerId]);

  const addMessage = useCallback((sender, text) => {
    const id = ++floatIdCounter.current;
    setChatLog(prev => [...prev.slice(-100), { id, sender, text }]);
    setFloatingMsgs(prev => [...prev.slice(-5), { id, sender, text }]);
    setTimeout(() => setFloatingMsgs(prev => prev.filter(m => m.id !== id)), FLOAT_MSG_MS + 200);
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
  }, [chatLog, showLog]);

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
          remoteAudioTrackRef.current = track;
          if (track.setVolume) {
            try { track.setVolume(viewerMutedRef.current ? 0 : 1); } catch (_) {}
          }
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

  const sendEmojiReaction = useCallback((emoji) => {
    if (!socket || !liveWatchStreamerId) return;
    setEmojiPickerOpen(false);
    const sender = user?.name || user?.username || 'Viewer';
    socket.emit('livekit:liveReaction', {
      streamerId: liveWatchStreamerId,
      emoji,
      sender,
    });
    addEmojiFloat(emoji);
  }, [socket, liveWatchStreamerId, user, addEmojiFloat]);

  const shareLivePayload = isBroadcaster
    ? {
      streamerId: String(user?._id || ''),
      streamerName: user?.name || user?.username || 'User',
      streamerProfilePic: user?.profilePic || '',
      roomName: liveRoomName || '',
    }
    : {
      streamerId: String(streamerId || ''),
      streamerName: hostInfo.name,
      streamerProfilePic: hostInfo.profilePic,
      roomName: hostInfo.roomName,
    };

  const remoteMainCamera = !isBroadcaster && !remoteScreenTrack ? remoteCameraTrack : null;
  const chatLogBottom = INPUT_BAR_H + 12;
  const actionRailBottom = INPUT_BAR_H + 16 + (
    isBroadcaster ? metrics.broadcasterRailBottomExtra : metrics.viewerRailBottomExtra
  );
  const actionRailMaxH = `calc(100dvh - ${metrics.liveTopBarClear + 48}px - ${actionRailBottom}px)`;
  const endBtnRight = metrics.actionRailGutter + 8;
  const displayName = isBroadcaster
    ? (user?.name || user?.username)
    : hostInfo.name;
  const displayAvatar = isBroadcaster ? user?.profilePic : hostInfo.profilePic;
  const showActionRail = isBroadcaster ? hostLive : viewerConnected;

  return (
    <Box position="fixed" inset={0} w="100vw" h="100dvh" bg="#000" zIndex={1600} overflow="hidden">
      {isBroadcaster && hostLive && (
        <>
          <Box position="absolute" inset={0} bg="#000" />
          <Box
            as="video"
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            display={isSharing ? 'none' : 'block'}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: hostVideoFitCover ? 'cover' : 'contain',
              objectPosition: 'center', backgroundColor: '#000',
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
        <>
          <Box position="absolute" inset={0} bg="#000" />
          <Box
            as="video"
            ref={remoteVideoRef}
            autoPlay
            playsInline
            key={remoteMainCamera?.sid || 'cam'}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: videoFitCover ? 'cover' : 'contain',
              objectPosition: 'center', backgroundColor: '#000',
            }}
          />
        </>
      ) : (
        <Flex h="100%" alignItems="center" justifyContent="center" bg="#000" px={6} direction="column" gap={3}>
          <Text color="gray.400" fontSize="md" textAlign="center">
            {!isBroadcaster
              ? (isReconnecting ? 'Reconnecting…' : viewerConnected ? 'Waiting for video…' : 'Connecting…')
              : (hostLive ? 'Starting camera…' : 'Tap Go Live to start')}
          </Text>
        </Flex>
      )}

      <Flex
        position="absolute"
        left={3}
        right={3}
        zIndex={30}
        px={2}
        py={2}
        alignItems="center"
        justifyContent="space-between"
        pointerEvents="none"
        style={{ top: ui.topBar.top }}
      >
        {isBroadcaster ? (
          <HStack spacing={2} flexShrink={0} pointerEvents="auto" maxW="70%">
            <Avatar src={displayAvatar} name={displayName || 'User'} size="sm" />
            <VStack spacing={0} align="flex-start" minW={0}>
              <Text color="white" fontWeight="bold" fontSize="sm" noOfLines={1} textShadow="0 1px 4px rgba(0,0,0,0.8)">{displayName}</Text>
              {isLive && (
                <HStack spacing={2}>
                  <Badge colorScheme="red" fontSize="xs" px={2} borderRadius="full">🔴 LIVE</Badge>
                  <ViewerBadge count={displayViewers} />
                </HStack>
              )}
            </VStack>
          </HStack>
        ) : (
          <HStack
            spacing={2}
            flexShrink={0}
            pointerEvents="auto"
            bg="rgba(0,0,0,0.45)"
            border="1px solid rgba(255,255,255,0.15)"
            borderRadius="full"
            px={2}
            py={1}
            maxW="min(220px, 55vw)"
          >
            <Avatar src={displayAvatar} name={displayName || 'User'} size="xs" />
            <Text color="white" fontWeight="bold" fontSize="sm" noOfLines={1}>{displayName}</Text>
          </HStack>
        )}
        <Box flex={1} minW={2} />
      </Flex>

      {(isBroadcaster && hostLive) && (
        <Button
          position="fixed"
          zIndex={40}
          size="xs"
          borderRadius="full"
          colorScheme="red"
          variant="solid"
          px={4}
          pointerEvents="auto"
          style={{ top: ui.topBar.top, right: `${endBtnRight}px` }}
          onClick={async () => { await endLive(); exitLivePage(); }}
        >
          End
        </Button>
      )}
      {!isBroadcaster && (
        <HStack
          position="fixed"
          zIndex={40}
          spacing={2}
          pointerEvents="auto"
          style={{ top: ui.topBar.top, right: `${endBtnRight}px` }}
        >
          {viewerConnected && (
            <Badge colorScheme="red" fontSize="xs" px={2} borderRadius="full">🔴 LIVE</Badge>
          )}
          <Button size="xs" borderRadius="full" colorScheme="red" variant="solid" px={4} onClick={safeClose}>
            {viewerConnected ? 'Leave' : 'Close'}
          </Button>
        </HStack>
      )}
      {isBroadcaster && !hostLive && (
        <IconButton
          position="fixed"
          zIndex={40}
          icon={<CloseIcon boxSize={3} />}
          size="sm"
          variant="ghost"
          colorScheme="whiteAlpha"
          color="white"
          pointerEvents="auto"
          style={{ top: ui.topBar.top, right: `${endBtnRight}px` }}
          onClick={safeClose}
          aria-label="Close"
        />
      )}

      {isBroadcaster && !isLive && (
        <Flex position="absolute" left={0} right={0} bottom="12%" zIndex={18} justify="center" px={6}>
          <Button
            colorScheme="red"
            size="lg"
            borderRadius="full"
            px={10}
            onClick={goLive}
            isLoading={startingLive}
            loadingText="Starting..."
            isDisabled={startingLive}
          >
            Go Live
          </Button>
        </Flex>
      )}

      <Box
        position="absolute"
        bottom={`${INPUT_BAR_H + 36}px`}
        left={0}
        pointerEvents="none"
        zIndex={15}
        style={{ right: ui.floatArea.right }}
      >
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

      {showLog && isLive && (
        <Box
          position="fixed"
          left="12px"
          overflowY="auto"
          display="flex"
          flexDir="column"
          justifyContent="flex-end"
          ref={chatLogRef}
          px={4}
          py={3}
          gap={1.5}
          zIndex={22}
          borderRadius="xl"
          border="1px solid"
          borderColor={CHAT_PANEL_BORDER}
          bg={CHAT_PANEL_BG}
          style={{
            bottom: `${chatLogBottom}px`,
            right: ui.logPanel.right,
            height: ui.logPanel.height,
          }}
          css={{ scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}
        >
          {chatLog.map(m => (
            <Box key={m.id} alignSelf="flex-start" maxW="100%">
              <Text fontSize="sm" color="white" lineHeight="short">
                <Text as="span" fontWeight="bold" color="yellow.300">{m.sender}: </Text>
                {m.text}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {emojiPickerOpen && !isBroadcaster && isLive && (
        <>
          <Box position="fixed" inset={0} zIndex={24} onClick={() => setEmojiPickerOpen(false)} />
          <Box
            position="absolute"
            zIndex={25}
            bg="white"
            borderRadius="2xl"
            p={2}
            boxShadow="lg"
            style={{
              bottom: `${INPUT_BAR_H + metrics.actionSlotH * 2 + 24}px`,
              right: ui.emojiPickerAnchor.right,
              maxWidth: ui.emojiPickerAnchor.maxWidth,
            }}
          >
            <SimpleGrid columns={4} spacing={2}>
              {LIVE_EMOJIS.map((emoji) => (
                <Box
                  key={emoji}
                  as="button"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  bg="gray.50"
                  _hover={{ bg: 'gray.100' }}
                  style={ui.emojiPickerBtn}
                  onClick={() => sendEmojiReaction(emoji)}
                >
                  <Text fontSize={ui.emojiPickerEmoji.fontSize} lineHeight={1}>{emoji}</Text>
                </Box>
              ))}
            </SimpleGrid>
          </Box>
        </>
      )}

      {showActionRail && (
        <Box
          position="fixed"
          zIndex={25}
          bottom={`${actionRailBottom}px`}
          right={`${metrics.actionRailRight}px`}
          w={`${metrics.actionRailWidth}px`}
          maxH={actionRailMaxH}
          display="flex"
          flexDirection="column"
          justifyContent="flex-end"
          alignItems="center"
          gap={2}
          pointerEvents="auto"
        >
          {isBroadcaster ? (
            <>
              <LiveActionButton
                ui={ui}
                icon={isMicMuted ? '🔇' : '🔊'}
                label={isMicMuted ? 'Unmute' : 'Mute'}
                onClick={() => { void toggleMicMute(); }}
              />
              {!isSharing && (
                <LiveActionButton
                  ui={ui}
                  icon={hostVideoFitCover ? '◫' : '◧'}
                  label={hostVideoFitCover ? 'Fit' : 'Fill'}
                  highlight={hostVideoFitCover}
                  onClick={() => setHostVideoFitCover(v => !v)}
                />
              )}
              <LiveActionButton
                ui={ui}
                icon="📤"
                label="Share live"
                primary
                onClick={() => setShareLiveOpen(true)}
              />
              <LiveActionButton
                ui={ui}
                icon="🏠"
                label="Share app"
                primary={!isSharing}
                disabled={isSharing}
                onClick={shareAndGoAppHome}
              />
              <LiveActionButton
                ui={ui}
                icon="🖥"
                label="Share window"
                disabled={isSharing}
                onClick={shareWindow}
              />
              <LiveActionButton
                ui={ui}
                icon="💬"
                label="Chat"
                primary={showLog}
                onClick={() => setShowLog(v => !v)}
              />
              {isSharing && (
                <LiveActionButton
                  ui={ui}
                  icon="🛑"
                  label="Stop"
                  onClick={toggleShare}
                  circleStyle={{ borderColor: 'red.400', borderWidth: '2px' }}
                />
              )}
            </>
          ) : (
            <>
              {remoteMainCamera && (
                <LiveActionButton
                  ui={ui}
                  icon={videoFitCover ? '◫' : '◧'}
                  label={videoFitCover ? 'Fit' : 'Fill'}
                  highlight={videoFitCover}
                  onClick={() => setVideoFitCover(v => !v)}
                />
              )}
              <LiveActionButton
                ui={ui}
                icon={viewerMuted ? '🔇' : '🔊'}
                label={viewerMuted ? 'Unmute' : 'Mute'}
                onClick={() => setViewerMuted(v => !v)}
              />
              <LiveActionButton
                ui={ui}
                icon="📤"
                label="Share"
                primary
                onClick={() => setShareLiveOpen(true)}
              />
              <LiveActionButton
                ui={ui}
                icon="💬"
                label="Chat"
                primary={showLog}
                onClick={() => setShowLog(v => !v)}
              />
              <LiveActionButton
                ui={ui}
                icon="♥"
                label="React"
                highlight={emojiPickerOpen}
                onClick={() => setEmojiPickerOpen(v => !v)}
              />
            </>
          )}
        </Box>
      )}

      <LiveShareModal
        isOpen={shareLiveOpen}
        onClose={() => setShareLiveOpen(false)}
        live={shareLivePayload}
      />

      {showActionRail && (
        <Flex
          position="fixed"
          bottom={0}
          left={0}
          right={0}
          zIndex={20}
          h={`${INPUT_BAR_H}px`}
          pl={4}
          pr={`${metrics.actionRailGutter + 8}px`}
          alignItems="center"
          gap={2}
          bg="rgba(0,0,0,0.42)"
          borderTop="1px solid rgba(255,255,255,0.08)"
        >
          <Input
            flex={1}
            size="sm"
            borderRadius="full"
            bg="rgba(255,255,255,0.1)"
            color="white"
            border="1px solid"
            borderColor="whiteAlpha.300"
            placeholder="Say something…"
            _placeholder={{ color: 'gray.400' }}
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()}
            maxH="40px"
          />
          <Button
            size="sm"
            colorScheme="blue"
            borderRadius="full"
            onClick={sendChat}
            flexShrink={0}
            px={5}
            h="36px"
            fontSize="sm"
          >
            Send
          </Button>
        </Flex>
      )}
    </Box>
  );
};

export default LiveStreamPage;
