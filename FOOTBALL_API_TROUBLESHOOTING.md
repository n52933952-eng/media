# Football API - Troubleshooting Guide

Based on real-world debugging experience, here are the most common issues and how to fix them.

---

## 🔍 Issue #1: Cron Jobs Not Running

### Symptoms:
- No console logs from cron jobs
- Matches not updating automatically
- Only updates when manually triggering

### Debug Steps:

1. **Check if cron is initialized:**
   ```javascript
   // In backend/index.js - you should see:
   console.log("⚽ Initializing Football Cron Jobs (Socket.IO is ready)...")
   initializeFootballCron()
   console.log("✅ Football Cron Jobs initialized successfully")
   ```

2. **Check cron logs:**
   - Look for: `⚽ [CRON] Running live match update...`
   - Should see timestamp: `📅 Time: [timestamp] UTC`

3. **Verify timezone:**
   - Cron uses UTC timezone
   - If you're in Jordan (UTC+3), matches at 3 PM Jordan time = 12 PM UTC
   - Check your cron schedule matches UTC, not local time

### Fix:
```javascript
// Check what time it is in UTC
console.log('Current UTC time:', new Date().toISOString())

// Test cron by running every minute (temporarily)
cron.schedule('*/1 * * * *', async () => {
    console.log('🔄 CRON TEST RUNNING at:', new Date().toLocaleString('en-US', { timeZone: 'UTC' }), 'UTC')
    await fetchAndUpdateLiveMatches()
})
```

---

## 🔍 Issue #2: Socket.IO Not Emitting

### Symptoms:
- Backend logs show "Socket.IO not available"
- No socket events being broadcast
- Frontend not receiving updates

### Debug Steps:

1. **Check Socket.IO initialization:**
   ```javascript
   // In backend/index.js - Socket MUST be initialized BEFORE cron jobs
   initializeSocket(app).then((result) => {
       // ... server starts ...
       
       // ✅ CORRECT: Initialize cron AFTER socket is ready
       initializeFootballCron()
   })
   ```

2. **Check getIO() function:**
   ```javascript
   // In backend/socket/socket.js
   export const getIO = () => {
       if (!io) {
           throw new Error('Socket.IO not initialized! Make sure initializeSocket() is called first.')
       }
       return io
   }
   ```

3. **Add debug logs in emitFootballPageUpdate:**
   ```javascript
   const emitFootballPageUpdate = async () => {
       const io = getIO()
       if (!io) {
           console.log('❌ Socket.IO not available - socket not initialized!')
           return
       }
       
       const clientCount = io.engine?.clientsCount || 0
       console.log(`📡 Emitting to ${clientCount} connected clients`)
       
       io.emit('footballPageUpdate', data)
   }
   ```

### Fix:
- Make sure `initializeSocket()` is called BEFORE `initializeFootballCron()`
- Check that `getIO()` returns a valid socket instance
- Verify socket is actually initialized (check logs on server start)

---

## 🔍 Issue #3: Frontend Not Receiving Events

### Symptoms:
- Backend shows "Emitting to X clients" but frontend doesn't update
- Console shows no socket events received
- State not updating

### Debug Steps:

1. **Check socket connection:**
   ```javascript
   // In frontend - add connection listeners
   useEffect(() => {
       if (!socket) return
       
       socket.on('connect', () => {
           console.log('✅ Socket connected:', socket.id)
       })
       
       socket.on('disconnect', () => {
           console.log('❌ Socket disconnected')
       })
       
       socket.on('connect_error', (error) => {
           console.error('❌ Socket connection error:', error)
       })
   }, [socket])
   ```

2. **Check event listener:**
   ```javascript
   useEffect(() => {
       if (!socket) {
           console.log('⚠️ Socket not available')
           return
       }
       
       const handleUpdate = (data) => {
           console.log('📥 RECEIVED UPDATE:', {
               live: data.live?.length,
               upcoming: data.upcoming?.length,
               finished: data.finished?.length
           })
           
           // Update state
           setLiveMatches(data.live || [])
           setUpcomingMatches(data.upcoming || [])
           setFinishedMatches(data.finished || [])
       }
       
       socket.on('footballPageUpdate', handleUpdate)
       
       return () => {
           socket.off('footballPageUpdate', handleUpdate)
       }
   }, [socket])
   ```

