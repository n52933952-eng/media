# TURN Server Setup Guide

## Why TURN Servers Are Critical

From the official react-native-webrtc documentation:

> **"If you don't use a TURN server then the connection will just outright fail."**

### The Problem:
- STUN servers only discover your public IP
- They can't help when devices are behind restrictive NATs/firewalls
- Direct peer-to-peer connections fail
- **Result: Connection state goes to "failed"**

### The Solution:
- TURN servers relay traffic when direct connection fails
- Required for production reliability
- Especially important for web-to-mobile calls across different networks

## Current Status

**Your Implementation:**
- ✅ STUN servers configured (6 servers)
- ❌ TURN servers missing
- **This is why connections are failing!**

## Options for TURN Servers

### Option 1: Free TURN Servers (Testing Only)
⚠️ **Warning:** Free TURN servers are slow, restrictive, or unreliable. Not recommended for production.

### Option 2: Host Your Own (Recommended for Production)

#### Using coturn (Recommended)
```bash
# Install coturn
sudo apt-get install coturn

# Configure /etc/turnserver.conf
listening-port=3478
fingerprint
lt-cred-mech
user=username:password
realm=yourdomain.com
```

#### Using eturnal
- Modern, easy to set up
- See: https://eturnal.net/

### Option 3: Commercial TURN Services
- Twilio (has TURN service)
- Metered.ca
- Xirsys

## How to Add TURN Server to Your Code

Once you have a TURN server, add it to the configuration:

```typescript
const configuration = {
  iceServers: [
    // STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    // ... other STUN servers ...
    
    // TURN server (add this)
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'your-username',
      credential: 'your-password'
    }
  ],
  iceCandidatePoolSize: 10,
};
```

## Testing TURN Servers

Use the official WebRTC tool:
https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

1. Enter your TURN server details
2. Click "Gather candidates"
3. Look for `typ relay` candidates (these are TURN candidates)
4. If you see relay candidates, your TURN server is working!

## Quick Test (Without TURN)

For now, test with both devices on the **same WiFi network**:
- This might work with just STUN servers
- But production will need TURN servers

## Next Steps

1. **For Testing:** Try same-network calls first
2. **For Production:** Set up a TURN server (coturn recommended)
3. **Add TURN to config:** Once you have TURN server credentials

## Why This Matters

Your current connection failures (`State changed to: failed`) are likely because:
- Web and mobile are on different networks
- NAT traversal fails without TURN
- No relay path available

**Adding TURN servers should fix the connection failures!**
