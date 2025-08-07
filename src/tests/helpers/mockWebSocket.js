import { jest } from '@jest/globals';
import { WebSocket } from 'ws';

// Import court registry - we'll avoid importing here and pass it as parameter instead

// Mock WebSocket for testing
export class MockWebSocket {
  constructor(options = {}) {
    this.readyState = WebSocket.OPEN;
    this.messages = [];
    this.closed = false;
    this.terminated = false;
    this.lastPing = null;
    this.listeners = new Map();

    // Apply any options
    Object.assign(this, options);
  }

  send(data) {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.messages.push(JSON.parse(data));
  }

  ping() {
    this.lastPing = Date.now();
    // Simulate pong response
    setTimeout(() => {
      this.emit('pong');
    }, 1);
  }

  close(code, reason) {
    this.readyState = WebSocket.CLOSED;
    this.closed = true;
    this.emit('close', code, reason);
  }

  terminate() {
    this.readyState = WebSocket.CLOSED;
    this.terminated = true;
    this.emit('close', 1006, 'Connection terminated');
  }

  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  emit(event, ...args) {
    const eventListeners = this.listeners.get(event) || [];
    eventListeners.forEach(listener => listener(...args));
  }

  // Helper methods for testing
  getLastMessage() {
    return this.messages[this.messages.length - 1];
  }

  getAllMessages() {
    return [...this.messages];
  }

  clearMessages() {
    this.messages = [];
  }

  simulateMessage(message) {
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }

  simulateError(error) {
    this.emit('error', error);
  }
}

// Helper function to create a mock court (registry should be passed from test)
export function createMockCourt(registry, courtId = 'test-court', options = {}) {
  const socket = new MockWebSocket(options);
  const capabilities = options.capabilities || ['live', 'record'];
  const authToken = options.authToken || 'dev-token-1';

  try {
    registry.register(courtId, socket, capabilities, authToken);
    return { socket, courtId, capabilities, authToken };
  } catch (error) {
    throw error;
  }
}

// Helper function to wait for a specific time
export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to wait for a condition to be true
export async function waitFor(condition, timeout = 5000, interval = 10) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return true;
    }
    await wait(interval);
  }
  throw new Error(`Condition not met within ${timeout}ms`);
}
