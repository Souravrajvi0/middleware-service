# Technical Decision Justifications

## 🎯 How to Use This Document

When interviewers ask "Why did you choose X over Y?", use this framework:
1. **Context**: What was the problem?
2. **Options Considered**: What alternatives did you evaluate?
3. **Decision**: What did you choose?
4. **Justification**: Why? (Technical + Business reasons)
5. **Results**: What was the impact?

---

## Decision 1: Node.js + TypeScript (Backend Language)

### Context
Needed a backend language to build middleware service integrating NetSuite ERP with Zoho Books, processing 10,000+ PDFs daily.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Python + Flask** | Easy to learn, good for data processing | Slower for I/O operations, GIL limits concurrency |
| **Java + Spring Boot** | Enterprise-grade, strong typing | Verbose, slower development, higher memory usage |
| **Node.js + TypeScript** | Non-blocking I/O, same language as NetSuite, fast development | Single-threaded (but event loop handles concurrency) |

### Decision
**Chose Node.js + TypeScript**

### Justification

**Technical Reasons:**
1. **Non-blocking I/O**: Perfect for I/O-bound operations (S3 uploads, API calls, database queries)
   - Can handle 10,000+ concurrent requests on single thread
   - Event loop processes async operations efficiently
2. **Language Consistency**: NetSuite uses JavaScript (SuiteScript 2.1)
   - Same mental model for both systems
   - Easy to debug Base64 encoding issues
3. **TypeScript Type Safety**: Prevents runtime errors
   ```typescript
   interface PDFRequest {
     base64Data: string;
     fileName: string;
     mimeType: 'application/pdf';
   }
   // Compiler catches type errors before deployment
   ```
4. **Rich Ecosystem**: NPM has libraries for everything
   - AWS SDK, Express, Axios, FormData, etc.

**Business Reasons:**
1. **Faster Development**: Built MVP in 2 weeks vs 4 weeks with Java
2. **Lower Learning Curve**: Team already knew JavaScript
3. **Cost-Effective**: Runs on smaller EC2 instances (t3.medium vs t3.large for Java)

### Results
- **Performance**: P95 latency 800ms (meets SLA)
- **Scalability**: Handles 10,000 PDFs/day with 2 EC2 instances
- **Developer Productivity**: 50% faster feature development vs Java

---

## Decision 2: PostgreSQL (Database)

### Context
Needed database to store transaction logs, API audit trails, and OAuth tokens for financial document processing.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **MySQL** | Popular, good performance | Limited JSON support, fewer advanced features |
| **MongoDB (NoSQL)** | Flexible schema, fast writes | No ACID transactions, eventual consistency |
| **DynamoDB (NoSQL)** | Serverless, auto-scaling | Expensive for reads, no complex queries |
| **PostgreSQL** | ACID, JSONB, advanced indexing | Slightly more complex than MySQL |

### Decision
**Chose PostgreSQL (RDS)**

### Justification

**Technical Reasons:**
1. **ACID Transactions**: Financial data requires strong consistency
   ```sql
   BEGIN;
   INSERT INTO transactions (...);
   INSERT INTO api_audit_logs (...);
   COMMIT; -- Both succeed or both fail
   ```
2. **JSONB Support**: Store flexible API request/response without schema changes
   ```sql
   SELECT * FROM api_audit_logs 
   WHERE request_headers->>'Authorization' LIKE 'Zoho%';
   ```
3. **Advanced Indexing**: Partial indexes for performance
   ```sql
   CREATE INDEX idx_failed_transactions 
   ON transactions (created_at) 
   WHERE status = 'failed'; -- Only indexes failed rows
   ```
4. **Complex Queries**: Reconciliation reports need JOINs
   ```sql
   SELECT t.netsuite_bill_id, COUNT(a.log_id) as api_calls
   FROM transactions t
   LEFT JOIN api_audit_logs a ON t.transaction_id = a.transaction_id
   GROUP BY t.netsuite_bill_id;
   ```

**Business Reasons:**
1. **Compliance**: Banking regulations require audit trails (7 years)
2. **Cost**: RDS PostgreSQL $100/month vs DynamoDB $300/month
3. **Familiarity**: Team had SQL experience

### Results
- **Data Integrity**: 100% transaction consistency (no data loss)
- **Query Performance**: 99% of queries < 50ms with proper indexes
- **Cost Savings**: 60% cheaper than DynamoDB

---

## Decision 3: Asynchronous Processing (SQS + Lambda)

