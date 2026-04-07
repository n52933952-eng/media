
import { createContext, useEffect, useState, useContext, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import { useToast } from '@chakra-ui/react';
import { UserContext } from './UserContext';
import ringTone from '../assets/ring.mp3'; // Import ring tone
import messageSound from '../assets/frontend_src_assets_sounds_message.mp3'; // Import message notification sound
import chessTone from '../assets/chesstone.mp3'; // Import chess challenge tone

/** Match backend + mobile: user ids are strings; API may return Mongo ObjectId objects — strict === fails for incoming calls. */
const userIdToStr = (id) => {
  if (id == null || id === '') return ''
  if (typeof id === 'string') return id.trim()
  if (typeof id === 'object' && id != null && typeof id.toString === 'function') return String(id.toString()).trim()
  return String(id).trim()
}

export const SocketContext = createContext();

export const SocketContextProvider = ({ children }) => {
  const { user } = useContext(UserContext);
  const toast = useToast();
  const [onlineUser, setOnlineUser] = useState([]);
  const [socket, setSocket] = useState(null);
  const [call, setCall] = useState({});
  const [callAccepted, setCallAccepted] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [isCalling, setIsCalling] = useState(false); // Track if current user is calling (ringing state)
  const [callType, setCallType] = useState('video'); // 'audio' or 'video'
  const [stream, setStream] = useState();
  const [remoteStream, setRemoteStream] = useState(); // Store remote stream in state
  const [me, setMe] = useState('');
  const [busyUsers, setBusyUsers] = useState(new Set()); // Track which users are busy
  const [totalUnreadCount, setTotalUnreadCount] = useState(0); // Global unread message count
  const [notificationCount, setNotificationCount] = useState(0); // Global unread notification count
  const [chessChallenge, setChessChallenge] = useState(null); // Track incoming chess challenge
  const [cardChallenge, setCardChallenge] = useState(null);   // Track incoming card (Go Fish) challenge

  const myVideo = useRef();
  const userVideo = useRef();
  const connectionRef = useRef();
  const peerRef = useRef();
  const streamRef = useRef(null);
  const iceServersRef = useRef(null);
  /** Mobile can trickle ICE before web taps Answer — queue until peer exists and offer is applied. */
  const pendingRemoteIceRef = useRef([]);
  const callPartnerIdRef = useRef(null);
  const ringtoneAudio = useRef(new Audio(ringTone)); // Audio for incoming call ringtone
  const messageSoundAudio = useRef(new Audio(messageSound)); // Audio for new unread message notification
  const chessToneAudio = useRef(new Audio(chessTone)); // Audio for chess challenge notification
  const selectedConversationIdRef = useRef(null); // Track which conversation is currently open
  
  // Ensure audio is ready to play (browser autoplay policy)
  useEffect(() => {
    if (messageSoundAudio.current) {
      messageSoundAudio.current.load();
    }
    if (ringtoneAudio.current) {
      ringtoneAudio.current.load();
    }
    if (chessToneAudio.current) {
      chessToneAudio.current.load();
    }
    
    let isUnlocked = false
    
    // Unlock audio on user interaction (browser security requirement)
    const unlockAudio = () => {
      if (isUnlocked) return
      
      // Try to unlock all audio files
      const audioFiles = [messageSoundAudio.current, ringtoneAudio.current, chessToneAudio.current].filter(Boolean);
      
      Promise.all(audioFiles.map(audio => {
        if (!audio) return Promise.resolve();
        return audio.play().then(() => {
          audio.pause();
          audio.currentTime = 0;
        }).catch(() => {
          // Still locked, browser needs user interaction
        });
      })).then(() => {
        isUnlocked = true;
        console.log('✅ Audio unlocked - notification sounds ready');
      }).catch(() => {
        // Still locked, browser needs user interaction
      });
    };
    
    // Try to unlock immediately (works if user already interacted)
    unlockAudio()
    
    // Also listen for ANY user interaction to unlock audio
    // Keep unlocking on user interaction to ensure audio works on all pages
    const events = ['click', 'touchstart', 'keydown', 'scroll', 'mousemove'];
    const eventHandlers = new Map();
    
    events.forEach(event => {
      const handler = () => {
        if (!isUnlocked) {
          unlockAudio();
        }
      };
      eventHandlers.set(event, handler);
      document.addEventListener(event, handler, { passive: true });
    });
    
    return () => {
      events.forEach(event => {
        const handler = eventHandlers.get(event);
        if (handler) {
          document.removeEventListener(event, handler);
        }
      });
    };
  }, [])

  // Get user media and unmute audio track explicitly
  const getMediaStream = async (type = 'video') => {
    try {
      const constraints = {
        audio: true,
        video: type === 'video' ? true : false
      };
      const currentStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Unmute audio tracks explicitly (enabled=true)
      currentStream.getAudioTracks().forEach(track => {
        if (!track.enabled) track.enabled = true;
      });

      streamRef.current = currentStream;
      setStream(currentStream);
      console.log(`Media stream obtained - Type: ${type}, Audio tracks: ${currentStream.getAudioTracks().length}, Video tracks: ${currentStream.getVideoTracks().length}`);
    } catch (error) {
      console.error('Error getting media stream:', error);
    }
  };

  // Don't request media stream on mount - only get it when actually starting a call
  // This makes the app lighter and prevents unnecessary camera/mic permissions on page load
  // useEffect(() => {
  //   getMediaStream('video'); // Default to video call
  // }, []);

  useEffect(() => {
    if (myVideo.current && stream) {
      myVideo.current.srcObject = stream;
      console.log('Assigned stream to myVideo');
    }
  }, [stream]);

  // Setup socket connection
  useEffect(() => {
    if (!user?._id) return;

    const socketUrl = import.meta.env.PROD 
      ? window.location.origin 
      : "http://localhost:5000";

    const newSocket = io(socketUrl, {
      query: { userId: userIdToStr(user._id), clientType: 'web' },
    });

    // WebRTC connectivity: use backend ICE servers (STUN/TURN) with safe fallback.
    const fetchIceServers = async () => {
      try {
        const res = await fetch(`${socketUrl}/api/call/ice-servers`, {
          credentials: 'include',
        })
        if (!res.ok) return
        const data = await res.json()
        if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) {
          iceServersRef.current = data.iceServers
          console.log(`✅ [webrtc] Loaded ICE servers: ${data.iceServers.length}`)
        }
      } catch (e) {
        console.warn('⚠️ [webrtc] Failed to load ICE servers, using browser defaults:', e?.message || e)
      }
    }
    fetchIceServers()

    // Re-assert "online" so Redis presence matches an active web session. Mobile may have set
    // clientPresence offline while backgrounded — same userId would block in-app callUser delivery.
    const emitClientPresenceOnline = () => {
      newSocket.emit('clientPresence', { status: 'online' })
    }

    newSocket.on('connect', () => {
      console.log('✅ Socket connected successfully! ID:', newSocket.id);
      emitClientPresenceOnline()
      // Win race with another device (e.g. mobile) that may emit offline right after we connect.
      window.setTimeout(emitClientPresenceOnline, 300)
      window.setTimeout(emitClientPresenceOnline, 2000)
    });

    newSocket.on('disconnect', () => {
      console.log('⚠️ Socket disconnected');
    });

    setSocket(newSocket);
    setMe(userIdToStr(user._id));

    newSocket?.on('getOnlineUser', (users) => setOnlineUser(users));

    // Targeted presence snapshot — response to presenceSubscribe (one component or SocketContext can trigger it)
    // Merges snapshot online users into the global onlineUser list
    newSocket?.on('presenceSnapshot', ({ onlineUsers: snapshotUsers, subscribedUserIds }) => {
      if (!Array.isArray(snapshotUsers)) return
      const snapshotOnlineIds = new Set(
        snapshotUsers.map(u => (typeof u === 'object' ? u.userId?.toString() : u?.toString())).filter(Boolean)
      )
      const allSubscribedIds = new Set(
        (Array.isArray(subscribedUserIds) ? subscribedUserIds : []).map(id => id?.toString()).filter(Boolean)
      )
      setOnlineUser(prev => {
        const arr = Array.isArray(prev) ? prev : []
        // Remove subscribed users who are now offline; keep everyone else untouched
        const kept = arr.filter(u => {
          const uid = typeof u === 'object' ? u.userId?.toString() : u?.toString()
          if (!uid || !allSubscribedIds.has(uid)) return true // not in subscribed set — keep as-is
          return snapshotOnlineIds.has(uid) // only keep if snapshot says online
        })
        // Add newly online users from snapshot that aren't already in the list
        const keptIds = new Set(kept.map(u => (typeof u === 'object' ? u.userId?.toString() : u?.toString())))
        const toAdd = snapshotUsers
          .map(u => {
            const uid = typeof u === 'object' ? u.userId?.toString() : u?.toString()
            return uid ? { userId: uid, onlineAt: typeof u === 'object' ? (u.onlineAt || Date.now()) : Date.now() } : null
          })
          .filter(u => u && !keptIds.has(u.userId))
        return [...kept, ...toAdd]
      })
    });

    // Targeted presence updates (from presenceSubscribe — more reliable than global broadcast)
    newSocket?.on('presenceUpdate', ({ userId, online }) => {
      if (!userId) return
      setOnlineUser(prev => {
        const arr = Array.isArray(prev) ? prev : []
        if (online) {
          // Add if not already in list
          const exists = arr.some(u => {
            const uid = typeof u === 'object' ? u.userId?.toString() : u?.toString()
            return uid === userId?.toString()
          })
          return exists ? arr : [...arr, { userId: userId.toString(), onlineAt: Date.now() }]
        } else {
          // Remove from list
          return arr.filter(u => {
            const uid = typeof u === 'object' ? u.userId?.toString() : u?.toString()
            return uid !== userId?.toString()
          })
        }
      })
    });

    // Listen for unread count updates
    newSocket?.on('unreadCountUpdate', ({ totalUnread }) => {
      setTotalUnreadCount(totalUnread || 0);
    });

    // Listen for new notifications
    newSocket?.on('newNotification', (notification) => {
      console.log('🔔 New notification received:', notification)
      setNotificationCount(prev => prev + 1)
    });

    // Listen for notification deletions (e.g., when user unfollows)
    newSocket?.on('notificationDeleted', (data) => {
      console.log('🗑️ Notification deleted via socket:', data)
      // Decrease count if a follow notification was deleted
      if (data.type === 'follow') {
        setNotificationCount(prev => Math.max(0, prev - 1))
      }
    });

    // Listen for new messages globally - play sound for unread messages
    newSocket?.on('newMessage', (message) => {
      if (!message || !message.sender || !user?._id) return;
      
      // Check if message is from another user (not current user)
      let messageSenderId = '';
      if (message.sender?._id) {
        messageSenderId = typeof message.sender._id === 'string' ? message.sender._id : message.sender._id.toString();
      } else if (message.sender) {
        messageSenderId = typeof message.sender === 'string' ? message.sender : String(message.sender);
      }
      
      let currentUserId = '';
      if (user?._id) {
        currentUserId = typeof user._id === 'string' ? user._id : user._id.toString();
      }
      
      const isFromCurrentUser = messageSenderId !== '' && currentUserId !== '' && messageSenderId === currentUserId;
      
      // Check if message is from the currently open conversation
      const isFromOpenConversation = selectedConversationIdRef.current && 
                                      messageSenderId === selectedConversationIdRef.current;
      
      const shouldPlay = !isFromCurrentUser && !isFromOpenConversation
      
      console.log('🔔 Message notification check:', {
        sender: messageSenderId,
        openConversation: selectedConversationIdRef.current || 'none',
        isFromMe: isFromCurrentUser,
        isFromOpenChat: isFromOpenConversation,
        willPlaySound: shouldPlay
      });
      
      // Play sound only for unread messages from other users AND not from currently open conversation
      if (shouldPlay && messageSoundAudio.current) {
        console.log('🔊 Playing notification sound...')
        messageSoundAudio.current.currentTime = 0; // Reset to start
        messageSoundAudio.current.play()
          .then(() => console.log('✅ Notification sound played successfully'))
          .catch(err => {
            console.log('❌ Message sound play error:', err.message);
          });
      } else {
        console.log('🔇 Notification sound suppressed (correct behavior)')
      }
    });

    // Fetch initial unread count - OPTIMIZED endpoint
    const fetchInitialUnreadCount = async () => {
      if (!user?._id) {
        setTotalUnreadCount(0);
        return;
      }
      try {
        const socketUrl = import.meta.env.PROD 
          ? window.location.origin 
          : "http://localhost:5000";
        // Use dedicated endpoint for total unread count (much more efficient)
        const res = await fetch(`${socketUrl}/api/message/unread/count`, {
          credentials: 'include',
        });
        const data = await res.json();
        if (res.ok && data.totalUnread !== undefined) {
          console.log('✅ Initial unread count fetched:', data.totalUnread);
          setTotalUnreadCount(data.totalUnread);
        }
      } catch (error) {
        console.log('Error fetching initial unread count:', error);
      }
    };
    fetchInitialUnreadCount();

    // Fetch initial notification count
    const fetchInitialNotificationCount = async () => {
      if (!user?._id) {
        setNotificationCount(0);
        return;
      }
      try {
        const socketUrl = import.meta.env.PROD 
          ? window.location.origin 
          : "http://localhost:5000";
        const res = await fetch(`${socketUrl}/api/notification/unread-count`, {
          credentials: 'include',
        });
        const data = await res.json();
        if (res.ok && data.unreadCount !== undefined) {
          console.log('✅ Initial notification count fetched:', data.unreadCount);
          setNotificationCount(data.unreadCount);
        }
      } catch (error) {
        console.log('Error fetching initial notification count:', error);
      }
    };
    fetchInitialNotificationCount();

    // Listen for football match updates
    newSocket?.on('footballMatchUpdate', (data) => {
      console.log('⚽ Football match update received:', data);
      // Emit custom event that Post component can listen to
      window.dispatchEvent(new CustomEvent('footballMatchUpdate', { detail: data }));
    });

    return () => {
      newSocket?.off('unreadCountUpdate');
      newSocket?.off('newMessage');
      newSocket?.off('newNotification');
      newSocket?.off('notificationDeleted');
      newSocket?.off('footballMatchUpdate');
      newSocket.close();
    };
  }, [user]);

  // Keep Redis presence "online" while this tab is active so calls + presenceSubscribe match mobile.
  // Do not emit "offline" on tab blur — socket should still receive callUser when the tab is in the background.
  useEffect(() => {
    if (!socket) return

    const assertPresenceOnline = () => {
      if (!socket.connected || document.visibilityState !== 'visible') return
      socket.emit('clientPresence', { status: 'online' })
    }

    assertPresenceOnline()
    document.addEventListener('visibilitychange', assertPresenceOnline)
    window.addEventListener('focus', assertPresenceOnline)

    const interval = window.setInterval(() => {
      assertPresenceOnline()
    }, 45_000)

    return () => {
      document.removeEventListener('visibilitychange', assertPresenceOnline)
      window.removeEventListener('focus', assertPresenceOnline)
      window.clearInterval(interval)
    }
  }, [socket])

  useEffect(() => {
    if (!socket) return;

    const handleCallCanceled = () => {
      // Stop ringtone when call is canceled
      if (ringtoneAudio.current) {
        ringtoneAudio.current.pause();
        ringtoneAudio.current.currentTime = 0;
      }
      
      // Clean up peer connections and streams
      cleanupPeer();
      
      // Stop all tracks from the current stream
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      
      // Clear stream state
      setStream(null);
      
      // Reset call states
      setCall({});
      setCallAccepted(false);
      setCallEnded(true);
      setIsCalling(false); // Stop ringing when call is canceled
      
      // Don't request new stream immediately - prevents unnecessary re-renders
      setTimeout(() => {
        setCallEnded(false); // Reset callEnded after a delay so UI can update
      }, 500);
    };

    socket.on("CallCanceled", handleCallCanceled);

    return () => {
      socket.off("CallCanceled", handleCallCanceled);
    };
  }, [socket]);

  // Handle callBusy event - track which users are busy
  useEffect(() => {
    if (!socket) return;

    const handleCallBusy = ({ userToCall, from }) => {
      setBusyUsers(prev => {
        const newSet = new Set(prev);
        if (userToCall) newSet.add(userIdToStr(userToCall));
        if (from) newSet.add(userIdToStr(from));
        return newSet;
      });
    };

    socket.on("callBusy", handleCallBusy);

    return () => {
      socket.off("callBusy", handleCallBusy);
    };
  }, [socket]);

  // Handle call cancelled - clear busy state
  useEffect(() => {
    if (!socket) return;

    const handleCallCancelled = ({ userToCall, from }) => {
      setBusyUsers(prev => {
        const newSet = new Set(prev);
        if (userToCall) newSet.delete(userIdToStr(userToCall));
        if (from) newSet.delete(userIdToStr(from));
        return newSet;
      });
    };

    socket.on("cancleCall", handleCallCancelled);

    return () => {
      socket.off("cancleCall", handleCallCancelled);
    };
  }, [socket]);

  // Handle callBusyError - when trying to call a busy user
  useEffect(() => {
    if (!socket) return;

    const handleCallBusyError = ({ message, busyUserId }) => {
      console.warn(message, busyUserId);
      
      // Stop ringtone if playing
      if (ringtoneAudio.current) {
        ringtoneAudio.current.pause();
        ringtoneAudio.current.currentTime = 0;
      }
      
      // Show toast notification
      toast({
        title: "User is Busy",
        description: "This user is currently in another call. Please try again later.",
        status: "warning",
        duration: 4000,
        isClosable: true,
        position: "top"
      });
      
      cleanupPeer();
      setCall({});
      setCallAccepted(false);
      setCallEnded(true);
      setIsCalling(false);
    };

    socket.on("callBusyError", handleCallBusyError);

    return () => {
      socket.off("callBusyError", handleCallBusyError);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    const handleCallcomming = ({ from, name: callerName, signal, userToCall, callType: incomingCallType = 'video' }) => {
      const currentUserId = userIdToStr(user?._id || me)
      const fromId = userIdToStr(from)
      const targetId = userIdToStr(userToCall)

      // If userToCall matches current user, we're receiving the call
      if (targetId && targetId === currentUserId && fromId !== currentUserId) {
        // We are receiving the call (incoming)
        callPartnerIdRef.current = fromId
        setCallType(incomingCallType);
        setCall({ isReceivingCall: true, from: fromId, name: callerName, signal, userToCall: targetId, callType: incomingCallType });
        setIsCalling(false);
        // Don't get media stream until user answers - saves resources if they decline
        
        // Play ringtone for incoming call
        if (ringtoneAudio.current) {
          // Ensure audio is loaded and ready
          ringtoneAudio.current.load();
          
          // Set properties for looping
          ringtoneAudio.current.loop = true;
          
          // Function to play ringtone (will be called directly or after user interaction)
          const playRingtone = () => {
            const playPromise = ringtoneAudio.current.play();
            if (playPromise !== undefined) {
              playPromise.catch(err => {
                console.log('⚠️ Ringtone play blocked (autoplay policy):', err.name);
                
                // Set up retry on next user interaction
                const retryPlay = () => {
                  ringtoneAudio.current.load();
                  ringtoneAudio.current.loop = true;
                  ringtoneAudio.current.play().catch(() => {});
                  
                  // Clean up listeners
                  retryEvents.forEach(event => {
                    document.removeEventListener(event, retryPlay);
                  });
                };
                
                const retryEvents = ['click', 'touchstart', 'keydown', 'mousemove', 'scroll'];
                retryEvents.forEach(event => {
                  document.addEventListener(event, retryPlay, { once: true, passive: true });
                });
              });
            }
          };
          
          // Try playing immediately
          playRingtone();
        }
      } 
      // If from matches current user, we're making the call (ringing state)
      // Don't update if we already set isCalling in callUser function
      else if (fromId === currentUserId && !isCalling) {
        // We are making the call - show ringing state
        setIsCalling(true);
        setCall({ isCalling: true, userToCall: targetId, from: fromId, name: callerName, callType: incomingCallType });
      }
    };

    socket.on("callUser", handleCallcomming);

    return () => {
      socket.off("callUser", handleCallcomming);
    };
  }, [socket, me, user?._id, isCalling]);

  // Trickle ICE relay for web calls (backend already supports this event).
  useEffect(() => {
    if (!socket) return;
    const handleIceCandidate = ({ candidate, from }) => {
      if (!candidate) return;
      const fromId = userIdToStr(from);
      if (callPartnerIdRef.current && fromId && fromId !== callPartnerIdRef.current) {
        return;
      }
      // Normalise to simple-peer signal format: { candidate: { candidate: string, sdpMid, sdpMLineIndex } }
      // Mobile sends flat RTCIceCandidate: { candidate: string, sdpMid, sdpMLineIndex }
      // Web (after our fix) sends the same flat format
      // Old web format (before fix): { candidate: { candidate: string, ... } } — also handled
      let signalData;
      if (candidate && typeof candidate.candidate === 'string') {
        signalData = { candidate };          // flat → wrap so simple-peer sees nested
      } else if (candidate && typeof candidate.candidate === 'object') {
        signalData = { candidate: candidate.candidate }; // already nested → unwrap one level
      } else {
        signalData = { candidate };
      }
      if (!peerRef.current) {
        pendingRemoteIceRef.current.push(signalData);
        return;
      }
      try {
        peerRef.current.signal(signalData);
      } catch (err) {
        console.warn('Error applying remote ICE candidate:', err?.message || err);
      }
    };
    socket.on('iceCandidate', handleIceCandidate);
    return () => {
      socket.off('iceCandidate', handleIceCandidate);
    };
  }, [socket]);

  // Clean up peer connections and video streams
  const cleanupPeer = () => {
    if (connectionRef.current) {
      connectionRef.current.destroy();
      connectionRef.current = null;
    }
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    if (userVideo.current) {
      userVideo.current.srcObject = null;
    }
    // Clear remote stream state
    setRemoteStream(null);
    pendingRemoteIceRef.current = [];
    callPartnerIdRef.current = null;
  };

  const callUser = async (id, recipientName = null, type = 'video') => {
    cleanupPeer();
    callPartnerIdRef.current = userIdToStr(id)
    setCallAccepted(false);
    setCallEnded(false);
    let effectiveType = type;
    setCallType(effectiveType);
    setCall({ isCalling: false, userToCall: userIdToStr(id), recipientName: recipientName, callType: effectiveType });
    try {

    // Get appropriate media stream based on call type
    // Check if we need a new stream (different type than current)
    let currentStream = stream;
    const needsNewStream = !currentStream || 
      (type === 'audio' && currentStream.getVideoTracks().length > 0) || 
      (type === 'video' && currentStream.getVideoTracks().length === 0);

    if (needsNewStream) {
      // Stop old tracks if they exist
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
      // Get new stream with correct type
      const constraints = {
        audio: true,
        video: effectiveType === 'video' ? true : false
      };
      try {
        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (mediaErr) {
        // Web safety: if camera capture fails, still allow audio call instead of hard failing.
        if (effectiveType === 'video') {
          console.warn('⚠️ [callUser] Video media failed, retrying audio-only:', mediaErr?.name, mediaErr?.message);
          currentStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          effectiveType = 'audio';
          setCallType('audio');
          setCall((prev) => ({ ...prev, callType: 'audio' }));
          toast({
            title: "Camera unavailable",
            description: "Started as audio call because camera failed.",
            status: "warning",
            duration: 4000,
            isClosable: true,
            position: "top",
          });
        } else {
          throw mediaErr;
        }
      }
      // Unmute audio tracks explicitly
      currentStream.getAudioTracks().forEach(track => {
        if (!track.enabled) track.enabled = true;
      });
      streamRef.current = currentStream;
      setStream(currentStream);
    }

    // Create peer connection (web-to-web uses bundled ICE candidates)
    const callerPeerOptions = { initiator: true, trickle: true, stream: currentStream };
    if (Array.isArray(iceServersRef.current) && iceServersRef.current.length > 0) {
      callerPeerOptions.config = { iceServers: iceServersRef.current };
    }
    const peer = new Peer(callerPeerOptions);
    peerRef.current = peer;

    peer.on('error', (err) => {
      console.error('❌ [WebRTC caller] Peer error:', err?.code, err?.message, err);
      // ERR_DATA_CHANNEL on close is expected cleanup noise — don't surface it to the user
      if (err?.code === 'ERR_DATA_CHANNEL') return;
      toast({ title: 'Call error', description: `${err?.code || err?.message || 'WebRTC error'}`, status: 'error', duration: 5000, isClosable: true, position: 'top' });
    });

    // Monitor underlying ICE state for diagnostics (addEventListener = no conflict with simple-peer)
    if (peer._pc) {
      peer._pc.addEventListener('iceconnectionstatechange', () => {
        const s = peer._pc.iceConnectionState;
        console.log(`🧊 [WebRTC caller] ICE state: ${s}`);
        if (s === 'failed') console.error('❌ [WebRTC caller] ICE failed — no reachable candidate pair. TURN may be needed.');
      });
      peer._pc.addEventListener('icegatheringstatechange', () => {
        console.log(`🧊 [WebRTC caller] ICE gathering: ${peer._pc.iceGatheringState}`);
      });
      peer._pc.addEventListener('icecandidate', (e) => {
        if (e.candidate) console.log(`🧊 [WebRTC caller] Candidate: type=${e.candidate.type} proto=${e.candidate.protocol} addr=${e.candidate.address}`);
      });
    }

    peer.on('signal', (data) => {
      const fromId = userIdToStr(user?._id || me)
      const toId = userIdToStr(id)
      // Offer SDP -> start ringing and send call invite
      if (data?.type === 'offer') {
        setIsCalling(true);
        setCall((prev) => ({ ...prev, isCalling: true }));
        socket.emit('callUser', {
          userToCall: toId,
          signalData: data,
          from: fromId,
          name: user.username,
          callType: effectiveType,
        });
        return
      }
      // Trickle ICE candidate -> extract inner candidate so mobile gets flat RTCIceCandidate format
      if (data?.candidate) {
        socket.emit('iceCandidate', { userToCall: toId, candidate: data.candidate, from: fromId });
      }
    });

    peer.on('stream', (currentStream) => {
      // Store remote stream in state for later use
      setRemoteStream(currentStream);
      
      if (userVideo.current) {
        userVideo.current.srcObject = currentStream;
        // Ensure audio is enabled and playing for both video and audio calls
        if (userVideo.current && userVideo.current.srcObject) {
          const audioTracks = currentStream.getAudioTracks();
          audioTracks.forEach(track => {
            track.enabled = true;
          });
          // Set volume and ensure playback for audio calls
          userVideo.current.volume = 1.0;
          userVideo.current.muted = false;
          
          // Force play to ensure audio works
          userVideo.current.play().catch(err => {
            console.log('Audio/Video play error (browser may require user interaction):', err);
          });
          
          console.log(`Receiving ${type} call - Audio tracks:`, audioTracks.length, 'Video tracks:', currentStream.getVideoTracks().length);
        }
      }
    });

    socket.once('callAccepted', (payload) => {
      try {
        const answerSignal = payload?.signal || payload;
        peer.signal(answerSignal);
        setCallAccepted(true);
        setIsCalling(false); // Stop ringing when call is accepted
      } catch (err) {
        console.warn('Error signaling callAccepted:', err.message);
      }
    });


    connectionRef.current = peer;
    } catch (err) {
      console.error('❌ [callUser] Failed to create/send offer:', err?.name, err?.message, err);
      if (ringtoneAudio.current) {
        ringtoneAudio.current.pause();
        ringtoneAudio.current.currentTime = 0;
      }
      cleanupPeer();
      setIsCalling(false);
      setCallAccepted(false);
      setCallEnded(true);
      setCall({});
      toast({
        title: "Call couldn't start",
        description: `Media error: ${err?.name || 'UnknownError'}${err?.message ? ` - ${err.message}` : ''}`,
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "top",
      });
    }
  };

  // Answer an incoming call
  const answerCall = async () => {
    const partnerId = userIdToStr(call.from)
    // Rescue ICE candidates that arrived BEFORE the user tapped Answer (mobile sends them immediately
    // after its offer). cleanupPeer() wipes pendingRemoteIceRef, so save & filter first.
    const rescuedIce = pendingRemoteIceRef.current.filter(() => true); // copy
    cleanupPeer(); // resets pendingRemoteIceRef to []
    // Restore the rescued candidates (already normalised for simple-peer) for the correct partner
    pendingRemoteIceRef.current = rescuedIce;
    if (partnerId) callPartnerIdRef.current = partnerId
    setCallAccepted(true);
    setCallEnded(false);
    setIsCalling(false); // Stop ringing when answering
    
    // Stop ringtone when answering call
    if (ringtoneAudio.current) {
      ringtoneAudio.current.pause();
      ringtoneAudio.current.currentTime = 0;
    }
    
    // Clear the call notification by removing isReceivingCall flag
    // This will dismiss the notification since CallNotification checks for isReceivingCall
    setCall(prev => ({ ...prev, isReceivingCall: false }));
    
    // Ensure we have the right stream type
    const callTypeForAnswer = call.callType || 'video';
    setCallType(callTypeForAnswer);
    
    // Check if we need a new stream (different type than current)
    let currentStream = stream;
    const needsNewStream = !currentStream || 
      (callTypeForAnswer === 'audio' && currentStream.getVideoTracks().length > 0) || 
      (callTypeForAnswer === 'video' && currentStream.getVideoTracks().length === 0);

    if (needsNewStream) {
      // Stop old tracks if they exist
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
      // Get new stream with correct type
      const constraints = {
        audio: true,
        video: callTypeForAnswer === 'video' ? true : false
      };
      currentStream = await navigator.mediaDevices.getUserMedia(constraints);
      // Unmute audio tracks explicitly
      currentStream.getAudioTracks().forEach(track => {
        if (!track.enabled) track.enabled = true;
      });
      streamRef.current = currentStream;
      setStream(currentStream);
    }
    
    // Ensure both users are marked as busy when call is answered
    if (call.from) {
      setBusyUsers(prev => {
        const newSet = new Set(prev);
        newSet.add(userIdToStr(call.from));
        newSet.add(userIdToStr(me));
        return newSet;
      });
    }
    
    // Create peer connection (web-to-web uses bundled ICE candidates)
    const answerPeerOptions = { initiator: false, trickle: true, stream: currentStream };
    if (Array.isArray(iceServersRef.current) && iceServersRef.current.length > 0) {
      answerPeerOptions.config = { iceServers: iceServersRef.current };
    }
    const peer = new Peer(answerPeerOptions);

    peer.on('error', (err) => {
      console.error('❌ [WebRTC answerer] Peer error:', err?.code, err?.message, err);
      // ERR_DATA_CHANNEL on close is expected cleanup noise — don't surface it to the user
      if (err?.code === 'ERR_DATA_CHANNEL') return;
      toast({ title: 'Call error', description: `${err?.code || err?.message || 'WebRTC error'}`, status: 'error', duration: 5000, isClosable: true, position: 'top' });
    });

    // Monitor underlying ICE state for diagnostics (addEventListener = no conflict with simple-peer)
    if (peer._pc) {
      peer._pc.addEventListener('iceconnectionstatechange', () => {
        const s = peer._pc.iceConnectionState;
        console.log(`🧊 [WebRTC answerer] ICE state: ${s}`);
        if (s === 'failed') console.error('❌ [WebRTC answerer] ICE failed — no reachable candidate pair. TURN may be needed.');
      });
      peer._pc.addEventListener('icegatheringstatechange', () => {
        console.log(`🧊 [WebRTC answerer] ICE gathering: ${peer._pc.iceGatheringState}`);
      });
      peer._pc.addEventListener('icecandidate', (e) => {
        if (e.candidate) console.log(`🧊 [WebRTC answerer] Candidate: type=${e.candidate.type} proto=${e.candidate.protocol} addr=${e.candidate.address}`);
      });
    }

    peer.on('signal', (data) => {
      const fromId = userIdToStr(me || user?._id)
      const toId = userIdToStr(call.from)
      if (data?.type === 'answer') {
        socket.emit('answerCall', { signal: data, to: toId });
        return
      }
      // Trickle ICE candidate -> extract inner candidate so mobile gets flat RTCIceCandidate format
      if (data?.candidate) {
        socket.emit('iceCandidate', { userToCall: toId, candidate: data.candidate, from: fromId });
      }
    });

    // Handle ICE restart offer from mobile app (when connection fails)

    peer.on('stream', (currentStream) => {
      // Store remote stream in state for later use
      setRemoteStream(currentStream);
      
      if (userVideo.current) {
        userVideo.current.srcObject = currentStream;
        // Ensure audio is enabled and playing for both video and audio calls
        if (userVideo.current && userVideo.current.srcObject) {
          const audioTracks = currentStream.getAudioTracks();
          audioTracks.forEach(track => {
            track.enabled = true;
          });
          // Set volume and ensure playback
          userVideo.current.volume = 1.0;
          userVideo.current.muted = false;
          
          // Force play to ensure audio/video works
          userVideo.current.play().catch(err => {
            console.log('Audio/Video play error (browser may require user interaction):', err);
          });
          
          console.log(`Answering ${callTypeForAnswer} call - Audio tracks:`, audioTracks.length, 'Video tracks:', currentStream.getVideoTracks().length);
        }
      }
    });

    if (call.signal) {
      console.log('📡 [WebRTC answerer] Signaling offer from caller, SDP type:', call.signal?.type, 'sdp length:', call.signal?.sdp?.length);
      try {
        peer.signal(call.signal);
      } catch (err) {
        console.error('❌ [WebRTC answerer] peer.signal(offer) threw:', err?.name, err?.message);
        toast({ title: 'SDP error', description: `Could not process caller's offer: ${err?.message}`, status: 'error', duration: 6000, isClosable: true, position: 'top' });
      }
    }

    peerRef.current = peer;
    connectionRef.current = peer;

    const queued = pendingRemoteIceRef.current.splice(0);
    for (const c of queued) {
      try {
        peer.signal(c);
      } catch (err) {
        console.warn('Error applying queued ICE candidate:', err?.message || err);
      }
    }
  };

  // Leave the call, stop tracks and refresh stream
  const leaveCall = () => {
    // Save call info before clearing state
    const callInfo = { ...call };
    const isReceiving = call.isReceivingCall;
    const from = call.from;
    const userToCall = call.userToCall;
    
    // Stop ringtone when leaving/declining call
    if (ringtoneAudio.current) {
      ringtoneAudio.current.pause();
      ringtoneAudio.current.currentTime = 0;
    }
    
    // Emit cancelCall BEFORE clearing state
    if (socket && (from || userToCall)) {
      // If receiving call, we are declining - notify the caller
      // If making call, we are canceling - notify the receiver
      socket.emit('cancelCall', {
        conversationId: userIdToStr(isReceiving ? from : userToCall),
        sender: userIdToStr(user._id),
      });
    }
    
    // Clear busy state for both users
    if (from || userToCall) {
      setBusyUsers(prev => {
        const newSet = new Set(prev);
        if (from) newSet.delete(userIdToStr(from));
        if (userToCall) newSet.delete(userIdToStr(userToCall));
        return newSet;
      });
    }
    
    // Now clear all call states
    setCallEnded(true);
    setCallAccepted(false);
    setIsCalling(false);
    setCall({});
    cleanupPeer();

    // Stop all tracks from the current stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Clear stream state to avoid memory leaks
    setStream(null);
    
    // Don't request new stream immediately - we'll get it when starting next call
    // This prevents unnecessary re-renders and message reloading
  };

  // Handle incoming chess challenge
  useEffect(() => {
    if (!socket) return;

    const handleChessChallenge = (data) => {
      console.log('♟️ Chess challenge received:', data);
      setChessChallenge({
        from: data.from,
        fromName: data.fromName,
        fromUsername: data.fromUsername,
        fromProfilePic: data.fromProfilePic,
        isReceivingChallenge: true,
      });

      // Play chess challenge tone
      if (chessToneAudio.current) {
        chessToneAudio.current.loop = true; // Loop until answered/declined
        chessToneAudio.current.play().catch(err => {
          console.log('Chess tone play error (browser may require user interaction):', err);
        });
      }
    };

    const handleChessDeclined = () => {
      console.log('♟️ Chess challenge declined');
      // Stop chess tone when challenge is declined
      if (chessToneAudio.current) {
        chessToneAudio.current.pause();
        chessToneAudio.current.currentTime = 0;
      }
      setChessChallenge(null);
    };

    socket.on('chessChallenge', handleChessChallenge);
    socket.on('chessDeclined', handleChessDeclined);

    return () => {
      socket.off('chessChallenge', handleChessChallenge);
      socket.off('chessDeclined', handleChessDeclined);
    };
  }, [socket]);

  // Accept chess challenge
  const acceptChessChallenge = () => {
    if (!socket || !chessChallenge) return;

    // Stop chess tone when accepting
    if (chessToneAudio.current) {
      chessToneAudio.current.pause();
      chessToneAudio.current.currentTime = 0;
    }

    const roomId = `chess_${chessChallenge.from}_${user._id}_${Date.now()}`;
    const acceptData = {
      from: user._id,
      to: chessChallenge.from,
      roomId: roomId
    };

    // Set orientation to black (accepter is always black)
    localStorage.removeItem("chessOrientation");
    localStorage.removeItem("gameLive");
    localStorage.removeItem("chessRoomId");
    localStorage.setItem("chessOrientation", "black");
    localStorage.setItem("gameLive", "true");
    localStorage.setItem("chessRoomId", roomId);

    socket.emit('acceptChessChallenge', acceptData);
    setChessChallenge(null);
  };

  // Decline chess challenge
  const declineChessChallenge = () => {
    if (!socket || !chessChallenge) return;

    // Stop chess tone when declining
    if (chessToneAudio.current) {
      chessToneAudio.current.pause();
      chessToneAudio.current.currentTime = 0;
    }

    socket.emit('declineChessChallenge', {
      from: user._id,
      to: chessChallenge.from
    });

    setChessChallenge(null);
  };

  // Function to end chess game when navigating away
  const endChessGameOnNavigate = () => {
    if (!socket || !user?._id) return;

    const gameLive = localStorage.getItem('gameLive') === 'true';
    const roomId = localStorage.getItem('chessRoomId');

    if (gameLive && roomId) {
      try {
        // Extract player IDs from roomId (format: chess_player1_player2_timestamp)
        // Use regex to match the pattern more reliably
        const match = roomId.match(/^chess_(.+?)_(.+?)_(\d+)$/);
        
        if (match) {
          const player1 = match[1];
          const player2 = match[2];
          
          // Determine which player we are
          const currentUserId = user._id.toString();
          const player1Str = player1.toString();
          const player2Str = player2.toString();
          
          // Emit chessGameEnd to backend with both player IDs
          // The backend will determine which player left
          socket.emit('chessGameEnd', {
            roomId,
            player1: player1Str,
            player2: player2Str
          });

          console.log('♟️ Chess game ended due to navigation', { roomId, player1: player1Str, player2: player2Str });
        } else {
          console.warn('⚠️ Could not parse roomId format:', roomId);
          // Still try to emit with roomId only (backend might handle it)
          socket.emit('chessGameEnd', { roomId });
        }
      } catch (error) {
        console.error('❌ Error ending chess game:', error);
        // Still try to emit with roomId only
        socket.emit('chessGameEnd', { roomId });
      }

      // Clean up localStorage
      localStorage.removeItem('chessOrientation');
      localStorage.removeItem('gameLive');
      localStorage.removeItem('chessRoomId');
      localStorage.removeItem('chessFEN');
      localStorage.removeItem('capturedWhite');
      localStorage.removeItem('capturedBlack');
    }
  };

  // ── Card (Go Fish) challenge handlers ─────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const handleCardChallenge = (data) => {
      setCardChallenge({
        from: data.from,
        fromName: data.fromName,
        fromUsername: data.fromUsername,
        fromProfilePic: data.fromProfilePic,
        isReceivingChallenge: true,
      });
    };

    const handleCardDeclined = () => {
      setCardChallenge(null);
    };

    socket.on('cardChallenge', handleCardChallenge);
    socket.on('cardDeclined', handleCardDeclined);

    return () => {
      socket.off('cardChallenge', handleCardChallenge);
      socket.off('cardDeclined', handleCardDeclined);
    };
  }, [socket]);

  const acceptCardChallenge = () => {
    if (!socket || !cardChallenge) return;

    const roomId = `card_${cardChallenge.from}_${user._id}_${Date.now()}`;
    const acceptData = { from: user._id, to: cardChallenge.from, roomId };

    localStorage.setItem('cardRoomId', roomId);
    socket.emit('acceptCardChallenge', acceptData);
    setCardChallenge(null);
  };

  const declineCardChallenge = () => {
    if (!socket || !cardChallenge) return;
    socket.emit('declineCardChallenge', { from: user._id, to: cardChallenge.from });
    setCardChallenge(null);
  };

  const endCardGameOnNavigate = () => {
    const roomId = localStorage.getItem('cardRoomId');
    if (roomId && socket) {
      const match = roomId.match(/^card_(.+?)_(.+?)_(\d+)$/);
      if (match) {
        socket.emit('cardGameEnd', { roomId, player1: match[1], player2: match[2] });
      } else {
        socket.emit('cardGameEnd', { roomId });
      }
      localStorage.removeItem('cardRoomId');
    }
  };

  // Function to update which conversation is currently open (for notification sound control)
  const setSelectedConversationId = (userId) => {
    console.log('🔊 Setting selectedConversationId:', userId || 'none')
    selectedConversationIdRef.current = userId;
  };

  return (
    <SocketContext.Provider
      value={{
        socket,
        call,
        callAccepted,
        callEnded,
        isCalling, // Export ringing state
        callType, // Export call type (audio/video)
        myVideo,
        userVideo,
        stream,
        remoteStream, // Export remote stream for components
        me,
        callUser,
        answerCall,
        leaveCall,
        onlineUser,
        onlineUsers: onlineUser, // Export as onlineUsers for consistency
        busyUsers, // Export busyUsers so components can check if a user is busy
        totalUnreadCount, // Export total unread message count
        notificationCount, // Export unread notification count
        setNotificationCount, // Function to update notification count
        setSelectedConversationId, // Function to update selected conversation for notification control
        chessChallenge, // Export chess challenge state
        acceptChessChallenge, // Function to accept chess challenge
        declineChessChallenge, // Function to decline chess challenge
        endChessGameOnNavigate, // Function to end chess game when navigating away
        cardChallenge, // Export card (Go Fish) challenge state
        acceptCardChallenge, // Function to accept card challenge
        declineCardChallenge, // Function to decline card challenge
        endCardGameOnNavigate, // Function to end card game when navigating away
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};
