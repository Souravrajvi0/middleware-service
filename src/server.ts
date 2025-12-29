import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import axios, { AxiosRequestHeaders, Method } from "axios";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

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
  const { base64Data, fileName = "file.bin", mimeType = "application/octet-stream", forward }: ConvertRequestBody =
    req.body || {};

  if (!base64Data) {
    return res.status(400).json({ error: "base64Data is required" });
  }

  try {
    const buffer = Buffer.from(base64Data, "base64");

    // If forward URL is provided, send the binary to that URL
    if (forward?.url) {
      const response = await axios.request({
        url: forward.url,
        method: forward.method || "POST",
        headers: {
          "Content-Type": mimeType,
          "Content-Length": buffer.length.toString(),
          ...(forward.headers || {}),
        },
        data: buffer,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
      });

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
    next(error);
  }
});

// Simple health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Basic error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unexpected error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});


