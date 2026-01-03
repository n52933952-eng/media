# Scaling Roadmap: From 1K to 1M+ Users

## 🎯 Goal: Scale from current capacity (~5K users) to 1M+ concurrent users

---

## Phase 1: Foundation & Critical Fixes (Weeks 1-2)
**Priority: CRITICAL - Must do first**

### 1.1 Move In-Memory State to Redis
**Current Problem:** `userSocketMap`, `chessGameStates`, `activeChessGames` are in-memory
**Impact:** Won't work with multiple servers, data loss on restart

**Actions:**
- [ ] Install Redis server
- [ ] Install `ioredis` or `redis` npm package
- [ ] Create Redis service layer (`backend/services/redis.js`)
- [ ] Replace `userSocketMap` with Redis hash: `userSocketMap:userId -> socketId`
- [ ] Replace `chessGameStates` with Redis: `chessGameState:roomId -> JSON`
- [ ] Replace `activeChessGames` with Redis: `activeChessGame:userId -> roomId`
- [ ] Update all Socket.IO handlers to use Redis instead of in-memory maps

**Files to modify:**
- `backend/socket/socket.js` - Replace all Map() with Redis calls
- `backend/controller/post.js` - Update `createChessGamePost` to use Redis
- `backend/controller/notification.js` - Use Redis for socket lookups

---

### 1.2 Database Indexing
**Current Problem:** Missing indexes on frequently queried fields
**Impact:** Slow queries, database overload

**Actions:**
- [ ] Add index on `User.followers` field
- [ ] Add index on `User.following` field
- [ ] Add index on `Post.postedBy` field
- [ ] Add index on `Post.createdAt` field (for feed sorting)
- [ ] Add index on `Notification.user` + `Notification.read` + `Notification.createdAt`
- [ ] Add index on `Message.conversationId` + `Message.createdAt`
- [ ] Add compound index on `Post.postedBy` + `Post.createdAt` (for user posts)
- [ ] Add compound index on `Notification.user` + `Notification.type` + `Notification.read`

**Files to modify:**
- `backend/models/user.js` - Add index definitions
- `backend/models/post.js` - Add index definitions
- `backend/models/notification.js` - Add index definitions
- `backend/models/message.js` - Add index definitions

---

### 1.3 Database Connection Pooling
**Current Problem:** No connection pooling configuration
**Impact:** Too many connections, connection exhaustion

**Actions:**
- [ ] Configure Mongoose connection pool size
- [ ] Set `maxPoolSize: 50` (adjust based on server capacity)
- [ ] Set `minPoolSize: 5`
- [ ] Add connection timeout settings
- [ ] Monitor connection usage

**Files to modify:**
- `backend/index.js` - Update `mongoose.connect()` with pool options

---

## Phase 2: Caching Layer (Week 3)
**Priority: HIGH - Major performance boost**

### 2.1 Redis Caching Strategy
**Current Problem:** Every request hits database
**Impact:** Database overload, slow responses

**Actions:**
- [ ] Cache user profiles (TTL: 5 minutes)
- [ ] Cache user followers list (TTL: 2 minutes)
- [ ] Cache feed posts (TTL: 1 minute)
- [ ] Cache notification counts (TTL: 30 seconds)
- [ ] Cache post details (TTL: 5 minutes)
- [ ] Implement cache invalidation on updates

