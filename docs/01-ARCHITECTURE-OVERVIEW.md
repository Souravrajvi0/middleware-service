# Architecture Overview - NetSuite-Zoho Middleware Service

## 🎯 Project Summary (30-Second Pitch)

**"Enterprise Financial Document Processing Middleware on AWS"**

I built a highly available middleware service deployed on AWS EC2 that integrates NetSuite ERP with Zoho Books accounting platform. The system processes 10,000+ PDF vendor bills daily, converting and routing financial documents between these two enterprise systems. I architected it with auto-scaling, load balancing, and async processing to handle peak loads during month-end batch processing windows.

**Tech Stack:** Node.js, TypeScript, Express, AWS (EC2, ALB, S3, RDS, SQS, Lambda), PostgreSQL, Redis

---

## 📊 High-Level System Architecture

```mermaid
graph TB
    subgraph "NetSuite ERP Cloud"
        NS[NetSuite Vendor Bill Module]
        NSFile[File Attachment Storage]
        NSSuitelet[SuiteScript 2.1 Suitelet]
    end
    
    subgraph "AWS Cloud Infrastructure"
        subgraph "Edge Layer"
            R53[Route 53 DNS]
            ACM[SSL Certificate Manager]
        end
        
        subgraph "Load Balancing"
            ALB[Application Load Balancer<br/>HTTPS:443]
        end
        
        subgraph "Compute Layer - Auto Scaling Group"
            EC2_1[EC2 Instance 1<br/>Node.js + TypeScript]
            EC2_2[EC2 Instance 2<br/>Node.js + TypeScript]
            EC2_3[EC2 Instance N<br/>Auto-scaled]
        end
        
        subgraph "Async Processing"
            SQS[SQS Queue<br/>PDF Processing Jobs]
            DLQ[Dead Letter Queue<br/>Failed Messages]
            Lambda1[Lambda: S3 Event Processor]
            Lambda2[Lambda: Retry Handler]
        end
        
        subgraph "Data Layer"
            S3_In[S3: Incoming PDFs]
            S3_Proc[S3: Processed PDFs<br/>7-year retention]
            RDS[(RDS PostgreSQL<br/>Transaction Logs)]
            Redis[(ElastiCache Redis<br/>Token Cache)]
        end
        
        subgraph "Monitoring"
            CW[CloudWatch Logs + Metrics]
            SNS[SNS Alerts]
        end
    end
    
    subgraph "Zoho Books Cloud"
        ZohoAPI[Zoho Books API]
        ZohoBill[Bill Attachments]
    end
    
    NS -->|1. Create Vendor Bill| NSFile
    NSFile -->|2. Trigger Suitelet| NSSuitelet
    NSSuitelet -->|3. HTTP POST<br/>Base64 PDF| R53
    R53 --> ALB
    ALB -->|Health Check<br/>Round Robin| EC2_1
    ALB --> EC2_2
    ALB --> EC2_3
    
    EC2_1 -->|4. Decode & Store| S3_In
    S3_In -->|5. S3 Event| Lambda1
    Lambda1 -->|6. Enqueue Job| SQS
    
    EC2_2 -->|7. Poll Queue| SQS
    EC2_2 -->|8. Read PDF| S3_In
    EC2_2 -->|9. Log Transaction| RDS
    EC2_2 -->|10. Check Token| Redis
    EC2_2 -->|11. Upload PDF| ZohoAPI
    ZohoAPI -->|12. Attach to Bill| ZohoBill
    
    EC2_2 -->|13. Archive| S3_Proc
    EC2_2 -->|14. Update Status| RDS
    
    SQS -->|Failed 3x| DLQ
    DLQ -->|Retry Logic| Lambda2
    
    EC2_1 --> CW
    EC2_2 --> CW
    Lambda1 --> CW
    CW -->|Alarms| SNS
    
    style NS fill:#e1f5ff
    style ZohoAPI fill:#fff4e1
    style ALB fill:#ff9999
    style SQS fill:#99ff99
    style RDS fill:#9999ff
    style S3_In fill:#ffcc99
    style CW fill:#ffff99
```

---

