
import{createContext,useEffect,useState,useContext,useRef} from 'react'
import io from 'socket.io-client'
import Peer from 'simple-peer'
import{UserContext} from './UserContext'

export const SocketContext = createContext()

export const SocketContextProvider = ({children}) => {

    const[socket,setSocket]=useState(null)
   
    const{user}=useContext(UserContext)
    
    const[onlineUser,setOnlineUser]=useState([])

    // WebRTC state
    const [callAccepted, setCallAccepted] = useState(false)
    const [callEnded, setCallEnded] = useState(false)
    const [stream, setStream] = useState(null)
    const [call, setCall] = useState({})
    const myVideo = useRef()
    const userVideo = useRef()
    const connectionRef = useRef()
    const peerRef = useRef()

    // Get user media (camera and microphone)
    const getMediaStream = async () => {
        try {
            const currentStream = await navigator.mediaDevices.getUserMedia({ 
                video: true, 
                audio: true 
            })
            
            // Unmute audio tracks explicitly
            currentStream.getAudioTracks().forEach(track => {
                if (!track.enabled) track.enabled = true
            })

            setStream(currentStream)
            console.log("Media stream obtained")
        } catch (error) {
            console.error('Error getting media stream:', error)
        }
    }

    // Get media stream on mount
    useEffect(() => {
        getMediaStream()
    }, [])

    // Assign stream to myVideo when stream changes
    useEffect(() => {
        if (myVideo.current && stream) {
            myVideo.current.srcObject = stream
            console.log('Assigned stream to myVideo')
        }
    }, [stream])

    useEffect(() => {
        // Use current origin for production, or localhost for development
        const socketUrl = import.meta.env.PROD 
            ? window.location.origin 
            : "http://localhost:5000"
        
        if (!user?._id) return

        const newSocket = io(socketUrl,{
            query:{
                userId:user._id
            }
        })
        
        setSocket(newSocket)
      
        newSocket.on("getOnlineUser",(users) => {
            setOnlineUser(users)
        })

        // Handle incoming call
        const handleCallUser = ({ signal, from, name, userToCall }) => {
            setCall({ isReceivingCall: true, from, name, signal, userToCall })
        }

        newSocket.on("callUser", handleCallUser)

        return () => {
            newSocket.off("callUser", handleCallUser)
            newSocket.close()
            if (stream) {
                stream.getTracks().forEach(track => track.stop())
            }
        }
   
    },[user?._id])

    // Clean up peer connections
    const cleanupPeer = () => {
        if (connectionRef.current) {
            connectionRef.current.destroy()
            connectionRef.current = null
        }
        if (peerRef.current) {
            peerRef.current.destroy()
            peerRef.current = null
        }
        if (userVideo.current) {
            userVideo.current.srcObject = null
        }
    }

    // Handle call canceled
    useEffect(() => {
        if (!socket) return

        const handleCallCanceled = () => {
            setCall({})
            setCallAccepted(false)
            setCallEnded(true)
            cleanupPeer()
            getMediaStream()
        }

        socket.on("CallCanceled", handleCallCanceled)

        return () => {
            socket.off("CallCanceled", handleCallCanceled)
        }
    }, [socket])

    // Call a user
    const callUser = (id) => {
        cleanupPeer()
        setCallAccepted(false)
        setCallEnded(false)

        if (!stream) {
            console.error("No stream available")
            return
        }

        const peer = new Peer({ 
            initiator: true, 
            trickle: false, 
            stream 
        })
        
        peerRef.current = peer

        peer.on('signal', (data) => {
            socket.emit('callUser', { 
                userToCall: id, 
                signalData: data, 
                from: user._id, 
                name: user.name || user.username 
            })
        })

        peer.on('stream', (currentStream) => {
            if (userVideo.current) {
                userVideo.current.srcObject = currentStream
            }
        })

        socket.once('callAccepted', (signal) => {
            try {
                peer.signal(signal)
                setCallAccepted(true)
            } catch (err) {
                console.warn('Error signaling callAccepted:', err.message)
            }
        })

        connectionRef.current = peer
    }

    // Answer a call
    const answerCall = () => {
        cleanupPeer()
        setCallAccepted(true)
        setCallEnded(false)

        if (!stream) {
            console.error("No stream available")
            return
        }

        const peer = new Peer({ 
            initiator: false, 
            trickle: false, 
            stream 
        })
        
        peerRef.current = peer

        peer.on('signal', (data) => {
            socket.emit('answerCall', { 
                signal: data, 
                to: call.from 
            })
        })

        peer.on('stream', (currentStream) => {
            if (userVideo.current) {
                userVideo.current.srcObject = currentStream
            }
        })

        if (call.signal) {
            try {
                peer.signal(call.signal)
            } catch (err) {
                console.warn('Error signaling answerCall:', err.message)
            }
        }

        connectionRef.current = peer
    }

    // Leave/End call
    const leaveCall = () => {
        setCallEnded(true)
        setCallAccepted(false)
        setCall({})
        cleanupPeer()

        // Stop all tracks from the current stream
        if (stream) {
            stream.getTracks().forEach(track => track.stop())
        }

        // Re-request fresh stream
        setTimeout(() => {
            getMediaStream()
        }, 500)

        if (socket && (call.from || call.userToCall)) {
            socket.emit('cancelCall', {
                conversationId: call.userToCall || call.from,
                sender: user._id
            })
        }
    }

    return <SocketContext.Provider value={{
        socket,
        onlineUser,
        call,
        callAccepted,
        callEnded,
        stream,
        myVideo,
        userVideo,
        callUser,
        answerCall,
        leaveCall
    }}>
        {children}
    </SocketContext.Provider>
}