**Implementation:**
```javascript
// Example: Cache user profile
async function getUserProfile(userId) {
  const cacheKey = `user:${userId}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)
  
  const user = await User.findById(userId)
  await redis.setex(cacheKey, 300, JSON.stringify(user)) // 5 min TTL
  return user
}
```

**Files to create:**
- `backend/services/cache.js` - Cache helper functions
- `backend/middleware/cacheMiddleware.js` - Express cache middleware

**Files to modify:**
- `backend/controller/user.js` - Add caching to `getUserProfile`
- `backend/controller/post.js` - Add caching to `getFeedPost`, `getPost`
- `backend/controller/notification.js` - Cache notification counts

---

### 2.2 Cache Invalidation
**Actions:**
- [ ] Invalidate user cache on profile update
- [ ] Invalidate feed cache on new post
- [ ] Invalidate follower cache on follow/unfollow
- [ ] Invalidate notification cache on new notification

---

## Phase 3: Socket.IO Scaling (Week 4)
**Priority: CRITICAL - Real-time won't work without this**

### 3.1 Redis Adapter for Socket.IO
**Current Problem:** Single server, can't scale horizontally
**Impact:** Real-time features break with multiple servers

**Actions:**
- [ ] Install `@socket.io/redis-adapter` and `redis` packages
- [ ] Configure Redis adapter for Socket.IO
- [ ] Test multi-server Socket.IO communication
- [ ] Update all socket events to work with Redis adapter

**Files to modify:**
- `backend/socket/socket.js` - Add Redis adapter configuration

**Code example:**
```javascript
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'

const pubClient = createClient({ url: process.env.REDIS_URL })
const subClient = pubClient.duplicate()

await Promise.all([pubClient.connect(), subClient.connect()])

io.adapter(createAdapter(pubClient, subClient))
```

---

### 3.2 Socket.IO Optimization
**Actions:**
- [ ] Use rooms efficiently (already doing this for chess)
- [ ] Implement socket connection limits per user
- [ ] Add socket authentication middleware
- [ ] Monitor socket connection counts
- [ ] Implement socket reconnection handling

---

## Phase 4: Database Optimization (Week 5)
**Priority: HIGH - Prevents database bottlenecks**

### 4.1 Query Optimization
**Current Problem:** Potential N+1 queries, inefficient queries
**Impact:** Slow responses, database overload

**Actions:**
- [ ] Review all database queries for N+1 problems
- [ ] Use `.populate()` efficiently (avoid deep nesting)
- [ ] Use `.select()` to limit fields returned
- [ ] Implement pagination for all list endpoints
- [ ] Use aggregation pipelines for complex queries
- [ ] Add query logging to identify slow queries

**Files to review:**
- `backend/controller/post.js` - `getFeedPost` (check for N+1)
- `backend/controller/user.js` - `getSuggestedUsers` (optimize)
- `backend/controller/notification.js` - `getNotifications` (add pagination)

---

### 4.2 Database Sharding Strategy
**Actions:**
- [ ] Plan sharding strategy (by user ID or region)
- [ ] Implement read replicas for read-heavy operations
- [ ] Set up MongoDB replica set
- [ ] Configure read preference for queries

---

### 4.3 Pagination Implementation
**Current Problem:** Loading all data at once
**Impact:** Memory issues, slow responses

**Actions:**
- [ ] Add pagination to feed posts (limit: 20 per page)
- [ ] Add pagination to notifications (limit: 50 per page)
- [ ] Add pagination to messages (limit: 50 per page)
- [ ] Add pagination to user posts (limit: 20 per page)
- [ ] Implement cursor-based pagination for better performance

**Files to modify:**
- `backend/controller/post.js` - Add pagination to all list endpoints
- `backend/controller/notification.js` - Add pagination
- `backend/controller/message.js` - Add pagination

---

## Phase 5: Infrastructure & Deployment (Week 6)
**Priority: HIGH - Required for production**

### 5.1 Load Balancing
**Actions:**
- [ ] Set up Nginx or cloud load balancer
- [ ] Configure sticky sessions for Socket.IO
- [ ] Set up health check endpoints
- [ ] Configure SSL/TLS certificates
- [ ] Set up multiple app server instances

**Configuration:**
```nginx
# Nginx config for Socket.IO sticky sessions
upstream backend {
    ip_hash;  # Sticky sessions
    server app1:5000;
    server app2:5000;
    server app3:5000;
}
```

---

### 5.2 Auto-Scaling
**Actions:**
- [ ] Set up auto-scaling based on CPU/memory
- [ ] Configure minimum/maximum instances
- [ ] Set up scaling policies
- [ ] Test scaling under load

---

### 5.3 CDN for Static Assets
**Actions:**
- [ ] Move static assets to CDN (CloudFront, Cloudflare)
- [ ] Configure CDN caching rules
- [ ] Update asset URLs in frontend

---

## Phase 6: Monitoring & Observability (Week 7)
**Priority: MEDIUM - Important for production**

### 6.1 Application Monitoring
**Actions:**
- [ ] Set up APM (Application Performance Monitoring)
- [ ] Add error tracking (Sentry, Rollbar)
- [ ] Monitor response times
- [ ] Track database query performance
- [ ] Monitor Socket.IO connection counts

**Tools:**
- Datadog, New Relic, or Prometheus + Grafana

---

### 6.2 Logging
**Actions:**
- [ ] Implement structured logging
- [ ] Set up centralized logging (ELK stack, CloudWatch)
- [ ] Add request ID tracking
- [ ] Log errors with context

**Files to create:**
- `backend/utils/logger.js` - Centralized logging utility

---

### 6.3 Health Checks
**Actions:**
- [ ] Create `/health` endpoint
- [ ] Create `/ready` endpoint (checks DB, Redis)
- [ ] Set up health check monitoring
- [ ] Configure alerts for failures

**Files to create:**
- `backend/routes/health.js` - Health check endpoints

---

## Phase 7: Security & Rate Limiting (Week 8)
**Priority: HIGH - Security critical**

### 7.1 Rate Limiting
**Actions:**
- [ ] Install `express-rate-limit` package
- [ ] Add rate limiting to authentication endpoints
- [ ] Add rate limiting to post creation
- [ ] Add rate limiting to follow/unfollow
- [ ] Add rate limiting to comments
- [ ] Use Redis for distributed rate limiting

**Files to create:**
- `backend/middleware/rateLimiter.js` - Rate limiting middleware

**Example:**
```javascript
const rateLimit = require('express-rate-limit')
const RedisStore = require('rate-limit-redis')

