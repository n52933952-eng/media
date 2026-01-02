# Render Deployment Guide - Frontend + Backend

## 📁 Your Project Structure

```
thredtrain/
├── backend/          (Node.js/Express API)
├── frontent/        (React/Vite Frontend)
└── package.json     (Root package.json)
```

---

## 🚀 Deployment Options

### **Option 1: Separate Services (Recommended)**
- ✅ Backend: Web Service
- ✅ Frontend: Static Site
- ✅ Better separation
- ✅ Independent scaling

### **Option 2: Combined Service**
- Backend serves frontend
- Single service
- Simpler setup

---

## 📋 Option 1: Separate Services (Recommended)

### **Step 1: Deploy Backend**

1. **Go to Render Dashboard** → **New** → **Web Service**
2. **Connect GitHub** → Select your repository
3. **Configure:**

```
Name: thredtrain-backend
Region: Choose closest to users
Branch: main (or your main branch)
Root Directory: (leave empty)
Runtime: Node
Build Command: npm install
Start Command: node backend/index.js
```

4. **Environment Variables:**

```env
MONGO=mongodb+srv://username:password@cluster.mongodb.net/dbname
REDIS_URL=redis://username:password@host:port
JWT_SECRET=your-super-secret-jwt-key-here
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
FRONTEND_URL=https://thredtrain-frontend.onrender.com
PORT=10000
```

5. **Click "Create Web Service"**

**Result:** `https://thredtrain-backend.onrender.com`

---

### **Step 2: Deploy Frontend**

1. **Go to Render Dashboard** → **New** → **Static Site**
2. **Connect GitHub** → Select your repository
3. **Configure:**

```
Name: thredtrain-frontend
Region: Choose closest to users
Branch: main (or your main branch)
Root Directory: frontent
Build Command: npm install && npm run build
Publish Directory: frontent/dist
```

4. **Environment Variables (for build):**

```env
VITE_API_URL=https://thredtrain-backend.onrender.com
```

5. **Click "Create Static Site"**

**Result:** `https://thredtrain-frontend.onrender.com`

---

### **Step 3: Update CORS in Backend**

Make sure backend allows frontend origin:

```env
FRONTEND_URL=https://thredtrain-frontend.onrender.com
```

This is already configured in your `backend/index.js`:
```javascript
app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true
}))
```

---

## 📋 Option 2: Combined Service (Backend Serves Frontend)

### **Single Web Service**

1. **Go to Render Dashboard** → **New** → **Web Service**
2. **Connect GitHub** → Select your repository
3. **Configure:**

```
Name: thredtrain-app
Region: Choose closest to users
Branch: main
Root Directory: (leave empty)
Runtime: Node
Build Command: npm run build
Start Command: node backend/index.js
```

4. **Environment Variables:**

```env
MONGO=mongodb+srv://...
REDIS_URL=redis://...
JWT_SECRET=...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
FRONTEND_URL=https://thredtrain-app.onrender.com
PORT=10000
```

5. **Click "Create Web Service"**

**Result:** `https://thredtrain-app.onrender.com`

**Note:** Your backend already serves the frontend in production:
```javascript
// Serve static files from React app (for production)
app.use(express.static(path.join(__dirname, '../frontent/dist')))

// Catch all handler: send back React's index.html file
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontent/dist/index.html'))
})
```

---

## 🔧 Frontend API Configuration

Your frontend is now configured to use environment variables:

**File:** `frontent/src/config/api.js`

```javascript
// Uses VITE_API_URL if set, otherwise same origin or localhost
export const API_BASE_URL = import.meta.env.VITE_API_URL 
    || (import.meta.env.PROD 
        ? window.location.origin
        : "http://localhost:5000")
```

### **For Separate Services:**
Set `VITE_API_URL=https://thredtrain-backend.onrender.com` in frontend build

### **For Combined Service:**
Don't set `VITE_API_URL` - it will use same origin automatically

---

## 🌐 Environment Variables Summary

### **Backend Required:**
```env
MONGO=                    # MongoDB connection string
REDIS_URL=               # Redis connection string (REQUIRED)
JWT_SECRET=              # Secret for JWT tokens
CLOUDINARY_CLOUD_NAME=   # Cloudinary cloud name
CLOUDINARY_API_KEY=      # Cloudinary API key
CLOUDINARY_API_SECRET=   # Cloudinary API secret
FRONTEND_URL=            # Frontend URL (for CORS)
PORT=                    # Port (Render auto-assigns, but can set)
```

### **Frontend (Separate Service Only):**
```env
VITE_API_URL=            # Backend API URL
```

---

## 🧪 Testing After Deployment

### **Test Backend:**
```bash
curl https://thredtrain-backend.onrender.com/health
```

Expected:
```json
{
  "status": "ok",
  "checks": {
    "database": "ok",
    "redis": "ok"
  }
}
```

### **Test Frontend:**
- Visit: `https://thredtrain-frontend.onrender.com`
- Should load and connect to backend

### **Test Combined:**
- Visit: `https://thredtrain-app.onrender.com`
- Should load frontend and API works

---

## 🔄 Deploying Multiple Backend Instances

To scale with multiple backend servers:

1. **Create additional Web Services** (same repo)
2. **Use SAME environment variables** (especially `MONGO`, `REDIS_URL`, `JWT_SECRET`)
3. **Render automatically load balances**

Example:
- `thredtrain-backend-1` → Port 10000
- `thredtrain-backend-2` → Port 10000
- Both share same MongoDB & Redis
- Render load balances automatically

---

## 📊 Comparison

### **Option 1: Separate Services**
✅ **Pros:**
- Independent scaling
- Frontend cached (faster)
- Better separation
- Frontend updates don't restart backend

❌ **Cons:**
- 2 services to manage
- Need to set `VITE_API_URL`

### **Option 2: Combined Service**
✅ **Pros:**
- Single service
- Simpler setup
- No CORS issues
- One URL

❌ **Cons:**
- Frontend updates restart backend
- Less flexible scaling

---

## 🎯 Recommendation

### **For Development/Testing:**
→ Use **Option 2** (Combined) - Simpler

### **For Production:**
→ Use **Option 1** (Separate) - Better scaling

---

## 🚨 Common Issues

### **Issue 1: CORS Errors**
**Fix:** Set `FRONTEND_URL` in backend to match frontend URL

### **Issue 2: API Not Found**
**Fix:** Set `VITE_API_URL` in frontend build environment

### **Issue 3: Redis Connection Failed**
**Fix:** Ensure `REDIS_URL` is correct and Redis is accessible

### **Issue 4: Build Fails**
**Fix:** Check `Root Directory` and `Build Command` are correct

---

## ✅ Quick Checklist

### **Backend Deployment:**
- [ ] Root Directory: (empty)
- [ ] Build Command: `npm install`
- [ ] Start Command: `node backend/index.js`
- [ ] All environment variables set
- [ ] `FRONTEND_URL` matches frontend URL

### **Frontend Deployment (Separate):**
- [ ] Root Directory: `frontent`
- [ ] Build Command: `npm install && npm run build`
- [ ] Publish Directory: `frontent/dist`
- [ ] `VITE_API_URL` set to backend URL

### **Combined Deployment:**
- [ ] Root Directory: (empty)
- [ ] Build Command: `npm run build`
- [ ] Start Command: `node backend/index.js`
- [ ] All environment variables set

---

## 🎉 Summary

**Your app is ready to deploy!**

1. **Choose deployment option** (Separate or Combined)
2. **Set environment variables**
3. **Deploy on Render**
4. **Test health endpoint**
5. **Scale by adding more backend instances**

**Both options work - choose based on your needs!**
