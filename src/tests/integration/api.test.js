import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { WebSocket } from 'ws';
import { app, server } from '../../app.js';
import { courtRegistry } from '../../ws/registry.js';
import { config } from '../../config.js';

describe('Integration Tests - REST to WebSocket Bridge', () => {
  let wsServer;
  let courtWs;
  const courtId = 'test-court-integration';
  const baseUrl = `http://localhost:${config.port}`;

  beforeAll(async () => {
    // Wait for server to be ready
    await new Promise(resolve => {
      if (server.listening) {
        resolve();
      } else {
        server.on('listening', resolve);
      }
    });
  });

  afterAll(async () => {
    if (courtWs && courtWs.readyState === WebSocket.OPEN) {
      courtWs.close();
    }

    // Clean shutdown is handled by the app itself
  });

  beforeEach(() => {
    // Clear registry before each test
    courtRegistry.courts.clear();
    courtRegistry.pendingCommands.clear();
  });

  afterEach(() => {
    if (courtWs && courtWs.readyState === WebSocket.OPEN) {
      courtWs.close();
    }
    courtRegistry.courts.clear();
    courtRegistry.pendingCommands.clear();
  });

  describe('REST API Endpoints', () => {
    test('GET /health should return service health', async () => {
      const response = await request(app).get('/health').expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.version).toBeDefined();
      expect(response.body.uptime).toBeGreaterThanOrEqual(0);
      expect(response.body.requestId).toBeDefined();
    });

    test('GET /v1/courts should return empty list initially', async () => {
      const response = await request(app).get('/v1/courts').expect(200);

      expect(response.body.courts).toEqual([]);
      expect(response.body.totalCount).toBe(0);
      expect(response.body.requestId).toBeDefined();
    });

    test('POST /v1/courts/:courtId/control should return 404 for non-existent court', async () => {
      const response = await request(app)
        .post('/v1/courts/non-existent/control')
        .send({
          action: 'start',
          userId: '12345678-1234-1234-1234-123456789012',
          source: 'mobile'
        })
        .expect(404);

      expect(response.body.title).toBe('Court Not Found');
      expect(response.body.detail).toContain('Court non-existent is not connected');
    });

    test('POST /v1/courts/:courtId/control should validate request body', async () => {
      const response = await request(app)
        .post('/v1/courts/test-court/control')
        .send({
          action: 'invalid-action',
          userId: 'invalid-uuid'
        })
        .expect(422);

      expect(response.body.title).toBe('Unprocessable Entity');
      expect(response.body.errors).toBeDefined();
      expect(response.body.errors.length).toBeGreaterThan(0);
    });
  });

  describe('WebSocket to REST Integration', () => {
    test('Complete flow: court connects, REST command, WebSocket response', async () => {
      // Step 1: Connect court via WebSocket
      courtWs = new WebSocket(`ws://localhost:${config.port}/ws`);

      await new Promise((resolve, reject) => {
        courtWs.on('open', resolve);
        courtWs.on('error', reject);
        setTimeout(reject, 5000); // 5s timeout
      });

      // Step 2: Register court
      courtWs.send(
        JSON.stringify({
          courtId: courtId,
          capabilities: ['live', 'record'],
          authToken: 'dev-token-1'
        })
      );

      // Wait for registration ACK
      const registrationResponse = await new Promise((resolve, reject) => {
        courtWs.on('message', data => {
          const message = JSON.parse(data.toString());
          if (message.type === 'registration-ack') {
            resolve(message);
          }
        });
        setTimeout(() => reject(new Error('Registration timeout')), 5000);
      });

      expect(registrationResponse.status).toBe('registered');
      expect(registrationResponse.courtId).toBe(courtId);

      // Step 3: Verify court is listed in REST API
      const courtsResponse = await request(app).get('/v1/courts').expect(200);

      expect(courtsResponse.body.totalCount).toBe(1);
      expect(courtsResponse.body.courts[0].courtId).toBe(courtId);

      // Step 4: Send control command via REST API
      const controlPromise = request(app)
        .post(`/v1/courts/${courtId}/control`)
        .send({
          action: 'start',
          userId: '12345678-1234-1234-1234-123456789012',
          source: 'mobile',
          meta: {
            quality: '1080p',
            duration: 3600
          }
        });

      // Step 5: Listen for WebSocket command and send ACK
      const commandResponse = await new Promise((resolve, reject) => {
        courtWs.on('message', data => {
          const message = JSON.parse(data.toString());
          if (message.cmd === 'START_RECORD') {
            // Send acknowledgment
            courtWs.send(
              JSON.stringify({
                commandId: message.commandId,
                success: true
              })
            );
            resolve(message);
          }
        });
        setTimeout(() => reject(new Error('Command timeout')), 5000);
      });

      expect(commandResponse.cmd).toBe('START_RECORD');
      expect(commandResponse.by).toBe('12345678-1234-1234-1234-123456789012');
      expect(commandResponse.source).toBe('mobile');
      expect(commandResponse.meta.quality).toBe('1080p');

      // Step 6: Verify REST API response
      const restResponse = await controlPromise.expect(200);

      expect(restResponse.body.success).toBe(true);
      expect(restResponse.body.courtId).toBe(courtId);
      expect(restResponse.body.action).toBe('start');
      expect(restResponse.body.commandId).toBeDefined();
    }, 15000); // Longer timeout for integration test

    test('REST command timeout when court does not acknowledge', async () => {
      // Connect and register court
      courtWs = new WebSocket(`ws://localhost:${config.port}/ws`);

      await new Promise(resolve => {
        courtWs.on('open', resolve);
      });

      courtWs.send(
        JSON.stringify({
          courtId: courtId,
          capabilities: ['live'],
          authToken: 'dev-token-1'
        })
      );

      // Wait for registration
      await new Promise(resolve => {
        courtWs.on('message', data => {
          const message = JSON.parse(data.toString());
          if (message.type === 'registration-ack') {
            resolve(message);
          }
        });
      });

      // Send control command but don't respond with ACK
      const response = await request(app)
        .post(`/v1/courts/${courtId}/control`)
        .send({
          action: 'start',
          userId: '12345678-1234-1234-1234-123456789012'
        })
        .expect(504); // Gateway Timeout

      expect(response.body.title).toBe('Gateway Timeout');
      expect(response.body.detail).toContain('Court did not acknowledge command');
    }, 10000);

    test('Server-sent events stream', async () => {
      // Start SSE connection
      const sseResponse = await request(app)
        .get('/v1/events')
        .set('Accept', 'text/event-stream')
        .expect(200)
        .expect('Content-Type', 'text/event-stream; charset=utf-8');

      // The response should be a streaming response
      expect(sseResponse.text).toBeDefined();

      // Should contain initial connection confirmation
      expect(sseResponse.text).toMatch(
        /data:.*connection.*Connected to feed starter service events/
      );
    });
  });

  describe('Error Handling', () => {
    test('Should handle invalid JSON in control request', async () => {
      const response = await request(app)
        .post('/v1/courts/test-court/control')
        .set('Content-Type', 'application/json')
        .send('invalid json')
        .expect(400);
    });

    test('Should handle missing required fields', async () => {
      const response = await request(app)
        .post('/v1/courts/test-court/control')
        .send({
          action: 'start'
          // Missing userId
        })
        .expect(422);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors.some(e => e.field.includes('userId'))).toBe(true);
    });

    test('Should return 404 for unknown endpoints', async () => {
      const response = await request(app).get('/unknown-endpoint').expect(404);

      expect(response.body.title).toBe('Not Found');
      expect(response.body.detail).toContain(
        'The requested resource /unknown-endpoint was not found'
      );
    });
  });

  describe('Security Features', () => {
    test('Should have security headers', async () => {
      const response = await request(app).get('/health').expect(200);

      // Check for common security headers added by helmet
      expect(response.headers['x-content-type-options']).toBeDefined();
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['x-xss-protection']).toBeDefined();
    });

    test('Should respect CORS configuration', async () => {
      const response = await request(app)
        .options('/v1/courts')
        .set('Origin', 'http://localhost:3000')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });
});
