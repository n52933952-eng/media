
import { createContext, useEffect, useState, useContext, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import { useToast } from '@chakra-ui/react';
import { UserContext } from './UserContext';
import ringTone from '../assets/ring.mp3'; // Import ring tone
import messageSound from '../assets/frontend_src_assets_sounds_message.mp3'; // Import message notification sound
import chessTone from '../assets/chesstone.mp3'; // Import chess challenge tone

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

  const myVideo = useRef();
  const userVideo = useRef();
  const connectionRef = useRef();
  const peerRef = useRef();
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
      query: { userId: user._id },
    });

    // Wait for socket to connect before setting it as ready
    newSocket.on('connect', () => {
      console.log('✅ Socket connected successfully! ID:', newSocket.id);
    });

    newSocket.on('disconnect', () => {
      console.log('⚠️ Socket disconnected');
    });

    setSocket(newSocket);
    setMe(user._id);

    newSocket?.on('getOnlineUser', (users) => setOnlineUser(users));

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
        newSet.add(userToCall);
        newSet.add(from);
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
        if (userToCall) newSet.delete(userToCall);
        if (from) newSet.delete(from);
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
      // Check if this is an incoming call (we're the receiver) or outgoing call (we're the caller)
      const currentUserId = me || user?._id
      
      // If userToCall matches current user, we're receiving the call
      if (userToCall === currentUserId && from !== currentUserId) {
        // We are receiving the call (incoming)
        setCallType(incomingCallType);
        setCall({ isReceivingCall: true, from, name: callerName, signal, userToCall, callType: incomingCallType });
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
      else if (from === currentUserId && !isCalling) {
        // We are making the call - show ringing state
        setIsCalling(true);
        setCall({ isCalling: true, userToCall, from, name: callerName, callType: incomingCallType });
      }
    };

    socket.on("callUser", handleCallcomming);

    return () => {
      socket.off("callUser", handleCallcomming);
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
  };

  const callUser = async (id, recipientName = null, type = 'video') => {
    cleanupPeer();
    setCallAccepted(false);
    setCallEnded(false);
    setIsCalling(true); // Start ringing state when calling
    setCallType(type);
    setCall({ isCalling: true, userToCall: id, recipientName: recipientName, callType: type });

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
        video: type === 'video' ? true : false
      };
      currentStream = await navigator.mediaDevices.getUserMedia(constraints);
      // Unmute audio tracks explicitly
      currentStream.getAudioTracks().forEach(track => {
        if (!track.enabled) track.enabled = true;
      });
      setStream(currentStream);
    }

    // Use trickle: true to support mobile app (which uses trickle: true)
    // This allows separate ICE candidate events, which is needed for NAT traversal
    const peer = new Peer({ initiator: true, trickle: true, stream: currentStream });
    peerRef.current = peer;

    peer.on('signal', (data) => {
      // With trickle: true, signal events include both SDP and ICE candidates
      // Check if this is an SDP (offer/answer) or an ICE candidate
      if (data.type === 'offer' || data.type === 'answer') {
        // This is the SDP offer/answer
        socket.emit('callUser', { userToCall: id, signalData: data, from: me, name: user.username, callType: type });
      } else if (data.candidate) {
        // This is an ICE candidate - send separately
        socket.emit('iceCandidate', { userToCall: id, candidate: data, from: me });
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

    socket.once('callAccepted', (signal) => {
      try {
        peer.signal(signal);
        setCallAccepted(true);
        setIsCalling(false); // Stop ringing when call is accepted
      } catch (err) {
        console.warn('Error signaling callAccepted:', err.message);
      }
    });

    // Handle ICE restart offer from mobile app (when connection fails)
    socket.on('iceRestartOffer', (data) => {
      console.log('🔄 [Web] Received ICE restart offer from mobile');
      try {
        if (peer && peer.signal) {
          peer.signal(data.signal);
          console.log('✅ [Web] ICE restart offer processed');
        } else {
          console.warn('⚠️ [Web] Peer not available for ICE restart');
        }
      } catch (err) {
        console.error('❌ [Web] Error processing ICE restart offer:', err);
      }
    });

    // Handle ICE candidates from mobile app (now that we use trickle: true)
    socket.on('iceCandidate', ({ candidate, from }) => {
      console.log('🧊 [Web] Received ICE candidate from mobile:', from);
      if (peer && candidate) {
        try {
          // With trickle: true, simple-peer expects ICE candidates via signal()
          peer.signal(candidate);
          console.log('✅ [Web] ICE candidate added to peer');
        } catch (err) {
          console.warn('⚠️ [Web] Error adding ICE candidate:', err);
        }
      }
    });

    connectionRef.current = peer;
  };

  // Answer an incoming call
  const answerCall = async () => {
    cleanupPeer();
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
      setStream(currentStream);
    }
    
    // Ensure both users are marked as busy when call is answered
    if (call.from) {
      setBusyUsers(prev => {
        const newSet = new Set(prev);
        newSet.add(call.from);
        newSet.add(me);
        return newSet;
      });
    }
    
    // Use trickle: true to support mobile app (which uses trickle: true)
    // This allows separate ICE candidate events, which is needed for NAT traversal
    const peer = new Peer({ initiator: false, trickle: true, stream: currentStream });
    peerRef.current = peer;

    peer.on('signal', (data) => {
      // With trickle: true, signal events include both SDP and ICE candidates
      // Check if this is an SDP (offer/answer) or an ICE candidate
      if (data.type === 'answer') {
        // This is the SDP answer
        socket.emit('answerCall', { signal: data, to: call.from });
      } else if (data.candidate) {
        // This is an ICE candidate - send separately
        socket.emit('iceCandidate', { userToCall: call.from, candidate: data, from: me });
      }
    });

    // Handle ICE restart offer from mobile app (when connection fails)
    socket.on('iceRestartOffer', (data) => {
      console.log('🔄 [Web] Received ICE restart offer from mobile (in answerCall)');
      try {
        if (peer && peer.signal) {
          peer.signal(data.signal);
          console.log('✅ [Web] ICE restart offer processed (in answerCall)');
        } else {
          console.warn('⚠️ [Web] Peer not available for ICE restart (in answerCall)');
        }
      } catch (err) {
        console.error('❌ [Web] Error processing ICE restart offer (in answerCall):', err);
      }
    });

    // Handle ICE candidates from mobile app (now that we use trickle: true)
    socket.on('iceCandidate', ({ candidate, from }) => {
      console.log('🧊 [Web] Received ICE candidate from mobile (in answerCall):', from);
      if (peer && candidate) {
        try {
          // With trickle: true, simple-peer expects ICE candidates via signal()
          peer.signal(candidate);
          console.log('✅ [Web] ICE candidate added to peer (in answerCall)');
        } catch (err) {
          console.warn('⚠️ [Web] Error adding ICE candidate (in answerCall):', err);
        }
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
      try {
        peer.signal(call.signal);
      } catch (err) {
        console.warn('Error signaling answerCall:', err.message);
      }
    }

    connectionRef.current = peer;
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
        conversationId: isReceiving ? from : userToCall,
        sender: user._id,
      });
    }
    
    // Clear busy state for both users
    if (from || userToCall) {
      setBusyUsers(prev => {
        const newSet = new Set(prev);
        if (from) newSet.delete(from);
        if (userToCall) newSet.delete(userToCall);
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
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
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
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};
