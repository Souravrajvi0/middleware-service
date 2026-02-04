# Interview Q&A - 50+ Backend Questions

## 🎯 Quick Navigation

- [Architecture & Design](#architecture--design)
- [Database & Data Management](#database--data-management)
- [AWS & Cloud Infrastructure](#aws--cloud-infrastructure)
- [API Design & Integration](#api-design--integration)
- [Performance & Scalability](#performance--scalability)
- [Security & Compliance](#security--compliance)
- [Monitoring & Debugging](#monitoring--debugging)
- [Problem-Solving Scenarios](#problem-solving-scenarios)

---

## Architecture & Design

### **Q1: Walk me through your project architecture**

**A:** "I built an enterprise middleware service that integrates NetSuite ERP with Zoho Books for a financial services client. The system processes 10,000+ PDF vendor bills daily.

**Architecture layers:**
1. **Client Layer**: NetSuite SuiteScript 2.1 Suitelet extracts PDFs and converts to Base64
2. **Edge Layer**: Route 53 DNS + Application Load Balancer with SSL termination
3. **Compute Layer**: Auto Scaling Group (2-10 EC2 t3.medium instances) running Node.js/TypeScript
4. **Async Processing**: SQS queue with Lambda triggers for event-driven processing
5. **Data Layer**: RDS PostgreSQL (Multi-AZ), ElastiCache Redis, S3 (incoming/processed buckets)
6. **Monitoring**: CloudWatch Logs, custom metrics, SNS alerts

**Key design decisions:**
- **Async processing** to handle NetSuite's 60-second timeout limits
- **S3 storage** for 7-year compliance retention (banking regulations)
- **Redis caching** for Zoho OAuth tokens (reduces API calls by 60%)
- **Multi-AZ deployment** for 99.9% uptime SLA"

---

### **Q2: Why did you choose this architecture over alternatives?**

**A:** "I evaluated three approaches:

**Option 1: Synchronous Processing (Rejected)**
- NetSuite → Middleware → Zoho in single request
- **Problem**: Zoho rate limits (100 req/min) cause timeouts
- **Problem**: Large batches (5000 PDFs) exceed 60-second timeout

**Option 2: Serverless (Lambda only) (Rejected)**
- **Problem**: Lambda 15-minute timeout insufficient for large PDFs
- **Problem**: Cold starts add 2-3 seconds latency
- **Problem**: Concurrent execution limits (1000) insufficient for peak loads

**Option 3: Hybrid (Selected)**
- EC2 for API ingestion (low latency, persistent connections)
- SQS + Lambda for async processing (auto-scaling, fault tolerance)
- **Benefit**: Best of both worlds—fast ingestion + scalable processing
- **Benefit**: Cost-effective (EC2 baseline + Lambda for bursts)"

---

### **Q3: How would you scale this to 100,000 PDFs per day?**

**A:** "Current bottlenecks and solutions:

**1. Zoho API Rate Limit (100 req/min = 144K/day max)**
- **Solution**: Implement intelligent batching—group PDFs by bill ID
- **Solution**: Use Zoho bulk upload API (50 PDFs per request)
- **Result**: 144K → 7.2M daily capacity

**2. Database Write Throughput**
- **Current**: Single RDS instance (5000 IOPS)
- **Solution**: Enable RDS write replicas for read queries
- **Solution**: Use Aurora PostgreSQL with auto-scaling storage
- **Result**: 10x write throughput

**3. S3 Upload Bandwidth**
- **Current**: Single NAT Gateway (5 Gbps)
- **Solution**: Add NAT Gateways in each AZ (15 Gbps total)
- **Solution**: Use S3 Transfer Acceleration
- **Result**: 3x upload speed

**4. SQS Queue Processing**
- **Current**: 10 EC2 workers (100 PDFs/min)
- **Solution**: Increase ASG max to 50 instances
- **Solution**: Add Lambda concurrent execution (1000 workers)
- **Result**: 100 → 5000 PDFs/min (300K/hour)"

---

## Database & Data Management

### **Q4: Explain your database schema design**

**A:** "I designed a normalized schema with three main tables:

**Table 1: `transactions`**
```sql
CREATE TABLE transactions (
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    netsuite_bill_id VARCHAR(50) NOT NULL,
    zoho_bill_id VARCHAR(50),
    file_name VARCHAR(255) NOT NULL,
    file_size_bytes INTEGER,
    mime_type VARCHAR(50),
    s3_bucket VARCHAR(100),
    s3_key VARCHAR(255),
    status VARCHAR(20) CHECK (status IN ('pending', 'processing', 'success', 'failed')),
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP,
    error_message TEXT,
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    UNIQUE INDEX idx_netsuite_bill (netsuite_bill_id)
);
```

**Design decisions:**
- **UUID primary key**: Distributed system-friendly (no auto-increment conflicts)
- **Status enum**: Prevents invalid states
- **Indexes on status + created_at**: Fast queries for monitoring dashboards
- **Unique constraint on netsuite_bill_id**: Prevents duplicate processing (idempotency)

**Table 2: `api_audit_logs`**
- Stores every API call (NetSuite → Middleware, Middleware → Zoho)
- **JSONB columns** for flexible request/response storage
- **Partitioned by month** for performance (12 partitions)

**Table 3: `zoho_tokens`**
- Encrypted OAuth tokens (using pgcrypto extension)
- TTL tracking for automatic refresh"

---

### **Q5: How do you handle database migrations in production?**

**A:** "I use a zero-downtime migration strategy:

**Step 1: Backward-compatible changes**
```sql
-- Add new column with default value
ALTER TABLE transactions 
ADD COLUMN zoho_document_id VARCHAR(50) DEFAULT NULL;

-- Deploy application v2 (reads new column, writes to both old + new)
-- Wait 24 hours for all instances to update

-- Backfill data
UPDATE transactions 
SET zoho_document_id = zoho_bill_id 
WHERE zoho_document_id IS NULL;

-- Make column NOT NULL
ALTER TABLE transactions 
ALTER COLUMN zoho_document_id SET NOT NULL;
```

**Step 2: Use migration tools**
- **Flyway** for versioned migrations
- **Rollback scripts** for every migration
- **Dry-run in staging** before production

**Step 3: Monitor during migration**
- CloudWatch alarm on database CPU > 80%
- Query performance monitoring (slow query log)
- Automatic rollback if error rate > 1%"

---

### **Q6: Why PostgreSQL over MySQL or NoSQL?**

**A:** "I chose PostgreSQL for specific features:

**1. JSONB Support**
- Store flexible API request/response payloads
- Query nested JSON with GIN indexes
```sql
SELECT * FROM api_audit_logs 
WHERE request_headers->>'Authorization' LIKE 'Zoho%';
```

**2. Advanced Indexing**
- Partial indexes for status queries:
```sql
CREATE INDEX idx_failed_transactions 
ON transactions (created_at) 
WHERE status = 'failed';
```

**3. ACID Transactions**
- Financial data requires strong consistency
- DynamoDB's eventual consistency unacceptable for billing

**4. Complex Queries**
- Reconciliation reports need JOINs:
```sql
SELECT t.netsuite_bill_id, COUNT(a.log_id) as api_calls
FROM transactions t
LEFT JOIN api_audit_logs a ON t.transaction_id = a.transaction_id
WHERE t.created_at > NOW() - INTERVAL '7 days'
GROUP BY t.netsuite_bill_id;
```

**5. Cost**
- RDS PostgreSQL: $100/month (db.t3.medium)
- DynamoDB equivalent: $300/month (read/write capacity units)"

---

## AWS & Cloud Infrastructure

### **Q7: Explain your VPC architecture**

**A:** "I designed a multi-tier VPC following AWS best practices:

**CIDR: 10.0.0.0/16 (65,536 IPs)**

**Public Subnets (2):**
- 10.0.1.0/24 (us-east-1a) - ALB, NAT Gateway
- 10.0.2.0/24 (us-east-1b) - ALB, NAT Gateway
- **Internet Gateway** for outbound traffic

**Private Subnets - Application Tier (3):**
- 10.0.10.0/24 (us-east-1a) - EC2 instances
- 10.0.11.0/24 (us-east-1b) - EC2 instances
- 10.0.12.0/24 (us-east-1c) - EC2 instances
- **NAT Gateways** for outbound API calls (Zoho)

**Private Subnets - Data Tier (3):**
- 10.0.20.0/24 (us-east-1a) - RDS primary
- 10.0.21.0/24 (us-east-1b) - RDS standby
- 10.0.22.0/24 (us-east-1c) - ElastiCache

**Security Groups:**
```hcl
# ALB Security Group
Inbound: 443 from 0.0.0.0/0 (HTTPS)
Outbound: 3000 to EC2 SG

# EC2 Security Group
Inbound: 3000 from ALB SG only
Outbound: 443 to 0.0.0.0/0 (Zoho API)
Outbound: 5432 to RDS SG
Outbound: 6379 to Redis SG

# RDS Security Group
Inbound: 5432 from EC2 SG only
Outbound: None
```

**Why this design?**
- **Defense in depth**: EC2 instances have no public IPs
- **Least privilege**: Security groups allow only necessary traffic
- **Multi-AZ**: Survives entire AZ failure"

---

### **Q8: How do you manage AWS costs?**

**A:** "I implemented several cost optimization strategies:

**1. Right-sizing Instances**
- **Before**: t2.large (2 vCPU, 8GB RAM) = $70/month
- **After**: t3.medium (2 vCPU, 4GB RAM) = $30/month
- **Savings**: 57% reduction
- **Justification**: CloudWatch showed avg memory usage 45%

**2. S3 Lifecycle Policies**
```json
{
  "Rules": [{
    "Id": "Archive old PDFs",
    "Status": "Enabled",
    "Transitions": [
      {"Days": 30, "StorageClass": "STANDARD_IA"},
      {"Days": 90, "StorageClass": "GLACIER"},
      {"Days": 2555, "StorageClass": "DEEP_ARCHIVE"}
    ],
    "Expiration": {"Days": 2555}
  }]
}
```
- **Savings**: $500/month (10TB storage)

**3. Reserved Instances**
- Purchased 2x t3.medium (1-year, no upfront)
- **Savings**: 30% vs on-demand

**4. Auto Scaling Schedule**
```hcl
resource "aws_autoscaling_schedule" "scale_down_night" {
  scheduled_action_name  = "scale-down-night"
  min_size               = 1
  max_size               = 2
  desired_capacity       = 1
  recurrence             = "0 22 * * *"  # 10 PM daily
}
```
- **Savings**: 50% reduction during off-hours

**Total monthly cost:**
- **Before**: $800/month
- **After**: $320/month
- **Savings**: 60%"

---

### **Q9: How do you handle Auto Scaling?**

**A:** "I use target tracking scaling policies:

**Policy 1: CPU-based**
```hcl
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

**Policy 2: SQS Queue Depth**
```hcl
resource "aws_autoscaling_policy" "sqs_tracking" {
  name                   = "sqs-target-tracking"
  autoscaling_group_name = aws_autoscaling_group.middleware.name
  policy_type            = "TargetTrackingScaling"
  
  target_tracking_configuration {
    customized_metric_specification {
      metric_name = "ApproximateNumberOfMessagesVisible"
      namespace   = "AWS/SQS"
      statistic   = "Average"
      
      dimensions {
        name  = "QueueName"
        value = "pdf-processing-queue"
      }
    }
    target_value = 100.0  # 100 messages per instance
  }
}
```

**Scaling behavior:**
- **Baseline**: 2 instances (handles 200 PDFs/min)
- **Peak load** (5000 PDFs): Scales to 8 instances in 5 minutes
- **Cool down**: Scales down gradually (1 instance every 5 minutes)

**Why target tracking?**
- Simpler than step scaling
- Automatic calculation of scaling adjustments
- Handles both scale-out and scale-in"

---

## API Design & Integration

### **Q10: How do you handle API versioning?**

**A:** "Currently unversioned (internal API), but for future public APIs:

**Strategy: URL Versioning**
```
/api/v1/convert/base64-to-binary
/api/v2/convert/base64-to-binary
```

**Deprecation process:**
1. Release v2 with new features
2. Add deprecation header to v1 responses:
```http
Deprecation: Sun, 01 Jan 2025 00:00:00 GMT
Sunset: Sun, 01 Jul 2025 00:00:00 GMT
Link: </api/v2/convert>; rel=\"successor-version\"
```
3. Monitor v1 usage via CloudWatch metrics
4. Send email notifications to clients
5. Disable v1 after sunset date

**Backward compatibility rules:**
- Never remove fields from responses
- New fields are optional with defaults
- Breaking changes require new version"

---

### **Q11: How do you handle rate limiting?**

**A:** "I implement rate limiting at two levels:

**Level 1: API Gateway (Future)**
```yaml
RateLimitPolicy:
  Quota: 10000 requests per day
  Burst: 100 requests per second
  Throttle: 1000 requests per minute
```

**Level 2: Application (Current)**
```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => req.headers['x-api-key'],
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too Many Requests',
      retryAfter: 60
    });
  },
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false
});

app.use('/api', limiter);
```

**Response headers:**
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1738656060
```

**Zoho API rate limit handling:**
```typescript
async function uploadToZoho(pdf, retryCount = 0) {
  try {
    return await axios.post(zohoUrl, pdf);
  } catch (error) {
    if (error.response?.status === 429) {
      const retryAfter = error.response.headers['retry-after'] || 60;
      await sleep(retryAfter * 1000);
      return uploadToZoho(pdf, retryCount + 1);
    }
    throw error;
  }
}
```"

---

## Performance & Scalability

### **Q12: What performance optimizations did you implement?**

**A:** "I optimized at multiple layers:

**1. Redis Token Caching**
- **Before**: Every request refreshes Zoho token (2 seconds)
- **After**: Cache token for 1 hour (TTL: 3600s)
- **Result**: 95% reduction in token refresh calls
- **Metric**: API latency reduced from 3s → 800ms

**2. S3 Multipart Upload**
```typescript
import { Upload } from '@aws-sdk/lib-storage';

async function uploadLargeFile(buffer, key) {
  const upload = new Upload({
    client: s3Client,
    params: { Bucket, Key, Body: buffer },
    partSize: 5 * 1024 * 1024, // 5MB chunks
    queueSize: 4 // 4 parallel uploads
  });
  return await upload.done();
}
```
- **Result**: 60% faster for files > 10MB

**3. Database Connection Pooling**
```typescript
const pool = new Pool({
  max: 20, // Max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
```
- **Before**: New connection per request (500ms overhead)
- **After**: Reuse connections (5ms overhead)

**4. Async Processing**
- **Before**: Synchronous upload (60 seconds per PDF)
- **After**: Async with SQS (202 response in 2 seconds)
- **Result**: 30x faster perceived latency

**5. ALB Connection Draining**
- Graceful shutdown (300-second timeout)
- Zero dropped requests during deployments"

---

### **Q13: How do you measure performance?**

**A:** "I track performance using custom CloudWatch metrics:

**Metric 1: PDF Processing Time**
```typescript
const startTime = Date.now();
await processPDF(pdf);
const duration = Date.now() - startTime;

await cloudwatch.putMetricData({
  Namespace: 'Middleware',
  MetricData: [{
    MetricName: 'PDFProcessingTime',
    Value: duration,
    Unit: 'Milliseconds',
    Dimensions: [
      { Name: 'Environment', Value: 'production' },
      { Name: 'FileSize', Value: getSizeCategory(pdf.size) }
    ]
  }]
});
```

**CloudWatch Insights Query:**
```sql
fields @timestamp, PDFProcessingTime
| stats avg(PDFProcessingTime) as avg, 
        pct(PDFProcessingTime, 50) as p50,
        pct(PDFProcessingTime, 95) as p95,
        pct(PDFProcessingTime, 99) as p99
| sort @timestamp desc
```

**Performance SLOs:**
- P50 latency: < 1 second
- P95 latency: < 3 seconds
- P99 latency: < 5 seconds
- Uptime: 99.9%

**Current metrics:**
- P50: 800ms ✅
- P95: 2.1s ✅
- P99: 4.5s ✅
- Uptime: 99.95% ✅"

---

## Security & Compliance

### **Q14: How do you secure sensitive data?**

**A:** "I implement defense-in-depth security:

**1. Encryption at Rest**
- **S3**: SSE-KMS with customer-managed keys
- **RDS**: AES-256 encryption enabled
- **EBS**: Encrypted volumes for EC2 instances

**2. Encryption in Transit**
- **ALB**: TLS 1.3 only (no TLS 1.0/1.1)
- **RDS**: SSL/TLS required for connections
```typescript
const pool = new Pool({
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/path/to/rds-ca-cert.pem')
  }
});
```

**3. Secrets Management**
```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

async function getZohoCredentials() {
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const response = await client.send(new GetSecretValueCommand({
    SecretId: 'prod/zoho/oauth'
  }));
  return JSON.parse(response.SecretString);
}
```
- **Automatic rotation**: Every 90 days
- **IAM role access**: No hardcoded credentials

**4. Network Isolation**
- EC2 instances in private subnets (no public IPs)
- Security groups: Least privilege (port 3000 from ALB only)
- VPC endpoints for S3/Secrets Manager (no internet traffic)

**5. Audit Logging**
- CloudTrail: All AWS API calls
- VPC Flow Logs: Network traffic analysis
- Application logs: Every API request logged"

---

### **Q15: How do you handle PII/sensitive data?**

**A:** "Financial documents contain PII (vendor names, amounts). I implement:

**1. Data Classification**
- **Public**: Transaction IDs, timestamps
- **Internal**: File names, S3 keys
- **Confidential**: PDF contents, vendor details

**2. Access Control**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"AWS": "arn:aws:iam::123456789012:role/MiddlewareServiceRole"},
    "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": "arn:aws:s3:::middleware-pdfs-processed/*",
    "Condition": {
      "StringEquals": {
        "s3:x-amz-server-side-encryption": "aws:kms"
      }
    }
  }]
}
```

**3. Data Retention**
- **7-year retention** for compliance (banking regulations)
- **Automatic deletion** after 2555 days (S3 lifecycle policy)
- **Immutable backups**: S3 Object Lock for audit trail

**4. Logging Sanitization**
```typescript
function sanitizeLog(data) {
  const sanitized = { ...data };
  delete sanitized.base64Data; // Remove PDF content
  delete sanitized.zohoToken;  // Remove OAuth tokens
  return sanitized;
}

