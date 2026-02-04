# Interview Cheat Sheet - Quick Reference

## 🎯 30-Second Elevator Pitch

> "I built an enterprise middleware service on AWS that integrates NetSuite ERP with Zoho Books, processing 10,000+ PDF vendor bills daily. The system uses Node.js/TypeScript with Auto Scaling, SQS for async processing, RDS PostgreSQL for transaction logs, and S3 for 7-year compliance retention. I achieved 99.9% uptime, 75% faster processing through horizontal scaling, and 60% cost reduction through right-sizing and lifecycle policies."

---

## 📊 Key Metrics (Memorize These!)

| Metric | Value | Context |
|--------|-------|---------|
| **Daily Volume** | 10,000+ PDFs | Peak: 5,000 in 1 hour (month-end) |
| **Uptime** | 99.9% | Multi-AZ ALB + ASG |
| **Processing Time** | 20 min (batch) | Was: 2 hours (75% faster) |
| **API Latency (P95)** | 800ms | Was: 45 seconds (98% reduction) |
| **Cost** | $320/month | Was: $800/month (60% savings) |
| **Success Rate** | 99.99% | SQS retry + DLQ |
| **MTTD** | 2 minutes | CloudWatch alarms |

---

## 🏗️ Tech Stack (Say This Confidently)

**Backend:** Node.js 20.x, TypeScript, Express.js  
**Database:** PostgreSQL 15 (RDS Multi-AZ), ElastiCache Redis  
**AWS Services:** EC2, ALB, Auto Scaling, S3, SQS, Lambda, CloudWatch, SNS, Secrets Manager, VPC  
**IaC:** Terraform (multi-environment: dev/staging/prod)  
**CI/CD:** GitHub Actions (automated testing + deployment)  
**Monitoring:** CloudWatch Logs/Metrics, X-Ray distributed tracing, PagerDuty  
**Security:** KMS encryption, IAM roles, Security Groups, Secrets Manager

---

## 🔄 Request Flow (Explain in 60 Seconds)

```
1. NetSuite creates vendor bill with PDF attachment
2. SuiteScript Suitelet extracts file, converts to Base64
3. HTTP POST to ALB (HTTPS:443) → SSL termination
4. ALB routes to healthy EC2 instance (Round-robin)
5. Middleware decodes Base64 → uploads to S3 incoming bucket
6. Transaction logged in PostgreSQL (status='pending')
7. Return 202 Accepted to NetSuite (async processing)
8. S3 event triggers Lambda → enqueues to SQS
9. EC2 worker polls SQS → downloads PDF from S3
10. Check Redis for Zoho OAuth token (cache hit = 95% of time)
11. Upload PDF to Zoho Books API (multipart/form-data)
12. Update PostgreSQL (status='success')
13. Archive PDF to S3 processed bucket (7-year retention)
14. Delete SQS message → processing complete
```

**If upload fails:** Retry 3x with exponential backoff → Dead Letter Queue → SNS alarm → Email ops team

---

## 💡 Why This Architecture? (3 Key Reasons)

### **1. Compliance**
- Banking regulations require **7-year document retention**
- S3 lifecycle policies: Standard → IA (30d) → Glacier (90d) → Delete (2555d)
- Cost: $0.004/GB/month (vs $0.10/GB for RDS BLOBs)

### **2. Scalability**
- NetSuite sends **batch PDFs during month-end** (5000+ in 1 hour)
- Auto Scaling: 2 instances baseline → 10 instances peak
- Async processing prevents **NetSuite 60-second timeout**

### **3. Reliability**
- Zoho API rate limit: **100 requests/minute**
- SQS queue decouples ingestion from processing
- Dead Letter Queue + retry logic = **99.99% success rate**

---

## 🎤 Common Interview Questions (Rapid Fire)

### **"Why Node.js?"**
> "NetSuite uses JavaScript (SuiteScript 2.1), so Node.js provides seamless integration. TypeScript adds type safety. Non-blocking I/O is perfect for I/O-bound PDF processing."

### **"Why PostgreSQL over NoSQL?"**
> "Need complex queries for reconciliation (JOIN NetSuite IDs with Zoho IDs). ACID transactions for financial audit compliance. JSONB for flexible API logs. Cost: $100/month vs $300/month for DynamoDB."

### **"Why SQS over direct API calls?"**
> "NetSuite has 60-second timeout. Zoho has 100 req/min rate limit. SQS provides automatic retry with exponential backoff and Dead Letter Queue for failed messages."

### **"Why Redis?"**
> "Zoho tokens expire every hour. Redis caching reduces token refresh calls by 60%. Sub-millisecond latency for token lookups."

