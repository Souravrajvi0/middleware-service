# STAR Method Interview Stories

## 🎯 What is STAR Method?

**S**ituation - **T**ask - **A**ction - **R**esult

A framework for answering behavioral questions like:
- "Tell me about a time you solved a difficult problem"
- "Describe a challenge you faced and how you overcame it"
- "Tell me about a time you improved system performance"

---

## Story 1: Handling NetSuite Timeout Issues

### Situation
After deploying the middleware to production, we started getting timeout errors from NetSuite. The system was processing vendor bills with PDF attachments, but when NetSuite sent batches of 100+ PDFs, the requests would timeout after 60 seconds. This caused 40% of batch uploads to fail, and the accounting team had to manually retry them.

### Task
I needed to fix the timeout issue without losing any data and ensure the system could handle large batches during month-end processing (when we receive 5,000+ PDFs in a few hours).

### Action

**Step 1: Diagnosed the problem**
- Analyzed CloudWatch logs and found requests taking 2-3 minutes
- Identified bottleneck: Processing PDFs synchronously (decode → upload to Zoho → wait for response)
- Zoho API was slow (2-3 seconds per PDF) and had rate limits (100 req/min)

**Step 2: Designed async solution**
- Changed API to return 202 Accepted immediately after uploading PDF to S3
- Implemented SQS queue for background processing
- Created worker processes to poll queue and upload to Zoho

**Step 3: Implemented changes**
```javascript
// Before: Synchronous (60+ seconds)
const result = await uploadToZoho(pdf);
return res.json(result);

// After: Asynchronous (2 seconds)
await uploadToS3(pdf);
await sqsQueue.send({ transactionId, s3Key });
return res.status(202).json({ transactionId, status: 'processing' });
```

**Step 4: Added retry logic**
- Configured SQS visibility timeout (5 minutes)
- Set up Dead Letter Queue for failed messages after 3 attempts
- Created CloudWatch alarm to alert ops team when DLQ has messages

**Step 5: Tested thoroughly**
- Tested with 500 PDFs in staging environment
- Verified no timeouts and all PDFs processed successfully
- Deployed to production with monitoring

### Result
- **Zero timeouts**: NetSuite never waits more than 3 seconds
- **Higher throughput**: Processed 5,000 PDFs during month-end in 20 minutes (was 2+ hours)
- **Better reliability**: 99.99% success rate (up from 60%)
- **User satisfaction**: Accounting team no longer needs manual retries

**Key Metrics:**
- API response time: 60s → 2s (97% improvement)
- Success rate: 60% → 99.99%
- Processing time: 2 hours → 20 minutes (83% faster)

---

## Story 2: Optimizing API Latency with Redis Caching

### Situation
After the async processing fix, we noticed the API was still slow. CloudWatch metrics showed P95 latency at 3 seconds, which was above our SLA of 2 seconds. Investigating the logs, I found that every request was calling Zoho's OAuth API to refresh the access token, which took 2 seconds per call.

### Task
Reduce API latency to meet the 2-second SLA without compromising security or reliability.

### Action

**Step 1: Analyzed the problem**
- Zoho OAuth tokens expire every hour (3600 seconds)
- We were refreshing the token on every request (wasteful)
- 10,000 requests/day = 10,000 token refreshes (only need 24)

**Step 2: Designed caching solution**
- Decided to use Redis (ElastiCache) for shared cache across EC2 instances
- Set TTL (Time To Live) to 3600 seconds (1 hour)
- Implemented cache-aside pattern

**Step 3: Implemented Redis caching**
```javascript
async function getZohoToken() {
  // Try cache first
  let token = await redis.get('zoho_access_token');
  
  if (token) {
    console.log('Cache hit');
    return token;
  }
  
  // Cache miss - refresh token
  console.log('Cache miss - refreshing token');
  const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', {
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });
  
  token = response.data.access_token;
  
  // Store in cache with 1-hour expiry
  await redis.setex('zoho_access_token', 3600, token);
  
  return token;
}
```

**Step 4: Deployed and monitored**
- Deployed to staging, verified cache hit rate > 90%
- Deployed to production with gradual rollout (10% → 50% → 100%)
- Monitored CloudWatch metrics for latency improvements

### Result
- **95% cache hit rate**: Only 5% of requests refresh token
- **Latency improvement**: P95 latency 3s → 800ms (73% faster)
- **API call reduction**: 10,000 Zoho calls/day → 500 calls/day (95% reduction)
- **Cost savings**: Reduced Zoho API usage (closer to free tier)