logger.info('Processing request', sanitizeLog(req.body));
```

**5. Compliance**
- **SOC 2 Type II**: Audit controls in place
- **GDPR**: Data deletion on request (S3 DeleteObject)
- **PCI DSS**: No credit card data stored"

---

## Monitoring & Debugging

### **Q16: How do you debug production issues?**

**A:** "I use a systematic approach:

**Step 1: Identify the issue**
- CloudWatch alarm triggers (e.g., 'DLQ message count > 10')
- PagerDuty notification to on-call engineer

**Step 2: Check dashboards**
- CloudWatch dashboard shows spike in 500 errors
- X-Ray service map shows latency in Zoho API calls

**Step 3: Query logs**
```sql
-- CloudWatch Logs Insights
fields @timestamp, @message, transactionId, error
| filter @message like /500 Internal Server Error/
| sort @timestamp desc
| limit 100
```

**Step 4: Trace specific transaction**
```sql
fields @timestamp, @message
| filter transactionId = 'a7f3c8e1-4b2d-4c9a-8f6e-1d2c3b4a5e6f'
| sort @timestamp asc
```

**Step 5: Check database**
```sql
SELECT * FROM transactions 
WHERE transaction_id = 'a7f3c8e1-4b2d-4c9a-8f6e-1d2c3b4a5e6f';

