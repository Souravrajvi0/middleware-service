# 50 Backend Interview Questions - Junior Level (7-10 LPA)

## 🎯 For 1-Year Experience Backend Developers

---

## Node.js & JavaScript Basics

### Q1: What is Node.js and why did you use it?
**A:** "Node.js is a JavaScript runtime built on Chrome's V8 engine. I used it because:
- **Non-blocking I/O**: Perfect for I/O-heavy tasks like PDF processing and API calls
- **Same language**: NetSuite uses JavaScript, so integration was seamless
- **NPM ecosystem**: Rich libraries like Express, AWS SDK, Axios
- **Performance**: Handles 10,000+ concurrent requests efficiently"

### Q2: Explain async/await vs callbacks
**A:** "In my project, I use async/await for cleaner code:
```javascript
// Old way (callbacks) - callback hell
uploadToS3(pdf, function(err, result) {
  if (err) return handleError(err);
  saveToDb(result, function(err, data) {
    if (err) return handleError(err);
    sendToZoho(data, function(err) {
      // nested callbacks...
    });
  });
});

// My way (async/await) - clean and readable
async function processPDF(pdf) {
  try {
    const s3Result = await uploadToS3(pdf);
    const dbData = await saveToDb(s3Result);
    await sendToZoho(dbData);
  } catch (error) {
    handleError(error);
  }
}
```
Benefits: Better error handling, easier to read, avoids callback hell."

### Q3: What is Express.js middleware?
**A:** "Middleware are functions that execute in sequence before reaching route handlers. In my project:
```javascript
app.use(requestLogger);      // 1. Log request
app.use(cors());             // 2. Handle CORS
app.use(express.json());     // 3. Parse JSON body
app.use(validateApiKey);     // 4. Check API key
app.post('/api/convert', handler); // 5. Route handler
```
Each middleware can modify `req`, `res`, or call `next()` to continue."

### Q4: How do you handle errors in Node.js?
**A:** "I use try-catch with async/await and error middleware:
```javascript
// Route handler
app.post('/api/convert', async (req, res, next) => {
  try {
    const result = await processPDF(req.body);
    res.json(result);
  } catch (error) {
    next(error); // Pass to error handler
  }
});

// Global error handler (last middleware)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});
```
This catches all errors in one place."

### Q5: What is the event loop?
**A:** "Event loop handles async operations in Node.js. When I call `await uploadToS3()`, Node.js doesn't block—it continues processing other requests. When S3 upload completes, the callback goes to event queue and executes. This lets my server handle 1000+ concurrent requests on a single thread."

---

## Database & SQL

### Q6: Why PostgreSQL instead of MySQL?
**A:** "I chose PostgreSQL for:
- **JSONB support**: Store flexible API logs without schema changes
- **Better indexing**: Partial indexes for status queries
- **ACID compliance**: Financial data needs strong consistency
- **Advanced features**: Window functions, CTEs for complex reports"

### Q7: What are indexes and when to use them?
**A:** "Indexes speed up queries. In my project:
```sql
-- Without index: Scans 1 million rows (slow)
SELECT * FROM transactions WHERE status = 'pending';

-- With index: Uses index (fast)
CREATE INDEX idx_status ON transactions(status);
```
I add indexes on columns used in WHERE, JOIN, ORDER BY. But too many indexes slow down INSERT/UPDATE."

### Q8: Explain ACID properties
**A:** "ACID ensures database reliability:
- **Atomicity**: Transaction succeeds completely or fails completely
- **Consistency**: Data follows all rules (constraints)
- **Isolation**: Concurrent transactions don't interfere
- **Durability**: Committed data survives crashes

Example: When I insert transaction + log, both succeed or both fail (atomicity)."

### Q9: What is a foreign key?
**A:** "Links two tables. In my schema:
```sql
CREATE TABLE api_audit_logs (
  log_id UUID PRIMARY KEY,
  transaction_id UUID REFERENCES transactions(transaction_id),
  -- other columns
);
```
This ensures `transaction_id` in logs must exist in transactions table."

### Q10: How do you prevent SQL injection?
**A:** "Use parameterized queries:
```javascript
// BAD - SQL injection risk
const query = `SELECT * FROM users WHERE email = '${userInput}'`;

// GOOD - parameterized
const query = 'SELECT * FROM users WHERE email = $1';
await db.query(query, [userInput]);
```
Database escapes special characters automatically."

---

## REST APIs

### Q11: What is REST?
**A:** "REST is an architectural style for APIs using HTTP methods:
- **GET**: Retrieve data (e.g., `GET /transactions`)
- **POST**: Create data (e.g., `POST /api/convert`)
- **PUT**: Update entire resource
- **PATCH**: Update partial resource
- **DELETE**: Remove data

My API uses POST for PDF uploads because we're creating new transactions."