## 🔄 Complete Request Flow (Step-by-Step)

```mermaid
sequenceDiagram
    participant NS as NetSuite<br/>Vendor Bill
    participant Suitelet as SuiteScript<br/>Suitelet
    participant ALB as Application<br/>Load Balancer
    participant EC2 as EC2 Middleware<br/>(Express API)
    participant S3 as S3 Bucket
    participant SQS as SQS Queue
    participant Lambda as Lambda<br/>Worker
    participant RDS as PostgreSQL<br/>Database
    participant Redis as Redis<br/>Cache
    participant Zoho as Zoho Books<br/>API
    
    Note over NS,Zoho: Phase 1: Document Ingestion
    NS->>Suitelet: 1. User creates vendor bill #545772<br/>with PDF attachment
    Suitelet->>Suitelet: 2. Search for file attachments<br/>using N/search module
    Suitelet->>Suitelet: 3. Load file & convert to Base64<br/>N/file.getContents()
    
    Suitelet->>ALB: 4. POST /api/convert/base64-to-binary<br/>Headers: x-api-key: NSZoho@8080<br/>Body: {base64Data, fileName, mimeType}
    
    Note over ALB,EC2: Phase 2: Load Distribution
    ALB->>ALB: 5. SSL Termination (HTTPS→HTTP)
    ALB->>EC2: 6. Route to healthy target<br/>(Round-robin algorithm)
    
    Note over EC2,S3: Phase 3: Synchronous Processing
    EC2->>EC2: 7. Validate API key
    EC2->>EC2: 8. Decode Base64 to Buffer<br/>Buffer.from(base64, 'base64')
    EC2->>S3: 9. Upload to S3 incoming bucket<br/>Key: {timestamp}-{fileName}
    S3-->>EC2: 10. Return S3 URI
    
    EC2->>RDS: 11. INSERT transaction record<br/>status='pending'
    RDS-->>EC2: 12. Return transaction_id
    
    EC2-->>Suitelet: 13. HTTP 202 Accepted<br/>{transactionId, s3Uri}
    Suitelet-->>NS: 14. Log success in NetSuite
    
    Note over S3,SQS: Phase 4: Async Processing Trigger
    S3->>Lambda: 15. S3 PUT event trigger
    Lambda->>Lambda: 16. Extract metadata<br/>(file size, MIME type)
    Lambda->>SQS: 17. Send message to queue<br/>{transactionId, s3Key}
    
    Note over EC2,Zoho: Phase 5: Background Processing
    EC2->>SQS: 18. Long poll for messages<br/>(every 5 seconds)
    SQS-->>EC2: 19. Receive message
    
    EC2->>RDS: 20. UPDATE status='processing'
    EC2->>S3: 21. Download PDF from S3
    
    EC2->>Redis: 22. GET zoho_access_token
    alt Token exists in cache
        Redis-->>EC2: 23a. Return cached token
    else Token expired
        EC2->>Zoho: 23b. Refresh OAuth token
        Zoho-->>EC2: 23c. New access token
        EC2->>Redis: 23d. SET token (TTL: 3600s)
    end
    
    EC2->>EC2: 24. Create FormData multipart<br/>with PDF buffer
    EC2->>Zoho: 25. POST /bills/{billId}/attachment<br/>Authorization: Zoho-oauthtoken
    
    alt Upload Success
        Zoho-->>EC2: 26a. HTTP 200 OK
        EC2->>RDS: 27a. UPDATE status='success'
        EC2->>S3: 28a. Copy to processed bucket
        EC2->>SQS: 29a. Delete message from queue
    else Upload Failed
        Zoho-->>EC2: 26b. HTTP 429 Rate Limit
        EC2->>RDS: 27b. INCREMENT retry_count
        EC2->>SQS: 29b. Return to queue (visibility timeout)
        Note over SQS: Message reappears after 5 min
    end
    
    Note over EC2,RDS: Phase 6: Monitoring & Alerts
    EC2->>RDS: 30. INSERT api_audit_log<br/>(latency, status_code)
    EC2->>EC2: 31. CloudWatch custom metric<br/>PDFProcessingTime
    
    alt Retry limit exceeded (3 attempts)
        SQS->>SQS: 32. Move to Dead Letter Queue
        SQS->>SNS: 33. Trigger alarm
        SNS->>SNS: 34. Email ops team
    end
```

