# How to Add Second Server to media-1-aue5.onrender.com

## 🎯 Your Current Setup

**Existing Server:**
- URL: `https://media-1-aue5.onrender.com/`
- Service Name: `media-1-aue5` (probably)

---

## 📋 Step-by-Step: Add Second Server

### **Step 1: Go to Render Dashboard**

1. Login to [render.com](https://render.com)
2. Go to your **Dashboard**
3. Find your existing service: `media-1-aue5` (or similar name)

---

### **Step 2: Check Your Current Service Settings**

**Click on your existing service** → **Settings** tab

**Note down these settings:**
- Repository (GitHub repo)
- Branch (main/master)
- Build Command
- Start Command
- **All Environment Variables** (especially `MONGO`, `REDIS_URL`, `JWT_SECRET`)

---

### **Step 3: Create New Service (Second Server)**

1. **Click "New"** → **"Web Service"**
2. **Connect Repository:**
   - Select **SAME GitHub repository** as your existing service
   - Select **SAME branch** (main/master)

3. **Configure Service:**

```
Name: media-2-aue5
   (or media-1-aue5-2, or any name you want)

Region: Same as your existing service
   (Important: Same region = faster)

Branch: main (same as existing)

Root Directory: (leave empty - same as existing)

Runtime: Node

Build Command: (copy from existing service)
   Usually: npm run build
   OR: npm install

Start Command: (copy from existing service)
   Usually: node backend/index.js
   OR: npm start
```

---

### **Step 4: Copy ALL Environment Variables**

**CRITICAL:** Copy ALL environment variables from your existing service:

**Go to existing service** → **Environment** tab → **Copy all variables**

**Paste into new service** → **Environment** tab

**Especially these MUST be identical:**
```env
MONGO=... (EXACT SAME)
REDIS_URL=... (EXACT SAME)
JWT_SECRET=... (EXACT SAME)
CLOUDINARY_CLOUD_NAME=... (SAME)
CLOUDINARY_API_KEY=... (SAME)
CLOUDINARY_API_SECRET=... (SAME)
FRONTEND_URL=... (SAME)
PORT=10000
```

**⚠️ IMPORTANT:** 
- `MONGO` - Must be EXACT same (same database)
- `REDIS_URL` - Must be EXACT same (same Redis)
- `JWT_SECRET` - Must be EXACT same (tokens work on both)

---

### **Step 5: Deploy**

1. **Click "Create Web Service"**
2. **Wait for deployment** (5-10 minutes)
3. **New service will be:** `https://media-2-aue5.onrender.com/` (or similar)

---

## 🔄 How Render Load Balances

### **Render automatically load balances when you have multiple services!**

**How it works:**
```
User visits: https://media-1-aue5.onrender.com/
    ↓
Render Load Balancer (Automatic)
    ↓
    ├── Server 1: media-1-aue5 (50% traffic)
    └── Server 2: media-2-aue5 (50% traffic)
```

**OR if you use custom domain:**
```
User visits: https://yourdomain.com/
    ↓
Render Load Balancer
    ↓
    ├── Server 1 (50% traffic)
    └── Server 2 (50% traffic)
```

**No extra configuration needed!** Render does it automatically.

---

## 🎯 Option: Use Custom Domain

### **If you want ONE URL for users:**

1. **Get a custom domain** (e.g., `thredtrain.com`)
2. **Point it to your Render service**
3. **Render automatically load balances** across all services

**Result:**
- Users visit: `https://thredtrain.com/`
- Load balancer routes to Server 1 or Server 2
- User doesn't know there are 2 servers

---

## ✅ Verify It's Working

### **Test Server 1:**
```bash
curl https://media-1-aue5.onrender.com/health
```

### **Test Server 2:**
```bash
curl https://media-2-aue5.onrender.com/health
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

---

## 📊 What Happens Now

### **Traffic Distribution:**
- **50%** of requests → Server 1 (`media-1-aue5`)
- **50%** of requests → Server 2 (`media-2-aue5`)
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

## 🚨 Important Notes

### **1. Same Environment Variables**
Both servers MUST have:
- Same `MONGO` connection string
- Same `REDIS_URL` connection string
- Same `JWT_SECRET`
- Same other credentials

### **2. Same Code**
Both servers use:
- Same GitHub repository
- Same branch
- Same code

### **3. Automatic Load Balancing**
Render automatically:
- Detects multiple services
- Load balances traffic
- Health checks both servers
- Routes to healthy servers only

---

## 🎯 Quick Checklist

Before creating Server 2:

- [ ] Check existing service settings
- [ ] Note down Build Command
- [ ] Note down Start Command
- [ ] Copy ALL environment variables
- [ ] Create new Web Service
- [ ] Use SAME repository
- [ ] Use SAME branch
- [ ] Paste ALL environment variables
- [ ] Deploy
- [ ] Test both servers

---

## 🎉 Summary

**To add second server to `media-1-aue5.onrender.com`:**

1. **Go to Render Dashboard**
2. **Click "New" → "Web Service"**
3. **Connect SAME repository**
4. **Copy ALL settings** from existing service
5. **Copy ALL environment variables** (especially `MONGO`, `REDIS_URL`, `JWT_SECRET`)
6. **Deploy**
7. **Render automatically load balances!**

**Result:**
- ✅ 2 servers working together
- ✅ Automatic load balancing
- ✅ 2x capacity
- ✅ High availability

**Your existing URL still works, but now has 2 servers behind it!**
