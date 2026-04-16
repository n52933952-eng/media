/**
 * GroupCallContext — WhatsApp-style group calling via LiveKit.
 *
 * Public API:
 *   startGroupCall(conversationId, members[], type)  → call all members
 *   joinGroupCall()                                   → answer incoming
 *   declineGroupCall()                                → decline/leave ring
 *   leaveGroupCall()                                  → leave active call
 *   incomingGroupCall  { conversationId, roomName, callerId, callerName, ... }
 *   groupCallActive    boolean
 *   groupCallType      'video' | 'audio'
 *   participants       RemoteParticipant[]
 *   groupCallRoom      ref to Room
 */

import {
  createContext, useContext, useEffect, useRef, useState, useCallback,
} from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { useToast } from '@chakra-ui/react';
import { UserContext } from './UserContext';
import { SocketContext } from './SocketContext';
import ringTone from '../assets/ring.mp3';

const API_BASE = import.meta.env.VITE_API_URL || '';

export const GroupCallContext = createContext();

export const GroupCallProvider = ({ children }) => {
  const { user }  = useContext(UserContext);
  const socketCtx = useContext(SocketContext);
  const socket    = socketCtx?.socket;
  const toast     = useToast();

  const [incomingGroupCall, setIncomingGroupCall] = useState(null);
  const [groupCallActive,   setGroupCallActive]   = useState(false);
  const [groupCallType,     setGroupCallType]      = useState('video');
  const [participants,      setParticipants]       = useState([]);
  const [activeConvId,      setActiveConvId]       = useState('');

  const groupCallRoom = useRef(null);
  const ringtoneRef = useRef(null);

  useEffect(() => {
    ringtoneRef.current = new Audio(ringTone);
    ringtoneRef.current.loop = true;
    return () => {
      try { ringtoneRef.current?.pause(); } catch (_) {}
    };
  }, []);

  const playRingtone = () => { try { ringtoneRef.current?.play(); } catch (_) {} };
  const stopRingtone = () => {
    try {
      ringtoneRef.current?.pause();
      if (ringtoneRef.current) ringtoneRef.current.currentTime = 0;
    } catch (_) {}
  };

  // ── fetch token ───────────────────────────────────────────────────────────
  const fetchToken = useCallback(async (conversationId) => {
    const res = await fetch(`${API_BASE}/api/call/token`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ type: 'group', conversationId }),
    });
    if (!res.ok) throw new Error('Failed to get group call token');
    return res.json(); // { token, roomName, livekitUrl }
  }, []);

  // ── disconnect room ───────────────────────────────────────────────────────
  const disconnectRoom = useCallback(async () => {
    stopRingtone();
    if (groupCallRoom.current) {
      try { await groupCallRoom.current.disconnect(); } catch (_) {}
      groupCallRoom.current = null;
    }
    setParticipants([]);
  }, []);

  // ── connect to group room ─────────────────────────────────────────────────
  const connectGroupRoom = useCallback(async (token, livekitUrl, type) => {
    await disconnectRoom();
    const room = new Room({ adaptiveStream: true, dynacast: true });
    groupCallRoom.current = room;

    const refreshParticipants = () => {
      setParticipants([...room.remoteParticipants.values()]);
    };

    room.on(RoomEvent.ParticipantConnected,    refreshParticipants);
    room.on(RoomEvent.ParticipantDisconnected, refreshParticipants);
    room.on(RoomEvent.TrackSubscribed,         refreshParticipants);
    room.on(RoomEvent.TrackUnsubscribed,       refreshParticipants);
    room.on(RoomEvent.Disconnected, () => {
      setGroupCallActive(false);
      setParticipants([]);
    });

    await room.connect(livekitUrl, token);

    if (type !== 'audio') {
      await room.localParticipant.enableCameraAndMicrophone();
    } else {
      await room.localParticipant.setMicrophoneEnabled(true);
    }

    refreshParticipants();
    return room;
  }, [disconnectRoom]);

  // ── PUBLIC: start a group call ────────────────────────────────────────────
  const startGroupCall = useCallback(async (conversationId, type = 'video') => {
    if (!user || !socket) return;
    try {
      const { token, roomName, livekitUrl } = await fetchToken(conversationId);
      await connectGroupRoom(token, livekitUrl, type);

      setGroupCallActive(true);
      setGroupCallType(type);
      setActiveConvId(conversationId);

      // Notify all group members
      socket.emit('livekit:startGroupCall', {
        conversationId,
        roomName,
        callerName:       user.name || user.username,
        callerProfilePic: user.profilePic,
        callType:         type,
      });

      toast({ title: `Group ${type} call started`, status: 'success', duration: 3000, position: 'top' });
    } catch (err) {
      console.error('❌ [GroupCall] startGroupCall:', err.message);
      toast({ title: 'Could not start group call', description: err.message, status: 'error', duration: 4000, position: 'top' });
      await disconnectRoom();
    }
  }, [user, socket, fetchToken, connectGroupRoom, disconnectRoom, toast]);

  // ── PUBLIC: join (answer) incoming group call ─────────────────────────────
  const joinGroupCall = useCallback(async () => {
    if (!incomingGroupCall) return;
    stopRingtone();
    const { conversationId, callType } = incomingGroupCall;
    try {
      const { token, livekitUrl } = await fetchToken(conversationId);
      await connectGroupRoom(token, livekitUrl, callType || 'video');

      setGroupCallActive(true);
      setGroupCallType(callType || 'video');
      setActiveConvId(conversationId);
      setIncomingGroupCall(null);
    } catch (err) {
      console.error('❌ [GroupCall] joinGroupCall:', err.message);
      toast({ title: 'Could not join group call', description: err.message, status: 'error', duration: 4000, position: 'top' });
      await disconnectRoom();
    }
  }, [incomingGroupCall, fetchToken, connectGroupRoom, disconnectRoom, toast]);

  // ── PUBLIC: decline incoming group call ──────────────────────────────────
  const declineGroupCall = useCallback(() => {
    stopRingtone();
    setIncomingGroupCall(null);
  }, []);

  // ── PUBLIC: leave active group call ──────────────────────────────────────
  const leaveGroupCall = useCallback(async () => {
    if (socket && activeConvId) {
      socket.emit('livekit:endGroupCall', { conversationId: activeConvId, roomName: `group_${activeConvId}` });
    }
    await disconnectRoom();
    setGroupCallActive(false);
    setActiveConvId('');
  }, [socket, activeConvId, disconnectRoom]);

  // ── Socket: incoming group call ───────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onIncoming = (data) => {
      setIncomingGroupCall(data);
      playRingtone();
    };

    const onEnded = ({ by }) => {
      // If someone else left, just refresh participants (room handles it via ParticipantDisconnected)
      // If all left, room disconnect event fires
    };

    socket.on('livekit:incomingGroupCall', onIncoming);
    socket.on('livekit:groupCallEnded',    onEnded);

    return () => {
      stopRingtone();
      socket.off('livekit:incomingGroupCall', onIncoming);
      socket.off('livekit:groupCallEnded',    onEnded);
    };
  }, [socket]);

  return (
    <GroupCallContext.Provider value={{
      incomingGroupCall,
      groupCallActive,
      groupCallType,
      participants,
      groupCallRoom,
      activeConvId,
      startGroupCall,
      joinGroupCall,
      declineGroupCall,
      leaveGroupCall,
    }}>
      {children}
    </GroupCallContext.Provider>
  );
};

export const useGroupCall = () => useContext(GroupCallContext);