### **"Why S3 over RDS BLOBs?"**
> "7-year compliance retention. Lifecycle policies (Standard → IA → Glacier). Cost: $0.004/GB vs $0.10/GB. Scalable to petabytes. S3 event triggers for Lambda."

### **"How do you handle failures?"**
> "Three-layer retry: 1) AWS SDK auto-retry (3 attempts), 2) SQS visibility timeout (message reappears after 5 min), 3) Dead Letter Queue after 3 failed attempts triggers CloudWatch alarm."

### **"How do you monitor?"**
> "CloudWatch Logs for all requests. Custom metrics (PDFProcessingTime, ZohoAPILatency). X-Ray distributed tracing. 15+ alarms with PagerDuty integration. RDS Performance Insights for slow queries."

### **"How do you deploy?"**
> "GitHub Actions CI/CD: Run tests → Build TypeScript → Upload to S3 → Trigger ASG instance refresh (90% healthy threshold) → Zero-downtime rolling deployment."

### **"How do you secure data?"**
> "Encryption at rest (S3 SSE-KMS, RDS AES-256). Encryption in transit (TLS 1.3). Secrets Manager for OAuth tokens. IAM roles (no hardcoded credentials). VPC private subnets (no public IPs)."

### **"How would you scale to 100K PDFs/day?"**
> "1) Use Zoho bulk upload API (50 PDFs/request) → 7.2M daily capacity. 2) Aurora PostgreSQL with auto-scaling. 3) Increase ASG max to 50 instances. 4) Add Lambda concurrent execution (1000 workers)."

---

## 🚨 Challenges & Solutions (STAR Method)

### **Challenge 1: NetSuite Timeout**
**Situation:** NetSuite has 60-second timeout. Processing 100 PDFs synchronously took 3 minutes.  
**Task:** Prevent timeouts while maintaining reliability.  
**Action:** Implemented async processing with SQS. API returns 202 Accepted after S3 upload (2 seconds), workers process in background.  
**Result:** P95 latency reduced from 45s → 800ms. Zero timeouts.

### **Challenge 2: Zoho Rate Limits**
**Situation:** Zoho API allows 100 req/min. During peak loads (5000 PDFs/hour), hit rate limit causing 429 errors.  
**Task:** Handle rate limits without losing data.  
**Action:** SQS visibility timeout returns messages to queue after 5 minutes. Automatic exponential backoff.  
**Result:** 99.99% success rate. Zero data loss.

### **Challenge 3: Memory Leaks**
**Situation:** EC2 instances running out of memory after 48 hours. Large PDF buffers not garbage collected.  
**Task:** Identify and fix memory leak.  
**Action:** Enabled heap snapshots. Found buffers accumulating. Added `buffer.fill(0)` to clear buffers after upload.  
**Result:** Memory usage stable at 45%. No more OOM crashes.

---

## 📈 Cost Optimization (Show Business Impact)

| Optimization | Savings | How |
|--------------|---------|-----|
| **Right-sizing** | $40/month | t2.large → t3.medium (CloudWatch showed 45% avg memory) |
| **S3 Lifecycle** | $500/month | Standard → IA (30d) → Glacier (90d) for 10TB storage |
| **Reserved Instances** | $100/month | 1-year RI for baseline 2 instances (30% discount) |
| **Auto Scaling Schedule** | $80/month | Scale down to 1 instance during off-hours (10 PM - 6 AM) |
| **Total** | **$720/month** | **60% cost reduction** |

---

## 🛡️ Security Highlights

- **Network:** VPC private subnets, Security Groups (port 3000 from ALB only), NAT Gateways
- **Encryption:** S3 SSE-KMS, RDS AES-256, TLS 1.3 in transit
- **Secrets:** AWS Secrets Manager with 90-day auto-rotation
- **Access:** IAM roles (least privilege), no hardcoded credentials
- **Audit:** CloudTrail (all AWS API calls), VPC Flow Logs, application logs
- **Compliance:** SOC 2 Type II, 7-year retention (banking regulations)

---

## 🔧 Debugging Workflow (Show Systematic Thinking)

```
1. CloudWatch alarm triggers → PagerDuty notification
2. Check dashboard → Identify spike in 500 errors
3. Query logs (CloudWatch Insights):
   fields @timestamp, error, transactionId
   | filter @message like /500/
   | sort @timestamp desc
4. Trace specific transaction in database:
   SELECT * FROM transactions WHERE transaction_id = '...';
5. Check X-Ray service map → Identify bottleneck (Zoho API latency)
6. Reproduce locally with downloaded S3 PDF
7. Fix → Deploy to staging → Integration tests → Canary (10% traffic) → Full rollout
```