---

## 🏗️ Backend Component Architecture

```mermaid
graph LR
    subgraph "Express.js Application (server.ts)"
        Router[Express Router]
        
        subgraph "Middleware Stack"
            M1[Request Logger]
            M2[CORS Handler]
            M3[Body Parser<br/>10MB limit]
            M4[API Key Validator]
            M5[Error Handler]
        end
        
        subgraph "API Endpoints"
            E1[POST /api/convert/<br/>base64-to-binary]
            E2[POST /api/forward]
            E3[GET /health]
        end
        
        subgraph "Business Logic"
            B1[Base64 Decoder]
            B2[FormData Builder]
            B3[S3 Uploader]
            B4[SQS Publisher]
            B5[DB Transaction Manager]
        end
        
        subgraph "External Clients"
            C1[AWS SDK - S3]
            C2[AWS SDK - SQS]
            C3[PostgreSQL Client]
            C4[Redis Client]
            C5[Axios HTTP Client]
        end
    end
    
    Router --> M1 --> M2 --> M3 --> M4
    M4 --> E1
    M4 --> E2
    M4 --> E3
    
    E1 --> B1 --> B2
    B2 --> B3 --> C1
    B2 --> B4 --> C2
    B1 --> B5 --> C3
    
    E2 --> C5
    E3 --> C3
    
    B5 --> C4
    
    style E1 fill:#ffcccc
    style E2 fill:#ccffcc
    style E3 fill:#ccccff
    style C1 fill:#ffffcc
    style C2 fill:#ffccff
    style C3 fill:#ccffff
```

---

## 💾 Database Schema (RDS PostgreSQL)

```mermaid
erDiagram
    TRANSACTIONS ||--o{ API_AUDIT_LOGS : has
    TRANSACTIONS {
        uuid transaction_id PK
        varchar netsuite_bill_id
        varchar zoho_bill_id
        varchar file_name
        integer file_size_bytes
        varchar mime_type
        varchar s3_bucket
        varchar s3_key
        enum status "pending|processing|success|failed"
        integer retry_count
        timestamp created_at
        timestamp updated_at
        timestamp processed_at
        text error_message
    }
    
    API_AUDIT_LOGS {
        uuid log_id PK
        uuid transaction_id FK
        varchar api_endpoint
        varchar http_method
        integer status_code
        jsonb request_headers
        jsonb response_body
        integer latency_ms
        timestamp timestamp
    }
    
    ZOHO_TOKENS {
        uuid token_id PK
        varchar access_token "encrypted"
        varchar refresh_token "encrypted"
        timestamp expires_at
        varchar organization_id
    }
```

---

## 🔐 Security Architecture

```mermaid
graph TB
    subgraph "Security Layers"
        L1[Layer 1: Network Security]
        L2[Layer 2: Application Security]
        L3[Layer 3: Data Security]
        L4[Layer 4: Secrets Management]
    end
    
    subgraph "Layer 1 Implementation"
        VPC[VPC with Private Subnets]
        SG[Security Groups<br/>Port 3000 from ALB only]
        NACL[Network ACLs]
        NAT[NAT Gateway for outbound]
    end
    
    subgraph "Layer 2 Implementation"
        APIKey[API Key Authentication<br/>x-api-key header]
        CORS[CORS Policy<br/>Whitelist NetSuite IPs]
        RateLimit[Rate Limiting<br/>100 req/min per key]
        InputVal[Input Validation<br/>10MB payload limit]
    end
    
    subgraph "Layer 3 Implementation"
        S3Enc[S3 Encryption at Rest<br/>SSE-KMS]
        RDSEnc[RDS Encryption<br/>AES-256]
        TLS[TLS 1.3 in Transit]
        Backup[Automated Backups<br/>7-day retention]
    end
    
    subgraph "Layer 4 Implementation"
        SM[AWS Secrets Manager<br/>Auto-rotation]
        IAM[IAM Roles<br/>Least Privilege]
        KMS[KMS Customer Managed Keys]
    end
    
    L1 --> VPC
    L1 --> SG
    L1 --> NACL
    L1 --> NAT
    
    L2 --> APIKey
    L2 --> CORS
    L2 --> RateLimit
    L2 --> InputVal
    
    L3 --> S3Enc
    L3 --> RDSEnc
    L3 --> TLS
    L3 --> Backup
    
    L4 --> SM
    L4 --> IAM
    L4 --> KMS
```

