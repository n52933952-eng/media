# Football API - Quick Setup Checklist

## 🚀 Quick Steps to Integrate API-Football

### 1️⃣ API Setup (5 minutes)
- [ ] Sign up at [RapidAPI](https://rapidapi.com/api-sports/api/api-football)
- [ ] Subscribe to **API-Football** (Free tier: 100-300 requests/day)
- [ ] Copy API key from dashboard
- [ ] Add to `.env`: `FOOTBALL_API_KEY=your_key_here`

### 2️⃣ Install Dependencies
```bash
npm install node-cron node-cache
```

### 3️⃣ Backend Setup (3 files)

#### File 1: `backend/models/football.js`
- [ ] Create MongoDB schema for matches
- [ ] Add indexes: `fixture.date`, `fixture.status.short`, `league.id`

#### File 2: `backend/controller/football.js`
- [ ] Create `fetchFromAPI()` function (with RapidAPI headers)
- [ ] Create `convertMatchFormat()` function (map API response → MongoDB)
- [ ] Create `getMatches()` endpoint (query database by status: live/upcoming/finished)
- [ ] Create `fetchMatchDetails()` function (get scorers/events for finished matches)

#### File 3: `backend/services/footballCron.js`
- [ ] Import `node-cron` and create scheduled tasks
- [ ] Create `fetchAndUpdateLiveMatches()` function
- [ ] Add cron schedule: `*/1 12-22 * * 6,0` (weekends) and `*/1 18-22 * * 1-5` (weekdays)
- [ ] Create `emitFootballPageUpdate()` function (Socket.IO broadcast)

### 4️⃣ Caching Setup

#### File: `backend/services/footballCache.js`
- [ ] Install `node-cache`
- [ ] Create cache with TTL:
  - Live matches: 90 seconds
  - Match details: 5 minutes
  - Others: 1 hour

### 5️⃣ Socket.IO Setup

#### Backend: `backend/services/footballCron.js`
- [ ] Import `getIO()` from `socket/socket.js`
- [ ] Emit `footballPageUpdate` event after updates:
  ```javascript
  io.emit('footballPageUpdate', {
      live: liveMatches,
      upcoming: upcomingMatches,
      finished: finishedMatches
  })
  ```

#### Frontend: `frontent/src/Pages/FootballPage.jsx`
- [ ] Listen for `footballPageUpdate` socket event
- [ ] Update state directly (no API calls for updates)
  ```javascript
  socket.on('footballPageUpdate', (data) => {
      setLiveMatches(data.live)
      setUpcomingMatches(data.upcoming)
      setFinishedMatches(data.finished)
  })
  ```

### 6️⃣ Frontend Display
- [ ] Create 3 tabs: Live, Upcoming, Finished
- [ ] Display match cards with teams, scores, status
- [ ] Show elapsed time for live matches
- [ ] Show scorers/events for finished matches

### 7️⃣ API Endpoints (Routes)

#### File: `backend/routes/football.js`
- [ ] `GET /api/football/matches?status={live|upcoming|finished}` - Get matches
- [ ] `POST /api/football/fetch/manual` - Manual fetch (testing)
- [ ] `POST /api/football/post/manual` - Manual feed post update

---

## 📋 Key Functions to Implement

### Backend Functions

1. **`fetchFromAPI(endpoint)`**
   - Make HTTP request to API-Football
   - Use RapidAPI headers: `x-rapidapi-key`, `x-rapidapi-host`
   - Handle rate limits and errors

2. **`convertMatchFormat(apiMatch)`**
   - Map API response to MongoDB schema
   - Extract: `fixtureId`, `league`, `teams`, `goals`, `fixture.status`

3. **`fetchAndUpdateLiveMatches()`**
   - Check cache first (90s TTL)
   - Fetch from API if cache miss
   - Filter by supported leagues
   - Update database
   - Detect finished matches (compare with previous state)
   - Emit Socket.IO events

4. **`emitFootballPageUpdate()`**
   - Query database for live/upcoming/finished matches
   - Broadcast via Socket.IO to all users

5. **`fetchMatchDetails(fixtureId)`**
   - Check cache first (5min TTL)
   - Fetch events (scorers) from API
   - Cache and return

### Frontend Functions

1. **`fetchMatches()`**
   - Initial fetch on page mount
   - Fetch live, upcoming, finished matches (3 API calls)

2. **Socket Listener**
   - Listen for `footballPageUpdate` events
   - Update state directly (no API calls)

---

## 🔄 Complete Flow

```
1. User opens Football page
   ↓
2. Frontend: Fetch initial data (3 API calls)
   ↓
3. User sees matches
   ↓
4. Cron job runs every 1 minute (during match hours)
   ↓
5. Backend: Check cache → Fetch from API if needed
   ↓
6. Backend: Update database
   ↓
7. Backend: Emit Socket.IO event
   ↓
8. Frontend: Receive update → State updates automatically
   ↓
9. User sees real-time updates (no page refresh!)
```

---

## 📊 API Usage (Optimized)

### Daily Calls Breakdown
- **Live matches polling**: ~300 calls/day
  - Cache hit rate: ~98%
  - Actual API calls: ~6 calls/day
- **Match details (scorers)**: ~10-20 calls/day
- **Daily fixtures fetch**: 1 call/day
- **Total**: ~27 calls/day (well within free tier!)

### Cache Strategy
- **Live matches**: 90s cache (reduce polling overhead)
- **Match details**: 5min cache (scorers don't change)
- **Result**: 98% cache hit rate = 98% fewer API calls!

---

## ✅ Testing Checklist

- [ ] Manual fetch works: `POST /api/football/fetch/manual`
- [ ] Matches display on Football page
- [ ] Live matches update every 1 minute (check console)
- [ ] Socket.IO events received in frontend (check Network tab)
- [ ] Cache works (check logs: "Using cached data")
- [ ] Finished matches show scorers/events
- [ ] Feed post updates automatically

---

## 🐛 Common Issues & Solutions

### Issue 1: "Rate limit exceeded"
**Solution**: 
- Check cache is working (logs should show "Using cached data")
- Increase cache TTL for live matches
- Reduce cron frequency during off-hours

### Issue 2: "Socket events not received"
**Solution**:
- Check Socket.IO connection in frontend
- Verify `getIO()` returns valid socket instance in backend
- Check event name matches: `footballPageUpdate`

### Issue 3: "Matches not updating"
**Solution**:
- Check cron jobs are running (check logs)
- Verify database is being updated
- Check Socket.IO events are being emitted

### Issue 4: "High API usage"
**Solution**:
- Enable caching (`node-cache`)
- Increase cache TTL
- Reduce cron frequency during off-hours
- Use database-first strategy (check DB before API)

---

## 📚 Quick Reference

### API Endpoints Used
- `GET /fixtures?live=all` - Get all live matches
- `GET /fixtures?league={id}&date={date}&season={year}` - Get fixtures
- `GET /fixtures/events?fixture={id}` - Get match details (scorers)

### Match Status Codes
- `NS` = Not Started (upcoming)
- `1H` = First Half (live)
- `HT` = Half Time (live)
- `2H` = Second Half (live)
- `FT` = Full Time (finished)

### Supported Leagues
- Premier League: `39`
- La Liga: `140`
- Serie A: `135`
- Bundesliga: `78`
- Ligue 1: `61`
- Champions League: `2`

---

## 🎯 Success Criteria

✅ Live matches update every 1 minute automatically  
✅ No page refresh needed (Socket.IO real-time updates)  
✅ API usage stays under free tier limit (<100 calls/day)  
✅ Finished matches show scorers/events  
✅ Feed post updates automatically when matches start/finish  
✅ Cache reduces API calls by ~98%  

---

**Need Help?** Check the full guide: `FOOTBALL_API_INTEGRATION_GUIDE.md`
