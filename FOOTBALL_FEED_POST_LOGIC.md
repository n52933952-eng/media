# ⚽ Football Feed Post System - How It Works

## 📊 Overview

The football feed post system automatically creates and updates posts in the user's home feed with live match information. Here's how it works:

---

## 🔄 **Update Flow (How Feed Post Gets Updated)**

### **1. Automated Cron Jobs (Scheduled Updates)**

The system runs scheduled tasks that automatically update the feed post:

#### **A. Live Match Polling (Every 10-15 minutes during match hours)**
- **Schedule:**
  - Weekends 12:00-22:00 UTC: Every 10 minutes
  - Weekdays 18:00-22:00 UTC: Every 15 minutes  
  - Off-hours: Hourly check
- **Function:** `fetchAndUpdateLiveMatches()` in `backend/services/footballCron.js`
- **What it does:**
  1. Calls API-Football: `GET /fixtures?live=all`
  2. Filters for supported leagues (Premier League, La Liga, Serie A, etc.)
  3. Updates match scores in database
  4. **If score/status changes:** Updates the existing feed post via Socket.IO

#### **B. Daily Fixture Fetch (Once at 6 AM UTC)**
- **Schedule:** `0 6 * * *` (6 AM UTC daily)
- **Function:** `fetchTodayFixtures()` in `backend/services/footballCron.js`
- **What it does:**
  1. Calls API-Football: `GET /fixtures?league={id}&date={today}&season={year}` for each league
  2. Saves all today's fixtures to database
  3. Prepares matches for later use

#### **C. Auto-Post Creation (Once at 7 AM UTC + Every 30 minutes)**
- **Schedule:** 
  - `0 7 * * *` (7 AM UTC - initial post)
  - `*/30 * * * *` (Every 30 minutes - refresh post)
- **Function:** `autoPostTodayMatches()` in `backend/controller/football.js`
- **What it does:**
  1. Checks if post exists for today (or yesterday)
  2. Fetches live matches from API-Football: `GET /fixtures?live=all`
  3. Saves live matches to database
  4. Queries database for live matches with status: `['1H', '2H', 'HT', 'ET', 'P', 'BT']`
  5. If live matches found:
     - Deletes old "no matches" posts
     - Creates new post with `footballData` (JSON string of match data)
     - Emits `newPost` socket event to followers
  6. If no live matches:
     - Creates "no matches" post (if none exists or if old)
     - Emits to followers

---

### **2. Real-Time Score Updates (Socket.IO)**

When scores change during live matches:

#### **Process:**
1. **Cron job detects change** (`fetchAndUpdateLiveMatches` runs every 10-15 min)
2. **Score comparison:**
   ```javascript
   const previousGoalsHome = previousMatch?.goals?.home || 0
   const currentGoalsHome = updatedMatch.goals?.home || 0
   const scoreChanged = (currentGoalsHome !== previousGoalsHome) || ...
   ```
3. **If score/status changed:**
   - Finds the existing feed post
   - Parses `footballData` JSON
   - Updates the specific match in the array
   - Filters out finished matches (FT, AET, PEN, etc.)
   - Saves updated post
   - **Emits Socket.IO event:** `footballMatchUpdate` to all followers
   ```javascript
   io.to(socketId).emit('footballMatchUpdate', {
     postId: todayPost._id.toString(),
     matchData: liveMatchesOnly,
     updatedAt: new Date()
   })
   ```

#### **Frontend Socket Listener:**
- **Location:** `frontent/src/Pages/HomePage.jsx` and `frontent/src/Components/Post.jsx`
- **Event:** `footballMatchUpdate`
- **What it does:**
  - Receives updated match data
  - Updates the post in the feed state
  - Re-renders with new scores (NO PAGE RELOAD!)

---

### **3. Manual Triggers (User Actions)**

#### **A. "Refresh Feed" Button** (Football Page)
- **Location:** `frontent/src/Pages/FootballPage.jsx`
- **Endpoint:** `POST /api/football/post/manual`
- **Function:** `manualPostTodayMatches()` → calls `autoPostTodayMatches()`
- **What it does:**
  1. Immediately triggers feed post creation/update
  2. Deletes old "no matches" posts
  3. Creates new post with current live matches
  4. Emits to followers via Socket.IO

#### **B. "Load All Leagues" Button** (Football Page)
- **Location:** `frontent/src/Pages/FootballPage.jsx`
- **Endpoint:** `POST /api/football/fetch/manual`
- **Function:** `manualFetchFixtures()` in `backend/controller/football.js`
- **What it does:**
  1. Fetches fixtures for past 3 days + next 7 days
  2. Saves matches to database
  3. **Does NOT** update feed post (only fetches data)