const limiter = rateLimit({
  store: new RedisStore({
    client: redisClient
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
})
```

---

### 7.2 Input Validation
**Actions:**
- [ ] Add input validation middleware (Joi, express-validator)
- [ ] Sanitize user inputs
- [ ] Validate file uploads (size, type)
- [ ] Add SQL injection protection (MongoDB is safe, but good practice)
- [ ] Add XSS protection

**Files to create:**
- `backend/middleware/validation.js` - Input validation middleware

---

### 7.3 Security Headers
**Actions:**
- [ ] Add helmet.js for security headers
- [ ] Configure CORS properly
- [ ] Add CSRF protection
- [ ] Secure cookies

**Files to modify:**
- `backend/index.js` - Add helmet middleware

---

## Phase 8: Performance Optimization (Week 9-10)
**Priority: MEDIUM - Nice to have**

### 8.1 Frontend Optimization
**Actions:**
- [ ] Implement code splitting
- [ ] Add lazy loading for components
- [ ] Optimize bundle size
- [ ] Add service worker for caching
- [ ] Implement virtual scrolling for long lists
- [ ] Optimize images (WebP, lazy loading)

---

### 8.2 Backend Optimization
**Actions:**
- [ ] Add compression middleware (gzip)
- [ ] Optimize JSON responses (remove unnecessary fields)
- [ ] Implement request batching where possible
- [ ] Use streaming for large responses
- [ ] Optimize file upload handling

---

### 8.3 Database Query Optimization
**Actions:**
- [ ] Review slow query log
- [ ] Add missing indexes
- [ ] Optimize aggregation pipelines
- [ ] Use projection to limit returned fields
- [ ] Implement database query caching

---

## Phase 9: Testing & Load Testing (Week 11)
**Priority: HIGH - Must validate before production**

### 9.1 Load Testing
**Actions:**
- [ ] Set up load testing tools (k6, Artillery, JMeter)
- [ ] Test with 1K concurrent users
- [ ] Test with 10K concurrent users
- [ ] Test with 100K concurrent users
- [ ] Identify bottlenecks
- [ ] Optimize based on results

**Test scenarios:**
- User registration/login
- Post creation/reading
- Real-time messaging
- Chess game creation
- Notification delivery
- Feed loading

---

### 9.2 Stress Testing
**Actions:**
- [ ] Test database under load
- [ ] Test Redis under load
- [ ] Test Socket.IO under load
- [ ] Test file uploads under load
- [ ] Identify breaking points

---

## Phase 10: Documentation & Runbooks (Week 12)
**Priority: MEDIUM - Important for operations**

### 10.1 Documentation
**Actions:**
- [ ] Document architecture
- [ ] Document deployment process
- [ ] Document scaling procedures
- [ ] Document monitoring dashboards
- [ ] Document incident response procedures

---

### 10.2 Runbooks
**Actions:**
- [ ] Create runbook for common issues
- [ ] Document rollback procedures
- [ ] Document scaling procedures
- [ ] Document database backup/restore

---

## Implementation Priority Summary

### Must Do (Critical Path):
1. ✅ Phase 1: Foundation & Critical Fixes
2. ✅ Phase 3: Socket.IO Scaling
3. ✅ Phase 5: Infrastructure & Deployment
4. ✅ Phase 7: Security & Rate Limiting

### Should Do (High Priority):
5. ✅ Phase 2: Caching Layer
6. ✅ Phase 4: Database Optimization
7. ✅ Phase 9: Testing & Load Testing

### Nice to Have:
8. ✅ Phase 6: Monitoring & Observability
9. ✅ Phase 8: Performance Optimization
10. ✅ Phase 10: Documentation & Runbooks

---

## Estimated Timeline

- **Minimum (Critical Path Only):** 6-8 weeks
- **Recommended (All Phases):** 12 weeks
- **With Team of 2-3 Developers:** 8-10 weeks

---

## Cost Estimates (Monthly)

### Small Scale (10K users):
- App Servers: $200-500
- Database: $100-300
- Redis: $50-100
- CDN: $50-100
- Monitoring: $50-100
- **Total: ~$500-1,100/month**

### Medium Scale (100K users):
- App Servers: $1,000-2,000
- Database: $500-1,000
- Redis: $200-500
- CDN: $200-500
- Monitoring: $200-500
- **Total: ~$2,100-4,500/month**

### Large Scale (1M users):
- App Servers: $5,000-10,000
- Database: $2,000-5,000
- Redis: $1,000-2,000
- CDN: $1,000-2,000
- Monitoring: $500-1,000
- Load Balancer: $500-1,000
- **Total: ~$10,000-21,000/month**

---

## Key Metrics to Monitor

1. **Response Times:**
   - API response time (target: <200ms)
   - Database query time (target: <50ms)
   - Socket.IO latency (target: <100ms)

2. **Throughput:**
   - Requests per second
   - Socket.IO messages per second
   - Database queries per second

3. **Resource Usage:**
   - CPU usage (target: <70%)
   - Memory usage (target: <80%)
   - Database connections (target: <80% of pool)

4. **Error Rates:**
   - API error rate (target: <0.1%)
   - Socket.IO error rate (target: <0.1%)
   - Database error rate (target: <0.01%)

---

## Next Steps

1. Review this roadmap
2. Prioritize phases based on current user growth
3. Set up development environment with Redis
4. Start with Phase 1 (Foundation & Critical Fixes)
5. Test incrementally after each phase
6. Monitor and adjust based on metrics

---

## Notes

- This roadmap assumes gradual user growth
- Adjust timeline based on team size and priorities
- Some phases can be done in parallel
- Always test thoroughly before moving to next phase
- Monitor metrics continuously and adjust as needed


