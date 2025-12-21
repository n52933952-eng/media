
import { createContext, useEffect, useState, useContext, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import { UserContext } from './UserContext';

export const SocketContext = createContext();

export const SocketContextProvider = ({ children }) => {
  const { user } = useContext(UserContext);
  const [onlineUser, setOnlineUser] = useState([]);
  const [socket, setSocket] = useState(null);
  const [call, setCall] = useState({});
  const [callAccepted, setCallAccepted] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [stream, setStream] = useState();
  const [me, setMe] = useState('');

  const myVideo = useRef();
  const userVideo = useRef();
  const connectionRef = useRef();
  const peerRef = useRef();

  // Get user media and unmute audio track explicitly
  const getMediaStream = async () => {
    try {
      const currentStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      
      // Unmute audio tracks explicitly (enabled=true)
      currentStream.getAudioTracks().forEach(track => {
        if (!track.enabled) track.enabled = true;
      });

      setStream(currentStream);
      console.log("Media stream obtained");
    } catch (error) {
      console.error('Error getting media stream:', error);
    }
  };

  useEffect(() => {
    getMediaStream();
  }, []);

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

    return () => {
      newSocket.close();
    };
  }, [user]);

  useEffect(() => {
    if (!socket) return;

    const handleCallCanceled = () => {
      setCall({});
      setCallAccepted(false);
      setCallEnded(true);
      cleanupPeer();
      getMediaStream();
    };

    socket.on("CallCanceled", handleCallCanceled);

    return () => {
      socket.off("CallCanceled", handleCallCanceled);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    const handleCallcomming = ({ from, name: callerName, signal, userToCall }) => {
      setCall({ isReceivingCall: true, from, name: callerName, signal, userToCall });
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
  };

  const callUser = (id) => {
    cleanupPeer();
    setCallAccepted(false);
    setCallEnded(false);

    const peer = new Peer({ initiator: true, trickle: false, stream });
    peerRef.current = peer;

    peer.on('signal', (data) => {
      socket.emit('callUser', { userToCall: id, signalData: data, from: me, name: user.username });
    });

    peer.on('stream', (currentStream) => {
      if (userVideo.current) userVideo.current.srcObject = currentStream;
    });

    socket.once('callAccepted', (signal) => {
      try {
        peer.signal(signal);
        setCallAccepted(true);
      } catch (err) {
        console.warn('Error signaling callAccepted:', err.message);
      }
    });

    connectionRef.current = peer;
  };

  // Answer an incoming call
  const answerCall = () => {
    cleanupPeer();
    setCallAccepted(true);
    setCallEnded(false);
    const peer = new Peer({ initiator: false, trickle: false, stream });
    peerRef.current = peer;

    peer.on('signal', (data) => {
      socket.emit('answerCall', { signal: data, to: call.from });
    });

    peer.on('stream', (currentStream) => {
      if (userVideo.current) userVideo.current.srcObject = currentStream;
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
    setCallEnded(true);
    setCallAccepted(false);
    setCall({});
    cleanupPeer();

    // Stop all tracks from the current stream
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    // Re-request fresh stream with unmuted audio
    setTimeout(() => {
      getMediaStream();
    }, 500);

    if (socket && call && (call.from || call.userToCall)) {
      socket.emit('cancelCall', {
        conversationId: call.userToCall || call.from,
        sender: user._id,
      });
    }
  };

  return (
    <SocketContext.Provider
      value={{
        socket,
        call,
        callAccepted,
        callEnded,
        myVideo,
        userVideo,
        stream,
        me,
        callUser,
        answerCall,
        leaveCall,
        onlineUser,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};