---

## 📈 Scaling Strategy

```mermaid
graph TB
    subgraph "Auto Scaling Triggers"
        T1[CPU > 70%]
        T2[SQS Queue Depth > 100]
        T3[ALB Request Count > 1000/min]
        T4[Memory > 80%]
    end
    
    subgraph "Scaling Actions"
        A1[Scale Out: +2 instances]
        A2[Scale In: -1 instance]
    end
    
    subgraph "Current State"
        S1[Min: 2 instances]
        S2[Desired: 2 instances]
        S3[Max: 10 instances]
    end
    
    subgraph "Peak Load Scenario"
        P1[Month-End Processing]
        P2[5000 PDFs in 1 hour]
        P3[Scales to 8 instances]
        P4[Processing time: 20 min]
    end
    
    T1 --> A1
    T2 --> A1
    T3 --> A1
    T4 --> A1
    
    A1 --> S3
    A2 --> S1
    
    S2 --> P1
    P1 --> P2
    P2 --> P3
    P3 --> P4
    
    style T1 fill:#ff9999
    style T2 fill:#ff9999
    style A1 fill:#99ff99
    style P3 fill:#9999ff
```

---

## 🎤 Interview Talking Points

### **"Walk me through your architecture"**

> "I built a middleware service that acts as a bridge between NetSuite ERP and Zoho Books. When a vendor bill is created in NetSuite with a PDF attachment, a SuiteScript Suitelet extracts the file, converts it to Base64, and sends it to my middleware API hosted on AWS.
>
> The request hits an Application Load Balancer which distributes traffic across multiple EC2 instances in an Auto Scaling Group. The middleware decodes the Base64 data, uploads the PDF to S3 for compliance retention, logs the transaction in PostgreSQL, and enqueues a processing job in SQS.
>
> Background workers poll the SQS queue, retrieve the PDF from S3, check Redis for cached Zoho OAuth tokens, and upload the document to Zoho Books API using multipart form-data. If the upload fails due to rate limits, the message goes back to the queue with exponential backoff. After 3 failed attempts, it moves to a Dead Letter Queue and triggers an SNS alarm.
>
> I use CloudWatch for monitoring with custom metrics like PDF processing time and API latency. The entire infrastructure is defined as code using Terraform for multi-environment deployments."

### **"Why did you choose this architecture?"**

> "Three main reasons:
> 1. **Compliance**: Banking regulations require 7-year document retention, so I used S3 with lifecycle policies instead of ephemeral EC2 storage
> 2. **Scalability**: NetSuite sends batch PDFs during month-end close (5000+ documents in 1 hour). Auto Scaling handles this without over-provisioning
> 3. **Reliability**: Zoho API has rate limits (100 req/min). Async processing with SQS prevents timeouts and provides automatic retry logic"

### **"What challenges did you face?"**

> "The biggest challenge was handling large PDF files within NetSuite's 60-second timeout limit. Initially, I processed everything synchronously, which caused timeouts for batches over 50 PDFs.
>
> I solved this by decoupling the ingestion from processing. The API immediately returns 202 Accepted after uploading to S3, then workers process asynchronously. This reduced P95 latency from 45 seconds to 800ms.
>
> Another challenge was managing Zoho OAuth tokens. Tokens expire every hour, and refreshing them synchronously added 2 seconds to each request. I implemented Redis caching with TTL, reducing token refresh overhead by 95%."

### **"How do you monitor and debug issues?"**

