# Football Feature - How It Works

## Overview
The Football feature automatically posts live match updates to followers' feeds.

## 3 Types of Posts

### 1. "Today's Top Matches" (Manual - when following)
- **When**: User follows Football account
- **Content**: Next 5 matches in the next 8 hours
- **Format**: Visual cards with team logos, league, and time
- **Stored in**: `footballData` field (JSON)
- **Appears**: Instantly via Socket.io (no refresh needed)

### 2. Match Updates (Automatic - via cron jobs)
- **⚽ KICK OFF**: When match starts
- **⚽ GOAL**: When someone scores
- **🏁 FULL TIME**: When match ends
- **Frequency**: Every 2 minutes (12pm-11pm UTC)
- **Format**: Text posts with match info
- **Appears**: Instantly via Socket.io

### 3. Live Scores (Football Page)
- **Where**: `/football` page
- **Updates**: Every 2 minutes
- **Shows**: Live matches, upcoming matches, finished matches

## How It Works

### When You Follow Football Account:

```
1. User clicks "Follow" on Football channel
2. Backend: Updates followers list in database
3. Frontend: Waits 500ms (ensures database is updated)
4. Backend: Creates "Today's Top Matches" post
5. Backend: Fetches FRESH followers list from database
6. Backend: Emits post via Socket.io to online followers
7. Frontend: Receives post instantly (no refresh)
8. Post appears in feed immediately
```

### Automatic Match Updates (Cron Jobs):

```
Every 2 minutes (12pm-11pm UTC):
1. Fetch live matches from Football-Data.org API
2. Compare with previous state
3. If match just started → Post "KICK OFF"
4. If goal scored → Post "GOAL"
5. If match finished → Post "FULL TIME"
6. Emit to online followers via Socket.io
7. Followers see updates instantly
```

### Daily Fixture Fetch (Cron Job):

```
Every day at 6 AM UTC:
1. Fetch today's fixtures from API
2. Store in database
3. Ready for "Today's Top Matches" posts
```

## Why Posts Appear Instantly Now

### Before (Bug):
- Follow API updated database
- Post created immediately
- Socket emitted to OLD followers list (you weren't in it yet)
- You had to refresh to see post

### After (Fixed):
- Follow API updates database
- Wait 500ms to ensure database is updated
- Post created
- Fetch FRESH followers list from database
- Socket emits to NEW followers list (you're in it now)
- Post appears instantly

## Duplicate Prevention

The system prevents creating multiple "Today's Top Matches" posts on the same day:

```javascript
// Checks if post already exists today
const existingPost = await Post.findOne({
    postedBy: footballAccount._id,
    text: /Today's Top Matches/i,
    footballData: { $exists: true },
    createdAt: { $gte: today, $lt: tomorrow }
})

if (existingPost) {
    return // Skip, don't create duplicate
}
```

## Cron Job Schedule

| Job | Schedule | Description |
|-----|----------|-------------|
| Live Matches | Every 2 minutes (12pm-11pm UTC) | Fetch live scores, post updates |
| Daily Fixtures | 6 AM UTC daily | Fetch today's fixtures |
| Startup Fetch | 5 seconds after server starts | Fetch fixtures immediately |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/football/post/manual` | POST | Create "Today's Top Matches" post |
| `/api/football/matches` | GET | Get cached matches (live/upcoming/finished) |
| `/api/football/fetch/manual` | POST | Manually fetch fixtures from API |

## Database Collections

### Posts
```javascript
{
  postedBy: ObjectId (Football account),
  text: "⚽ Today's Top Matches ⚽",
  footballData: "[{homeTeam, awayTeam, league, time}]", // JSON string
  createdAt: Date
}
```

### Matches
```javascript
{
  fixtureId: Number,
  league: { id, name, logo },
  teams: { home: {name, logo}, away: {name, logo} },
  fixture: { date, status },
  goals: { home, away }
}
```

## Socket.io Events

| Event | When | Data |
|-------|------|------|
| `newPost` | New post created | Full post object |
| `postDeleted` | Post deleted | `{ postId }` |

## Troubleshooting

### Posts don't appear without refresh
- ✅ Fixed: Now fetches fresh followers list before emitting
- ✅ Fixed: Added 500ms delay to ensure follow is saved

### No match updates
- Check if cron jobs are running (logs show "⚽ [CRON] Running live match update...")
- Check if it's between 12pm-11pm UTC (cron only runs during these hours)
- Check if matches are actually live (status: IN_PLAY, PAUSED)

### No matches on Football page
- Run manual fetch: POST `/api/football/fetch/manual`
- Wait ~40 seconds (fetches all leagues with rate limiting)
- Check database for matches

## Testing

### Test "Today's Top Matches" post:
1. Unfollow Football account
2. Follow Football account again
3. Post should appear instantly (no refresh)

### Test match updates:
1. Wait for live match (12pm-11pm UTC)
2. Cron job will auto-post updates every 2 minutes
3. Check logs for "⚽ [CRON] Running live match update..."

### Manual fixture fetch:
```bash
POST http://localhost:5000/api/football/fetch/manual
```

## Summary

- ✅ Posts appear instantly via Socket.io
- ✅ No refresh needed
- ✅ Duplicate prevention active
- ✅ Cron jobs run automatically
- ✅ Live scores update every 2 minutes
- ✅ Fresh followers list fetched before emitting