**Key Metrics:**
- P95 latency: 3s → 800ms
- Cache hit rate: 95%
- Zoho API calls: -95%

---

## Story 3: Debugging Production Memory Leak

### Situation
Two weeks after launch, we started getting alerts that EC2 instances were running out of memory and crashing every 48 hours. This caused brief outages (1-2 minutes) while Auto Scaling launched replacement instances. The crashes happened during peak hours, affecting users.

### Task
Identify and fix the memory leak before it caused more serious outages or data loss.

### Action

**Step 1: Confirmed the issue**
- SSH'd into EC2 instance and ran `top` command
- Node.js process memory growing from 500MB → 3.5GB over 48 hours
- Checked CloudWatch metrics: confirmed memory usage trend

**Step 2: Enabled heap snapshots**
```javascript
import v8 from 'v8';

// Take heap snapshot every hour
setInterval(() => {
  const filename = v8.writeHeapSnapshot();
  console.log('Heap snapshot written to', filename);
}, 60 * 60 * 1000);
```

**Step 3: Analyzed heap snapshots**
- Downloaded snapshots from EC2 to local machine
- Opened in Chrome DevTools (chrome://inspect → Memory → Load)
- Compared snapshots over time
- Found: Large Buffer objects accumulating in memory

**Step 4: Identified root cause**
```javascript
// Problem code: Buffer not released after S3 upload
app.post('/api/convert', async (req, res) => {
  const buffer = Buffer.from(req.body.base64Data, 'base64');
  await uploadToS3(buffer);
  // Buffer stays in memory - garbage collector doesn't free it!
  res.json({ success: true });
});
```

**Step 5: Fixed the leak**
```javascript
// Solution: Explicitly clear buffer
app.post('/api/convert', async (req, res) => {
  const buffer = Buffer.from(req.body.base64Data, 'base64');
  
  try {
    await uploadToS3(buffer);
    res.json({ success: true });
  } finally {
    // Clear buffer to help garbage collector
    buffer.fill(0);
  }
});
```

**Step 6: Verified fix**
- Deployed to staging, ran load test for 72 hours
- Memory usage stayed stable at 500MB
- Deployed to production with monitoring

### Result
- **Memory stability**: Memory usage stable at 500MB (no more growth)
- **Zero crashes**: No instance crashes in 3 months since fix
- **Uptime improvement**: 99.5% → 99.9% uptime
- **Learning**: Documented memory management best practices for team

**Key Metrics:**
- Instance crashes: 15/month → 0/month
- Memory usage: 3.5GB → 500MB (stable)
- Uptime: 99.5% → 99.9%

---

## Story 4: Implementing Auto Scaling for Cost Optimization

### Situation
Our AWS bill was $800/month, which was over budget. Analysis showed we were running 10 EC2 instances 24/7, but traffic varied significantly: 100 PDFs/hour during business hours, only 10 PDFs/hour at night, and 5,000 PDFs/hour during month-end. We were wasting money on idle instances.

### Task
Reduce AWS costs by 50% without impacting performance or reliability.

### Action

**Step 1: Analyzed traffic patterns**
- Pulled CloudWatch metrics for 30 days
- Found patterns:
  - Night (10 PM - 6 AM): 90% idle capacity
  - Weekends: 80% idle capacity
  - Month-end (2 days/month): 200% over-capacity (causing failures)

**Step 2: Designed Auto Scaling strategy**
- Baseline: 2 instances (handles normal load)
- Scale up: Add instances when CPU > 70% or SQS queue depth > 100
- Scale down: Remove instances when CPU < 30%
- Max: 10 instances (handles month-end peak)

**Step 3: Implemented Auto Scaling Group**
```hcl
resource "aws_autoscaling_group" "middleware" {
  min_size         = 2
  max_size         = 10
  desired_capacity = 2
  
  target_group_arns = [aws_lb_target_group.middleware.arn]
  
  tag {
    key                 = "Name"
    value               = "middleware-asg"
    propagate_at_launch = true
  }
}

# CPU-based scaling
resource "aws_autoscaling_policy" "cpu_tracking" {
  name                   = "cpu-target-tracking"
  autoscaling_group_name = aws_autoscaling_group.middleware.name
  policy_type            = "TargetTrackingScaling"
  
  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = 70.0
  }
}
```

**Step 4: Added scheduled scaling**
```hcl
# Scale down at night
resource "aws_autoscaling_schedule" "scale_down_night" {
  scheduled_action_name  = "scale-down-night"
  min_size               = 1
  max_size               = 2
  desired_capacity       = 1
  recurrence             = "0 22 * * *"  # 10 PM daily
  autoscaling_group_name = aws_autoscaling_group.middleware.name
}

# Scale up in morning
resource "aws_autoscaling_schedule" "scale_up_morning" {
  scheduled_action_name  = "scale-up-morning"
  min_size               = 2
  max_size               = 10
  desired_capacity       = 2
  recurrence             = "0 6 * * *"  # 6 AM daily
  autoscaling_group_name = aws_autoscaling_group.middleware.name
}
```

**Step 5: Tested and monitored**
- Tested in staging for 1 week
- Verified scaling events worked correctly
- Deployed to production with close monitoring

### Result
- **Cost reduction**: $800/month → $320/month (60% savings)
- **Performance**: Zero degradation (P95 latency unchanged)
- **Scalability**: Handled month-end peak (5,000 PDFs) without failures
- **Automation**: No manual intervention needed

**Key Metrics:**
- Monthly cost: $800 → $320 (60% reduction)
- Month-end failures: 15% → 0%
- Average instances: 10 → 3.5

---

## Story 5: Implementing Database Indexing for Performance

### Situation
As data grew to 500,000 transactions, the admin dashboard became slow. The "Failed Transactions" page took 30 seconds to load, causing timeouts. Users complained they couldn't monitor system health effectively.

### Task
Optimize database queries to make the dashboard load in under 2 seconds.

### Action

**Step 1: Identified slow queries**
```sql
-- Enabled slow query log in RDS
log_min_duration_statement = 1000  -- Log queries > 1 second

-- Found slow query
SELECT * FROM transactions 
WHERE status = 'failed' 
AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

**Step 2: Analyzed query plan**
```sql
EXPLAIN ANALYZE
SELECT * FROM transactions 
WHERE status = 'failed' 
AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- Output:
-- Seq Scan on transactions (cost=0.00..12345.67 rows=1000)
-- Planning Time: 0.5 ms
-- Execution Time: 28,432 ms
```
Problem: Sequential scan (reading all 500,000 rows)

**Step 3: Created composite index**
```sql
-- Create index on status + created_at
CREATE INDEX CONCURRENTLY idx_transactions_status_created 
ON transactions (status, created_at DESC);

-- CONCURRENTLY allows index creation without locking table
```

**Step 4: Verified improvement**
```sql
EXPLAIN ANALYZE
SELECT * FROM transactions 
WHERE status = 'failed' 
AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;

-- Output:
-- Index Scan using idx_transactions_status_created (cost=0.42..123.45 rows=1000)
-- Planning Time: 0.3 ms
-- Execution Time: 45 ms
```

**Step 5: Added more indexes**
```sql
-- Index for transaction ID lookups
CREATE INDEX idx_transaction_id ON transactions (transaction_id);

-- Partial index for pending transactions (smaller, faster)
CREATE INDEX idx_pending_transactions 
ON transactions (created_at) 
WHERE status = 'pending';
```

### Result
- **Query performance**: 30 seconds → 45ms (99.85% faster)
- **Dashboard load time**: 30s → 1.2s (meets SLA)
- **User satisfaction**: No more complaints about slow dashboard
- **Database CPU**: 60% → 20% (indexes reduce CPU usage)

**Key Metrics:**
- Query time: 30s → 45ms
- Dashboard load: 30s → 1.2s
- Database CPU: 60% → 20%

---

## Story 6: Handling Zoho API Rate Limits

### Situation
During month-end processing, we were hitting Zoho's rate limit (100 requests/minute). This caused 429 errors, and 30% of PDFs failed to upload. The Dead Letter Queue was filling up, and we had to manually retry thousands of failed uploads.

### Task
Handle Zoho rate limits gracefully without losing data or requiring manual intervention.

### Action

**Step 1: Understood the problem**
- Zoho allows 100 requests/minute
- During peak, we were sending 200 requests/minute
- 429 errors were moving messages to DLQ after 3 retries

**Step 2: Implemented exponential backoff**
```javascript
async function uploadToZoho(pdf, retryCount = 0) {
  try {
    return await axios.post(zohoUrl, pdf);
  } catch (error) {
    if (error.response?.status === 429) {
      // Rate limit hit
      const retryAfter = error.response.headers['retry-after'] || 60;
      const backoffTime = retryAfter * 1000 * Math.pow(2, retryCount);
      
      console.log(`Rate limited. Retrying after ${backoffTime}ms`);
      await sleep(backoffTime);
      
      if (retryCount < 5) {
        return uploadToZoho(pdf, retryCount + 1);
      }
    }
    throw error;
  }
}
```

**Step 3: Adjusted SQS visibility timeout**
```javascript
// Increased visibility timeout from 5 minutes to 10 minutes
// Gives more time for rate limit backoff
await sqs.changeMessageVisibility({
  QueueUrl: queueUrl,
  ReceiptHandle: message.ReceiptHandle,
  VisibilityTimeout: 600  // 10 minutes
});
```

**Step 4: Implemented intelligent batching**
```javascript
// Process messages in batches with delays
async function processQueue() {
  const messages = await sqs.receiveMessage({ MaxNumberOfMessages: 10 });
  
  for (const message of messages.Messages) {
    await processPDF(message);
    await sleep(600); // 600ms delay = 100 req/min max
  }
}
```

**Step 5: Added monitoring**
```javascript
// Track 429 errors in CloudWatch
await cloudwatch.putMetricData({
  MetricName: 'ZohoRateLimitErrors',
  Value: 1,
  Unit: 'Count'
});

// Alert if > 10 rate limit errors in 5 minutes
```

### Result
- **Success rate**: 70% → 99.99% (no more DLQ buildup)
- **Manual retries**: 3,000/month → 0/month
- **Processing time**: Slightly slower but reliable
- **Zero data loss**: All PDFs eventually processed

**Key Metrics:**
- Success rate: 70% → 99.99%
- 429 errors: 3,000/month → 50/month
- DLQ messages: 500 → 0

---

## Story 7: Implementing Zero-Downtime Deployments

### Situation
Every deployment required taking the system offline for 5 minutes to update EC2 instances. This caused 503 errors for users and interrupted month-end processing. We needed a way to deploy without downtime.

### Task
Implement zero-downtime deployments so users never experience service interruptions.

### Action

**Step 1: Set up Application Load Balancer**
- Configured ALB with health checks
- Set connection draining timeout to 300 seconds

**Step 2: Implemented rolling deployment**
```yaml
# GitHub Actions workflow
- name: Deploy to production
  run: |
    # Trigger Auto Scaling Group instance refresh
    aws autoscaling start-instance-refresh \
      --auto-scaling-group-name prod-middleware-asg \
      --preferences '{
        "MinHealthyPercentage": 90,
        "InstanceWarmup": 300
      }'
