# Development Guide

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development server
npm run dev

# Run demo
npm run demo

# Run tests
npm test
```

## 🛠️ Development Workflow

### Development Server

```bash
npm run dev          # Start with nodemon (auto-reload)
npm start           # Start production server
```

### Code Quality

```bash
npm run lint        # Check code style
npm run lint:fix    # Fix auto-fixable issues
npm run format      # Format code with Prettier
```

### Testing

```bash
npm test            # Run all tests
npm run test:watch  # Run tests in watch mode
```

## 📡 API Testing

### WebSocket Connection Test

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

// Register court
ws.send(
  JSON.stringify({
    courtId: 'test-court-001',
    capabilities: ['live', 'record'],
    authToken: 'dev-token-1'
  })
);
```

### REST API Test

```bash
# Health check
curl http://localhost:3000/health

# List courts
curl http://localhost:3000/v1/courts

# Send control command
curl -X POST http://localhost:3000/v1/courts/test-court-001/control \
  -H "Content-Type: application/json" \
  -d '{
    "action": "start",
    "userId": "12345678-1234-1234-1234-123456789012",
    "source": "mobile",
    "meta": {"quality": "1080p"}
  }'

# Server-sent events
curl -H "Accept: text/event-stream" http://localhost:3000/v1/events
```

## 🔧 Configuration

Environment variables in `.env`:

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode
- `COURT_NODES_ALLOWED` - Comma-separated auth tokens
- `WS_HEARTBEAT_INTERVAL` - Heartbeat interval in ms
- `WS_HEARTBEAT_TIMEOUT` - Heartbeat timeout in ms
- `CONTROL_ACK_TIMEOUT` - Command ACK timeout in ms
- `LOG_LEVEL` - Logging level (debug, info, warn, error)

## 🧪 Testing Strategy

### Unit Tests

- `src/tests/unit/registry.test.js` - Court registry functionality
- `src/tests/unit/handlers.test.js` - WebSocket message handling

### Integration Tests

- `src/tests/integration/api.test.js` - End-to-end API testing

### Test Helpers

- `src/tests/helpers/mockWebSocket.js` - Mock WebSocket implementation

## 🏗️ Architecture Overview

```
┌─────────────────┐    REST     ┌─────────────────┐    WebSocket    ┌─────────────────┐
│  Mobile App     │────────────▶│  Feed Starter   │◀──────────────▶│  Court Edge PC  │
│  Backend        │             │  Service        │                 │                 │
└─────────────────┘             └─────────────────┘                 └─────────────────┘
                                        │
                                        │ SSE
                                        ▼
                                ┌─────────────────┐
                                │ Admin Dashboard │
                                │                 │
                                └─────────────────┘
```

## 📝 Code Style

- ES Modules only
- Async/await preferred over promises
- Functions ≤ 50 lines
- JSDoc comments for public APIs
- Structured logging with request IDs
- Error handling with RFC 7807 format

## 🔒 Security Features

- Helmet security headers
- CORS configuration
- Rate limiting (100 req/15min per IP)
- Auth token validation for courts
- Request/response sanitization
- Graceful error handling without stack leaks

## 📈 Monitoring & Debugging

### Logging

- Structured JSON logs in production
- Pretty printed logs in development
- Request/response correlation with IDs
- Performance metrics and timing

### Debug Mode

```bash
DEBUG=ws:* npm run dev    # WebSocket debug output
```

### Health Monitoring

- Health endpoint: `GET /health`
- Memory usage and uptime metrics
- Connected courts count
- Process statistics

## 🚦 Production Deployment

1. Set `NODE_ENV=production`
2. Configure proper CORS origins
3. Set up log aggregation
4. Configure monitoring/alerting
5. Set up load balancing if needed
6. Use process manager (PM2, systemd)

### Docker Support (Future)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/ ./src/
EXPOSE 3000
CMD ["node", "src/app.js"]
```

## 🔄 CI/CD Pipeline (Future)

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run demo
```
