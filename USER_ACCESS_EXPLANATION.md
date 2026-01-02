# How Users Access Your App with Multiple Servers

## 🎯 Short Answer

**Users access ONE website URL** - the load balancer handles routing to backend servers behind the scenes.

---

## 📱 How It Works

### **Scenario 1: Separate Frontend + Backend (Recommended)**

```
User's Browser
    ↓
ONE Frontend URL: https://thredtrain-frontend.onrender.com
    ↓
Frontend makes API calls
    ↓
Backend Load Balancer (Automatic)
    ├── Server 1 (handles some requests)
    └── Server 2 (handles other requests)
```

**User sees:** Only ONE URL (frontend)
**User doesn't know:** There are 2 backend servers

---

### **Scenario 2: Combined Service (Backend Serves Frontend)**

If you have multiple backend services that each serve the frontend:

```
User can access:
- https://thredtrain-backend.onrender.com
- https://thredtrain-backend-2.onrender.com
```

**But this is NOT recommended!** Users shouldn't choose which URL to use.

---

## ✅ Best Practice: ONE Frontend URL

### **Recommended Setup:**

```
1. Frontend Service (Static Site)
   URL: https://thredtrain-frontend.onrender.com
   → Users access THIS URL

2. Backend Services (Multiple, behind the scenes)
   - Server 1: https://thredtrain-backend.onrender.com
   - Server 2: https://thredtrain-backend-2.onrender.com
   → Users DON'T access these directly
```

**How it works:**
1. User visits: `https://thredtrain-frontend.onrender.com`
2. Frontend loads (React app)
3. Frontend makes API calls to: `https://thredtrain-backend.onrender.com`
4. Load balancer routes to Server 1 or Server 2 automatically
5. User doesn't know there are 2 servers

---

## 🔐 Login & Authentication

### **How Login Works:**

1. **User visits:** `https://thredtrain-frontend.onrender.com`
2. **User logs in** → Frontend sends credentials to backend
3. **Backend (Server 1 or 2)** → Validates, creates JWT token
4. **Token stored in cookie** → Works on BOTH servers (same JWT_SECRET)
5. **User logged in** → Can use app normally

### **Key Point:**
- User logs in ONCE
- Token works on BOTH servers (same JWT_SECRET)
- User doesn't know which server handled login
- All requests work seamlessly

---

## 🌐 URL Configuration

### **Option 1: Separate Frontend + Backend**

**Frontend Environment:**
```env
VITE_API_URL=https://thredtrain-backend.onrender.com
```

**User accesses:**
- ✅ `https://thredtrain-frontend.onrender.com` (ONE URL)

**Backend Load Balancer:**
- Server 1: `https://thredtrain-backend.onrender.com`
- Server 2: `https://thredtrain-backend-2.onrender.com`
- Load balancer routes automatically

---

### **Option 2: Combined Service (Not Recommended for Multiple Servers)**

If backend serves frontend and you have 2 servers:

**Problem:**
- User can access Server 1: `https://thredtrain-backend.onrender.com`
- User can access Server 2: `https://thredtrain-backend-2.onrender.com`
- **Users might use different URLs** ❌

**Solution:**
- Use ONE primary URL
- Point domain to one server
- Or use Render's load balancer with custom domain

---

## 🎯 Recommended Setup

### **For Production:**

```
1. Frontend (Static Site)
   URL: https://thredtrain-frontend.onrender.com
   OR custom domain: https://thredtrain.com
   
2. Backend Services (Multiple)
   - Server 1: https://thredtrain-backend.onrender.com
   - Server 2: https://thredtrain-backend-2.onrender.com
   
3. Frontend connects to ONE backend URL
   VITE_API_URL=https://thredtrain-backend.onrender.com
   
4. Load balancer routes to Server 1 or 2 automatically
```

**User Experience:**
- User visits: `https://thredtrain.com` (or frontend URL)
- User logs in ONCE
- All requests work seamlessly
- User doesn't know there are multiple servers

---

## 🔄 How Requests Flow

### **Example: User Logs In**

```
1. User visits: https://thredtrain-frontend.onrender.com
2. User enters credentials
3. Frontend sends: POST /api/user/login
   → To: https://thredtrain-backend.onrender.com
4. Load Balancer routes to Server 1 (or Server 2)
5. Server validates, creates JWT token
6. Token stored in cookie
7. User logged in ✅
```

### **Example: User Makes Move in Chess**

```
1. User makes move
2. Frontend sends: POST /api/chess/move
   → To: https://thredtrain-backend.onrender.com
3. Load Balancer routes to Server 2 (this time)
4. Server 2 processes (has access to same Redis/MongoDB)
5. Move saved, Socket.IO broadcasts
6. User sees move ✅
```

**Note:** User doesn't know which server handled the request!

---

## ❌ What NOT to Do

### **Don't Let Users Choose Server:**

```
❌ Bad:
- "Login on Server 1: https://server1.onrender.com"
- "Login on Server 2: https://server2.onrender.com"
```

**Why:**
- Confusing for users
- Tokens might not work if JWT_SECRET different
- Inconsistent experience

### **Do This Instead:**

```
✅ Good:
- ONE frontend URL
- Frontend connects to ONE backend URL
- Load balancer handles routing
```

---

## 🎯 Custom Domain Setup

### **If You Have Custom Domain:**

```
1. Point domain to frontend:
   thredtrain.com → https://thredtrain-frontend.onrender.com

2. Or point to backend (if combined):
   thredtrain.com → https://thredtrain-backend.onrender.com
   (Load balancer routes to Server 1 or 2)

3. Users always use: https://thredtrain.com
```

---

## 📊 Summary

### **User Perspective:**
- ✅ Visits ONE URL (frontend)
- ✅ Logs in ONCE
- ✅ Uses app normally
- ✅ Doesn't know about multiple servers

### **Your Setup:**
- ✅ Multiple backend servers
- ✅ Load balancer routes automatically
- ✅ All servers share Redis & MongoDB
- ✅ Same JWT_SECRET (tokens work everywhere)

### **Key Points:**
1. **Users access ONE URL** (frontend)
2. **Load balancer handles routing** (automatic)
3. **Tokens work on all servers** (same JWT_SECRET)
4. **User doesn't choose server** (it's automatic)

---

## ✅ Answer to Your Question

**"Can users login from two different website URLs?"**

**Answer:** 
- **Technically:** Yes, if you have 2 combined services
- **Recommended:** No - users should use ONE frontend URL
- **Best Practice:** ONE frontend URL, multiple backend servers behind the scenes

**Users should only see ONE URL!** The load balancer handles the rest automatically.