```

**Step 3: Configured health checks**
```javascript
app.get('/health', async (req, res) => {
  try {
    // Check database
    await db.query('SELECT 1');
    
    // Check Redis
    await redis.ping();
    
    // Check S3 (optional)
    await s3.headBucket({ Bucket: 'middleware-pdfs' });
    
    res.json({ status: 'healthy' });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});
```

**Step 4: Tested deployment process**
- Deployed to staging with monitoring
- Verified no dropped requests during deployment
- Deployed to production during low-traffic period

### Result
- **Deployment downtime**: 5 minutes → 0 minutes
- **Dropped requests**: 50/deployment → 0/deployment
- **Deployment frequency**: 1/week → 3/week (faster iterations)
- **User experience**: No more 503 errors during deployments

**Key Metrics:**
- Downtime: 5 min → 0 min
- Dropped requests: 50 → 0
- Deployment frequency: 1/week → 3/week

---

## 🎤 How to Use These Stories in Interviews

### Common Behavioral Questions:

**"Tell me about a time you solved a difficult technical problem"**
→ Use Story 1 (NetSuite Timeout) or Story 3 (Memory Leak)

**"Describe a time you improved system performance"**
→ Use Story 2 (Redis Caching) or Story 5 (Database Indexing)

**"Tell me about a time you reduced costs"**
→ Use Story 4 (Auto Scaling)

**"How do you handle failures?"**
→ Use Story 6 (Zoho Rate Limits)

**"Tell me about a time you improved deployment process"**
→ Use Story 7 (Zero-Downtime Deployments)

### Tips:
1. **Be specific**: Use actual numbers (60% cost reduction, 99.99% success rate)
2. **Show your thinking**: Explain why you chose each solution
3. **Mention alternatives**: "I considered X and Y, but chose Z because..."
4. **Highlight results**: Always end with measurable impact
5. **Keep it concise**: 2-3 minutes per story

---

## 📚 Related Documents

- [01-ARCHITECTURE-OVERVIEW.md](./01-ARCHITECTURE-OVERVIEW.md) - System architecture
- [05-INTERVIEW-QA.md](./05-INTERVIEW-QA.md) - Technical Q&A
- [08-TECH-DECISIONS.md](./08-TECH-DECISIONS.md) - Technical decision justifications
