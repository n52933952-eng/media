
import { createContext, useEffect, useState, useContext, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import { useToast } from '@chakra-ui/react';
import { UserContext } from './UserContext';
import ringTone from '../assets/ring.mp3'; // Import ring tone
import messageSound from '../assets/frontend_src_assets_sounds_message.mp3'; // Import message notification sound

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

  const myVideo = useRef();
  const userVideo = useRef();
  const connectionRef = useRef();
  const peerRef = useRef();
  const ringtoneAudio = useRef(new Audio(ringTone)); // Audio for incoming call ringtone
  const messageSoundAudio = useRef(new Audio(messageSound)); // Audio for new unread message notification

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

    setSocket(newSocket);
    setMe(user._id);

    newSocket?.on('getOnlineUser', (users) => setOnlineUser(users));

    // Listen for unread count updates
    newSocket?.on('unreadCountUpdate', ({ totalUnread }) => {
      setTotalUnreadCount(totalUnread || 0);
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
      
      // Play sound only for unread messages from other users
      if (!isFromCurrentUser && messageSoundAudio.current) {
        messageSoundAudio.current.currentTime = 0; // Reset to start
        messageSoundAudio.current.play().catch(err => {
          console.log('Message sound play error (browser may require user interaction):', err);
        });
      }
    });

    // Fetch initial unread count
    const fetchInitialUnreadCount = async () => {
      if (!user?._id) {
        setTotalUnreadCount(0);
        return;
      }
      try {
        const socketUrl = import.meta.env.PROD 
          ? window.location.origin 
          : "http://localhost:5000";
        const res = await fetch(`${socketUrl}/api/message/conversations?limit=1`, {
          credentials: 'include',
        });
        const data = await res.json();
        if (res.ok) {
          const conversations = data.conversations || data || [];
          const total = conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
          setTotalUnreadCount(total);
        }
      } catch (error) {
        console.log('Error fetching initial unread count:', error);
      }
    };
    fetchInitialUnreadCount();

    return () => {
      newSocket?.off('unreadCountUpdate');
      newSocket?.off('newMessage');
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
          ringtoneAudio.current.loop = true; // Loop until answered/declined
          ringtoneAudio.current.play().catch(err => {
            console.log('Ringtone play error (browser may require user interaction):', err);
          });
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

    const peer = new Peer({ initiator: true, trickle: false, stream: currentStream });
    peerRef.current = peer;

    peer.on('signal', (data) => {
      socket.emit('callUser', { userToCall: id, signalData: data, from: me, name: user.username, callType: type });
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
    
    const peer = new Peer({ initiator: false, trickle: false, stream: currentStream });
    peerRef.current = peer;

    peer.on('signal', (data) => {
      socket.emit('answerCall', { signal: data, to: call.from });
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
        busyUsers, // Export busyUsers so components can check if a user is busy
        totalUnreadCount, // Export total unread message count
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};
