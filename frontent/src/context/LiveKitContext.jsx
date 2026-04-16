/**
 * LiveKitContext — replaces the WebRTC/simple-peer call system.
 *
 * Responsibilities:
 *  - Fetch token from backend (/api/call/token)
 *  - Maintain LiveKit Room connection
 *  - Expose call state: incomingCall, isCalling, callAccepted, callEnded
 *  - Expose: startCall, answerCall, declineCall, leaveCall
 *  - Handle FCM-triggered incoming calls (token in push → join room)
 *  - Track busyUsers via socket callBusy / cancleCall events
 *
 * Does NOT touch: chess, cards, racing, messages, presence, posts.
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

export const LiveKitContext = createContext();

// ─── helpers ────────────────────────────────────────────────────────────────
const idStr = (v) => {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object' && typeof v.toString === 'function') return String(v.toString()).trim();
  return String(v).trim();
};

const sortedRoomName = (a, b) => {
  const ids = [idStr(a), idStr(b)].sort();
  return `call_${ids[0]}_${ids[1]}`;
};

// ─── Provider ────────────────────────────────────────────────────────────────
export const LiveKitProvider = ({ children }) => {
  const { user }   = useContext(UserContext);
  const socketCtx  = useContext(SocketContext);
  const socket     = socketCtx?.socket;
  const toast      = useToast();

  // ── call state ──────────────────────────────────────────────────────────
  const [incomingCall, setIncomingCall] = useState(null);   // { from, callerName, callerProfilePic, callType, roomName }
  const [isCalling,    setIsCalling]    = useState(false);  // we initiated, waiting for answer
  const [callAccepted, setCallAccepted] = useState(false);  // both sides in room
  const [callEnded,    setCallEnded]    = useState(false);  // call finished (used to dismiss UI)
  const [callType,     setCallType]     = useState('video');
  const [callPartner,  setCallPartner]  = useState(null);   // { id, name, profilePic }
  const [roomName,     setRoomName]     = useState('');
  const [busyUsers,    setBusyUsers]    = useState(new Set());

  // ── LiveKit room ─────────────────────────────────────────────────────────
  const roomRef         = useRef(null);
  const [localTracks,  setLocalTracks]  = useState([]);
  const [remoteTracks, setRemoteTracks] = useState([]);

  // ── ringtone ─────────────────────────────────────────────────────────────
  const ringtoneRef = useRef(null);
  useEffect(() => {
    ringtoneRef.current = new Audio(ringTone);
    ringtoneRef.current.loop = true;
    return () => { ringtoneRef.current?.pause(); };
  }, []);

  const playRingtone  = () => { try { ringtoneRef.current?.play(); }  catch (_) {} };
  const stopRingtone  = () => { try { ringtoneRef.current?.pause(); ringtoneRef.current.currentTime = 0; } catch (_) {} };

  // ── fetch LiveKit token from our backend ─────────────────────────────────
  const fetchToken = useCallback(async ({ type = 'direct', targetId, conversationId }) => {
    const res  = await fetch(`${API_BASE}/api/call/token`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ type, targetId, conversationId }),
    });
    if (!res.ok) throw new Error('Failed to get LiveKit token');
    return res.json(); // { token, roomName, livekitUrl }
  }, []);

  // ── cleanup room (called on leaveCall / callEnded) ────────────────────────
  const disconnectRoom = useCallback(async () => {
    stopRingtone();
    if (roomRef.current) {
      try { await roomRef.current.disconnect(); } catch (_) {}
      roomRef.current = null;
    }
    setLocalTracks([]);
    setRemoteTracks([]);
  }, []);

  // ── connect to a LiveKit room ─────────────────────────────────────────────
  const connectRoom = useCallback(async (token, livekitUrl, type) => {
    await disconnectRoom();

    const room = new Room({
      adaptiveStream: true,
      dynacast:       true,
    });
    roomRef.current = room;

    // Track events
    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      setRemoteTracks(prev => [...prev, { track, participantId: participant.identity }]);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      setRemoteTracks(prev => prev.filter(t => t.track !== track));
    });
    room.on(RoomEvent.ParticipantConnected, () => {
      setCallAccepted(true);
      stopRingtone();
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      // Other side left — end call
      handleCallEnded();
    });
    room.on(RoomEvent.Disconnected, () => {
      handleCallEnded();
    });

    await room.connect(livekitUrl, token);

    // Publish local tracks: audio calls should not keep camera enabled.
    if (type === 'audio') {
      await room.localParticipant.setCameraEnabled(false);
      await room.localParticipant.setMicrophoneEnabled(true);
    } else {
      await room.localParticipant.enableCameraAndMicrophone();
    }
    const published = room.localParticipant.trackPublications;
    const local = [];
    published.forEach((pub) => {
      if (pub.track) local.push(pub.track);
    });
    setLocalTracks(local);

    return room;
  }, [disconnectRoom]);

  // ── internal: mark call as ended ─────────────────────────────────────────
  const handleCallEnded = useCallback(() => {
    stopRingtone();
    setCallEnded(true);
    setCallAccepted(false);
    setIsCalling(false);
    setIncomingCall(null);
    disconnectRoom();
    // Reset ended flag after a tick so UI can react
    setTimeout(() => setCallEnded(false), 300);
  }, [disconnectRoom]);

  // ── PUBLIC: start a 1-to-1 call ──────────────────────────────────────────
  const startCall = useCallback(async (targetUser, type = 'video') => {
    if (!user || !socket) return;
    try {
      setCallType(type);
      setCallPartner({ id: idStr(targetUser._id), name: targetUser.name, profilePic: targetUser.profilePic });
      setIsCalling(true);
      setCallEnded(false);

      const myId = idStr(user._id);
      const theirId = idStr(targetUser._id);
      const room = sortedRoomName(myId, theirId);
      setRoomName(room);

      // Get token & connect to room first so we're ready when they answer
      const { token, livekitUrl } = await fetchToken({ type: 'direct', targetId: theirId });
      await connectRoom(token, livekitUrl, type);

      // Notify receiver via socket (backend handles FCM for offline)
      socket.emit('livekit:callUser', {
        userToCall:       theirId,
        callerId:         myId,
        callerName:       user.name || user.username,
        callerProfilePic: user.profilePic,
        callType:         type,
        roomName:         room,
      });

      playRingtone();
    } catch (err) {
      console.error('❌ [LiveKit] startCall error:', err.message);
      setIsCalling(false);
      await disconnectRoom();
      toast({ title: 'Call failed', description: err.message, status: 'error', duration: 4000, isClosable: true, position: 'top' });
    }
  }, [user, socket, fetchToken, connectRoom, disconnectRoom, toast]);

  // ── PUBLIC: answer incoming call ─────────────────────────────────────────
  const answerCall = useCallback(async () => {
    if (!incomingCall) return;
    stopRingtone();
    try {
      const { from, callType: ct, roomName: room } = incomingCall;
      setCallType(ct || 'video');
      setRoomName(room);
      setCallAccepted(true);
      setIncomingCall(null);

      const { token, livekitUrl } = await fetchToken({ type: 'direct', targetId: from });
      await connectRoom(token, livekitUrl, ct || 'video');
    } catch (err) {
      console.error('❌ [LiveKit] answerCall error:', err.message);
      setCallAccepted(false);
      await disconnectRoom();
      toast({ title: 'Could not connect', description: err.message, status: 'error', duration: 4000, isClosable: true, position: 'top' });
    }
  }, [incomingCall, fetchToken, connectRoom, disconnectRoom, toast]);

  // ── PUBLIC: decline incoming call ────────────────────────────────────────
  const declineCall = useCallback(() => {
    if (!incomingCall || !socket) return;
    stopRingtone();
    socket.emit('livekit:declineCall', {
      callerId: incomingCall.from,
      roomName: incomingCall.roomName,
    });
    setIncomingCall(null);
    setCallEnded(false);
  }, [incomingCall, socket]);

  // ── PUBLIC: leave / end active call ──────────────────────────────────────
  const leaveCall = useCallback(() => {
    if (!socket) return;
    const partnerId = callPartner?.id;
    if (partnerId) {
      socket.emit('livekit:cancelCall', { userToCall: partnerId, roomName });
    }
    handleCallEnded();
    setCallPartner(null);
    setRoomName('');
  }, [socket, callPartner, roomName, handleCallEnded]);

  // ── Socket: incoming call notification ───────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onIncomingCall = (data) => {
      // data: { from, callerName, callerProfilePic, callType, roomName }
      setIncomingCall(data);
      setCallPartner({ id: data.from, name: data.callerName, profilePic: data.callerProfilePic });
      setCallEnded(false);
      playRingtone();
    };

    const onCallCanceled = ({ from }) => {
      if (incomingCall?.from === from || callPartner?.id === from) {
        stopRingtone();
        setIncomingCall(null);
        setIsCalling(false);
        setCallAccepted(false);
        disconnectRoom();
        toast({ title: 'Call ended', status: 'info', duration: 3000, isClosable: true, position: 'top' });
      }
    };

    const onCallDeclined = ({ by }) => {
      if (callPartner?.id === by) {
        stopRingtone();
        toast({ title: 'Call declined', description: 'The user declined your call.', status: 'warning', duration: 3000, isClosable: true, position: 'top' });
        handleCallEnded();
        setCallPartner(null);
        setRoomName('');
      }
    };

    // Busy tracking (same events as before — mobile + web compatibility)
    const onCallBusy = ({ userToCall, from }) => {
      setBusyUsers(prev => {
        const n = new Set(prev);
        if (userToCall) n.add(idStr(userToCall));
        if (from)       n.add(idStr(from));
        return n;
      });
    };
    const onCancleCall = ({ userToCall, from }) => {
      setBusyUsers(prev => {
        const n = new Set(prev);
        if (userToCall) n.delete(idStr(userToCall));
        if (from)       n.delete(idStr(from));
        return n;
      });
    };

    socket.on('livekit:incomingCall',  onIncomingCall);
    socket.on('livekit:callCanceled',  onCallCanceled);
    socket.on('livekit:callDeclined',  onCallDeclined);
    socket.on('callBusy',              onCallBusy);
    socket.on('cancleCall',            onCancleCall);

    return () => {
      socket.off('livekit:incomingCall',  onIncomingCall);
      socket.off('livekit:callCanceled',  onCallCanceled);
      socket.off('livekit:callDeclined',  onCallDeclined);
      socket.off('callBusy',              onCallBusy);
      socket.off('cancleCall',            onCancleCall);
    };
  }, [socket, incomingCall, callPartner, handleCallEnded, disconnectRoom, toast]);

  return (
    <LiveKitContext.Provider value={{
      // state
      incomingCall,
      isCalling,
      callAccepted,
      callEnded,
      callType,
      callPartner,
      roomName,
      busyUsers,
      localTracks,
      remoteTracks,
      room: roomRef,
      // actions
      startCall,
      answerCall,
      declineCall,
      leaveCall,
      fetchToken,   // exposed for group calls / live stream
    }}>
      {children}
    </LiveKitContext.Provider>
  );
};

export const useLiveKit = () => useContext(LiveKitContext);
