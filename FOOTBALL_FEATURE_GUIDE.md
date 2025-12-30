# ⚽ Football Live Feature - Complete Guide

## 🎉 What's Been Built

A complete football live scores and updates system integrated into your social media app!

### Features Implemented:

1. **Backend System**
   - MongoDB models for matches and leagues
   - API-FOOTBALL integration (100 requests/day)
   - REST API endpoints for match data
   - Automated cron jobs for live updates
   - Football system account (@Football)
   - Auto-posting to user feeds

2. **Frontend System**
   - Dedicated Football page (`/football`)
   - Live scores display
   - Upcoming fixtures
   - Finished matches
   - Follow/unfollow functionality
   - Football channel in suggested users

---

## 📋 Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

This will install `node-cron` (added to package.json)

### 2. API Key Setup

**Current Status:** ✅ API key is already added directly to code (f3ebe896455cab31fc80e859716411df)

**For production/security (recommended):**
Move the API key to your `.env` file:

```env
FOOTBALL_API_KEY=f3ebe896455cab31fc80e859716411df
```

Then remove it from:
- `backend/controller/football.js` (line 6)
- `backend/services/footballCron.js` (line 7)

**Get your key from:** https://dashboard.api-football.com/

### 3. Start the Server

```bash
npm run dev
```

The football cron jobs will automatically start when the server starts.

---

## 🎯 How It Works

### Automated Updates (Cron Jobs)

**1. Live Match Updates**
- Runs every **2 minutes** during match hours (12pm - 11pm UTC)
- Fetches all live matches from API-FOOTBALL
- Updates database with current scores
- Auto-posts updates to followers:
  - ⚽ Match starts → "KICK OFF" post
  - ⚽ Goal scored → "GOAL!" post with score
  - 🏁 Match ends → "FULL TIME" post with final score

**2. Daily Fixtures**
- Runs once at **6 AM UTC**
- Fetches today's matches for all supported leagues
- Stores in database for quick access

### Supported Leagues

1. **Premier League** (England)
2. **La Liga** (Spain)
3. **UEFA Champions League**
4. **Serie A** (Italy)
5. **Bundesliga** (Germany)
6. **Ligue 1** (France)

### API Usage Optimization

With **100 requests/day**, the system is configured to:
- Use **~12 requests** for live updates (every 2 min × 6 hours = 12 requests)
- Use **~6 requests** for daily fixtures (1 per league)
- Leaves **~80 requests** as buffer

**Total: ~18 requests/day** under normal usage

---

## 🌐 User Experience

### For Regular Users

1. **Discover Football Channel**
   - Appears in "Suggested Users" sidebar (Home page)
   - Labeled as "⚽ Follow for Live Football"

2. **Follow the Channel**
   - Click "Follow" button
   - Receive live match updates in feed (Home page)

3. **Visit Football Page**
   - Navigate to `/football` route
   - See live, upcoming, and finished matches
   - No login required (but follow button only for logged-in users)

### For You (Admin)

**Manual API Calls (Optional):**

You can manually trigger updates via API:

```bash
# Fetch live matches
POST /api/football/fetch/live

# Fetch today's fixtures
POST /api/football/fetch/fixtures

# Fetch league standings
POST /api/football/fetch/standings/:leagueId

# Manually post match update
POST /api/football/post-update
Body: { fixtureId: 12345, updateType: "goal" }
```

---

## 📂 File Structure

### Backend
```
backend/
├── models/
│   └── football.js          # Match & League schemas
├── controller/
│   └── football.js          # API logic
├── routes/
│   └── football.js          # API routes
├── services/
│   └── footballCron.js      # Automated updates
└── index.js                 # Cron initialization
```

### Frontend
```
frontent/
├── src/
│   ├── Pages/
│   │   └── FootballPage.jsx    # Main football page
│   ├── Components/
│   │   └── SuggestedUsers.jsx  # Shows football channel
│   └── App.jsx                  # Football route
```

---

## 🔧 Configuration

### Modify Leagues

Edit `SUPPORTED_LEAGUES` in:
- `backend/controller/football.js`
- `backend/services/footballCron.js`

### Adjust Cron Schedule

Edit in `backend/services/footballCron.js`:

```javascript
// Live matches - change frequency
cron.schedule('*/2 12-23 * * *', ...) // Currently every 2 min

// Daily fixtures - change time
cron.schedule('0 6 * * *', ...) // Currently 6 AM UTC
```

### Change Match Hours

Modify the time range in cron schedule:
```javascript
'*/2 12-23 * * *' // 12pm-11pm UTC
      ↑↑  ↑↑
      Start-End hours
```