SELECT * FROM api_audit_logs 
WHERE transaction_id = 'a7f3c8e1-4b2d-4c9a-8f6e-1d2c3b4a5e6f'
ORDER BY timestamp DESC;
```

**Step 6: Reproduce locally**
```bash
# Download PDF from S3
aws s3 cp s3://middleware-pdfs-incoming/1738656000000-invoice.pdf .

# Test locally
curl -X POST http://localhost:3000/api/convert/base64-to-binary \
  -H 'x-api-key: NSZoho@8080' \
  -d @test-payload.json
```

**Step 7: Fix and deploy**
- Create hotfix branch
- Deploy to staging
- Run integration tests
- Deploy to production with canary (10% traffic)
- Monitor for 30 minutes
- Full rollout"

---

### **Q17: What monitoring tools do you use?**

**A:** "I use a comprehensive monitoring stack:

**1. CloudWatch**
- **Logs**: Application logs, ALB access logs, VPC flow logs
- **Metrics**: CPU, memory, disk, custom metrics
- **Alarms**: 15+ alarms for critical thresholds
- **Dashboards**: 3 dashboards (infrastructure, application, business)

**2. AWS X-Ray**
- Distributed tracing (NetSuite → Middleware → Zoho)
- Service map visualization
- Latency analysis (identify bottlenecks)

**3. CloudWatch Insights**
```sql
-- Top 10 slowest API calls
fields @timestamp, duration, endpoint
| filter endpoint = '/api/convert/base64-to-binary'
| sort duration desc
| limit 10
```

**4. SNS + PagerDuty**
- Critical alarms → PagerDuty (on-call rotation)
- Warning alarms → Email
- Info alarms → Slack #alerts channel

**5. Custom Metrics**
```typescript
// Business metrics
await cloudwatch.putMetricData({
  Namespace: 'Middleware/Business',
  MetricData: [{
    MetricName: 'PDFsProcessed',
    Value: 1,
    Unit: 'Count'
  }, {
    MetricName: 'ZohoAPISuccessRate',
    Value: successRate,
    Unit: 'Percent'
  }]
});
```

**6. RDS Performance Insights**
- Top SQL queries by execution time
- Database load (active sessions)
- Wait events analysis"

---

## Problem-Solving Scenarios

### **Q18: How would you handle a sudden 10x traffic spike?**

**A:** "Scenario: Normal load is 1000 PDFs/hour, suddenly 10,000 PDFs/hour.

**Immediate actions (0-5 minutes):**
1. **Check Auto Scaling**: Verify ASG is scaling (should hit max 10 instances)
2. **Increase ASG max**: Temporarily raise max from 10 → 30 instances
```bash
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name prod-middleware-asg \
  --max-size 30