3. **Verify event name matches:**
   - Backend emits: `io.emit('footballPageUpdate', data)`
   - Frontend listens: `socket.on('footballPageUpdate', handleUpdate)`
   - ✅ Event names must match exactly!

### Fix:
- Check socket is connected (look for "✅ Socket connected" in console)
- Verify event name matches exactly (case-sensitive!)
- Check Network tab → WS (WebSocket) connection is established
- Make sure you're not removing the listener too early

---

## 🔍 Issue #4: Cache Blocking Updates

### Problem:
- Cache is preventing fresh data from reaching users
- Updates only happen when cache expires
- Socket events not being emitted when using cached data

### Solution:
**Cache should ONLY affect API calls, NOT socket emissions!**

```javascript
const fetchAndUpdateLiveMatches = async () => {
    // Step 1: Check cache for API response (saves API calls)
    let apiMatches = getCachedLiveMatches()
    
    if (!apiMatches) {
        // Fetch from API if cache miss
        const result = await fetchFromAPI('/fixtures?live=all')
        apiMatches = result.data
        setCachedLiveMatches(apiMatches, 90) // Cache for 90 seconds
    } else {
        console.log('📦 Using cached API response (saving API call)')
    }
    
    // Step 2: ALWAYS update database (regardless of cache)
    // Process matches and update DB...
    
    // Step 3: ALWAYS emit socket event (regardless of cache)
    // ✅ This ensures users get updates even when using cached API data
    await emitFootballPageUpdate()
}
```

**Key Point:** Cache the API response, but ALWAYS emit socket events.

---

## 🔍 Issue #5: Database Not Updating

### Symptoms:
- Matches in database are stale
- Updates not saving to MongoDB
- Query returns old data

### Debug Steps:

1. **Check database connection:**
   ```javascript
   // Should see on server start:
   console.log("✅ MongoDB Connected with connection pooling")
   ```

2. **Add debug logs in update logic:**
   ```javascript
   const fetchAndUpdateLiveMatches = async () => {
       for (const matchData of filteredMatches) {
           const convertedMatch = convertMatchFormat(matchData)
           
           console.log('🔄 Updating match:', {
               fixtureId: convertedMatch.fixtureId,
               score: `${convertedMatch.goals.home}-${convertedMatch.goals.away}`,
               status: convertedMatch.fixture.status.short
           })
           
           const updatedMatch = await Match.findOneAndUpdate(
               { fixtureId: convertedMatch.fixtureId },
               convertedMatch,
               { upsert: true, new: true, runValidators: true }
           )
           
           console.log('✅ Match updated:', updatedMatch?.fixtureId)
       }
   }
   ```

3. **Check for errors:**
   ```javascript
   try {
       await Match.findOneAndUpdate(...)
   } catch (error) {
       console.error('❌ Database update error:', error)
       console.error('   Match data:', convertedMatch)
   }
   ```

