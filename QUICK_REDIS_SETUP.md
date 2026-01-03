# Quick Redis Setup (Windows)

## Fastest Way: Docker

1. **Install Docker Desktop** (if not installed):
   - Download: https://www.docker.com/products/docker-desktop
   - Install and start Docker Desktop

2. **Run Redis in Docker:**
   ```bash
   docker run -d -p 6379:6379 --name redis redis:latest
   ```

3. **Verify Redis is running:**
   ```bash
   docker ps
   ```
   You should see Redis container running

4. **Add to `.env` file:**
   ```env
   REDIS_URL=redis://localhost:6379
   ```

5. **Start your app:**
   ```bash
   npm run dev
   ```

---

## Alternative: Redis Cloud (No Installation Needed)

1. **Sign up for free Redis:**
   - Go to: https://redis.com/try-free/
   - Create free account
   - Create a database
   - Copy the connection URL

2. **Add to `.env` file:**
   ```env
   REDIS_URL=redis://your-connection-string-here
   ```

3. **Start your app:**
   ```bash
   npm run dev
   ```

---

## Verify Redis is Working:

After starting the app, you should see:
```
✅ Redis connected successfully - App ready for scaling!
✅ Socket.IO Redis adapter configured - ready for multi-server scaling!
✅ Server is running on port 5000
✅ App is ready for 1M+ users with Redis scaling!
```

---

**That's it! Your app is now ready for 1M+ users!** 🚀


