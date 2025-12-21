


import{createContext,useEffect,useState,useContext,useRef} from 'react'
import io from 'socket.io-client'
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

    useEffect(() => {
        // Use current origin for production, or localhost for development
        const socketUrl = import.meta.env.PROD 
            ? window.location.origin 
            : "http://localhost:5000"
        
        const socket = io(socketUrl,{
            query:{
                userId:user?._id
            }
        })
        setSocket(socket)
       
      
        socket.on("getOnlineUser",(users) => {
        setOnlineUser(users)
        })

        // Handle incoming call
        socket.on("callUser", ({ signal, from, name, userToCall }) => {
            setCall({ isReceivingCall: true, from, name, signal, userToCall })
        })

        // Handle call accepted
        socket.on("callAccepted", async (signal) => {
            setCallAccepted(true)
            
            if (connectionRef.current && signal) {
                try {
                    await connectionRef.current.setRemoteDescription(new RTCSessionDescription(signal))
                    console.log("Remote description set successfully")
                } catch (err) {
                    console.error("Error setting remote description:", err)
                }
            }
        })

        // Handle ICE candidate (for both caller and receiver)
        socket.on("iceCandidate", async ({ candidate }) => {
            if (connectionRef.current && candidate && connectionRef.current.remoteDescription) {
                try {
                    await connectionRef.current.addIceCandidate(new RTCIceCandidate(candidate))
                    console.log("ICE candidate added successfully")
                } catch (err) {
                    console.error("Error adding ICE candidate:", err)
                }
            }
        })

        // Handle call canceled
        socket.on("CallCanceled", () => {
            setCall({})
            setCallAccepted(false)
            setCallEnded(true)
            if (stream) {
                stream.getTracks().forEach(track => track.stop())
            }
        })
    
        return () => {
            socket && socket.close()
            if (stream) {
                stream.getTracks().forEach(track => track.stop())
            }
        }
   
    },[user?._id])

   console.log(user)
    // Call a user
    const callUser = async (id) => {
        const currentStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        })
        setStream(currentStream)
        if (myVideo.current) {
            myVideo.current.srcObject = currentStream
        }
        
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        })

        connectionRef.current = peerConnection

        // Add local stream to peer connection
        currentStream.getTracks().forEach((track) => {
            peerConnection.addTrack(track, currentStream)
        })

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && socket) {
                socket.emit("iceCandidate", {
                    userToCall: id,
                    candidate: event.candidate,
                    from: user._id
                })
            }
        }

        // Handle remote stream
        peerConnection.ontrack = (event) => {
            console.log("Received remote track", event.streams)
            if (userVideo.current && event.streams[0]) {
                userVideo.current.srcObject = event.streams[0]
                console.log("Remote video stream set")
            }
        }

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log("Connection state:", peerConnection.connectionState)
        }

        // Create offer
        const offer = await peerConnection.createOffer()
        await peerConnection.setLocalDescription(offer)

        if (socket) {
            socket.emit("callUser", {
                userToCall: id,
                signalData: offer,
                from: user._id,
                name: user.name || user.username
            })
        }
    }

    // Answer a call
    const answerCall = async () => {
        setCallAccepted(true)
        const currentStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        })
        setStream(currentStream)
        if (myVideo.current) {
            myVideo.current.srcObject = currentStream
        }

        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        })

        connectionRef.current = peerConnection

        // Add local stream to peer connection
        currentStream.getTracks().forEach((track) => {
            peerConnection.addTrack(track, currentStream)
        })

        // Handle ICE candidates - wait until remote description is set
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && socket && peerConnection.remoteDescription) {
                socket.emit("iceCandidate", {
                    userToCall: call.from,
                    candidate: event.candidate,
                    from: user._id
                })
            }
        }

        // Handle remote stream
        peerConnection.ontrack = (event) => {
            console.log("Received remote track", event.streams)
            if (userVideo.current && event.streams[0]) {
                userVideo.current.srcObject = event.streams[0]
                console.log("Remote video stream set")
            }
        }

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log("Connection state:", peerConnection.connectionState)
        }

        // Set remote description and create answer
        let answer = null
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(call.signal))
            answer = await peerConnection.createAnswer()
            await peerConnection.setLocalDescription(answer)
            console.log("Answer created and set as local description")
        } catch (err) {
            console.error("Error creating answer:", err)
            return
        }

        if (socket && answer) {
            socket.emit("answerCall", {
                signal: answer,
                to: call.from
            })
        }
    }

    // Leave/End call
    const leaveCall = () => {
        setCallEnded(true)
        setCallAccepted(false)
        
        if (connectionRef.current) {
            connectionRef.current.close()
            connectionRef.current = null
        }

        if (stream) {
            stream.getTracks().forEach(track => track.stop())
            setStream(null)
        }

        socket.emit("cancelCall", {
            conversationId: call.userToCall || call.from,
            sender: user._id
        })

        setCall({})
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