```
3. **Monitor SQS queue depth**: If > 1000, increase visibility timeout
4. **Check Zoho rate limits**: If hitting 100 req/min, implement batching

**Short-term fixes (5-30 minutes):**
1. **Enable Lambda workers**: Deploy Lambda function to poll SQS
```typescript
exports.handler = async (event) => {
  for (const record of event.Records) {
    await processPDF(JSON.parse(record.body));
  }
};
```
2. **Increase RDS IOPS**: Modify instance to higher tier (db.t3.large)
3. **Add read replicas**: Offload SELECT queries to replica

**Long-term solutions (1-7 days):**
1. **Implement caching**: Cache frequently accessed data in Redis
2. **Optimize queries**: Add indexes, use EXPLAIN ANALYZE
3. **Horizontal scaling**: Shard database by date range
4. **CDN for static assets**: CloudFront for admin dashboard

**Post-incident:**
1. **Root cause analysis**: Why did traffic spike?
2. **Update runbook**: Document response steps
3. **Increase baseline capacity**: Raise ASG min from 2 → 4
4. **Load testing**: Simulate 10x traffic monthly"

---

### **Q19: How would you debug a memory leak?**

**A:** "Scenario: EC2 instances running out of memory after 48 hours.

**Step 1: Confirm the issue**
```bash
# SSH to EC2 instance
ssh ec2-user@10.0.10.5

