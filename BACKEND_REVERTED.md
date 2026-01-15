# Backend Reverted - Important Note

## ✅ Changes Made

Removed handlers that were added for web-to-mobile attempt:
- ❌ Removed `iceCandidate` handler (lines 724-731)
- ❌ Removed `iceRestartOffer` handler (lines 733-744)

## ⚠️ Important Warning

**The mobile app emits `iceCandidate` events** (required for mobile-to-mobile calls).

If mobile-to-mobile calls stop working after this revert, we need to add back the `iceCandidate` handler:

```javascript
// WebRTC: Handle ICE candidate (needed for mobile-to-mobile)
socket.on("iceCandidate", async ({ userToCall, candidate, from }) => {
    const receiverData = await getUserSocket(userToCall)
    const receiverSocketId = receiverData?.socketId
    if (receiverSocketId) {
        io.to(receiverSocketId).emit("iceCandidate", { candidate, from })
    }
})
```

**The `iceRestartOffer` handler can stay removed** - it was new and not needed for original functionality.

## 🧪 Testing Required

Please test:
1. ✅ Web-to-web calls (should work - no changes)
2. ⚠️ Mobile-to-mobile calls (may break - needs `iceCandidate` handler)

If mobile-to-mobile breaks, we'll add back only the `iceCandidate` handler (not `iceRestartOffer`).
