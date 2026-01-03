# How to Set Up Load Balancer - Step by Step

## 🎯 Easiest Options (Choose One)

### **Option 1: Custom Domain with DNS (Easiest)**
### **Option 2: Use Nginx as Load Balancer (Best)**
### **Option 3: Use One URL (Simplest - No Load Balancing)**

---

## 📋 Option 1: Custom Domain with DNS (Easiest)

### **Step 1: Get Custom Domain**

1. **Buy domain** from:
   - Namecheap.com
   - GoDaddy.com
   - Google Domains
   - Any domain registrar

**Example:** `thredtrain.com` (or your preferred name)

---

### **Step 2: Get IP Addresses from Render**

1. **Go to Render Dashboard**
2. **Click on Server 1** (`media-1-aue5`)
3. **Go to "Settings" tab**
4. **Look for "IP Address" or "Service Info"**
5. **Note the IP address** (e.g., `123.45.67.89`)

**Repeat for Server 2:**
1. **Click on Server 2** (`media-2-aue5`)
2. **Get IP address**

**If Render doesn't show IP:**
- Contact Render support
- Or use CNAME records instead (see below)

---

### **Step 3: Configure DNS Records**

**Go to your domain registrar's DNS settings:**

**Option A: Using A Records (If you have IPs)**

```
Type: A
Name: @
Value: [Server 1 IP from Render]
TTL: 300

Type: A
Name: @
Value: [Server 2 IP from Render]
TTL: 300
```

**Option B: Using CNAME Records (If no IPs)**

```
Type: CNAME
Name: @
Value: media-1-aue5.onrender.com
TTL: 300

Type: CNAME
Name: www
Value: media-1-aue5.onrender.com
TTL: 300
```

**Note:** CNAME only points to one service. For true load balancing, you need A records with IPs.

---

### **Step 4: Add Custom Domain to Render**

1. **Go to Server 1** on Render
2. **Settings** → **Custom Domains**
3. **Add:** `thredtrain.com`
4. **Follow DNS instructions**

**Repeat for Server 2:**
1. **Go to Server 2** on Render
2. **Settings** → **Custom Domains**
3. **Add:** `thredtrain.com` (same domain)

**Note:** Some registrars allow multiple A records for round-robin DNS load balancing.

---

### **Step 5: Wait for DNS Propagation**

- **Wait 5-30 minutes** for DNS to propagate
- **Test:** `ping thredtrain.com` (should resolve)

---

### **Result:**
- Users visit: `https://thredtrain.com/`
- DNS round-robin distributes to Server 1 or Server 2
- Basic load balancing ✅

---

## 📋 Option 2: Nginx Load Balancer (Best Solution)

### **Step 1: Set Up Nginx Server**

**You need a server to run Nginx:**

**Option A: Use Render (New Service)**
1. **Create new Web Service** on Render
2. **Name:** `thredtrain-loadbalancer`
3. **Use Nginx configuration** (see below)

**Option B: Use VPS (DigitalOcean, AWS EC2, etc.)**
1. **Create VPS** (smallest is fine)
2. **Install Nginx**
3. **Configure** (see below)

---

### **Step 2: Install Nginx**

**On your server/VPS:**

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

### **Step 3: Configure Nginx**

**Edit Nginx config file:**

```bash
sudo nano /etc/nginx/sites-available/thredtrain
```

**Add this configuration:**

```nginx
upstream backend {
    # Round-robin load balancing
    server media-1-aue5.onrender.com;
    server media-2-aue5.onrender.com;
    
    # Optional: Add weights
    # server media-1-aue5.onrender.com weight=3;
    # server media-2-aue5.onrender.com weight=1;
}

server {
    listen 80;
    server_name thredtrain.com www.thredtrain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name thredtrain.com www.thredtrain.com;

    # SSL certificates (use Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/thredtrain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/thredtrain.com/privkey.pem;

    # Proxy to backend servers
    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support (for Socket.IO)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

### **Step 4: Enable Site**

```bash
# Create symlink
sudo ln -s /etc/nginx/sites-available/thredtrain /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

---

### **Step 5: Set Up SSL (Let's Encrypt)**

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d thredtrain.com -d www.thredtrain.com
```

---

### **Result:**
- Users visit: `https://thredtrain.com/`
- Nginx load balances between Server 1 and Server 2
- True application load balancing ✅
- SSL/HTTPS included ✅

---

## 📋 Option 3: Use One URL (Simplest - No Load Balancing)

### **If you don't need load balancing right now:**

1. **Use Server 1 URL** for all users: `https://media-1-aue5.onrender.com/`
2. **Server 2 is backup** (manual switch if Server 1 goes down)
3. **No load balancing** - but simple and works

**To switch to Server 2:**
- Just change frontend API URL to Server 2
- Or redirect users to Server 2 URL

---

## 🎯 Which Option to Choose?

### **Option 1: Custom Domain with DNS**
- ✅ Easiest
- ✅ No extra server needed
- ⚠️ Basic DNS round-robin (not true load balancing)
- ⚠️ May not work if Render doesn't provide IPs

### **Option 2: Nginx Load Balancer**
- ✅ Best solution
- ✅ True application load balancing
- ✅ Health checks, SSL, WebSocket support
- ❌ Requires extra server/VPS

### **Option 3: Use One URL**
- ✅ Simplest
- ✅ No setup needed
- ❌ No load balancing
- ❌ Single point of failure

---

## 🚀 Quick Start (Recommended)

### **For Quick Setup: Option 1 (Custom Domain)**

1. **Buy domain** (e.g., `thredtrain.com`)
2. **Get IPs from Render** (or use CNAME)
3. **Add DNS A records** (pointing to both servers)
4. **Add custom domain to both Render services**
5. **Wait for DNS propagation**
6. **Done!** ✅

### **For Production: Option 2 (Nginx)**

1. **Get VPS** (DigitalOcean, AWS, etc.)
2. **Install Nginx**
3. **Configure** (use config above)
4. **Set up SSL** (Let's Encrypt)
5. **Point domain to Nginx server**
6. **Done!** ✅

---

## 📋 Step-by-Step: Option 1 (Easiest)

### **1. Buy Domain**
- Go to Namecheap/GoDaddy
- Buy `thredtrain.com` (or your name)
- Cost: ~$10-15/year

### **2. Get Render Service Info**
- Go to Render Dashboard
- Check if services show IP addresses
- If not, contact Render support

### **3. Configure DNS**
- Go to domain registrar DNS settings
- Add A records pointing to both server IPs
- Save changes

### **4. Add Custom Domain to Render**
- Server 1 → Settings → Custom Domains → Add domain
- Server 2 → Settings → Custom Domains → Add domain
- Follow Render's instructions

### **5. Wait & Test**
- Wait 5-30 minutes
- Visit `https://thredtrain.com/`
- Should work! ✅

---

## ✅ Summary

**To set up load balancer:**

**Easiest:** Custom domain with DNS (Option 1)
**Best:** Nginx load balancer (Option 2)
**Simplest:** Use one URL (Option 3 - no load balancing)

**Choose based on your needs!**