### Fix:
- Check MongoDB connection string in `.env`
- Verify database indexes are created
- Check for validation errors in schema
- Make sure `upsert: true` is set (creates if doesn't exist)

---

## 🔍 Issue #6: Timezone Mismatch

### Problem:
- Cron runs at wrong times
- Matches missed during live hours
- Updates happening at wrong times

### Solution:

1. **All cron schedules use UTC:**
   ```javascript
   // ✅ CORRECT: Uses UTC (12:00-22:00 UTC)
   cron.schedule('*/1 12-22 * * 6,0', async () => {
       console.log('Time:', new Date().toLocaleString('en-US', { timeZone: 'UTC' }), 'UTC')
   })
   
   // ❌ WRONG: Don't use local timezone
   // Cron always runs in server timezone (usually UTC)
   ```

2. **Check your server timezone:**
   ```bash
   # Check server timezone
   date
   # Should show UTC or your configured timezone
   ```

3. **Adjust cron schedule for your timezone:**
   ```javascript
   // If you're in Jordan (UTC+3) and want matches at 3 PM - 11 PM Jordan time:
   // 3 PM Jordan = 12 PM UTC
   // 11 PM Jordan = 8 PM UTC
   cron.schedule('*/1 12-20 * * 6,0', async () => {
       // This runs 12:00-20:00 UTC = 3 PM - 11 PM Jordan time
   })
   ```

---

## 🔍 Issue #7: High API Usage

### Symptoms:
- API quota almost exhausted
- Rate limit errors
- Too many API calls per day

### Solution:

1. **Enable caching:**
   ```javascript
   // Cache live matches for 90 seconds (longer than cron interval)
   const CACHE_TTL = {
       LIVE_MATCHES: 90,  // 90 seconds
       MATCH_DETAILS: 300 // 5 minutes
   }
   ```

2. **Check cache is working:**
   ```javascript
   // Should see in logs:
   console.log('📦 Using cached API response (saving API call)')
   // NOT:
   console.log('📞 Fetching from API...') // (only on cache miss)
   ```

3. **Reduce cron frequency during off-hours:**
   ```javascript
   // Off-hours: Every 15 minutes (not every minute)
   cron.schedule('*/15 0-11,23 * * *', async () => {
       // Check less frequently when no matches expected
   })
   ```

4. **Use database-first strategy:**
   ```javascript
   // Check database before making API calls
   const previouslyLiveMatches = await Match.find({
       'fixture.status.short': { $in: ['1H', '2H', 'HT'] }
   })
   
   // Only fetch from API if matches are actually live
   if (previouslyLiveMatches.length > 0) {
       // Fetch from API...
   }
   ```

---

## ✅ Quick Debug Checklist

Run through these in order:

1. **[ ] Check server logs:**
   - `✅ Socket.IO initialized` → Should see this first
   - `⚽ Initializing Football Cron Jobs` → Should see this after socket
   - `⚽ [CRON] Running live match update...` → Should see this every minute during match hours

2. **[ ] Check cron is running:**
   - Look for timestamp logs: `📅 Time: [timestamp] UTC`
   - Should see cron logs every minute (during match hours)

3. **[ ] Check socket emission:**
   - `📡 Emitting to X connected clients` → Should see client count > 0
   - `✅ Broadcasted: X live, Y upcoming, Z finished` → Should see this after emission

4. **[ ] Check frontend:**
   - `✅ Socket connected: [socket_id]` → Should see this in browser console
   - `📥 RECEIVED UPDATE: { live: X, upcoming: Y, finished: Z }` → Should see this when updates arrive

5. **[ ] Check database:**
   - Query MongoDB: `db.matches.find({ 'fixture.status.short': '1H' }).count()`
   - Should see live matches if any are currently playing

---

## 🐛 Common Error Messages & Solutions

### Error: "Socket.IO not initialized"
**Solution:** Make sure `initializeSocket()` is called BEFORE `initializeFootballCron()`

### Error: "Rate limit exceeded"
**Solution:** Enable caching and reduce cron frequency

### Error: "getIO is not a function"
**Solution:** Check `getIO` is exported from `socket/socket.js`

### Error: "Match is not defined"
**Solution:** Import Match model: `import { Match } from '../models/football.js'`

### Error: "Cannot read property 'clientsCount' of undefined"
**Solution:** Check `io.engine` exists, or use `io.sockets.sockets.size` instead

---

## 🎯 Testing Real-Time Updates

### Manual Test:
1. Open 2 browser tabs with Football page
2. In backend, trigger manual fetch: `POST /api/football/fetch/manual`
3. Both tabs should update automatically (no page refresh)

### Automated Test:
1. Wait for cron job to run (check logs)
2. Check frontend console for: `📥 RECEIVED UPDATE`
3. Verify state updates without API calls

---

**Still having issues?** Check the logs and share:
- Backend logs (cron, socket emission)
- Frontend console logs (socket connection, received events)
- Network tab (WebSocket connection status)
- Database query results (check if matches are being saved)
