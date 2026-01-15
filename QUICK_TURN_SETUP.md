# Quick TURN Server Setup Guide

## 🚀 Quick Start (Free Testing)

### Option 1: Metered.ca (Free Tier - Good for Testing)

1. **Sign up:** https://www.metered.ca/stun-turn
2. **Get your credentials** (they provide instantly)
3. **Add to your code** (see below)

### Option 2: Xirsys (Free Trial)

1. **Sign up:** https://xirsys.com/
2. **Get credentials from dashboard**
3. **Add to your code**

---

## 📝 How to Add TURN Server to Your Code

### Step 1: Get TURN Server Credentials

**Metered.ca Example:**
- Server: `turn:openrelay.metered.ca:80`
- Username: (provided in dashboard)
- Password: (provided in dashboard)

### Step 2: Update Mobile App Configuration

Edit: `D:\appthread\AwesomeProject\src\context\WebRTCContext.tsx`

**Replace the configuration section with:**

```typescript
// ICE servers configuration (STUN + TURN servers for NAT traversal)
const configuration = {
  iceServers: [
    // STUN servers (for discovering public IP)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
    
    // TURN server (REPLACE WITH YOUR CREDENTIALS)
    {
      urls: [
        'turn:openrelay.metered.ca:80',           // UDP
        'turn:openrelay.metered.ca:443',          // TCP
        'turn:openrelay.metered.ca:80?transport=tcp',  // TCP explicit
      ],
      username: 'YOUR_METERED_USERNAME',          // Replace this
      credential: 'YOUR_METERED_PASSWORD'        // Replace this
    }
  ],
  iceCandidatePoolSize: 10,
};
```

### Step 3: Test Your TURN Server

1. **Go to:** https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
2. **Add your TURN server:**
   - STUN/TURN URI: `turn:openrelay.metered.ca:80`
   - Username: (your username)
   - Password: (your password)
3. **Click "Gather candidates"**
4. **Look for `typ relay` candidates** - if you see these, TURN is working!

---

## 🏭 Production Setup (Your Own Server)

### Step 1: Install coturn on Your Server

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install coturn
```

### Step 2: Configure coturn

Edit `/etc/turnserver.conf`:

```conf
# Basic configuration
listening-port=3478
external-ip=YOUR_SERVER_PUBLIC_IP
realm=yourdomain.com

# Authentication (choose one method)

# Method 1: Static user/password
user=myusername:mypassword

# Method 2: Static auth secret (more secure)
# static-auth-secret=your-secret-key-here

# Security
fingerprint
lt-cred-mech

# Logging
log-file=/var/log/turn.log
verbose
```

### Step 3: Start coturn

```bash
sudo systemctl start coturn
sudo systemctl enable coturn
```

### Step 4: Open Firewall Ports

```bash
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 49152:65535/udp  # TURN relay ports
```

### Step 5: Add to Your Code

```typescript
{
  urls: 'turn:your-server-ip:3478',
  username: 'myusername',
  credential: 'mypassword'
}
```

---

## 🔒 Security Best Practices

### Use Environment Variables

**Create `.env` file:**
```env
TURN_SERVER_URL=turn:your-server.com:3478
TURN_USERNAME=your-username
TURN_PASSWORD=your-password
```

**In code:**
```typescript
{
  urls: process.env.TURN_SERVER_URL,
  username: process.env.TURN_USERNAME,
  credential: process.env.TURN_PASSWORD
}
```

**Add to `.gitignore`:**
```
.env
```

---

## ✅ Testing Checklist

- [ ] TURN server credentials obtained
- [ ] Added to mobile app configuration
- [ ] Tested with WebRTC trickle-ice tool
- [ ] See `typ relay` candidates in test
- [ ] Test web-to-mobile call
- [ ] Connection should now succeed!

---

## 🐛 Troubleshooting

### No relay candidates in test?
- Check TURN server is running
- Verify credentials are correct
- Check firewall ports are open
- Try TCP transport: `turn:server.com:3478?transport=tcp`

### Connection still fails?
- Make sure TURN server is accessible from both devices
- Check TURN server logs: `sudo tail -f /var/log/turn.log`
- Verify ICE candidates include relay type

---

## 📚 Resources

- **coturn GitHub:** https://github.com/coturn/coturn
- **Metered.ca:** https://www.metered.ca/stun-turn
- **Trickle ICE Test:** https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
- **Official TURN Guide:** https://webrtc.org/getting-started/turn-server
