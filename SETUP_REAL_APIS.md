# Setup Real Free APIs for News and Movies

## 🎯 What You Need

### 1. GNews API Key (for CNN, Al Jazeera, etc.)
- **Website:** https://gnews.io/
- **Free Tier:** 100 requests/day
- **What it gives you:**
  - CNN articles
  - Al Jazeera English
  - Al Jazeera Arabic
  - Any news source

**Steps:**
1. Go to https://gnews.io/
2. Click "Sign Up" (it's free!)
3. After signup, go to Dashboard
4. Copy your API key
5. Add to `.env`: `GNEWS_API_KEY=your_key_here`

### 2. TMDB API Key (for Kids Movies)
- **Website:** https://www.themoviedb.org/
- **Free Tier:** Unlimited requests
- **What it gives you:**
  - Kids movies
  - Family-friendly content
  - Movie posters and details

**Steps:**
1. Go to https://www.themoviedb.org/
2. Sign up (free)
3. Go to Settings → API
4. Request an API key (instant approval)
5. Copy your API key
6. Add to `.env`: `TMDB_API_KEY=your_key_here`

## 📝 Update Your .env File

Add both keys:

```env
GNEWS_API_KEY=your_gnews_api_key_here
TMDB_API_KEY=your_tmdb_api_key_here
```

## 🔄 Update News Sources in Database

After getting your API keys, run:

```bash
node backend/scripts/initializeNewsSources.js
```

This will add:
- CNN
- Al Jazeera English
- Al Jazeera Arabic
- Kids Movies (from TMDB)

## 🚀 Restart and Test

1. **Restart your backend:**
   ```bash
   npm run dev
   ```

2. **Fetch articles:**
   - Follow any news source (auto-fetches), or
   - Run: `node backend/scripts/fetchFollowedSources.js`

3. **Refresh your frontend** - you'll see real articles!

## ✨ Features

- **CNN:** Latest breaking news
- **Al Jazeera English:** Middle East & world news in English
- **Al Jazeera Arabic:** Middle East & world news in Arabic (أخبار)
- **Kids Movies:** Latest family-friendly animated movies with posters

All articles are real-time from the APIs! 📰🎬