# Check memory usage
free -h
top -o %MEM

# Check Node.js process
ps aux | grep node
```

**Step 2: Enable heap snapshots**
```typescript
// Add to server.ts
import v8 from 'v8';
import fs from 'fs';

setInterval(() => {
  const heapSnapshot = v8.writeHeapSnapshot();
  console.log('Heap snapshot written to', heapSnapshot);
}, 60 * 60 * 1000); // Every hour
```

**Step 3: Analyze heap snapshots**
```bash
# Download snapshots
scp ec2-user@10.0.10.5:/opt/middleware/heap-*.heapsnapshot .

# Open in Chrome DevTools
# chrome://inspect → Memory → Load snapshot
```

**Step 4: Identify leak**
- Look for objects growing over time
- Common culprits:
  - Event listeners not removed
  - Global variables accumulating data
  - Unclosed database connections
  - Large buffers not garbage collected

**Step 5: Fix the leak**
```typescript
// Before (leak)
app.post('/api/convert', async (req, res) => {
  const buffer = Buffer.from(req.body.base64Data, 'base64');
  await uploadToS3(buffer);
  // Buffer not released - memory leak!
});

// After (fixed)
app.post('/api/convert', async (req, res) => {
  const buffer = Buffer.from(req.body.base64Data, 'base64');
  try {
    await uploadToS3(buffer);
  } finally {
    buffer.fill(0); // Clear buffer
  }
});
```

**Step 6: Verify fix**
- Deploy to staging
- Run load test for 72 hours
- Monitor memory usage (should be stable)
- Deploy to production with canary"

---

### **Q20: Database is slow. How do you diagnose?**

**A:** "Systematic approach:

**Step 1: Check RDS metrics**
- CPU utilization: > 80% indicates compute bottleneck
- IOPS: Hitting provisioned limit?
- Connections: > 80% of max_connections?

**Step 2: Enable slow query log**
```sql
-- RDS Parameter Group
log_min_duration_statement = 1000  -- Log queries > 1 second
```

**Step 3: Analyze slow queries**
```sql
-- Top 10 slowest queries
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