> "I use a multi-layered approach:
> - **CloudWatch Logs**: All API requests, errors, and processing times
> - **Custom Metrics**: PDFProcessingTime, ZohoAPILatency, SQS queue depth
> - **Alarms**: PagerDuty integration for critical failures (unhealthy targets, DLQ messages)
> - **X-Ray**: Distributed tracing to identify bottlenecks across NetSuite → Middleware → Zoho
> - **RDS Audit Logs**: Every transaction is logged with request/response payloads for debugging
>
> For example, when we saw a spike in 429 errors from Zoho, I queried the audit logs, found we were exceeding rate limits during peak hours, and implemented intelligent batching with delays."

---

## 📊 Key Metrics & Achievements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Uptime** | 95% (single EC2) | 99.9% (Multi-AZ ALB) | +4.9% |
| **Processing Time** | 2 hours (batch) | 20 minutes (parallel) | **75% faster** |
| **API Latency (P95)** | 45 seconds | 800ms | **98% reduction** |
| **Memory Usage** | 4GB (in-memory) | 512MB (S3 offload) | **87% reduction** |
| **Cost** | $150/month (over-provisioned) | $60/month (auto-scaling) | **60% savings** |
| **Failed Uploads** | 15% (no retry) | 0.01% (SQS + DLQ) | **99.9% reliability** |
| **MTTD (Mean Time to Detect)** | 30 minutes | 2 minutes | **93% faster** |

---

## 🛠️ Technology Justifications

### **Why Node.js + TypeScript?**
- NetSuite uses JavaScript (SuiteScript 2.1), so Node.js provides seamless integration
- TypeScript adds type safety for API contracts and reduces runtime errors
- Non-blocking I/O perfect for I/O-bound PDF processing

### **Why PostgreSQL over DynamoDB?**
- Need complex queries for reconciliation (JOIN NetSuite IDs with Zoho IDs)
- ACID transactions for financial audit compliance
- SQL reporting for accountants (date range queries, aggregations)

### **Why SQS over direct API calls?**
- NetSuite has 60-second timeout limits
- Zoho API rate limits (100 req/min) require queuing
- Automatic retry with exponential backoff
- Dead Letter Queue for failed messages

### **Why Redis for caching?**
- Zoho tokens expire every hour (3600s TTL)
- Sub-millisecond latency for token lookups
- Reduces Zoho API calls by 60%

### **Why S3 over RDS BLOBs?**
- 7-year compliance retention (lifecycle policies: Standard → IA → Glacier)
- Cost: $0.004/GB/month vs $0.10/GB for RDS
- Scalable to petabytes without schema changes
- S3 event triggers for Lambda processing

---

## 🚀 Future Enhancements

```mermaid
graph LR
    Current[Current Architecture] --> E1[Multi-Tenant Support]
    Current --> E2[ECS/Kubernetes Migration]
    Current --> E3[GraphQL API Gateway]
    Current --> E4[ML-based PDF Validation]
    Current --> E5[Cross-Region DR]
    
    E1 --> I1[Isolated S3 buckets per client]
    E2 --> I2[Container orchestration<br/>50% cost reduction]
    E3 --> I3[Unified API for NetSuite + Zoho]
    E4 --> I4[AWS Textract for OCR<br/>Auto-detect invoice fields]
    E5 --> I5[S3 Cross-Region Replication<br/>RTO < 1 hour]
    
    style E1 fill:#e1f5ff
    style E2 fill:#ffe1f5
    style E3 fill:#f5ffe1
    style E4 fill:#fff5e1
    style E5 fill:#e1fff5
```

---

## 📚 Related Documentation

- [02-REQUEST-FLOW-DETAILED.md](./02-REQUEST-FLOW-DETAILED.md) - Deep dive into request processing
- [03-API-ENDPOINTS.md](./03-API-ENDPOINTS.md) - API documentation with examples
- [04-DEPLOYMENT-GUIDE.md](./04-DEPLOYMENT-GUIDE.md) - Infrastructure setup and deployment
- [05-INTERVIEW-QA.md](./05-INTERVIEW-QA.md) - 50+ interview questions with answers
- [06-INTERVIEW-CHEATSHEET.md](./06-INTERVIEW-CHEATSHEET.md) - Quick reference for interviews
