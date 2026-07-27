/**
 * LiveBroadcastContext — LiveKit room for web live streaming (camera + chat).
 */

import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, VideoPresets, ConnectionState } from 'livekit-client';
import { useToast } from '@chakra-ui/react';
import { UserContext } from './UserContext';
import { SocketContext } from './SocketContext';
import { resignActiveGames } from '../utils/liveGameResign';
import { liveBroadcastNav } from '../services/liveBroadcastNav';
import { restoreCameraForViewers } from '../utils/liveBroadcastCamera';
import {
  canSendLiveChat,
  createLiveChatBatchSink,
  LIVE_CHAT_MAX_MESSAGES,
} from '../utils/liveChatThrottle';

const API_BASE = import.meta.env.VITE_API_URL || '';

/** End live if broadcaster leaves the tab/app without Share + minimize (matches mobile). */
const BROADCASTER_BACKGROUND_END_MS = 15000;

/** Match group-call room settings — proven to work web → mobile screen share. */
const LIVE_ROOM_OPTIONS = {
  adaptiveStream: true,
  dynacast: true,
};

const LiveBroadcastContext = createContext(null);

export const LiveBroadcastProvider = ({ children }) => {
  const { user } = useContext(UserContext);
  const { socket } = useContext(SocketContext) || {};
  const toast = useToast();

  const [isLive, setIsLive] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [startingLive, setStartingLive] = useState(false);
  const [localTrack, setLocalTrack] = useState(null);
  const [localScreenTrack, setLocalScreenTrack] = useState(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isLiveControlsFocused, setIsLiveControlsFocused] = useState(false);
  const [hostPipVisible, setHostPipVisible] = useState(true);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [liveRoomName, setLiveRoomName] = useState('');
  const [liveChatMessages, setLiveChatMessages] = useState([]);

  const roomRef = useRef(null);
  const roomNameRef = useRef('');
  const liveEndedRef = useRef(false);
  const pendingEndLiveRef = useRef(null);
  const endLiveRef = useRef(async () => {});
  const reconnectWatchdogRef = useRef(null);
  const onChatRef = useRef(null);
  const isSharingRef = useRef(false);
  const isMinimizedRef = useRef(false);
  const hostPreviewTrackRef = useRef(null);
  const chatMsgIdRef = useRef(0);
  const lastChatSendAtRef = useRef(0);
  const flushIncomingChatRef = useRef(() => {});
  const incomingChatBatchRef = useRef(createLiveChatBatchSink((items) => flushIncomingChatRef.current(items)));

  const clearReconnectWatchdog = useCallback(() => {
    if (reconnectWatchdogRef.current) {
      clearTimeout(reconnectWatchdogRef.current);
      reconnectWatchdogRef.current = null;
    }
  }, []);

  const addLiveChatMessage = useCallback((sender, text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    const id = `msg_${++chatMsgIdRef.current}_${Date.now()}`;
    setLiveChatMessages((prev) => [...prev.slice(-(LIVE_CHAT_MAX_MESSAGES - 1)), {
      id,
      sender: String(sender || 'User'),
      text: trimmed,
    }]);
  }, []);

  useEffect(() => {
    flushIncomingChatRef.current = (items) => {
      if (!items?.length) return;
      setLiveChatMessages((prev) => {
        const next = [...prev];
        for (const item of items) {
          const id = `msg_${++chatMsgIdRef.current}_${Date.now()}`;
          next.push({ id, sender: item.sender, text: item.text });
        }
        return next.slice(-LIVE_CHAT_MAX_MESSAGES);
      });
    };
  }, []);

  const clearLiveChatMessages = useCallback(() => {
    chatMsgIdRef.current = 0;
    lastChatSendAtRef.current = 0;
    incomingChatBatchRef.current.clear();
    setLiveChatMessages([]);
  }, []);

  const syncLocalTrack = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setLocalTrack(null);
      setLocalScreenTrack(null);
      setIsSharing(false);
      isSharingRef.current = false;
      hostPreviewTrackRef.current = null;
      return;
    }
    const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const screenPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    const sharing = !!screenPub?.track;
    const publishedCam = camPub?.track ?? null;
    const cam = sharing
      ? (hostPreviewTrackRef.current ?? publishedCam)
      : publishedCam;
    setLocalTrack(cam);
    setLocalScreenTrack(screenPub?.track ?? null);
    isSharingRef.current = sharing;
    setIsSharing(sharing);
  }, []);

  const showHostPip = useCallback(() => setHostPipVisible(true), []);
  const hideHostPip = useCallback(() => setHostPipVisible(false), []);

  const stashPreviewForShare = useCallback(async (room) => {
    let pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    if (!pub?.track) {
      await room.localParticipant.setCameraEnabled(true, {
        resolution: VideoPresets.h360.resolution,
      });
      pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    }
    const track = pub?.track ?? null;
    if (track) hostPreviewTrackRef.current = track;
    if (track) await room.localParticipant.unpublishTrack(track, false);
  }, []);

  const stopAllPublishedTracks = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try { await room.localParticipant.setScreenShareEnabled(false); } catch (_) {}
    try { await room.localParticipant.setCameraEnabled(false); } catch (_) {}
    try { await room.localParticipant.setMicrophoneEnabled(false); } catch (_) {}
    isSharingRef.current = false;
    setIsSharing(false);
  }, []);

  const disconnect = useCallback(async () => {
    clearReconnectWatchdog();
    await stopAllPublishedTracks();
    try { await roomRef.current?.disconnect(); } catch (_) {}
    roomRef.current = null;
    setLocalTrack(null);
    setLocalScreenTrack(null);
    setIsSharing(false);
    isSharingRef.current = false;
    hostPreviewTrackRef.current = null;
    setHostPipVisible(true);
    setIsMinimized(false);
    setIsLiveControlsFocused(false);
    setViewerCount(0);
    clearLiveChatMessages();
  }, [stopAllPublishedTracks, clearLiveChatMessages, clearReconnectWatchdog]);

  const ensureScreenShare = useCallback(async ({ preferCurrentTab = false } = {}) => {
    const room = roomRef.current;
    if (!room) return false;
    try {
      if (isSharingRef.current) {
        await room.localParticipant.setScreenShareEnabled(false);
        isSharingRef.current = false;
      }
      await room.localParticipant.setScreenShareEnabled(true, {
        audio: false,
        preferCurrentTab,
      });
      await stashPreviewForShare(room);
      isSharingRef.current = true;
      setIsSharing(true);
      syncLocalTrack();
      return true;
    } catch (err) {
      if (/cancel|abort|denied/i.test(String(err?.message || err))) return false;
      console.warn('[LiveBroadcast] screen share failed:', err);
      toast({
        title: 'Screen share failed',
        description: 'Could not start screen sharing.',
        status: 'error',
        duration: 4000,
        isClosable: true,
        position: 'top',
      });
      return false;
    }
  }, [syncLocalTrack, toast, stashPreviewForShare]);

  const minimizeLive = useCallback(() => {
    setIsMinimized(true);
    isMinimizedRef.current = true;
    setIsLiveControlsFocused(false);
    liveBroadcastNav.minimize?.();
  }, []);

  const returnToLiveControls = useCallback(() => {
    setIsMinimized(false);
    isMinimizedRef.current = false;
    setIsLiveControlsFocused(true);
  }, []);

  const setLiveControlsFocused = useCallback((focused) => {
    setIsLiveControlsFocused(focused);
    if (focused) {
      setIsMinimized(false);
      isMinimizedRef.current = false;
    }
  }, []);

  /** Share this browser tab, then go to app home (feed / games). */
  const shareAndGoAppHome = useCallback(async () => {
    if (!roomRef.current || !isLive) return;
    const ok = await ensureScreenShare({ preferCurrentTab: true });
    if (ok) minimizeLive();
  }, [isLive, ensureScreenShare, minimizeLive]);

  /** Share a window — browser picker; stay on live controls. */
  const shareWindow = useCallback(async () => {
    if (!roomRef.current || !isLive) return;
    await ensureScreenShare({ preferCurrentTab: false });
  }, [isLive, ensureScreenShare]);

  const toggleShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !isLive) return;
    const next = !isSharingRef.current;
    try {
      if (next) {
        await room.localParticipant.setScreenShareEnabled(true, { audio: false });
        await stashPreviewForShare(room);
      } else {
        await room.localParticipant.setScreenShareEnabled(false);
        await restoreCameraForViewers(room, hostPreviewTrackRef.current);
        hostPreviewTrackRef.current = null;
      }
      isSharingRef.current = next;
      setIsSharing(next);
      if (!next) setHostPipVisible(true);
      syncLocalTrack();
    } catch (err) {
      console.warn('[LiveBroadcast] screen share failed:', err);
      isSharingRef.current = false;
      setIsSharing(false);
      setHostPipVisible(true);
      if (next) {
        toast({
          title: 'Screen share failed',
          description: 'Could not start screen sharing.',
          status: 'error',
          duration: 4000,
          isClosable: true,
          position: 'top',
        });
      }
    }
  }, [isLive, syncLocalTrack, toast, stashPreviewForShare]);

  const endLive = useCallback(async () => {
    resignActiveGames(socket, user);
    const streamerId = user?._id != null ? String(user._id) : '';
    const endedRoomName = roomNameRef.current || '';
    const shouldNotifyServer = !!streamerId && !liveEndedRef.current;
    // Mark ended FIRST so reconnect cannot resume goLive / recreate the card.
    liveEndedRef.current = true;
    setIsLive(false);
    setIsMinimized(false);
    isMinimizedRef.current = false;
    setIsLiveControlsFocused(false);
    if (shouldNotifyServer) {
      try {
        window.dispatchEvent(new CustomEvent('liveLocalHostEnded', { detail: { streamerId } }));
      } catch (_) { /* ignore */ }
      const endPayload = { streamerId, roomName: endedRoomName };
      if (socket?.connected) {
        pendingEndLiveRef.current = null;
        socket.emit('livekit:leaveLiveWatch', { streamerId });
        socket.emit('livekit:endLive', endPayload);
      } else if (socket) {
        pendingEndLiveRef.current = endPayload;
        console.warn('[LiveBroadcast] endLive queued — socket not connected yet');
      }
    }
    roomNameRef.current = '';
    setLiveRoomName('');
    setIsMicMuted(false);
    await disconnect();
  }, [socket, user, disconnect]);

  /** End live for viewers without extra navigation (call / game interrupt). */
  const endLiveForCall = useCallback(async () => {
    await endLive();
  }, [endLive]);

  /**
   * Normal camera live — end before call / game.
   * Keep live only for intentional share+minimize (same rule as the Answer warning).
   */
  const endNormalLiveBeforeInterrupt = useCallback(async () => {
    const keepShareMinimized = isMinimized && isSharing;
    if (keepShareMinimized) return;
    // Use roomRef too — React isLive can lag one frame after navigate/accept.
    if (isLive || roomRef.current) {
      await endLiveForCall();
      // Brief settle so the live PeerConnection/camera releases before call connect.
      await new Promise((r) => setTimeout(r, 200));
    }
  }, [isLive, isMinimized, isSharing, endLiveForCall]);

  endLiveRef.current = endLive;

  useEffect(() => {
    isMinimizedRef.current = isMinimized;
  }, [isMinimized]);

  /** Tab hidden / browser minimized without intentional share+minimize — end live after 15s. */
  useEffect(() => {
    if (!isLive) return undefined;

    let backgroundTimer = null;

    const clearBackgroundTimer = () => {
      if (backgroundTimer) {
        clearTimeout(backgroundTimer);
        backgroundTimer = null;
      }
    };

    const scheduleBackgroundEnd = () => {
      clearBackgroundTimer();
      if (isMinimizedRef.current || isSharingRef.current) return;
      backgroundTimer = setTimeout(() => {
        backgroundTimer = null;
        if (liveEndedRef.current) return;
        if (isMinimizedRef.current || isSharingRef.current) return;
        console.warn('[LiveBroadcast] Tab hidden >15s without minimize — ending live');
        void endLiveRef.current?.();
      }, BROADCASTER_BACKGROUND_END_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        clearBackgroundTimer();
        return;
      }
      if (document.visibilityState === 'hidden') {
        scheduleBackgroundEnd();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearBackgroundTimer();
    };
  }, [isLive]);

  const goLive = useCallback(async () => {
    if (!user || !socket || startingLive) return;
    if (roomRef.current && isLive) {
      syncLocalTrack();
      return;
    }

    setStartingLive(true);
    liveEndedRef.current = false;
    pendingEndLiveRef.current = null;
    try {
      const res = await fetch(`${API_BASE}/api/call/token`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'livestream', targetId: String(user._id) }),
      });
      if (!res.ok) {
        toast({
          title: 'Go Live failed',
          description: 'Could not connect to the live server.',
          status: 'error',
          duration: 4000,
          isClosable: true,
          position: 'top',
        });
        return;
      }
      const { token, roomName, livekitUrl } = await res.json();
      roomNameRef.current = roomName;
      setLiveRoomName(roomName);

      const room = new Room(LIVE_ROOM_OPTIONS);
      roomRef.current = room;

      room.on(RoomEvent.ParticipantConnected, () => setViewerCount(c => c + 1));
      room.on(RoomEvent.ParticipantDisconnected, () => setViewerCount(c => Math.max(0, c - 1)));
      room.on(RoomEvent.Reconnecting, () => {
        console.warn('[LiveBroadcast] LiveKit reconnecting…');
        // Cap stuck reconnect — don't leave host UI "live" forever.
        clearReconnectWatchdog();
        reconnectWatchdogRef.current = setTimeout(() => {
          reconnectWatchdogRef.current = null;
          if (liveEndedRef.current) return;
          if (!roomRef.current || roomRef.current.state !== ConnectionState.Reconnecting) return;
          console.warn('[LiveBroadcast] Reconnect watchdog — ending live session');
          void endLiveRef.current?.().then(() => {
            toast({
              title: 'Live ended',
              description: 'Your livestream stopped because the connection was lost.',
              status: 'warning',
              duration: 5000,
              isClosable: true,
              position: 'top',
            });
          });
        }, 18_000);
      });
      room.on(RoomEvent.Reconnected, () => {
        clearReconnectWatchdog();
        syncLocalTrack();
      });
      room.on(RoomEvent.Disconnected, () => {
        clearReconnectWatchdog();
        // Match mobile: tear down server live + feed card when LiveKit dies (don't leave a zombie card).
        if (!liveEndedRef.current) {
          void endLiveRef.current?.();
          return;
        }
        roomRef.current = null;
        setLocalTrack(null);
        setLocalScreenTrack(null);
        setIsSharing(false);
        isSharingRef.current = false;
        setIsLive(false);
      });
      const onLocalTracks = () => syncLocalTrack();
      room.on(RoomEvent.LocalTrackPublished, onLocalTracks);
      room.on(RoomEvent.LocalTrackUnpublished, onLocalTracks);
      room.on(RoomEvent.DataReceived, (payload) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (msg.type === 'chat' && msg.sender && msg.text) {
            incomingChatBatchRef.current.push(msg.sender, msg.text);
            onChatRef.current?.(msg.sender, msg.text);
          }
        } catch (_) {}
      });

      await room.connect(livekitUrl, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      await room.localParticipant.setCameraEnabled(true, {
        resolution: VideoPresets.h360.resolution,
      });
      syncLocalTrack();

      setIsLive(true);
      socket.emit('livekit:joinLiveWatch', { streamerId: String(user._id) });
      socket.emit('livekit:goLive', {
        streamerId: String(user._id),
        streamerName: user.name || user.username,
        streamerProfilePic: user.profilePic,
        roomName,
      });

    } catch (err) {
      console.error('[LiveBroadcast] goLive:', err);
    } finally {
      setStartingLive(false);
    }
  }, [user, socket, startingLive, isLive, syncLocalTrack, toast, clearReconnectWatchdog]);

  /** Flush queued endLive + never resume after user already ended (reconnect race). */
  useEffect(() => {
    if (!socket || !user?._id) return undefined;
    const onConnect = () => {
      const pending = pendingEndLiveRef.current;
      if (pending) {
        console.log('[LiveBroadcast] Flushing queued endLive after reconnect');
        pendingEndLiveRef.current = null;
        liveEndedRef.current = true;
        socket.emit('livekit:leaveLiveWatch', { streamerId: pending.streamerId });
        socket.emit('livekit:endLive', pending);
        try {
          window.dispatchEvent(new CustomEvent('liveLocalHostEnded', { detail: { streamerId: pending.streamerId } }));
        } catch (_) { /* ignore */ }
        return;
      }
      if (liveEndedRef.current || !isLive || !roomNameRef.current) return;
      const room = roomRef.current;
      const lkAlive =
        !!room
        && (room.state === ConnectionState.Connected || room.state === ConnectionState.Reconnecting);
      if (!lkAlive) {
        console.warn('[LiveBroadcast] Skip goLive re-announce — LiveKit not alive');
        return;
      }
      console.log('[LiveBroadcast] Socket reconnected while live — re-announce goLive (resume)');
      socket.emit('livekit:joinLiveWatch', { streamerId: String(user._id) });
      socket.emit('livekit:goLive', {
        streamerId: String(user._id),
        streamerName: user.name || user.username,
        streamerProfilePic: user.profilePic,
        roomName: roomNameRef.current,
        resume: true,
      });
    };
    socket.on('connect', onConnect);
    return () => socket.off('connect', onConnect);
  }, [socket, isLive, user?._id, user?.name, user?.username, user?.profilePic]);

  const sendChat = useCallback(async (text, senderName) => {
    const trimmed = String(text || '').trim();
    const room = roomRef.current;
    if (!trimmed || !room) return false;
    const now = Date.now();
    if (!canSendLiveChat(lastChatSendAtRef.current, now)) return false;
    const msg = { type: 'chat', sender: senderName, text: trimmed };
    const encoded = new TextEncoder().encode(JSON.stringify(msg));
    await room.localParticipant.publishData(encoded, { reliable: true });
    lastChatSendAtRef.current = now;
    return true;
  }, []);

  const registerChatHandler = useCallback((fn) => {
    onChatRef.current = fn;
  }, []);

  const toggleMicMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !isLive) return;
    const next = !isMicMuted;
    try {
      await room.localParticipant.setMicrophoneEnabled(!next);
      setIsMicMuted(next);
    } catch (_) {}
  }, [isLive, isMicMuted]);

  useEffect(() => {
    if (!socket || !isLive || !user?._id) return;
    const onStreamEnded = async (payload) => {
      if (String(payload?.streamerId || '') !== String(user._id)) return;
      if (liveEndedRef.current) return;

      const reason = String(payload?.reason || '');
      const room = roomRef.current;
      const lkStillUp =
        !!room
        && (room.state === ConnectionState.Connected || room.state === ConnectionState.Reconnecting);

      // Server is source of truth after disconnect grace — never ignore `disconnect` cleanup.
      if (lkStillUp && reason !== 'disconnect') {
        console.warn('[LiveBroadcast] Ignoring streamEnded — LiveKit session still active', reason);
        return;
      }

      console.warn('[LiveBroadcast] streamEnded for host — tearing down', { reason });
      await endLiveRef.current?.();
      if (reason === 'disconnect') {
        toast({
          title: 'Live ended',
          description: 'Your livestream stopped because the connection was lost.',
          status: 'warning',
          duration: 5000,
          isClosable: true,
          position: 'top',
        });
      }
    };
    socket.on('livekit:streamEnded', onStreamEnded);
    return () => socket.off('livekit:streamEnded', onStreamEnded);
  }, [socket, isLive, user?._id, toast]);

  useEffect(() => {
    if (!user && isLive) void endLiveRef.current?.();
  }, [user, isLive]);

  const value = {
    isLive,
    viewerCount,
    startingLive,
    localTrack,
    localScreenTrack,
    isSharing,
    isMinimized,
    isLiveControlsFocused,
    hostPipVisible,
    showHostPip,
    hideHostPip,
    goLive,
    endLive,
    endLiveForCall,
    endNormalLiveBeforeInterrupt,
    toggleShare,
    shareAndGoAppHome,
    shareWindow,
    minimizeLive,
    returnToLiveControls,
    setLiveControlsFocused,
    syncLocalTrack,
    getRoom: () => roomRef.current,
    liveRoomName,
    isMicMuted,
    toggleMicMute,
    sendChat,
    registerChatHandler,
    liveChatMessages,
    addLiveChatMessage,
    clearLiveChatMessages,
  };

  return (
    <LiveBroadcastContext.Provider value={value}>
      {children}
    </LiveBroadcastContext.Provider>
  );
};

export const useLiveBroadcast = () => {
  const ctx = useContext(LiveBroadcastContext);
  if (!ctx) throw new Error('useLiveBroadcast must be used within LiveBroadcastProvider');
  return ctx;
};