### Q12: What are HTTP status codes?
**A:** "I use these in my project:
- **200 OK**: Success (health check)
- **202 Accepted**: Async processing started
- **400 Bad Request**: Invalid input (missing fileName)
- **401 Unauthorized**: Invalid API key
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: Server crashed
- **503 Service Unavailable**: Database down"

### Q13: What is CORS and why needed?
**A:** "CORS (Cross-Origin Resource Sharing) allows browsers to call APIs from different domains. Without CORS:
```javascript
// Frontend at example.com calls api.myapp.com
// Browser blocks request (security)

// Solution: Enable CORS
app.use(cors({
  origin: 'https://example.com',
  methods: ['GET', 'POST']
}));
```
I allow NetSuite's domain to call my API."

### Q14: GET vs POST - when to use?
**A:** "
- **GET**: Retrieve data, idempotent (safe to repeat), data in URL
- **POST**: Create/modify data, not idempotent, data in body

I use POST for PDF upload because:
1. Sending large Base64 data (can't fit in URL)
2. Creating new transaction (not idempotent)
3. Modifying server state"

### Q15: What is API authentication?
**A:** "I use API key authentication:
```javascript
app.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```
NetSuite sends `x-api-key: NSZoho@8080` in headers. More secure methods: JWT, OAuth."

---

## AWS Basics

### Q16: What is EC2?
**A:** "EC2 (Elastic Compute Cloud) is a virtual server in AWS. I run my Node.js app on EC2 t3.medium instances (2 vCPU, 4GB RAM). Like renting a computer in the cloud—I can SSH, install software, deploy apps."

### Q17: What is S3?
**A:** "S3 (Simple Storage Service) is object storage. I use it to store PDFs:
```javascript
await s3.putObject({
  Bucket: 'middleware-pdfs',
  Key: 'invoice.pdf',
  Body: pdfBuffer
});
```
Benefits: Unlimited storage, $0.023/GB/month, 99.999999999% durability."

### Q18: What is a Load Balancer?
**A:** "Distributes traffic across multiple servers. My ALB (Application Load Balancer):
```
User Request → ALB → EC2 Instance 1 (if healthy)
                  → EC2 Instance 2 (if Instance 1 busy)
```
Benefits: High availability, auto-scaling, SSL termination."

### Q19: What is Auto Scaling?
**A:** "Automatically adds/removes servers based on load:
- **Normal**: 2 EC2 instances
- **Peak (month-end)**: Scales to 10 instances
- **Night**: Scales down to 1 instance

Saves cost (pay only for what you use) and handles traffic spikes."

### Q20: What is RDS?
**A:** "RDS (Relational Database Service) is managed PostgreSQL/MySQL. AWS handles:
- Backups (automated daily)
- Updates (security patches)
- Scaling (increase storage)
- Multi-AZ (automatic failover)

I just connect and run queries—no server management."

---

## System Design Basics

### Q21: What is a queue and why use it?
**A:** "Queue decouples producer and consumer. In my project:
```
NetSuite → API (producer) → SQS Queue → Worker (consumer) → Zoho
```
Benefits:
- NetSuite gets immediate response (no timeout)
- Workers process at their own pace
- Automatic retry if worker fails
- Handles traffic spikes (queue buffers requests)"

### Q22: Synchronous vs Asynchronous processing?
**A:** "
**Synchronous**: Wait for response before continuing
```javascript
const result = uploadToZoho(pdf); // Blocks for 10 seconds
return result;
```

**Asynchronous**: Continue without waiting
```javascript
await queue.send(pdf); // Returns in 100ms
return { status: 'processing' };
// Worker processes later
```
I use async because NetSuite has 60-second timeout."

### Q23: What is caching and why use it?
**A:** "Store frequently accessed data in memory. I cache Zoho OAuth tokens in Redis:
```javascript
// Without cache: Call Zoho API every request (2 seconds)
const token = await zoho.refreshToken();

// With cache: Call once per hour
let token = await redis.get('zoho_token');
if (!token) {
  token = await zoho.refreshToken();
  await redis.setex('zoho_token', 3600, token);
}
```
Result: 60% fewer API calls, 95% faster."

### Q24: What is horizontal vs vertical scaling?
**A:** "
**Vertical**: Bigger server (t3.medium → t3.large)
- Pros: Simple
- Cons: Expensive, limited (can't scale infinitely)

**Horizontal**: More servers (2 instances → 10 instances)
- Pros: Unlimited scaling, cheaper
- Cons: Need load balancer, distributed state

I use horizontal scaling with Auto Scaling Group."

### Q25: What is a microservice?
**A:** "Breaking app into small, independent services. Instead of one big app:
```
Monolith: [Auth + PDF Processing + Billing] (one codebase)

Microservices:
- Auth Service (port 3000)
- PDF Service (port 3001)
- Billing Service (port 3002)
```
Benefits: Deploy independently, scale separately, different tech stacks."

---

## Git & Version Control

### Q26: What is Git?
**A:** "Version control system to track code changes. Basic workflow:
```bash
git clone <repo>           # Download code
git checkout -b feature    # Create branch
# Make changes
git add .                  # Stage changes
git commit -m "message"    # Save changes
git push origin feature    # Upload to GitHub
# Create Pull Request
```"

### Q27: What is a branch?
**A:** "Separate line of development. I use:
- `main`: Production code
- `dev`: Development code
- `feature/pdf-upload`: New feature
- `hotfix/memory-leak`: Urgent bug fix

Branches let multiple developers work without conflicts."

### Q28: What is a merge conflict?
**A:** "When two people edit same line:
```javascript
// My code (feature branch)
const port = 3000;

// Teammate's code (main branch)
const port = 8080;

// Git can't decide - manual fix needed
<<<<<<< HEAD
const port = 3000;
=======
const port = 8080;
>>>>>>> main
```
I resolve by choosing correct version or combining both."

### Q29: What is a Pull Request?
**A:** "Request to merge code into main branch. Workflow:
1. Push feature branch to GitHub
2. Create PR (Pull Request)
3. Team reviews code
4. CI/CD runs tests
5. If approved, merge to main
6. Auto-deploy to production"

### Q30: What is .gitignore?
**A:** "Tells Git to ignore files:
```
node_modules/    # Don't commit dependencies
.env             # Don't commit secrets
*.log            # Don't commit logs
dist/            # Don't commit build files
```
Keeps repo clean and secure."

---

## Security

### Q31: How do you store passwords?
**A:** "Never store plain text! Use bcrypt:
```javascript
// Registration
const hashedPassword = await bcrypt.hash(password, 10);
await db.query('INSERT INTO users (password) VALUES ($1)', [hashedPassword]);

// Login
const user = await db.query('SELECT password FROM users WHERE email = $1', [email]);
const isValid = await bcrypt.compare(password, user.password);
```
Even if database leaks, passwords are safe."

### Q32: What is environment variable?
**A:** "Store secrets outside code:
```javascript
// BAD - hardcoded secret
const apiKey = 'NSZoho@8080';

// GOOD - environment variable
const apiKey = process.env.API_KEY;
```
`.env` file:
```
API_KEY=NSZoho@8080
DB_PASSWORD=secret123
```
Never commit `.env` to Git!"

### Q33: What is HTTPS vs HTTP?
**A:** "
- **HTTP**: Plain text (anyone can read)
- **HTTPS**: Encrypted with SSL/TLS

My ALB uses HTTPS (port 443) so API keys and PDFs are encrypted in transit."

### Q34: What is JWT?
**A:** "JSON Web Token for authentication:
```javascript
// Login: Generate token
const token = jwt.sign({ userId: 123 }, 'secret', { expiresIn: '1h' });
res.json({ token });

// Protected route: Verify token
const decoded = jwt.verify(token, 'secret');
console.log(decoded.userId); // 123
```
User sends token in headers for subsequent requests."

### Q35: What is rate limiting?
**A:** "Prevent abuse by limiting requests:
```javascript
const limiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 100              // 100 requests per minute
});
app.use(limiter);
```
If user exceeds limit, return 429 Too Many Requests."

---

## Performance

### Q36: What is connection pooling?
**A:** "Reuse database connections instead of creating new ones:
```javascript
// Without pool: New connection per request (slow)
const client = new Client();
await client.connect(); // 500ms
await client.query('SELECT...');
await client.end();

// With pool: Reuse connections (fast)
const pool = new Pool({ max: 20 });
await pool.query('SELECT...'); // 5ms
```
My pool has 20 connections shared across all requests."

### Q37: What is N+1 query problem?
**A:** "Making too many database queries:
```javascript
// BAD - N+1 queries
const transactions = await db.query('SELECT * FROM transactions'); // 1 query
for (const t of transactions) {
  const logs = await db.query('SELECT * FROM logs WHERE transaction_id = $1', [t.id]); // N queries
}

// GOOD - 1 query with JOIN
const result = await db.query(`
  SELECT t.*, l.*
  FROM transactions t
  LEFT JOIN logs l ON t.id = l.transaction_id
`);
```"

### Q38: How do you optimize API response time?
**A:** "Multiple strategies:
1. **Caching**: Redis for frequently accessed data
2. **Indexing**: Database indexes on WHERE clauses
3. **Async processing**: Return 202 immediately, process in background
4. **Connection pooling**: Reuse DB connections
5. **CDN**: Cache static assets
6. **Compression**: gzip response bodies"

### Q39: What is lazy loading?
**A:** "Load data only when needed:
```javascript
// Eager loading: Load everything upfront
const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
const posts = await db.query('SELECT * FROM posts WHERE user_id = $1', [userId]);

// Lazy loading: Load posts only if accessed
const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
// Load posts later if needed
if (needPosts) {
  const posts = await db.query('SELECT * FROM posts WHERE user_id = $1', [userId]);
}
```"

### Q40: What is pagination?
**A:** "Load data in chunks instead of all at once:
```javascript
// Without pagination: Load 1 million rows (crashes)
SELECT * FROM transactions;

// With pagination: Load 50 rows at a time
SELECT * FROM transactions
ORDER BY created_at DESC
LIMIT 50 OFFSET 0;  // Page 1

LIMIT 50 OFFSET 50; // Page 2
```
API: `GET /transactions?page=1&limit=50`"

---

## Testing & Debugging

### Q41: What types of tests do you write?
**A:** "
1. **Unit tests**: Test individual functions
```javascript
test('decodeBase64 converts base64 to buffer', () => {
  const result = decodeBase64('SGVsbG8=');
  expect(result.toString()).toBe('Hello');
});
```

2. **Integration tests**: Test API endpoints
```javascript
test('POST /api/convert returns 202', async () => {
  const response = await request(app)
    .post('/api/convert')
    .send({ base64Data: '...' });
  expect(response.status).toBe(202);
});
```"

### Q42: How do you debug production issues?
**A:** "
1. Check logs: `tail -f /var/log/app.log`
2. Check metrics: CloudWatch dashboard
3. Reproduce locally: Download data from production
4. Add more logging: Deploy with debug logs
5. Use debugger: `node --inspect` for breakpoints"

### Q43: What is logging and why important?
**A:** "Record events for debugging:
```javascript
console.log('Processing PDF:', fileName);
console.error('Upload failed:', error);

// Better: Structured logging
logger.info('Processing PDF', { fileName, size, transactionId });
logger.error('Upload failed', { error: error.message, transactionId });
```
Helps debug issues in production."

### Q44: What is a memory leak?
**A:** "Memory not released after use. Example:
```javascript
// BAD - memory leak
const cache = {};
app.get('/user/:id', (req, res) => {
  cache[req.params.id] = userData; // Never deleted
});

// GOOD - use LRU cache with max size
const LRU = require('lru-cache');
const cache = new LRU({ max: 500 });
```
Symptoms: Server crashes after few hours, memory usage keeps growing."

### Q45: What is a race condition?
**A:** "Two operations compete:
```javascript
// BAD - race condition
let balance = 100;
async function withdraw(amount) {
  if (balance >= amount) {
    await sleep(100); // Simulate delay
    balance -= amount;
  }
}
withdraw(60); // Both check balance=100, both succeed
withdraw(60); // Final balance = -20 (wrong!)

// GOOD - use database transactions
BEGIN TRANSACTION;
UPDATE accounts SET balance = balance - 60 WHERE id = 1 AND balance >= 60;
COMMIT;
```"

---

## DevOps Basics

### Q46: What is CI/CD?
**A:** "Continuous Integration / Continuous Deployment. Automated pipeline:
```
1. Push code to GitHub
2. GitHub Actions runs tests
3. If tests pass, build Docker image
4. Deploy to staging
5. Run integration tests
6. If approved, deploy to production
```
Automates deployment, reduces human error."

### Q47: What is Docker?
**A:** "Packages app with dependencies:
```dockerfile
FROM node:20
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
CMD ["node", "server.js"]
```
Benefits: Same environment everywhere (dev, staging, prod), easy deployment."

### Q48: What is monitoring?
**A:** "Track system health:
- **Metrics**: CPU, memory, request count, latency
- **Logs**: Application logs, error logs
- **Alerts**: Email/SMS when CPU > 80%

I use CloudWatch to monitor EC2, RDS, and custom metrics."

### Q49: What is a health check?
**A:** "Endpoint to verify service is running:
```javascript
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1'); // Check DB
    await redis.ping();         // Check Redis
    res.json({ status: 'healthy' });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy' });
  }
});
```
Load balancer calls this every 30 seconds."

### Q50: What is rollback?
**A:** "Revert to previous version if deployment fails:
```bash
# Deploy v2
git tag v2.0.0
git push --tags

# v2 has bugs - rollback to v1
git checkout v1.0.0
./deploy.sh
```
My GitHub Actions keeps last 5 versions for quick rollback."

---

## 🎯 Study Tips

1. **Practice explaining**: Say answers out loud
2. **Draw diagrams**: Sketch architecture on paper
3. **Code examples**: Write code snippets from memory
4. **Real metrics**: Memorize your project's numbers (uptime, latency, cost)
5. **STAR method**: Situation, Task, Action, Result for behavioral questions

**Good luck! 🚀**
