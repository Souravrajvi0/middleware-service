import request from 'supertest';
import axios from 'axios';

// Mock axios before importing the server
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Import the app from server
import { app } from '../src/server';

describe('NetSuite Middleware Server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return status ok', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });
  });

  describe('POST /api/forward', () => {
    it('should forward request to target URL', async () => {
      const mockResponse = {
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: { success: true },
      };

      mockedAxios.request.mockResolvedValueOnce(mockResponse as any);

      const response = await request(app)
        .post('/api/forward')
        .send({
          targetUrl: 'https://example.com/api',
          method: 'POST',
          headers: { 'Authorization': 'Bearer token' },
          body: { test: 'data' },
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 200,
        headers: mockResponse.headers,
        data: mockResponse.data,
      });

      expect(mockedAxios.request).toHaveBeenCalledWith({
        url: 'https://example.com/api',
        method: 'POST',
        headers: { 'Authorization': 'Bearer token' },
        data: { test: 'data' },
        validateStatus: expect.any(Function),
      });
    });

    it('should use default method POST if not provided', async () => {
      const mockResponse = {
        status: 200,
        headers: {},
        data: {},
      };

      mockedAxios.request.mockResolvedValueOnce(mockResponse as any);

      await request(app)
        .post('/api/forward')
        .send({
          targetUrl: 'https://example.com/api',
        });

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should return 400 if targetUrl is missing', async () => {
      const response = await request(app)
        .post('/api/forward')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'targetUrl is required' });
    });

    it('should handle different HTTP methods', async () => {
      const mockResponse = {
        status: 200,
        headers: {},
        data: {},
      };

      mockedAxios.request.mockResolvedValueOnce(mockResponse as any);

      await request(app)
        .post('/api/forward')
        .send({
          targetUrl: 'https://example.com/api',
          method: 'GET',
        });

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should handle axios errors', async () => {
      const error = new Error('Network error');
      mockedAxios.request.mockRejectedValueOnce(error);

      const response = await request(app)
        .post('/api/forward')
        .send({
          targetUrl: 'https://example.com/api',
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });
  });

  describe('POST /api/convert/base64-to-binary', () => {
    const validBase64 = Buffer.from('Hello, World!').toString('base64');

    it('should convert base64 to binary and return file', async () => {
      const response = await request(app)
        .post('/api/convert/base64-to-binary')
        .send({
          base64Data: validBase64,
          fileName: 'test.txt',
          mimeType: 'text/plain',
        });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/plain');
      expect(response.headers['content-disposition']).toBe('attachment; filename="test.txt"');
      expect(Buffer.from(response.body)).toEqual(Buffer.from('Hello, World!'));
    });

    it('should use default fileName and mimeType if not provided', async () => {
      const response = await request(app)
        .post('/api/convert/base64-to-binary')
        .send({
          base64Data: validBase64,
        });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/octet-stream');
      expect(response.headers['content-disposition']).toBe('attachment; filename="file.bin"');
    });

    it('should return 400 if base64Data is missing', async () => {
      const response = await request(app)
        .post('/api/convert/base64-to-binary')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'base64Data is required' });
    });

    it('should forward binary to URL if forward config is provided', async () => {
      const mockResponse = {
        status: 201,
        headers: { 'content-type': 'application/json' },
        data: { id: '123' },
      };

      mockedAxios.request.mockResolvedValueOnce(mockResponse as any);

      const response = await request(app)
        .post('/api/convert/base64-to-binary')
        .send({
          base64Data: validBase64,
          fileName: 'test.txt',
          mimeType: 'text/plain',
          forward: {
            url: 'https://example.com/upload',
            method: 'POST',
            headers: { 'X-Custom-Header': 'value' },
          },
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        status: 201,
        headers: mockResponse.headers,
        data: mockResponse.data,
      });

      expect(mockedAxios.request).toHaveBeenCalledWith({
        url: 'https://example.com/upload',
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.from('Hello, World!').length.toString(),
          'X-Custom-Header': 'value',
        },
        data: Buffer.from('Hello, World!'),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: expect.any(Function),
      });
    });

    it('should use default POST method for forward if not specified', async () => {
      const mockResponse = {
        status: 200,
        headers: {},
        data: {},
      };

      mockedAxios.request.mockResolvedValueOnce(mockResponse as any);

      await request(app)
        .post('/api/convert/base64-to-binary')
        .send({
          base64Data: validBase64,
          forward: {
            url: 'https://example.com/upload',
          },
        });

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should handle forward errors', async () => {
      const error = new Error('Upload failed');
      mockedAxios.request.mockRejectedValueOnce(error);

      const response = await request(app)
        .post('/api/convert/base64-to-binary')
        .send({
          base64Data: validBase64,
          forward: {
            url: 'https://example.com/upload',
          },
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    });

    it('should handle invalid base64 data gracefully', async () => {
      const response = await request(app)
        .post('/api/convert/base64-to-binary')
        .send({
          base64Data: 'invalid-base64!!!',
        });

      // Buffer.from handles invalid base64 by ignoring invalid characters
      // So this should still return 200, but with decoded data
      expect(response.status).toBe(200);
    });
  });
});

