import EventEmitter from 'events';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

/**
 * In-memory registry for court WebSocket connections
 * Manages court node connections, heartbeats, and status tracking
 */
class CourtRegistry extends EventEmitter {
  constructor() {
    super();
    this.courts = new Map(); // courtId -> { socket, status, lastHeartbeat, capabilities }
    this.pendingCommands = new Map(); // commandId -> { resolve, reject, timer }
    this.heartbeatInterval = null;

    this._setupHeartbeat();
  }

  /**
   * Register a new court connection
   */
  register(courtId, socket, capabilities = [], authToken = null) {
    if (!config.courtNodesAllowed.includes(authToken)) {
      throw new Error('Invalid authentication token');
    }

    // Close existing connection if any
    if (this.courts.has(courtId)) {
      const existing = this.courts.get(courtId);
      existing.socket.terminate();
      logger.warn({ courtId }, 'Replaced existing court connection');
    }

    const courtEntry = {
      socket,
      status: 'connected',
      capabilities,
      authToken,
      lastHeartbeat: Date.now(),
      connectedAt: Date.now()
    };

    this.courts.set(courtId, courtEntry);
    this.emit('court-status', { courtId, status: 'connected', capabilities });

    logger.info(
      {
        courtId,
        capabilities,
        totalCourts: this.courts.size
      },
      'Court registered'
    );

    return courtEntry;
  }

  /**
   * Unregister a court connection
   */
  unregister(courtId) {
    const court = this.courts.get(courtId);
    if (!court) return false;

    this.courts.delete(courtId);
    this.emit('court-status', { courtId, status: 'disconnected' });

    logger.info(
      {
        courtId,
        totalCourts: this.courts.size
      },
      'Court unregistered'
    );

    return true;
  }

  /**
   * Get court connection by ID
   */
  getCourt(courtId) {
    return this.courts.get(courtId);
  }

  /**
   * Get all registered courts
   */
  getAllCourts() {
    return Array.from(this.courts.entries()).map(([courtId, data]) => ({
      courtId,
      status: data.status,
      capabilities: data.capabilities,
      lastHeartbeat: data.lastHeartbeat,
      connectedAt: data.connectedAt
    }));
  }

  /**
   * Send command to court and wait for acknowledgment
   */
  async sendCommand(courtId, command, timeoutMs = config.controlAckTimeout) {
    const court = this.getCourt(courtId);
    if (!court) {
      throw new Error('Court not connected');
    }

    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const commandWithId = { ...command, commandId };

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timer = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(new Error('Command acknowledgment timeout'));
      }, timeoutMs);

      // Store pending command
      this.pendingCommands.set(commandId, { resolve, reject, timer });

      // Send command
      try {
        court.socket.send(JSON.stringify(commandWithId));
        logger.info({ courtId, command: command.cmd, commandId }, 'Command sent to court');
      } catch (error) {
        this.pendingCommands.delete(commandId);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Handle command acknowledgment from court
   */
  handleCommandAck(commandId, success = true, error = null) {
    const pending = this.pendingCommands.get(commandId);
    if (!pending) {
      logger.warn({ commandId }, 'Received ACK for unknown command');
      return;
    }

    this.pendingCommands.delete(commandId);
    clearTimeout(pending.timer);

    if (success) {
      pending.resolve({ success, commandId });
    } else {
      pending.reject(new Error(error || 'Command failed'));
    }
  }

  /**
   * Update court heartbeat timestamp
   */
  updateHeartbeat(courtId) {
    const court = this.getCourt(courtId);
    if (court) {
      court.lastHeartbeat = Date.now();
      court.status = 'connected';
    }
  }

  /**
   * Setup periodic heartbeat checking
   */
  _setupHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const deadlineMs = config.ws.heartbeatTimeout;

      for (const [courtId, court] of this.courts.entries()) {
        const timeSinceLastHeartbeat = now - court.lastHeartbeat;

        if (timeSinceLastHeartbeat > deadlineMs) {
          logger.warn(
            {
              courtId,
              timeSinceLastHeartbeat
            },
            'Court heartbeat timeout - terminating connection'
          );

          court.socket.terminate();
          this.unregister(courtId);
        } else {
          // Send ping to court
          try {
            court.socket.ping();
          } catch (error) {
            logger.error({ courtId, error }, 'Failed to ping court');
            this.unregister(courtId);
          }
        }
      }

      // Emit heartbeat status for all courts
      this.emit('court-heartbeat', {
        timestamp: now,
        courts: this.getAllCourts()
      });
    }, config.ws.heartbeatInterval);
  }

  /**
   * Graceful shutdown - close all connections
   */
  shutdown() {
    logger.info('Shutting down court registry');

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all pending commands with error
    for (const [commandId, pending] of this.pendingCommands.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Service shutting down'));
    }
    this.pendingCommands.clear();

    // Close all court connections
    for (const [courtId, court] of this.courts.entries()) {
      court.socket.terminate();
    }
    this.courts.clear();
  }
}

// Singleton instance
export const courtRegistry = new CourtRegistry();
