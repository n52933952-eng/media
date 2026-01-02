# How to Add a Second Server (Load Balancer Setup)

## 🎯 Goal: Add Another Backend Server to Help Current One

### Your Current Setup:
```
1 Backend Server → Handles all traffic
```

### What You Want:
```
Load Balancer
    ├── Server 1 (Current)
    └── Server 2 (New)
```

---

## 📋 Step-by-Step Guide

### **Step 1: Your Current Server (Keep It Running)**

Your current server is probably:
- `thredtrain-backend` on Render
- URL: `https://thredtrain-backend.onrender.com`
- **Keep this running!** ✅

---

### **Step 2: Create Second Backend Server**

1. **Go to Render Dashboard**
2. **Click "New"** → **"Web Service"**
3. **Connect Same GitHub Repository**
   - Same repo as your current server
   - Same branch (main/master)

4. **Configure New Service:**

```
Name: thredtrain-backend-2
   (or thredtrain-backend-secondary)
   
Region: Same as Server 1
   (Important: Same region = faster communication)

Branch: main (same as Server 1)

Root Directory: (leave empty)

Runtime: Node

Build Command: npm install

Start Command: node backend/index.js
```

5. **Environment Variables - CRITICAL:**

**Copy ALL environment variables from Server 1:**

```env
# Database - MUST BE SAME
MONGO=mongodb+srv://... (EXACT SAME as Server 1)

# Redis - MUST BE SAME
REDIS_URL=redis://... (EXACT SAME as Server 1)

# JWT - MUST BE SAME
JWT_SECRET=... (EXACT SAME as Server 1)

# Cloudinary - SAME
CLOUDINARY_CLOUD_NAME=... (SAME)
CLOUDINARY_API_KEY=... (SAME)
CLOUDINARY_API_SECRET=... (SAME)

# Frontend URL - SAME
FRONTEND_URL=https://your-frontend.onrender.com (SAME)

# Port - Render auto-assigns
PORT=10000
```

**⚠️ IMPORTANT:** These MUST be identical:
- `MONGO` - Same database
- `REDIS_URL` - Same Redis instance
- `JWT_SECRET` - Same secret (tokens work on both)

6. **Click "Create Web Service"**

---

### **Step 3: Render Automatically Load Balances**

Render automatically detects multiple services and load balances!

**How it works:**
```
User Request
    ↓
Render Load Balancer (Automatic)
    ↓
    ├── Server 1 (50% of traffic)
    └── Server 2 (50% of traffic)
```

**No configuration needed!** Render does it automatically.

---

## 🔍 How to Verify It's Working

### **Test Server 1:**
```bash
curl https://thredtrain-backend.onrender.com/health
```

### **Test Server 2:**
```bash
curl https://thredtrain-backend-2.onrender.com/health
```

**Both should return:**
```json
{
  "status": "ok",
  "checks": {
    "database": "ok",
    "redis": "ok"
  }
}
```

### **Test Load Balancing:**

Make multiple requests - they'll go to different servers:
```bash
# Request 1 → Server 1
curl https://thredtrain-backend.onrender.com/health

# Request 2 → Server 2 (or Server 1, depends on load balancer)
curl https://thredtrain-backend.onrender.com/health
```

---

## 🎯 What Happens Now

### **Traffic Distribution:**
- **50%** of requests → Server 1
- **50%** of requests → Server 2
- **Automatic** - Render decides

### **Shared Resources:**
Both servers use:
- ✅ **Same MongoDB** → Same data
- ✅ **Same Redis** → Same game state, Socket.IO
- ✅ **Same JWT Secret** → Tokens work on both

### **Benefits:**
- ✅ **2x Capacity** - Handle 2x more users
- ✅ **High Availability** - If Server 1 crashes, Server 2 continues
- ✅ **Better Performance** - Load distributed
- ✅ **Zero Downtime** - Deploy to one, other handles traffic

---

## 🔧 Adding More Servers (Scale to 3, 4, 5...)

Want even more capacity? Add Server 3, 4, 5...

**Same process:**
1. Create new Web Service
2. Same repo, same branch
3. **Copy ALL environment variables** (especially `MONGO`, `REDIS_URL`, `JWT_SECRET`)
4. Deploy