#### **C. Following Football Account** (SuggestedChannels)
- **Location:** `frontent/src/Components/SuggestedChannels.jsx`
- **When:** User clicks "Follow" on Football account
- **What it does:**
  1. Calls `POST /api/football/post/manual` to create post immediately
  2. Adds post to user's feed
  3. Ensures user sees matches right away

---

## 📡 **API Requests Flow**

### **Request Pattern:**

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CRON JOB: fetchAndUpdateLiveMatches()                    │
│    └─> API-Football: GET /fixtures?live=all                 │
│        └─> Update database                                   │
│        └─> If score changed: Update feed post + Socket emit │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 2. CRON JOB: autoPostTodayMatches() (every 30 min)          │
│    └─> Check existing post                                  │
│    └─> API-Football: GET /fixtures?live=all                 │
│        └─> Save to database                                 │
│        └─> Query database for live matches                  │
│        └─> Create/update post                               │
│        └─> Socket emit: newPost                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 3. USER ACTION: "Refresh Feed" Button                       │
│    └─> POST /api/football/post/manual                       │
│        └─> Calls autoPostTodayMatches()                     │
│            └─> (Same as above)                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗄️ **Database Updates**

### **Match Updates:**
- **Collection:** `matches`
- **Updates:**
  - Scores (`goals.home`, `goals.away`)
  - Status (`fixture.status.short`, `fixture.status.elapsed`)
  - Events (scorers, cards, substitutions) - **ONLY for finished matches**

### **Post Updates:**
- **Collection:** `posts`
- **Field:** `footballData` (JSON string)
- **Updates:**
  - Created when live matches start
  - Updated when scores change (via Socket.IO)
  - Deleted when all matches finish

---

## 🔍 **Feed Post Detection Logic**

### **When Creating Post:**

1. **Check for existing post:**
   - Look for posts created yesterday OR today (to catch old "no matches" posts)
   - Check if post has `footballData` (match post) or just text ("no matches" post)

2. **If "no matches" post exists:**
   - Check if there are now live matches
   - If YES → Delete old post, create new with matches
   - If NO → Check age (if > 6 hours, refresh; otherwise keep)

3. **If match post exists:**
   - Parse `footballData` to check for live matches
   - If has live matches AND updated < 10 min ago → Skip (Socket.IO handles updates)
   - If no live matches OR stale (> 10 min) → Delete and create fresh

4. **Create new post:**
   - Fetch live matches from API-Football
   - Save to database
   - Query database for live matches
   - Create post with `footballData` (JSON string)
   - Emit `newPost` socket event

---

## ⚡ **Real-Time Updates (Socket.IO)**

### **Socket Events:**

1. **`newPost`** - Emitted when:
   - New feed post is created
   - User follows Football account
   - Cron job creates/updates post

2. **`footballMatchUpdate`** - Emitted when:
   - Score changes during live match
   - Match status changes (1H → 2H, etc.)
   - Elapsed time updates
   - **Frequency:** Every 10-15 minutes (when cron runs)

### **Frontend Handling:**
- **Post Component:** Listens for `footballMatchUpdate`
- **Updates:** Post state in real-time (no page reload)
- **User Experience:** Scores update automatically in feed

---

## 📊 **Summary: Request Frequency**

| Action | Frequency | API Calls | Endpoint |
|--------|-----------|-----------|----------|
| Live match polling | 10-15 min (match hours) | 1 call | `GET /fixtures?live=all` |
| Daily fixtures | Once at 6 AM | ~6 calls (one per league) | `GET /fixtures?league={id}&date={date}` |
| Feed post refresh | Every 30 min | 1 call | `GET /fixtures?live=all` |
| Match details (finished) | On-demand | 1 call per match | `GET /fixtures?id={id}` |
| Manual refresh | User action | 1 call | `GET /fixtures?live=all` |

**Total:** ~45-50 API calls per day (well under 100 requests/day free tier)

---

## 🎯 **Key Points:**

1. **Feed post is created ONCE per day** (or refreshed every 30 min if stale)
2. **Scores update in real-time** via Socket.IO (no new post created)
3. **Old "no matches" posts are automatically deleted** when live matches start
4. **Post contains JSON string** of match data (for frontend rendering)
5. **Finished matches are filtered out** from live post (only live matches shown)
6. **Manual refresh button** immediately updates feed post

---

## 🔧 **Configuration:**

- **API Base URL:** `https://v3.football.api-sports.io`
- **API Key:** `FOOTBALL_API_KEY` environment variable
- **Supported Leagues:** Premier League (39), La Liga (140), Serie A (135), Bundesliga (78), Ligue 1 (61), Champions League (2)
- **Live Match Status:** `['1H', '2H', 'HT', 'ET', 'P', 'BT']`
- **Finished Status:** `['FT', 'AET', 'PEN', 'CANC', 'POSTP', 'SUSP']`
