import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { courtRegistry } from '../../ws/registry.js';
import { MockWebSocket, createMockCourt, wait } from '../helpers/mockWebSocket.js';

describe('CourtRegistry', () => {
  beforeEach(() => {
    // Clear registry before each test
    courtRegistry.courts.clear();
    courtRegistry.pendingCommands.clear();
  });

  afterEach(() => {
    // Cleanup after each test
    courtRegistry.courts.clear();
    courtRegistry.pendingCommands.clear();
  });

  describe('Court Registration', () => {
    test('should register a new court successfully', () => {
      const { socket, courtId, capabilities } = createMockCourt(courtRegistry, 'court-001');

      const court = courtRegistry.getCourt(courtId);
      expect(court).toBeDefined();
      expect(court.socket).toBe(socket);
      expect(court.capabilities).toEqual(capabilities);
      expect(court.status).toBe('connected');
    });

    test('should reject registration with invalid auth token', () => {
      const socket = new MockWebSocket();

      expect(() => {
        courtRegistry.register('court-001', socket, ['live'], 'invalid-token');
      }).toThrow('Invalid authentication token');
    });

    test('should replace existing court connection', () => {
      const court1 = createMockCourt(courtRegistry, 'court-001');
      const court2 = createMockCourt(courtRegistry, 'court-001'); // Same court ID

      expect(court1.socket.terminated).toBe(true);

      const currentCourt = courtRegistry.getCourt('court-001');
      expect(currentCourt.socket).toBe(court2.socket);
    });

    test('should unregister court successfully', () => {
      const { courtId } = createMockCourt(courtRegistry, 'court-001');

      const result = courtRegistry.unregister(courtId);
      expect(result).toBe(true);
      expect(courtRegistry.getCourt(courtId)).toBeUndefined();
    });

    test('should return false when unregistering non-existent court', () => {
      const result = courtRegistry.unregister('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('Command Handling', () => {
    test('should send command and receive acknowledgment', async () => {
      const { socket, courtId } = createMockCourt(courtRegistry, 'court-001');

      const command = { cmd: 'START_RECORD', by: 'user-123' };

      // Simulate ACK response
      setTimeout(() => {
        const lastMessage = socket.getLastMessage();
        socket.simulateMessage({
          commandId: lastMessage.commandId,
          success: true
        });
      }, 10);

      const result = await courtRegistry.sendCommand(courtId, command);
      expect(result.success).toBe(true);
      expect(result.commandId).toBeDefined();

      const sentCommand = socket.getLastMessage();
      expect(sentCommand.cmd).toBe('START_RECORD');
      expect(sentCommand.by).toBe('user-123');
      expect(sentCommand.commandId).toBeDefined();
    });

    test('should timeout when court does not acknowledge', async () => {
      const { courtId } = createMockCourt(courtRegistry, 'court-001');

      const command = { cmd: 'START_RECORD', by: 'user-123' };

      await expect(
        courtRegistry.sendCommand(courtId, command, 100) // 100ms timeout
      ).rejects.toThrow('Command acknowledgment timeout');
    }, 1000);

    test('should reject command for non-existent court', async () => {
      const command = { cmd: 'START_RECORD', by: 'user-123' };

      await expect(courtRegistry.sendCommand('non-existent', command)).rejects.toThrow(
        'Court not connected'
      );
    });

    test('should handle command acknowledgment with error', async () => {
      const { socket, courtId } = createMockCourt(courtRegistry, 'court-001');

      const command = { cmd: 'START_RECORD', by: 'user-123' };

      // Simulate error ACK response
      setTimeout(() => {
        const lastMessage = socket.getLastMessage();
        socket.simulateMessage({
          commandId: lastMessage.commandId,
          success: false,
          error: 'Recording already in progress'
        });
      }, 10);

      await expect(courtRegistry.sendCommand(courtId, command)).rejects.toThrow(
        'Recording already in progress'
      );
    });
  });

  describe('Heartbeat Management', () => {
    test('should update heartbeat timestamp', () => {
      const { courtId } = createMockCourt(courtRegistry, 'court-001');

      const before = Date.now();
      courtRegistry.updateHeartbeat(courtId);
      const after = Date.now();

      const court = courtRegistry.getCourt(courtId);
      expect(court.lastHeartbeat).toBeGreaterThanOrEqual(before);
      expect(court.lastHeartbeat).toBeLessThanOrEqual(after);
    });

    test('should not crash when updating non-existent court heartbeat', () => {
      expect(() => {
        courtRegistry.updateHeartbeat('non-existent');
      }).not.toThrow();
    });
  });

  describe('Court Information', () => {
    test('should return all connected courts', () => {
      createMockCourt(courtRegistry, 'court-001', { capabilities: ['live'] });
      createMockCourt(courtRegistry, 'court-002', { capabilities: ['record'] });
      createMockCourt(courtRegistry, 'court-003', { capabilities: ['live', 'record'] });

      const courts = courtRegistry.getAllCourts();
      expect(courts).toHaveLength(3);
      expect(courts.map(c => c.courtId)).toEqual(['court-001', 'court-002', 'court-003']);
      expect(courts[0].capabilities).toEqual(['live']);
      expect(courts[1].capabilities).toEqual(['record']);
      expect(courts[2].capabilities).toEqual(['live', 'record']);
    });

    test('should return empty array when no courts connected', () => {
      const courts = courtRegistry.getAllCourts();
      expect(courts).toHaveLength(0);
    });
  });

  describe('Event Emission', () => {
    test('should emit court-status event on registration', done => {
      courtRegistry.once('court-status', data => {
        expect(data.courtId).toBe('court-001');
        expect(data.status).toBe('connected');
        expect(data.capabilities).toEqual(['live', 'record']);
        done();
      });

      createMockCourt(courtRegistry, 'court-001');
    });

    test('should emit court-status event on unregistration', done => {
      const { courtId } = createMockCourt(courtRegistry, 'court-001');

      courtRegistry.once('court-status', data => {
        expect(data.courtId).toBe('court-001');
        expect(data.status).toBe('disconnected');
        done();
      });

      courtRegistry.unregister(courtId);
    });
  });
});
