/**
 * Keeps the LiveKit broadcast room alive while the host browses the app (App home + screen share).
 */

import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { useToast } from '@chakra-ui/react';
import { UserContext } from './UserContext';
import { SocketContext } from './SocketContext';
import { resignActiveGames } from '../utils/liveGameResign';

const API_BASE = import.meta.env.VITE_API_URL || '';
const LIVESTREAM_MAX_MS = 25 * 60 * 1000;

const isScreenSharePub = (pub, track) =>
  pub?.source === Track.Source.ScreenShare
  || track?.source === Track.Source.ScreenShare
  || pub?.source === 'screen_share'
  || track?.source === 'screen_share';

const LiveBroadcastContext = createContext(null);

export const liveBroadcastNav = {
  minimize: null,
  returnToLive: null,
};

export const LiveBroadcastProvider = ({ children }) => {
  const { user } = useContext(UserContext);
  const { socket } = useContext(SocketContext) || {};
  const toast = useToast();

  const [isLive, setIsLive] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [startingLive, setStartingLive] = useState(false);
  const [localTrack, setLocalTrack] = useState(null);

  const roomRef = useRef(null);
  const roomNameRef = useRef('');
  const isSharingRef = useRef(false);
  const isLiveRef = useRef(false);
  const liveEndedRef = useRef(false);
  const liveTimeoutRef = useRef(null);
  const endLiveRef = useRef(async () => {});
  const onChatRef = useRef(null);

  isLiveRef.current = isLive;

  const syncLocalTrack = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setLocalTrack(null);
      return;
    }
    const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    setLocalTrack(camPub?.track ?? null);
  }, []);

  const disconnect = useCallback(async () => {
    if (liveTimeoutRef.current) {
      clearTimeout(liveTimeoutRef.current);
      liveTimeoutRef.current = null;
    }
    try { await roomRef.current?.disconnect(); } catch (_) {}
    roomRef.current = null;
    setLocalTrack(null);
    isSharingRef.current = false;
    setIsSharing(false);
    setViewerCount(0);
  }, []);

  const endLive = useCallback(async () => {
    resignActiveGames(socket, user);
    if (socket && user?._id && roomNameRef.current && !liveEndedRef.current) {
      liveEndedRef.current = true;
      socket.emit('livekit:endLive', {
        streamerId: String(user._id),
        roomName: roomNameRef.current,
      });
    }
    roomNameRef.current = '';
    await disconnect();
    setIsLive(false);
    setIsMinimized(false);
  }, [socket, user, disconnect]);

  endLiveRef.current = endLive;

  const goLive = useCallback(async () => {
    if (!user || !socket || startingLive) return;
    if (roomRef.current && isLive) {
      syncLocalTrack();
      setIsMinimized(false);
      return;
    }

    setStartingLive(true);
    liveEndedRef.current = false;
    try {
      const res = await fetch(`${API_BASE}/api/call/token`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'livestream', targetId: String(user._id) }),
      });
      if (!res.ok) return;
      const { token, roomName, livekitUrl } = await res.json();
      roomNameRef.current = roomName;

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.ParticipantConnected, () => setViewerCount(c => c + 1));
      room.on(RoomEvent.ParticipantDisconnected, () => setViewerCount(c => Math.max(0, c - 1)));
      room.on(RoomEvent.Disconnected, () => {
        roomRef.current = null;
        setLocalTrack(null);
        setIsLive(false);
        setIsMinimized(false);
        isSharingRef.current = false;
        setIsSharing(false);
      });
      // Sync only when user stops via browser UI (same as GroupCallUI).
      room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (isScreenSharePub(pub)) {
          isSharingRef.current = false;
          setIsSharing(false);
        }
      });
      room.on(RoomEvent.DataReceived, (payload) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (msg.type === 'chat') onChatRef.current?.(msg.sender, msg.text);
        } catch (_) {}
      });

      await room.connect(livekitUrl, token);
      await room.localParticipant.enableCameraAndMicrophone();
      syncLocalTrack();

      setIsLive(true);
      setIsMinimized(false);
      socket.emit('livekit:goLive', {
        streamerId: String(user._id),
        streamerName: user.name || user.username,
        streamerProfilePic: user.profilePic,
        roomName,
      });

      liveTimeoutRef.current = setTimeout(() => {
        if (!liveEndedRef.current && socket) {
          liveEndedRef.current = true;
          socket.emit('livekit:endLive', { streamerId: String(user._id), roomName });
        }
        void endLiveRef.current?.();
        toast({
          title: 'Live ended',
          description: 'Maximum live duration is 25 minutes.',
          status: 'info',
          duration: 4000,
          isClosable: true,
          position: 'top',
        });
      }, LIVESTREAM_MAX_MS);
    } catch (err) {
      console.error('[LiveBroadcast] goLive:', err);
    } finally {
      setStartingLive(false);
    }
  }, [user, socket, startingLive, isLive, syncLocalTrack, toast]);

  // Same pattern as GroupCallUI handleShare — plain toggle, optimistic UI.
  const toggleShare = useCallback(async (opts = {}) => {
    const room = roomRef.current;
    if (!room) return false;
    const next = !isSharingRef.current;
    try {
      await room.localParticipant.setScreenShareEnabled(next, next ? opts : undefined);
      isSharingRef.current = next;
      setIsSharing(next);
      return next;
    } catch (err) {
      isSharingRef.current = false;
      setIsSharing(false);
      if (next) {
        toast({
          title: 'Screen share failed',
          description: err?.message || 'Could not start screen sharing.',
          status: 'error',
          duration: 4000,
          isClosable: true,
          position: 'top',
        });
      }
      return false;
    }
  }, [toast]);

  const minimizeLive = useCallback(() => {
    if (!isLive) return;
    liveBroadcastNav.minimize?.();
  }, [isLive]);

  const openLiveControls = useCallback(() => {
    setIsMinimized(prev => (prev ? false : prev));
  }, []);

  const leaveLiveControls = useCallback(() => {
    if (!isLiveRef.current) return;
    setIsMinimized(prev => (prev ? prev : true));
  }, []);

  const returnToLiveControls = useCallback(() => {
    if (!isLiveRef.current) return;
    setIsMinimized(false);
    liveBroadcastNav.returnToLive?.();
  }, []);

  const shareAndGoHome = useCallback(async () => {
    if (!isLiveRef.current) return;
    if (!isSharingRef.current) {
      const room = roomRef.current;
      if (!room) return;
      try {
        await room.localParticipant.setScreenShareEnabled(true, { preferCurrentTab: true });
        isSharingRef.current = true;
        setIsSharing(true);
      } catch (err) {
        toast({
          title: 'Screen share failed',
          description: err?.message || 'Could not start screen sharing.',
          status: 'error',
          duration: 4000,
          isClosable: true,
          position: 'top',
        });
        return;
      }
    }
    liveBroadcastNav.minimize?.();
  }, [toast]);

  const sendChat = useCallback(async (text, senderName) => {
    const trimmed = String(text || '').trim();
    const room = roomRef.current;
    if (!trimmed || !room) return;
    const msg = { type: 'chat', sender: senderName, text: trimmed };
    const encoded = new TextEncoder().encode(JSON.stringify(msg));
    await room.localParticipant.publishData(encoded, { reliable: true });
  }, []);

  const registerChatHandler = useCallback((fn) => {
    onChatRef.current = fn;
  }, []);

  useEffect(() => {
    if (!socket || !isLive || !user?._id) return;
    const onStreamEnded = async (payload) => {
      if (String(payload?.streamerId || '') !== String(user._id)) return;
      await endLiveRef.current?.();
    };
    socket.on('livekit:streamEnded', onStreamEnded);
    return () => socket.off('livekit:streamEnded', onStreamEnded);
  }, [socket, isLive, user?._id]);

  useEffect(() => {
    if (!user && isLive) void endLiveRef.current?.();
  }, [user, isLive]);

  useEffect(() => () => {
    if (liveTimeoutRef.current) clearTimeout(liveTimeoutRef.current);
  }, []);

  const value = {
    isLive,
    isMinimized,
    isSharing,
    viewerCount,
    startingLive,
    localTrack,
    goLive,
    endLive,
    toggleShare,
    shareAndGoHome,
    minimizeLive,
    openLiveControls,
    leaveLiveControls,
    returnToLiveControls,
    syncLocalTrack,
    getRoom: () => roomRef.current,
    sendChat,
    registerChatHandler,
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
