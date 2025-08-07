import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import expressPino from 'express-pino-logger';

import { config } from './config.js';
import { logger } from './utils/logger.js';
import { handleConnection } from './ws/handlers.js';
import { courtRegistry } from './ws/registry.js';
import controlRoutes from './routes/control.js';

const app = express();
const server = createServer(app);

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:']
      }
    }
  })
);

// CORS configuration
app.use(
  cors({
    origin: config.nodeEnv === 'production' ? ['https://your-app-domain.com'] : true, // Allow all origins in development
    credentials: true,
    optionsSuccessStatus: 200
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    type: 'https://httpstatuses.com/429',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/v1/', limiter);

// Request parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Structured logging with request IDs
app.use(
  expressPino({
    logger,
    genReqId: req =>
      req.get('X-Request-ID') || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  })
);

// Health check endpoint
app.get('/health', (req, res) => {
  const courtCount = courtRegistry.getAllCourts().length;

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    courts: {
      connected: courtCount,
      total: courtCount
    },
    memory: process.memoryUsage(),
    requestId: req.id
  });
});

// API routes
app.use('/v1/courts', controlRoutes);

// Events endpoint (separate from courts)
app.get('/v1/events', (req, res) => {
  const requestId = req.id;

  logger.info({ requestId }, 'SSE client connected');

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Send initial connection confirmation
  res.write(
    `data: ${JSON.stringify({
      type: 'connection',
      message: 'Connected to feed starter service events',
      timestamp: new Date().toISOString(),
      requestId
    })}\n\n`
  );

  // Set up event listeners
  const onCourtStatus = data => {
    res.write(`event: court-status\n`);
    res.write(
      `data: ${JSON.stringify({
        ...data,
        timestamp: new Date().toISOString()
      })}\n\n`
    );
  };

  const onCourtHeartbeat = data => {
    res.write(`event: court-heartbeat\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Register event listeners
  courtRegistry.on('court-status', onCourtStatus);
  courtRegistry.on('court-heartbeat', onCourtHeartbeat);

  // Handle client disconnect
  req.on('close', () => {
    logger.info({ requestId }, 'SSE client disconnected');
    courtRegistry.removeListener('court-status', onCourtStatus);
    courtRegistry.removeListener('court-heartbeat', onCourtHeartbeat);
  });

  // Send periodic keepalive
  const keepAliveTimer = setInterval(() => {
    res.write(`event: keepalive\n`);
    res.write(
      `data: ${JSON.stringify({
        timestamp: new Date().toISOString()
      })}\n\n`
    );
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAliveTimer);
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    type: 'https://httpstatuses.com/404',
    title: 'Not Found',
    status: 404,
    detail: `The requested resource ${req.originalUrl} was not found`,
    instance: req.originalUrl,
    requestId: req.id
  });
});

// Global error handler (RFC 7807 Problem Details)
app.use((error, req, res, next) => {
  const statusCode = error.statusCode || error.status || 500;
  const requestId = req.id;

  logger.error(
    {
      error: error.message,
      stack: error.stack,
      statusCode,
      requestId,
      url: req.originalUrl,
      method: req.method
    },
    'Unhandled error'
  );

  res.status(statusCode).json({
    type: `https://httpstatuses.com/${statusCode}`,
    title: error.name || 'Internal Server Error',
    status: statusCode,
    detail: config.nodeEnv === 'production' ? 'An internal server error occurred' : error.message,
    instance: req.originalUrl,
    requestId,
    ...(config.nodeEnv !== 'production' && { stack: error.stack })
  });
});

// WebSocket server setup
const wss = new WebSocketServer({
  server,
  path: '/ws',
  perMessageDeflate: {
    zlibDeflateOptions: {
      threshold: 1024,
      concurrencyLimit: 10
    }
  }
});

wss.on('connection', handleConnection);

wss.on('error', error => {
  logger.error({ error }, 'WebSocket server error');
});

// Graceful shutdown handling
const shutdown = signal => {
  logger.info({ signal }, 'Received shutdown signal');

  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');

    // Close WebSocket server
    wss.close(() => {
      logger.info('WebSocket server closed');

      // Shutdown court registry
      courtRegistry.shutdown();

      // Exit process
      process.exit(0);
    });
  });

  // Force exit after timeout
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', error => {
  logger.fatal({ error }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled promise rejection');
  process.exit(1);
});

// Start server
server.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      nodeEnv: config.nodeEnv,
      wsPath: '/ws',
      pid: process.pid
    },
    'Feed Starter Service started'
  );

  logger.info(`🚀 Server running at http://localhost:${config.port}`);
  logger.info(`📡 WebSocket endpoint: ws://localhost:${config.port}/ws`);
  logger.info(`🔄 Events stream: http://localhost:${config.port}/v1/events`);
  logger.info(`❤️ Health check: http://localhost:${config.port}/health`);
});

export { app, server };