**Step 4: Explain query plan**
```sql
EXPLAIN ANALYZE
SELECT * FROM transactions 
WHERE status = 'pending' 
AND created_at > NOW() - INTERVAL '7 days';

-- Output shows:
-- Seq Scan on transactions (cost=0.00..1234.56 rows=100)
-- Missing index!
```

**Step 5: Add indexes**
```sql
CREATE INDEX CONCURRENTLY idx_transactions_status_created 
ON transactions (status, created_at);

-- Verify improvement
EXPLAIN ANALYZE [same query];
-- Now shows:
-- Index Scan using idx_transactions_status_created (cost=0.29..8.31 rows=100)
```

**Step 6: Optimize queries**
```sql
-- Before (N+1 query problem)
SELECT * FROM transactions;
-- Then for each transaction:
SELECT * FROM api_audit_logs WHERE transaction_id = ?;

-- After (single query with JOIN)
SELECT t.*, a.* 
FROM transactions t
LEFT JOIN api_audit_logs a ON t.transaction_id = a.transaction_id
WHERE t.created_at > NOW() - INTERVAL '7 days';
```

**Step 7: Scale if needed**
- Add read replica for SELECT queries
- Upgrade instance class (db.t3.medium → db.t3.large)
- Enable connection pooling (PgBouncer)"

---

## 📚 Additional Resources

- [01-ARCHITECTURE-OVERVIEW.md](./01-ARCHITECTURE-OVERVIEW.md)
- [02-REQUEST-FLOW-DETAILED.md](./02-REQUEST-FLOW-DETAILED.md)
- [06-INTERVIEW-CHEATSHEET.md](./06-INTERVIEW-CHEATSHEET.md)
