# Setting Up HTTPS on EC2 for NetSuite Middleware

## Problem
NetSuite SuiteScript requires HTTPS URLs. Your current middleware URL is HTTP:
- Current: `http://51.20.245.218:3000/api/convert/base64-to-binary`
- Required: `https://yourdomain.com/api/convert/base64-to-binary`

## Solution Options

### Option 1: Domain + Let's Encrypt (Recommended - Free SSL)

**Requirements:**
- A domain name (e.g., `yourdomain.com`)
- Domain DNS pointing to EC2 IP: `51.20.245.218`

**Steps:**

1. **Install Nginx on EC2:**
   ```bash
   sudo yum update -y
   sudo yum install nginx -y
   ```

2. **Install Certbot (Let's Encrypt):**
   ```bash
   sudo yum install certbot python3-certbot-nginx -y
   ```

3. **Configure Nginx as reverse proxy:**
   Create `/etc/nginx/conf.d/middleware.conf`:
   ```nginx
   server {
       listen 80;
       server_name yourdomain.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

4. **Get SSL Certificate:**
   ```bash
   sudo certbot --nginx -d yourdomain.com
   ```

5. **Update NetSuite URL:**
   Change from: `http://51.20.245.218:3000/api/convert/base64-to-binary`
   To: `https://yourdomain.com/api/convert/base64-to-binary`

---

### Option 2: Cloudflare Tunnel (No Domain Needed - Free)

**Steps:**

1. **Install Cloudflare Tunnel on EC2:**
   ```bash
   wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
   chmod +x cloudflared-linux-amd64
   sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
   ```

2. **Authenticate:**
   ```bash
   cloudflared tunnel login
   ```

3. **Create Tunnel:**
   ```bash
   cloudflared tunnel create netsuite-middleware
   ```

4. **Configure Tunnel:**
   Create `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <tunnel-id>
   credentials-file: /home/ec2-user/.cloudflared/<tunnel-id>.json

   ingress:
     - hostname: netsuite-middleware.yourdomain.workers.dev
       service: http://localhost:3000
     - service: http_status:404
   ```

5. **Run Tunnel:**
   ```bash
   cloudflared tunnel run netsuite-middleware
   ```

6. **Update NetSuite URL:**
   Use: `https://netsuite-middleware.yourdomain.workers.dev/api/convert/base64-to-binary`

---

### Option 3: AWS Application Load Balancer (Production - Paid)

1. Create ALB in AWS Console
2. Add SSL certificate (ACM)
3. Point to EC2 instance
4. Use ALB HTTPS endpoint in NetSuite

---

## Quick Test After Setup

Once HTTPS is working, test with:
```bash
curl https://yourdomain.com/health
```

Should return: `{"status":"ok"}`

## Update NetSuite Code

After setting up HTTPS, update the middleware URL in your Suitelet:
```javascript
var middlewareUrl = 'https://yourdomain.com/api/convert/base64-to-binary';
```


