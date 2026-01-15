# How to Set Up TURN Servers

## Quick Options

### Option 1: Free Public TURN Server (Testing Only)

⚠️ **Warning:** Free TURN servers are unreliable and slow. Use only for testing.

**Metered.ca (Free Tier):**
- Sign up at: https://www.metered.ca/stun-turn
- Get free TURN server credentials
- Limited bandwidth but good for testing

**Xirsys (Free Trial):**
- Sign up at: https://xirsys.com/
- Free trial available
- Good for testing

### Option 2: Use Your Own Server (Recommended for Production)

#### Step 1: Install coturn (Linux/Ubuntu)

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install coturn

# Or build from source
git clone https://github.com/coturn/coturn.git
cd coturn
./configure
make
sudo make install
```

#### Step 2: Configure coturn

Edit `/etc/turnserver.conf`:

```conf
# Listening port
listening-port=3478

# TLS listening port (optional, for secure TURN)
tls-listening-port=5349

# Realm (your domain)
realm=yourdomain.com

# User credentials (username:password)
user=your-username:your-password

# Or use static auth secret (more secure)
static-auth-secret=your-secret-key

# Log file
log-file=/var/log/turn.log

# Enable fingerprinting
fingerprint

# Enable long-term credentials
lt-cred-mech

# External IP (your server's public IP)
external-ip=YOUR_SERVER_PUBLIC_IP

# Relay IP range (optional)
relay-ip=0.0.0.0

# No CLI
no-cli

# No TLS (if you don't have SSL certificate)
no-tls
no-dtls
```

#### Step 3: Start coturn

```bash
# Start coturn service
sudo systemctl start coturn
sudo systemctl enable coturn

# Check if it's running
sudo systemctl status coturn
```

#### Step 4: Open Firewall Ports

```bash
# Allow TURN server ports
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 49152:65535/udp  # TURN relay port range
```

### Option 3: Use Twilio TURN Service (Paid, Reliable)

1. Sign up at: https://www.twilio.com/
2. Go to "Programmable Voice" → "TURN Credentials"
3. Get your TURN server URL and credentials
4. Use in your code (see below)

## How to Add TURN Server to Your Code

### For Mobile App (React Native)

Edit `D:\appthread\AwesomeProject\src\context\WebRTCContext.tsx`:

```typescript
const configuration = {
  iceServers: [
    // STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
    
    // TURN server (add this)
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'your-username',
      credential: 'your-password'
    },
    // Or if using static auth secret:
    // {
    //   urls: 'turn:your-turn-server.com:3478?transport=tcp',
    //   username: 'your-username',
    //   credential: 'your-password'
    // }
  ],
  iceCandidatePoolSize: 10,
};
```

### For Web Frontend (Simple-Peer)

Simple-peer automatically uses the browser's WebRTC configuration, but you can also configure it:

```javascript
// In your web frontend, if using native WebRTC (not simple-peer)
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'your-username',
      credential: 'your-password'
    }
  ]
};

const peerConnection = new RTCPeerConnection(configuration);
```

**Note:** Simple-peer uses the browser's default WebRTC configuration, so TURN servers set in the mobile app should work, but for best results, configure TURN on both sides.

## Testing Your TURN Server

### Method 1: Official WebRTC Tool

1. Go to: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
2. Enter your TURN server details:
   - STUN/TURN URI: `turn:your-turn-server.com:3478`
   - Username: `your-username`
   - Password: `your-password`
3. Click "Add Server" then "Gather candidates"
4. Look for candidates with `typ relay` - these are TURN candidates
5. If you see relay candidates, your TURN server is working!

### Method 2: Test from Command Line

```bash
# Test STUN
turnutils_stunclient your-turn-server.com

# Test TURN
turnutils_uclient -u your-username -w your-password your-turn-server.com
```

## Quick Setup Example (Metered.ca Free Tier)

1. **Sign up:** https://www.metered.ca/stun-turn
2. **Get credentials:**
   - TURN Server: `turn:openrelay.metered.ca:80`
   - Username: (provided)
   - Password: (provided)

3. **Add to mobile app:**
```typescript
{
  urls: 'turn:openrelay.metered.ca:80',
  username: 'your-metered-username',
  credential: 'your-metered-password'
}
```

## Production Setup (coturn on Your Server)

### Full coturn Configuration Example

```conf
# /etc/turnserver.conf

# Network
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
external-ip=YOUR_PUBLIC_IP

# Authentication
realm=yourdomain.com
user=username:password
# OR use static-auth-secret (more secure)
# static-auth-secret=your-secret-key

# Security
fingerprint
lt-cred-mech
stun-only

# Logging
log-file=/var/log/turn.log
verbose

# Performance
no-cli
no-tls
no-dtls
```

### Start and Test

```bash
# Start coturn
sudo systemctl start coturn

# Check logs
sudo tail -f /var/log/turn.log

# Test
turnutils_stunclient YOUR_PUBLIC_IP
```

## Important Notes

1. **Security:** Never commit TURN server credentials to git
2. **Environment Variables:** Store credentials in environment variables
3. **Multiple TURN Servers:** You can add multiple TURN servers for redundancy
4. **TCP vs UDP:** Some networks block UDP, so also provide TCP TURN:
   ```typescript
   {
     urls: 'turn:your-server.com:3478?transport=tcp',
     username: 'username',
     credential: 'password'
   }
   ```

## Environment Variables Setup

### Mobile App (.env file)

```env
TURN_SERVER_URL=turn:your-server.com:3478
TURN_USERNAME=your-username
TURN_PASSWORD=your-password
```

### In Code:

```typescript
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: process.env.TURN_SERVER_URL || 'turn:your-server.com:3478',
      username: process.env.TURN_USERNAME || 'your-username',
      credential: process.env.TURN_PASSWORD || 'your-password'
    }
  ],
};
```

## Next Steps

1. **For Quick Testing:** Use Metered.ca free tier
2. **For Production:** Set up your own coturn server
3. **Add to Code:** Update the configuration in WebRTCContext.tsx
4. **Test:** Use the WebRTC trickle-ice tool
5. **Deploy:** Make sure firewall ports are open
