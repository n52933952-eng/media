# How to Get Real Articles from API

## Current Status
Right now you're seeing **sample/test posts** (dummy data I created for testing). These are NOT from a real API.

## Steps to Get Real Articles:

### Step 1: Get Free GNews API Key
1. Go to: **https://gnews.io/**
2. Click **"Sign Up"** (it's free!)
3. After signing up, log in to your dashboard
4. You'll see your **API Key** - copy it!

### Step 2: Add API Key to Your Project
1. Open your `.env` file (in the root directory)
2. Add this line:
```
GNEWS_API_KEY=paste_your_api_key_here
```
3. Save the file

### Step 3: Restart Backend Server
1. Stop your backend server (Ctrl+C if running)
2. Start it again:
```bash
npm run dev
```

### Step 4: Fetch Real Articles
Once your server is restarted, you have 3 options:

**Option A:** Follow/Unfollow any news source (articles auto-fetch)

**Option B:** Call the API endpoint:
```
GET http://localhost:5000/api/news/fetch-all
```

**Option C:** Run the script:
```bash
node backend/scripts/fetchFollowedSources.js
```

### Step 5: Refresh Your Frontend
Refresh your browser page and you'll see real articles from the news API!

## What You'll Get
- Real, up-to-date news articles
- Latest 5 articles per source
- Automatically fetched when you follow a source
- 100 free requests per day (more than enough for testing)

## Troubleshooting
If you get "You did not provide an API key" error:
- Make sure you added `GNEWS_API_KEY` to `.env`
- Make sure you restarted the backend server
- Check that your API key doesn't have extra spaces

Enjoy your real news feed! 📰✨











