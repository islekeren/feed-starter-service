import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { handleConnection } from '../../ws/handlers.js';
import { courtRegistry } from '../../ws/registry.js';
import { MockWebSocket } from '../helpers/mockWebSocket.js';

describe('WebSocket Handlers', () => {
  let mockSocket;
  let mockReq;

  beforeEach(() => {
    mockSocket = new MockWebSocket();
    mockReq = {
      socket: { remoteAddress: '127.0.0.1' }
    };

    // Clear registry
    courtRegistry.courts.clear();
    courtRegistry.pendingCommands.clear();
  });

  afterEach(() => {
    courtRegistry.courts.clear();
    courtRegistry.pendingCommands.clear();
  });

  describe('Connection Handling', () => {
    test('should handle new WebSocket connection', () => {
      expect(() => {
        handleConnection(mockSocket, mockReq);
      }).not.toThrow();

      // Should have event listeners attached
      expect(mockSocket.listeners.has('message')).toBe(true);
      expect(mockSocket.listeners.has('pong')).toBe(true);
      expect(mockSocket.listeners.has('close')).toBe(true);
      expect(mockSocket.listeners.has('error')).toBe(true);
    });
  });

  describe('Court Registration Messages', () => {
    test('should register court on valid registration message', () => {
      handleConnection(mockSocket, mockReq);

      const registrationMessage = {
        courtId: 'court-001',
        capabilities: ['live', 'record'],
        authToken: 'dev-token-1'
      };

      mockSocket.simulateMessage(registrationMessage);

      // Should be registered
      const court = courtRegistry.getCourt('court-001');
      expect(court).toBeDefined();
      expect(court.capabilities).toEqual(['live', 'record']);

      // Should send registration ACK
      const response = mockSocket.getLastMessage();
      expect(response.type).toBe('registration-ack');
      expect(response.courtId).toBe('court-001');
      expect(response.status).toBe('registered');
    });

    test('should reject registration with invalid auth token', () => {
      handleConnection(mockSocket, mockReq);

      const registrationMessage = {
        courtId: 'court-001',
        capabilities: ['live', 'record'],
        authToken: 'invalid-token'
      };

      mockSocket.simulateMessage(registrationMessage);

      // Should not be registered
      const court = courtRegistry.getCourt('court-001');
      expect(court).toBeUndefined();

      // Should send error response
      const response = mockSocket.getLastMessage();
      expect(response.type).toBe('registration-error');
      expect(response.error).toBe('Invalid authentication token');
      expect(mockSocket.terminated).toBe(true);
    });

    test('should handle registration with minimal data', () => {
      handleConnection(mockSocket, mockReq);

      const registrationMessage = {
        courtId: 'court-001',
        authToken: 'dev-token-1'
      };

      mockSocket.simulateMessage(registrationMessage);

      const court = courtRegistry.getCourt('court-001');
      expect(court).toBeDefined();
      expect(court.capabilities).toEqual([]); // Default empty array
    });

    test('should reject invalid registration message', () => {
      handleConnection(mockSocket, mockReq);

      const invalidMessage = {
        courtId: '', // Empty court ID
        authToken: 'dev-token-1'
      };

      mockSocket.simulateMessage(invalidMessage);

      const response = mockSocket.getLastMessage();
      expect(response.type).toBe('registration-error');
    });
  });

  describe('Command Acknowledgment Messages', () => {
    test('should handle command acknowledgment', async () => {
      handleConnection(mockSocket, mockReq);

      // First register the court
      const registrationMessage = {
        courtId: 'court-001',
        authToken: 'dev-token-1'
      };
      mockSocket.simulateMessage(registrationMessage);
      mockSocket.clearMessages();

      // Send a command to create a pending command
      const commandPromise = courtRegistry.sendCommand('court-001', {
        cmd: 'START_RECORD',
        by: 'user-123'
      });

      // Get the command that was sent
      const sentCommand = mockSocket.getLastMessage();
      expect(sentCommand.commandId).toBeDefined();

      // Simulate ACK response
      mockSocket.simulateMessage({
        commandId: sentCommand.commandId,
        success: true
      });

      const result = await commandPromise;
      expect(result.success).toBe(true);
      expect(result.commandId).toBe(sentCommand.commandId);
    });

    test('should handle command acknowledgment with error', async () => {
      handleConnection(mockSocket, mockReq);

      // Register court
      mockSocket.simulateMessage({
        courtId: 'court-001',
        authToken: 'dev-token-1'
      });
      mockSocket.clearMessages();

      // Send command
      const commandPromise = courtRegistry.sendCommand('court-001', {
        cmd: 'START_RECORD'
      });

      const sentCommand = mockSocket.getLastMessage();

      // Simulate error ACK
      mockSocket.simulateMessage({
        commandId: sentCommand.commandId,
        success: false,
        error: 'Device busy'
      });

      await expect(commandPromise).rejects.toThrow('Device busy');
    });

    test('should ignore ACK for unknown command', () => {
      handleConnection(mockSocket, mockReq);

      expect(() => {
        mockSocket.simulateMessage({
          commandId: 'unknown-command-123',
          success: true
        });
      }).not.toThrow();
    });
  });

  describe('Heartbeat Handling', () => {
    test('should update heartbeat on pong', () => {
      handleConnection(mockSocket, mockReq);

      // Register court first
      mockSocket.simulateMessage({
        courtId: 'court-001',
        authToken: 'dev-token-1'
      });

      const courtBefore = courtRegistry.getCourt('court-001');
      const heartbeatBefore = courtBefore.lastHeartbeat;

      // Simulate some time passing
      setTimeout(() => {
        mockSocket.emit('pong');

        const courtAfter = courtRegistry.getCourt('court-001');
        expect(courtAfter.lastHeartbeat).toBeGreaterThan(heartbeatBefore);
      }, 10);
    });
  });

  describe('Connection Cleanup', () => {
    test('should unregister court on connection close', () => {
      handleConnection(mockSocket, mockReq);

      // Register court
      mockSocket.simulateMessage({
        courtId: 'court-001',
        authToken: 'dev-token-1'
      });

      expect(courtRegistry.getCourt('court-001')).toBeDefined();

      // Simulate connection close
      mockSocket.close(1000, 'Normal closure');

      expect(courtRegistry.getCourt('court-001')).toBeUndefined();
    });

    test('should unregister court on connection error', () => {
      handleConnection(mockSocket, mockReq);

      // Register court
      mockSocket.simulateMessage({
        courtId: 'court-001',
        authToken: 'dev-token-1'
      });

      expect(courtRegistry.getCourt('court-001')).toBeDefined();

      // Simulate connection error
      mockSocket.simulateError(new Error('Connection lost'));

      expect(courtRegistry.getCourt('court-001')).toBeUndefined();
    });
  });

  describe('Invalid Messages', () => {
    test('should handle malformed JSON', () => {
      handleConnection(mockSocket, mockReq);

      // Simulate invalid JSON
      mockSocket.emit('message', Buffer.from('invalid json'));

      const response = mockSocket.getLastMessage();
      expect(response.error).toBe('Invalid message format');
    });

    test('should handle unknown message type', () => {
      handleConnection(mockSocket, mockReq);

      const unknownMessage = {
        type: 'unknown',
        data: 'some data'
      };

      mockSocket.simulateMessage(unknownMessage);

      const response = mockSocket.getLastMessage();
      expect(response.error).toBe('Unknown message type');
    });
  });
});