---

## 🚀 Testing

### 1. Check Football Account Created
After server starts, check MongoDB:
```javascript
db.users.findOne({ username: "Football" })
```

Should see:
- name: "Football Live"
- bio: "⚽ Live football scores..."
- profilePic: (football icon URL)

### 2. Test API Endpoints

**Get matches:**
```bash
curl http://localhost:5000/api/football/matches?status=live
```

**Get supported leagues:**
```bash
curl http://localhost:5000/api/football/leagues
```

### 3. Test Frontend

1. Navigate to `http://localhost:5173/football`
2. Check if page loads with tabs (Live, Upcoming, Finished)
3. Follow football channel from suggested users
4. Check if updates appear in home feed

---

## 📊 Database Schema

### Match Document
```javascript
{
  fixtureId: Number,
  league: { id, name, country, logo, flag, season },
  teams: {
    home: { id, name, logo },
    away: { id, name, logo }
  },
  fixture: {
    date: Date,
    venue: String,
    city: String,
    status: { long, short, elapsed }
  },
  goals: { home: Number, away: Number },
  events: [{ time, team, player, type, detail }],
  postedToFeed: Boolean,
  postId: ObjectId,
  lastUpdated: Date
}
```

---

## 🎨 Customization

### Change Football Account Info

Edit in `backend/services/footballCron.js` and `backend/controller/football.js`:

```javascript
const footballAccount = new User({
  name: 'Your Name',
  username: 'YourUsername',
  bio: 'Your Bio',
  profilePic: 'Your Icon URL'
})
```

### Add More Leagues

Find league IDs from API-FOOTBALL documentation:
https://www.api-football.com/documentation-v3

Add to `SUPPORTED_LEAGUES` array:
```javascript
const SUPPORTED_LEAGUES = [
  39,   // Premier League
  140,  // La Liga
  // Add more...
  253   // Major League Soccer (example)
]
```

---

## ⚠️ Important Notes

1. **API Rate Limits**
   - Free tier: 100 requests/day
   - Monitor usage in API-FOOTBALL dashboard
   - System designed to use ~18 requests/day

2. **Cron Jobs**
   - Only run during server uptime
   - If server restarts, crons restart
   - Consider using external cron service for 24/7 (e.g., cron-job.org)

3. **Production Deployment**
   - Make sure `.env` variables are set on production server
   - Adjust cron times for your timezone
   - Monitor MongoDB storage (matches accumulate over time)

4. **Database Cleanup**
   - Old matches can be cleaned periodically
   - Add cleanup script to delete matches older than 7 days (optional)

---

## 🐛 Troubleshooting

### "Football account not found"
- Server needs to run for 3 seconds after start
- Check MongoDB connection
- Manually create account using `getFootballAccount()` function

### "No matches showing"
- Check API key in `.env`
- Verify API quota (100 requests/day)
- Check if today has any matches for supported leagues
- Manually trigger fetch: `POST /api/football/fetch/fixtures`

### "Cron jobs not running"
- Check server console for "✅ Football Cron Jobs initialized"
- Verify server time (crons use UTC)
- Check if `node-cron` is installed

---

## 📈 Future Enhancements

Ideas for future development:
- [ ] Add team pages
- [ ] Player statistics
- [ ] Match predictions
- [ ] User favorite teams
- [ ] Push notifications for goals
- [ ] League standings page
- [ ] International matches (World Cup, etc.)
- [ ] Video highlights integration

---

## 🎓 API-FOOTBALL Documentation

Full API docs: https://www.api-football.com/documentation-v3

Key endpoints used:
- `/fixtures?live=all` - Get live matches
- `/fixtures?league={id}&date={date}` - Get fixtures
- `/standings?league={id}` - Get league standings

---

## ✅ Checklist for Going Live

- [ ] Add FOOTBALL_API_KEY to production `.env`
- [ ] Run `npm install` on production server
- [ ] Verify MongoDB connection
- [ ] Test cron jobs in production
- [ ] Monitor API usage for first 24 hours
- [ ] Announce football feature to users
- [ ] Create tutorial post about following @Football

---

## 💡 Tips for Users

Suggest users to:
1. Follow @Football to get updates
2. Visit `/football` page for full match list
3. Share match posts with friends
4. Request specific leagues/teams

---

**Built with:** Node.js, Express, MongoDB, Socket.IO, React, Chakra UI, API-FOOTBALL

**Need help?** Check API-FOOTBALL documentation or MongoDB docs.