### Context
NetSuite has 60-second timeout limit. Processing 100 PDFs synchronously takes 3+ minutes, causing timeouts.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Synchronous** | Simple, immediate response | Timeouts, can't handle batches |
| **Background Jobs (Bull Queue)** | In-process, no external dependency | Single point of failure, lost jobs if server crashes |
| **SQS + Workers** | Durable, auto-retry, scalable | Additional AWS service, slight complexity |

### Decision
**Chose SQS (Simple Queue Service) + EC2 Workers + Lambda**

### Justification

**Technical Reasons:**
1. **Decoupling**: NetSuite gets immediate 202 response
   ```javascript
   // API returns in 2 seconds
   await uploadToS3(pdf);
   await sqsQueue.send({ transactionId, s3Key });
   return res.status(202).json({ transactionId });
   
   // Worker processes later (no timeout)
   const message = await sqsQueue.receive();
   await processAndUploadToZoho(message);
   ```
2. **Fault Tolerance**: Messages persist even if worker crashes
3. **Automatic Retry**: Failed messages return to queue after visibility timeout
4. **Dead Letter Queue**: After 3 failures, move to DLQ and alert ops team
5. **Scalability**: Can add more workers during peak loads

**Business Reasons:**
1. **Reliability**: 99.99% success rate (vs 85% with synchronous)
2. **User Experience**: NetSuite users get instant feedback
3. **Cost**: Pay only for messages processed ($0.40/million requests)

### Results
- **Zero Timeouts**: NetSuite never waits > 3 seconds
- **Higher Throughput**: Process 5,000 PDFs/hour during month-end
- **Better Reliability**: Automatic retry handles Zoho rate limits

---

## Decision 4: Redis Caching (ElastiCache)

### Context
Zoho OAuth tokens expire every hour. Refreshing token on every request adds 2 seconds latency.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **No Cache** | Simple | 2-second overhead per request |
| **In-Memory (Node.js)** | Fast, no external dependency | Lost on server restart, not shared across instances |
| **Redis (ElastiCache)** | Shared cache, persistent, TTL support | Additional AWS service |

### Decision
**Chose Redis (ElastiCache)**

### Justification

**Technical Reasons:**
1. **Shared State**: All EC2 instances share same token
   ```javascript
   // Instance 1 refreshes token
   await redis.setex('zoho_token', 3600, newToken);
   
   // Instance 2 uses cached token (no refresh needed)
   const token = await redis.get('zoho_token');
   ```
2. **TTL (Time To Live)**: Auto-expire after 1 hour
3. **Sub-millisecond Latency**: Redis GET takes < 1ms
4. **Persistence**: Survives server restarts

**Business Reasons:**
1. **Performance**: API latency reduced from 3s → 800ms
2. **Cost**: Fewer Zoho API calls (60% reduction)
3. **Scalability**: Works with Auto Scaling (shared cache)

### Results
- **95% Cache Hit Rate**: Only 5% of requests refresh token
- **Latency Improvement**: P95 latency 2.2s → 800ms (63% faster)
- **API Call Reduction**: 10,000 Zoho calls/day → 4,000 calls/day

---

## Decision 5: S3 for PDF Storage

### Context
Need to store PDFs for 7 years (banking compliance). Processing 10,000 PDFs/day = 3.65 million PDFs/year.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **RDS BLOBs** | Simple, same database | Expensive ($0.10/GB), slow, limited storage |
| **EC2 Disk** | Fast access | Lost on instance termination, no redundancy |
| **S3** | Cheap ($0.023/GB), unlimited, lifecycle policies | Slight latency for retrieval |

### Decision
**Chose S3 with Lifecycle Policies**

### Justification

**Technical Reasons:**
1. **Unlimited Storage**: No capacity planning needed
2. **Durability**: 99.999999999% (11 nines) - virtually no data loss
3. **Lifecycle Policies**: Auto-archive old PDFs
   ```json
   {
     "Transitions": [
       {"Days": 30, "StorageClass": "STANDARD_IA"},
       {"Days": 90, "StorageClass": "GLACIER"},
       {"Days": 2555, "StorageClass": "DEEP_ARCHIVE"}
     ]
   }
   ```
4. **Event Triggers**: S3 PUT event triggers Lambda for processing
5. **Versioning**: Can recover accidentally deleted files

**Business Reasons:**
1. **Cost**: $0.023/GB vs $0.10/GB for RDS (78% cheaper)
   - 10TB storage: S3 = $230/month, RDS = $1,000/month
2. **Compliance**: 7-year retention with automatic archival
3. **Scalability**: Handles petabytes without infrastructure changes

