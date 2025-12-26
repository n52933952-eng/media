# 🚀 Quick Start: Get Real Articles from APIs

## Step 1: Get API Keys (Both FREE!)

### 1.1 GNews API (for CNN, Al Jazeera)
1. Visit: **https://gnews.io/**
2. Click **"Sign Up"** (free - 100 requests/day)
3. After signup, go to Dashboard
4. Copy your API key

### 1.2 TMDB API (for Kids Movies)
1. Visit: **https://www.themoviedb.org/**
2. Sign up (free)
3. Go to **Settings → API**
4. Request an API key (instant approval!)
5. Copy your API key

## Step 2: Add Keys to .env File

Open your `.env` file and add:

```env
GNEWS_API_KEY=your_gnews_key_here
TMDB_API_KEY=your_tmdb_key_here
```

**Example:**
```env
GNEWS_API_KEY=a1b2c3d4e5f6g7h8i9j0
TMDB_API_KEY=1234567890abcdef1234567890abcdef
```

## Step 3: Update News Sources

Run this to add CNN, Al Jazeera (English & Arabic), and Kids Movies:

```bash
node backend/scripts/initializeNewsSources.js
```

This will add:
- ✅ **CNN** - Latest breaking news
- ✅ **Al Jazeera English** - Middle East & world news
- ✅ **Al Jazeera Arabic** - أخبار الشرق الأوسط (Arabic news)
- ✅ **Kids Movies** - Family-friendly animated movies

## Step 4: Restart Backend

```bash
# Stop server (Ctrl+C)
npm run dev
```

## Step 5: Fetch Real Articles!

**Option A:** Follow any news source (auto-fetches articles)

**Option B:** Run fetch script:
```bash
node backend/scripts/fetchFollowedSources.js
```

**Option C:** Call API:
```
GET http://localhost:5000/api/news/fetch-all
```

## Step 6: Refresh Frontend

Refresh your browser - you'll see **real articles** from:
- 📰 CNN
- 📰 Al Jazeera English  
- 📰 Al Jazeera Arabic (أخبار)
- 🎬 Kids Movies (with movie posters!)

## ✨ That's It!

Now you have real, live articles from professional news sources and movie databases!

**Note:** Both APIs are completely free:
- GNews: 100 requests/day (more than enough!)
- TMDB: Unlimited requests (free forever!)

Enjoy your real news feed! 🎉