---

## 📚 Database Schema (Quick Reference)

```sql
-- transactions table
transaction_id UUID PRIMARY KEY
netsuite_bill_id VARCHAR(50) UNIQUE
zoho_bill_id VARCHAR(50)
file_name VARCHAR(255)
s3_bucket VARCHAR(100)
s3_key VARCHAR(255)
status ENUM('pending', 'processing', 'success', 'failed')
retry_count INTEGER DEFAULT 0
created_at TIMESTAMP
processed_at TIMESTAMP
error_message TEXT

-- Indexes
idx_status (status)
idx_created_at (created_at)
idx_netsuite_bill (netsuite_bill_id) UNIQUE
```

---

## 🎯 AWS Services Justification (One-Liners)

| Service | Why? |
|---------|------|
| **EC2** | Persistent connections, custom runtime (Node.js 20.x), cost-effective for baseline load |
| **ALB** | Layer 7 routing, SSL termination, health checks, multi-AZ distribution |
| **Auto Scaling** | Handle 10x traffic spikes (month-end batches), pay only for what you use |
| **S3** | 7-year compliance retention, lifecycle policies, event triggers, $0.004/GB/month |
| **SQS** | Decouple ingestion from processing, automatic retry, Dead Letter Queue |
| **Lambda** | Event-driven (S3 triggers), serverless (no infrastructure management), cost-effective for bursts |
| **RDS** | ACID transactions, complex queries (JOINs), automated backups, Multi-AZ failover |
| **Redis** | Sub-millisecond latency, token caching (60% reduction in API calls), TTL support |
| **CloudWatch** | Centralized logging, custom metrics, alarms, dashboards, Insights queries |
| **Secrets Manager** | Encrypted secrets, auto-rotation, IAM integration, audit trail |

---

## 🚀 Future Enhancements (Show Forward Thinking)

1. **Multi-Tenant Support:** Isolated S3 buckets per client, tenant-specific databases
2. **ECS/Kubernetes:** Container orchestration, 50% cost reduction with Fargate Spot
3. **GraphQL API:** Unified API for NetSuite + Zoho, reduce over-fetching
4. **ML-based PDF Validation:** AWS Textract for OCR, auto-detect invoice fields
5. **Cross-Region DR:** S3 Cross-Region Replication, RTO < 1 hour, RPO < 5 minutes

---

## 📖 Study Tips for Interview

### **Before Interview:**
1. Review all 6 docs (30 min each)
2. Practice drawing architecture diagram on whiteboard
3. Memorize key metrics (uptime, latency, cost)
4. Prepare 3 STAR stories (challenges you solved)

### **During Interview:**
1. **Start with overview** (30-second pitch)
2. **Use diagrams** (draw on whiteboard/paper)
3. **Mention metrics** (99.9% uptime, 75% faster)
4. **Show trade-offs** ("I chose X over Y because...")
5. **Ask clarifying questions** (don't assume requirements)

### **Common Mistakes to Avoid:**
- ❌ Jumping into code without explaining architecture
- ❌ Not mentioning metrics/business impact
- ❌ Saying "I don't know" (say "I would research X and Y")
- ❌ Over-engineering (keep it simple, then scale)
- ❌ Forgetting to mention monitoring/security

---

## 🎓 Key Takeaways (Memorize!)

1. **Async processing** prevents timeouts and improves scalability
2. **SQS + DLQ** provides fault tolerance and automatic retry
3. **Redis caching** reduces external API calls by 60%
4. **Multi-AZ deployment** ensures 99.9% uptime
5. **S3 lifecycle policies** reduce storage costs by 80%
6. **Auto Scaling** handles 10x traffic spikes without over-provisioning
7. **CloudWatch alarms** detect issues in 2 minutes (MTTD)
8. **Terraform IaC** enables reproducible deployments
9. **Zero-downtime deployments** with ASG instance refresh
10. **Security in depth:** Encryption, IAM, VPC, Secrets Manager

---

## 📞 Quick Links

- [Full Architecture](./01-ARCHITECTURE-OVERVIEW.md)
- [Request Flow](./02-REQUEST-FLOW-DETAILED.md)
- [API Docs](./03-API-ENDPOINTS.md)
- [Deployment Guide](./04-DEPLOYMENT-GUIDE.md)
- [50+ Q&A](./05-INTERVIEW-QA.md)

---

**Good luck with your interviews! 🚀**