### Results
- **Cost Savings**: $500/month saved on storage
- **Zero Data Loss**: 100% of PDFs retained for 7 years
- **Automatic Archival**: Old PDFs moved to Glacier (99% cost reduction)

---

## Decision 6: Application Load Balancer (ALB)

### Context
Single EC2 instance has 95% uptime. Need high availability and ability to scale horizontally.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **No Load Balancer** | Simple, cheap | Single point of failure, can't scale |
| **Network Load Balancer (NLB)** | Ultra-low latency, Layer 4 | No SSL termination, no path-based routing |
| **Application Load Balancer (ALB)** | SSL termination, health checks, Layer 7 routing | Slightly higher cost |

### Decision
**Chose Application Load Balancer (ALB)**

### Justification

**Technical Reasons:**
1. **SSL Termination**: ALB handles HTTPS, EC2 instances use HTTP
   - Simplifies certificate management (one cert on ALB vs multiple on EC2)
2. **Health Checks**: Auto-removes unhealthy instances
   ```yaml
   HealthCheck:
     Path: /health
     Interval: 30 seconds
     UnhealthyThreshold: 3
   ```
3. **Multi-AZ**: Distributes traffic across availability zones
4. **Connection Draining**: Graceful shutdown during deployments
5. **Layer 7 Routing**: Can route based on URL path (future: `/api/v1`, `/api/v2`)

**Business Reasons:**
1. **High Availability**: 99.9% uptime (vs 95% with single EC2)
2. **Zero-Downtime Deployments**: Rolling updates without dropped requests
3. **Scalability**: Works seamlessly with Auto Scaling Group

### Results
- **Uptime**: 95% → 99.9% (4.9% improvement)
- **Deployment Downtime**: 5 minutes → 0 minutes
- **Fault Tolerance**: Survives entire AZ failure

---

## Decision 7: Auto Scaling Group (ASG)

### Context
Traffic varies: 100 PDFs/hour normally, 5,000 PDFs/hour during month-end. Over-provisioning wastes money, under-provisioning causes failures.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Fixed Capacity (10 instances)** | Simple, predictable | Wastes money during off-hours (80% idle) |
| **Manual Scaling** | Full control | Requires 24/7 monitoring, slow response |
| **Auto Scaling Group** | Automatic, cost-effective | Slight complexity in setup |

### Decision
**Chose Auto Scaling Group with Target Tracking**

### Justification

**Technical Reasons:**
1. **Automatic Scaling**: Adds/removes instances based on metrics
   ```hcl
   # Scale when CPU > 70%
   target_tracking_configuration {
     predefined_metric_type = "ASGAverageCPUUtilization"
     target_value = 70.0
   }
   ```
2. **Multiple Scaling Policies**: CPU + SQS queue depth
3. **Health Checks**: Replaces unhealthy instances automatically
4. **Scheduled Scaling**: Scale down at night, scale up before month-end

**Business Reasons:**
1. **Cost Optimization**: Pay only for what you use
   - Normal: 2 instances ($60/month)
   - Peak: 10 instances for 2 hours ($5/month)
   - Total: $65/month vs $300/month (10 instances 24/7)
2. **Performance**: Handles traffic spikes without manual intervention
3. **Reliability**: No single point of failure

### Results
- **Cost Savings**: 60% reduction ($300 → $120/month)
- **Performance**: Zero failures during month-end peaks
- **Automation**: No manual intervention needed

---

## Decision 8: Multi-AZ Deployment

### Context
Single availability zone has 99.5% uptime. Need higher availability for production.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Single AZ** | Cheaper, simpler | Downtime during AZ failure (rare but happens) |
| **Multi-AZ** | High availability, automatic failover | Slightly higher cost |
| **Multi-Region** | Disaster recovery | Complex, expensive, high latency |

### Decision
**Chose Multi-AZ (3 availability zones)**

### Justification

**Technical Reasons:**
1. **Fault Tolerance**: Survives entire AZ failure
   - ALB in us-east-1a, us-east-1b
   - EC2 in us-east-1a, us-east-1b, us-east-1c
   - RDS primary in us-east-1a, standby in us-east-1b
2. **Automatic Failover**: RDS switches to standby in < 2 minutes
3. **Load Distribution**: ALB distributes traffic across AZs

**Business Reasons:**
1. **SLA**: 99.9% uptime guarantee to clients
2. **Cost**: Only 10% more expensive than single AZ
3. **Compliance**: Banking regulations require high availability