**Result:**
```
Load Balancer
    ├── Server 1 (33% traffic)
    ├── Server 2 (33% traffic)
    └── Server 3 (33% traffic)
```

**3 servers = 3x capacity!**

---

## 📊 Your Folder Structure

Your structure doesn't change:
```
thredtrain/ (GitHub Repo)
├── backend/
│   ├── index.js
│   ├── routes/
│   └── ...
├── frontent/
└── package.json
```

**Both servers use the SAME code from the SAME repo!**

---

## ⚠️ Critical Requirements

### **1. Same Redis URL**
```
Server 1: REDIS_URL=redis://...
Server 2: REDIS_URL=redis://... (MUST BE SAME)
```

**Why:** Socket.IO, game state, real-time features need shared Redis

### **2. Same MongoDB**
```
Server 1: MONGO=mongodb://...
Server 2: MONGO=mongodb://... (MUST BE SAME)
```

**Why:** Both servers need access to same data

### **3. Same JWT Secret**
```
Server 1: JWT_SECRET=secret123
Server 2: JWT_SECRET=secret123 (MUST BE SAME)
```

**Why:** Tokens created on Server 1 must work on Server 2

---

## 🎯 Real Example

### **Before (1 Server):**
```
10,000 users → 1 Server
- Slow responses ⏳
- Can crash under load 💥
- Single point of failure
```

### **After (2 Servers):**
```
10,000 users → Load Balancer
    ├── Server 1: 5,000 users ✅
    └── Server 2: 5,000 users ✅
- Fast responses ✅
- No crashes ✅
- High availability ✅
```

---

## 💰 Cost

### **Render Pricing:**
- **Free Tier:** 1 service (750 hours/month)
- **Paid:** $7/month per service

### **Example:**
- Server 1: Free (if under 750 hours) or $7/month
- Server 2: $7/month
- **Total: $7-14/month for 2x capacity**

**Worth it for production!**

---

## 🚨 Common Mistakes

### **Mistake 1: Different Redis**
```
❌ Server 1: REDIS_URL=redis://localhost:6379
❌ Server 2: REDIS_URL=redis://localhost:6379 (different instance)
```
**Fix:** Use same Redis URL (e.g., Redis Cloud)

### **Mistake 2: Different JWT Secret**
```
❌ Server 1: JWT_SECRET=secret1
❌ Server 2: JWT_SECRET=secret2
```
**Fix:** Use exact same `JWT_SECRET`

### **Mistake 3: Different Database**
```
❌ Server 1: MONGO=mongodb://db1
❌ Server 2: MONGO=mongodb://db2
```
**Fix:** Use exact same MongoDB connection string

---

## ✅ Quick Checklist

Before deploying Server 2:

- [ ] Same GitHub repository
- [ ] Same branch (main/master)
- [ ] Same `MONGO` connection string
- [ ] Same `REDIS_URL` connection string
- [ ] Same `JWT_SECRET`
- [ ] Same `CLOUDINARY` credentials
- [ ] Same `FRONTEND_URL`
- [ ] Same region (recommended)
- [ ] Root Directory: (empty)
- [ ] Build Command: `npm install`
- [ ] Start Command: `node backend/index.js`

---

## 🎉 Summary

**To add a second server:**

1. **Create new Web Service** on Render
2. **Same repo, same branch**
3. **Copy ALL environment variables** (especially `MONGO`, `REDIS_URL`, `JWT_SECRET`)
4. **Deploy** - Render automatically load balances!

**Result:**
- ✅ 2x capacity
- ✅ High availability
- ✅ Better performance
- ✅ Automatic load balancing

**Your folder structure stays the same - both servers use the same code!**

---

## 🔄 Workflow

### **Daily Operations:**
1. Both servers run automatically
2. Render load balances traffic
3. Both share Redis & MongoDB
4. Everything works seamlessly

### **Deploying Updates:**
1. Push code to GitHub
2. Both servers auto-deploy
3. Or deploy to one first, then other
4. Zero downtime!

### **Scaling:**
- Need more capacity? Add Server 3, 4, 5...
- Same process, same environment variables
- Automatic load balancing

---

## 🎯 Next Steps

1. **Create Server 2** on Render
2. **Copy environment variables**
3. **Deploy**
4. **Test both servers**
5. **Monitor performance**

**You're ready to scale!** 🚀
