# WebRTC Flow: Web to React Native Mobile

This document describes the complete WebRTC signaling flow between web browser and React Native mobile app.

## Architecture Overview

1. **Signaling Server**: Socket.IO backend (`D:\thredtrain\backend\socket\socket.js`)
2. **Web Client**: React app using `simple-peer` library (`D:\thredtrain\frontent\src\context\SocketContext.jsx`)
3. **Mobile Client**: React Native app using `react-native-webrtc` (`D:\appthread\AwesomeProject\src\context\WebRTCContext.tsx`)

## Standard WebRTC Flow (Both Clients)

### Step 1: User Presence & Login
- Both clients connect to Socket.IO server with `userId` as query parameter
- Server stores socket connection in Redis for scalability
- Clients register presence for online/offline detection

### Step 2: Get Local Media
- **Web**: Uses browser `getUserMedia()` via `simple-peer`
- **Mobile**: Uses `react-native-webrtc` `mediaDevices.getUserMedia()`
- Both capture audio/video streams before initiating calls

### Step 3: Initiate Call (Offer/Answer Model)

#### Web Initiates Call:
1. **Web creates Peer connection** (`simple-peer` with `trickle: true`)
   ```javascript
   const peer = new Peer({ initiator: true, trickle: true, stream: currentStream });
   ```

2. **Web's peer emits 'signal' event** (SDP offer)
   - Web emits `callUser` event via Socket.IO:
   ```javascript
   socket.emit('callUser', { 
     userToCall: id, 
     signalData: data, // SDP offer
     from: me, 
     name: user.username, 
     callType: type 
   });
   ```

3. **Backend receives `callUser` event**
   - Checks if receiver is online/offline
   - If **online**: Emits `callUser` event to receiver's socket
   - If **offline**: Sends push notification and stores pending call in Redis

4. **Mobile receives `callUser` event**
   - Extracts SDP offer from `data.signal`
   - Sets remote description: `pc.setRemoteDescription(offer)`
   - Creates answer: `pc.createAnswer()`
   - Sends answer via `answerCall` event:
   ```typescript
   socket.emit('answerCall', { 
     signal: answer, // SDP answer
     to: call.from 
   });
   ```

5. **Backend forwards answer to web**
   - Backend emits `callAccepted` event to web caller

6. **Web receives answer**
   - Web's peer processes answer: `peer.signal(answer)`
   - Connection negotiation continues

### Step 4: ICE Candidate Exchange

**IMPORTANT**: Both clients now use `trickle: true` for compatibility!

#### Web sends ICE candidates:
1. Web's peer emits 'signal' for each ICE candidate:
   ```javascript
   if (data.candidate) {
     socket.emit('iceCandidate', { 
       userToCall: id, 
       candidate: data, 
       from: me 
     });
   }
   ```

2. Backend forwards to mobile:
   ```javascript
   io.to(receiverSocketId).emit("iceCandidate", { candidate, from });
   ```

3. Mobile receives and adds:
   ```typescript
   socket.on('iceCandidate', async (data) => {
     await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
   });
   ```

#### Mobile sends ICE candidates:
1. Mobile's peer connection emits `onicecandidate`:
   ```typescript
   pc.onicecandidate = (event) => {
     if (event.candidate) {
       socket.emit('iceCandidate', {
         userToCall: remoteUserIdRef.current,
         candidate: event.candidate,
         from: user._id,
       });
     }
   };
   ```

2. Backend forwards to web:
   ```javascript
   io.to(receiverSocketId).emit("iceCandidate", { candidate, from });
   ```

3. Web receives and processes:
   ```javascript
   socket.on('iceCandidate', ({ candidate, from }) => {
     peer.signal(candidate); // simple-peer processes ICE candidate
   });
   ```

### Step 5: Connection Establishment
- Both peers exchange ICE candidates
- WebRTC finds best network path (STUN/TURN servers)
- Connection state changes: `connecting` → `connected`
- Media streams flow directly between peers (peer-to-peer)

### Step 6: ICE Restart (Connection Failure Recovery)

If connection fails, mobile initiates ICE restart:

1. **Mobile detects failure**:
   ```typescript
   if (pc.connectionState === 'failed' && !iceRestartAttempted) {
     const offer = await pc.createOffer({ iceRestart: true });
     await pc.setLocalDescription(offer);
     socket.emit('iceRestartOffer', { to: remoteUserId, signal: offer });
   }
   ```

2. **Backend forwards ICE restart offer**:
   ```javascript
   io.to(receiverSocketId).emit("iceRestartOffer", { signal, from });
   ```

3. **Web processes restart**:
   ```javascript
   socket.on('iceRestartOffer', (data) => {
     peer.signal(data.signal); // simple-peer processes restart offer
   });
   ```

## Key Implementation Details

### Why `trickle: true`?
- **Web-to-Mobile**: Both use `trickle: true` for separate ICE candidate events
- **Web-to-Web**: Also works with `trickle: true` (backward compatible)
- **Mobile-to-Mobile**: Uses `trickle: true` (react-native-webrtc default)

### Event Names (Socket.IO):
- `callUser` - Initiate call (contains SDP offer)
- `answerCall` - Accept call (contains SDP answer)
- `iceCandidate` - Exchange ICE candidates
- `iceRestartOffer` - ICE restart (connection recovery)
- `cancelCall` - Cancel/decline call
- `callEnded` - Call terminated
- `callBusyError` - User is busy

### Backend Scalability:
- Uses Redis for socket storage (O(1) lookup)
- Stores pending calls indexed by receiverId
- Automatically re-sends calls when offline users come online

## Testing Checklist

- [ ] Web initiates call → Mobile receives notification
- [ ] Mobile answers → Web receives answer
- [ ] ICE candidates exchange (check logs)
- [ ] Connection establishes (`connected` state)
- [ ] Audio/video streams work
- [ ] ICE restart works on connection failure
- [ ] Call cancellation works
- [ ] Offline user receives notification and can join call

## Troubleshooting

### Connection Fails:
1. Check if ICE candidates are being exchanged (logs should show `🧊 [ICE]`)
2. Verify both devices on same network OR TURN servers configured
3. Check firewall blocking UDP ports (49152-65535)
4. Verify STUN/TURN servers in WebRTC configuration

### No Audio/Video:
1. Check permissions (microphone/camera)
2. Verify media streams are added to peer connection
3. Check `InCallManager` is started (mobile)
4. Verify audio routing settings

### Mobile Not Receiving Calls:
1. Check socket connection status
2. Verify `callUser` listener is set up
3. Check backend logs for event emission
4. Verify push notification is received