### Results
- **Uptime**: 99.5% → 99.95% (50% reduction in downtime)
- **Zero AZ Failures**: Survived 2 AZ outages with no impact
- **RTO (Recovery Time Objective)**: < 2 minutes

---

## Decision 9: Infrastructure as Code (Terraform)

### Context
Manual AWS setup is error-prone and hard to replicate across environments (dev, staging, prod).

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Manual (AWS Console)** | Easy to start | Not reproducible, no version control |
| **CloudFormation** | AWS native, free | YAML/JSON verbose, AWS-only |
| **Terraform** | Multi-cloud, HCL syntax, state management | Learning curve |

### Decision
**Chose Terraform**

### Justification

**Technical Reasons:**
1. **Reproducible**: Same code creates identical infrastructure
   ```hcl
   module "vpc" {
     source = "./modules/vpc"
     environment = var.environment
   }
   ```
2. **Version Control**: Infrastructure changes tracked in Git
3. **State Management**: Terraform tracks what's deployed
4. **Multi-Environment**: Same code for dev/staging/prod with variables

**Business Reasons:**
1. **Disaster Recovery**: Rebuild entire stack in 20 minutes
2. **Consistency**: Dev environment matches production
3. **Collaboration**: Team can review infrastructure changes via PRs

### Results
- **Deployment Time**: 2 hours (manual) → 20 minutes (Terraform)
- **Errors**: 80% reduction in configuration mistakes
- **Environments**: Easily created 3 environments (dev, staging, prod)

---

## Decision 10: CloudWatch + SNS (Monitoring)

### Context
Need to detect and respond to production issues quickly. Manual monitoring is not scalable.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **No Monitoring** | Free | Blind to issues, reactive |
| **Datadog** | Beautiful UI, advanced features | $15/host/month = $450/month |
| **CloudWatch + SNS** | AWS native, cheap, integrated | Basic UI |

### Decision
**Chose CloudWatch + SNS + PagerDuty**

### Justification

**Technical Reasons:**
1. **Native Integration**: Auto-collects EC2, RDS, ALB metrics
2. **Custom Metrics**: Track business metrics
   ```javascript
   await cloudwatch.putMetricData({
     MetricName: 'PDFProcessingTime',
     Value: duration,
     Unit: 'Milliseconds'
   });
   ```
3. **Log Insights**: Query logs with SQL-like syntax
4. **Alarms**: Trigger actions when thresholds exceeded
   ```yaml
   Alarm: DLQ message count > 10
   Action: SNS → PagerDuty → On-call engineer
   ```

**Business Reasons:**
1. **Cost**: $50/month vs $450/month for Datadog
2. **MTTD (Mean Time To Detect)**: 30 minutes → 2 minutes
3. **Proactive**: Detect issues before customers complain

### Results
- **Incident Response**: 30-minute detection → 2-minute detection
- **Cost**: 90% cheaper than Datadog
- **Visibility**: 15+ alarms covering all critical paths

---

## 🎤 How to Present These Decisions in Interviews

### Framework:
1. **State the decision**: "I chose PostgreSQL for the database"
2. **Explain the context**: "We needed to store transaction logs with strong consistency"
3. **List alternatives**: "I considered MySQL, MongoDB, and DynamoDB"
4. **Justify with data**: "PostgreSQL's JSONB support and ACID transactions were critical"
5. **Show results**: "This resulted in 100% data integrity and $200/month cost savings"

### Example Answer:
> **Interviewer**: "Why did you choose Node.js?"
>
> **You**: "I chose Node.js with TypeScript for three main reasons. First, NetSuite uses JavaScript, so using Node.js meant we could use the same language across both systems, making debugging easier. Second, Node.js's non-blocking I/O was perfect for our I/O-heavy workload—we're doing lots of S3 uploads, API calls, and database queries. The event loop lets us handle 10,000+ concurrent requests on a single thread. Third, TypeScript added type safety, which caught bugs at compile time instead of runtime. I considered Python and Java, but Node.js gave us the best combination of performance and developer productivity. We built the MVP in 2 weeks, and it's been handling 10,000 PDFs per day with P95 latency under 1 second."

---

## 📚 Related Documents

- [01-ARCHITECTURE-OVERVIEW.md](./01-ARCHITECTURE-OVERVIEW.md) - Full system architecture
- [05-INTERVIEW-QA.md](./05-INTERVIEW-QA.md) - 50+ interview questions
- [08-STAR-STORIES.md](./08-STAR-STORIES.md) - Behavioral interview stories
