import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import axios, { AxiosRequestHeaders, Method } from "axios";
import FormData from "form-data";

export const app = express();
const PORT = process.env.PORT || 3000;

// Catch-all request logger - logs EVERY request before anything else
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log("\n🔵 ===== INCOMING REQUEST =====");
  console.log("Method:", req.method);
  console.log("URL:", req.url);
  console.log("Path:", req.path);
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("================================\n");
  next();
});

app.use(cors());

// JSON body parser with error handling
app.use(
  express.json({
    limit: "10mb",
    strict: false,
  })
);

// Middleware to log parsed body (runs after express.json())
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log("📦 Body after parsing:", {
    type: typeof req.body,
    keys: req.body && typeof req.body === "object" ? Object.keys(req.body) : "N/A",
    preview: req.body && typeof req.body === "object" ? JSON.stringify(req.body).substring(0, 200) : req.body,
  });
  next();
});

// API Key validation middleware
// Matches the security from Cloudflare worker
const API_KEY = process.env.API_KEY || "NSZoho@8080"; // Default matches NetSuite

app.use((req: Request, res: Response, next: NextFunction) => {
  // Skip API key check for health endpoint
  if (req.path === "/health" || req.path === "/") {
    return next();
  }

  // Check for API key in headers
  const providedKey = req.headers["x-api-key"];

  if (!providedKey || providedKey !== API_KEY) {
    console.warn("❌ API key validation failed", {
      path: req.path,
      method: req.method,
      providedKey: providedKey ? "present (invalid)" : "missing",
    });
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or missing API key. Please provide valid x-api-key header.",
    });
  }

  console.log("✅ API key validated for", req.path);
  next();
});

interface ForwardRequestBody {
  targetUrl: string;
  method?: Method;
  headers?: Record<string, string>;
  body?: unknown;
}

app.post("/api/forward", async (req: Request, res: Response, next: NextFunction) => {
  const { targetUrl, method = "POST", headers = {}, body }: ForwardRequestBody = req.body || {};

  if (!targetUrl) {
    return res.status(400).json({ error: "targetUrl is required" });
  }

  try {
    const response = await axios.request({
      url: targetUrl,
      method,
      headers,
      data: body,
      validateStatus: () => true,
    });

    res.status(response.status).json({
      status: response.status,
      headers: response.headers,
      data: response.data,
    });
  } catch (error) {
    next(error);
  }
});

interface ConvertForwardConfig {
  url: string;
  method?: Method;
  headers?: Record<string, string>;
}

interface ConvertRequestBody {
  base64Data: string;
  fileName?: string;
  mimeType?: string;
  forward?: ConvertForwardConfig;
}

app.post("/api/convert/base64-to-binary", async (req: Request, res: Response, next: NextFunction) => {
  // Detailed logging of the incoming request for debugging
  console.log("=== /api/convert/base64-to-binary called ===");
  console.log("Headers:", req.headers);
  console.log("Raw body as received:", req.body);

  const {
    base64Data,
    fileName = "file.bin",
    mimeType = "application/octet-stream",
    forward,
  }: ConvertRequestBody = (req.body || {}) as ConvertRequestBody;

  console.log("Parsed request fields:", {
    hasBase64Data: !!base64Data,
    base64Preview: base64Data ? base64Data.substring(0, 50) + "..." : null,
    fileName,
    mimeType,
    forward,
  });

  if (!base64Data) {
    console.warn("Request rejected: base64Data is missing or empty");
    return res.status(400).json({ error: "base64Data is required" });
  }

  try {
    const buffer = Buffer.from(base64Data, "base64");
    console.log("Decoded buffer length (bytes):", buffer.length);

    // If forward URL is provided, send the binary to that URL
    if (forward?.url) {
      console.log("Forwarding binary to URL:", forward.url, {
        method: forward.method || "POST",
        mimeType,
        fileName,
      });

      // Create multipart/form-data for Zoho API
      const formData = new FormData();
      formData.append('attachment', buffer, {
        filename: fileName,
        contentType: mimeType
      });

      console.log("📤 Sending as multipart/form-data with filename:", fileName);

      const response = await axios.request({
        url: forward.url,
        method: forward.method || "POST",
        headers: {
          ...formData.getHeaders(), // This adds the correct multipart boundary
          ...(forward.headers || {}), // Include Zoho auth token
        },
        data: formData,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
      });

      console.log("✅ Zoho response status:", response.status);
      console.log("📦 Zoho response data:", JSON.stringify(response.data, null, 2));

      return res.status(response.status).json({
        status: response.status,
        headers: response.headers,
        data: response.data,
      });
    }

    // Otherwise, return the binary file directly
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    console.error("❌ Error in base64-to-binary conversion:", error);
    next(error);
  }
});

// Simple health check
app.get("/health", (_req: Request, res: Response) => {
  console.log("Health check successful");

  res.json({ status: "ok" });
});

// Simple test POST endpoint - accepts anything and echoes it back
app.post("/api/test", (req: Request, res: Response) => {
  console.log("\n🟢 ===== TEST ENDPOINT HIT =====");
  console.log("Method:", req.method);
  console.log("URL:", req.url);
  console.log("Body type:", typeof req.body);
  console.log("Body content:", req.body);
  console.log("Headers:", req.headers);
  console.log("===============================\n");

  res.json({
    success: true,
    message: "Test endpoint received your request!",
    receivedBody: req.body,
    bodyType: typeof req.body,
    timestamp: new Date().toISOString(),
  });
});

// Error handler for JSON parsing errors (must be before other error handlers)
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && "body" in err) {
    console.error("❌ JSON parsing error:", err);
    console.error("Request URL:", req.url);
    console.error("Request method:", req.method);
    console.error("Content-Type header:", req.headers["content-type"]);
    return res.status(400).json({
      error: "Invalid JSON in request body",
      details: err.message,
    });
  }
  next(err);
});

// Basic error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Only start server if this file is run directly (not imported)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
    console.log(`🔒 API Key: ${API_KEY}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  });
}


