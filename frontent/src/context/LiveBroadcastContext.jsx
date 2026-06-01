/**
 * LiveBroadcastContext — LiveKit room for web live streaming (camera + chat).
 */

import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { useToast } from '@chakra-ui/react';
import { UserContext } from './UserContext';
import { SocketContext } from './SocketContext';
import { resignActiveGames } from '../utils/liveGameResign';
import { liveBroadcastNav } from '../services/liveBroadcastNav';

const API_BASE = import.meta.env.VITE_API_URL || '';
const LIVESTREAM_MAX_MS = 25 * 60 * 1000;

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

  const roomRef = useRef(null);
  const roomNameRef = useRef('');
  const liveEndedRef = useRef(false);
  const liveTimeoutRef = useRef(null);
  const endLiveRef = useRef(async () => {});
  const onChatRef = useRef(null);
  const isSharingRef = useRef(false);

  const syncLocalTrack = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setLocalTrack(null);
      setLocalScreenTrack(null);
      setIsSharing(false);
      isSharingRef.current = false;
      return;
    }
    const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const screenPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    setLocalTrack(camPub?.track ?? null);
    setLocalScreenTrack(screenPub?.track ?? null);
    const sharing = !!screenPub?.track;
    isSharingRef.current = sharing;
    setIsSharing(sharing);
  }, []);

  const disconnect = useCallback(async () => {
    if (liveTimeoutRef.current) {
      clearTimeout(liveTimeoutRef.current);
      liveTimeoutRef.current = null;
    }
    try { await roomRef.current?.disconnect(); } catch (_) {}
    roomRef.current = null;
    setLocalTrack(null);
    setLocalScreenTrack(null);
    setIsSharing(false);
    isSharingRef.current = false;
    setIsMinimized(false);
    setIsLiveControlsFocused(false);
    setViewerCount(0);
  }, []);

  const ensureScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room || isSharingRef.current) return true;
    try {
      await room.localParticipant.setScreenShareEnabled(true);
      isSharingRef.current = true;
      setIsSharing(true);
      syncLocalTrack();
      return true;
    } catch (err) {
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
  }, [syncLocalTrack, toast]);

  const minimizeLive = useCallback(() => {
    setIsMinimized(true);
    setIsLiveControlsFocused(false);
    liveBroadcastNav.minimize?.();
  }, []);

  const returnToLiveControls = useCallback(() => {
    setIsMinimized(false);
    setIsLiveControlsFocused(true);
  }, []);

  const setLiveControlsFocused = useCallback((focused) => {
    setIsLiveControlsFocused(focused);
    if (focused) setIsMinimized(false);
  }, []);

  const shareAndGoAppHome = useCallback(async () => {
    if (!roomRef.current || !isLive) return;
    const ok = await ensureScreenShare();
    if (ok) minimizeLive();
  }, [isLive, ensureScreenShare, minimizeLive]);

  const toggleShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !isLive) return;
    const next = !isSharingRef.current;
    try {
      await room.localParticipant.setScreenShareEnabled(next);
      isSharingRef.current = next;
      setIsSharing(next);
      syncLocalTrack();
    } catch (err) {
      console.warn('[LiveBroadcast] screen share failed:', err);
      isSharingRef.current = false;
      setIsSharing(false);
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
  }, [isLive, syncLocalTrack, toast]);

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
    setIsLiveControlsFocused(false);
  }, [socket, user, disconnect]);

  endLiveRef.current = endLive;

  const goLive = useCallback(async () => {
    if (!user || !socket || startingLive) return;
    if (roomRef.current && isLive) {
      syncLocalTrack();
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

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.ParticipantConnected, () => setViewerCount(c => c + 1));
      room.on(RoomEvent.ParticipantDisconnected, () => setViewerCount(c => Math.max(0, c - 1)));
      room.on(RoomEvent.Disconnected, () => {
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
          if (msg.type === 'chat') onChatRef.current?.(msg.sender, msg.text);
        } catch (_) {}
      });

      await room.connect(livekitUrl, token);
      await room.localParticipant.enableCameraAndMicrophone();
      syncLocalTrack();

      setIsLive(true);
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
    viewerCount,
    startingLive,
    localTrack,
    localScreenTrack,
    isSharing,
    isMinimized,
    isLiveControlsFocused,
    goLive,
    endLive,
    toggleShare,
    shareAndGoAppHome,
    minimizeLive,
    returnToLiveControls,
    setLiveControlsFocused,
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
