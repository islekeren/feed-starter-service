import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { courtRegistry } from './registry.js';

// Validation schemas
const registrationSchema = z.object({
  courtId: z.string().min(1).max(50),
  capabilities: z
    .array(z.enum(['live', 'record']))
    .optional()
    .default([]),
  authToken: z.string().min(1)
});

const commandAckSchema = z.object({
  commandId: z.string(),
  success: z.boolean().optional().default(true),
  error: z.string().optional()
});

/**
 * Handle WebSocket connection from court node
 */
export function handleConnection(ws, req) {
  const clientIp = req.socket.remoteAddress;
  let courtId = null;

  logger.info({ clientIp }, 'New WebSocket connection');

  // Handle incoming messages
  ws.on('message', async data => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(ws, message, clientIp);
    } catch (error) {
      logger.error({ error, clientIp }, 'Failed to process WebSocket message');
      ws.send(
        JSON.stringify({
          error: 'Invalid message format',
          details: error.message
        })
      );
    }
  });

  // Handle pong responses (heartbeat)
  ws.on('pong', () => {
    if (courtId) {
      courtRegistry.updateHeartbeat(courtId);
      logger.debug({ courtId }, 'Received heartbeat pong');
    }
  });

  // Handle connection close
  ws.on('close', (code, reason) => {
    logger.info(
      {
        courtId,
        clientIp,
        code,
        reason: reason.toString()
      },
      'WebSocket connection closed'
    );

    if (courtId) {
      courtRegistry.unregister(courtId);
    }
  });

  // Handle connection errors
  ws.on('error', error => {
    logger.error(
      {
        courtId,
        clientIp,
        error
      },
      'WebSocket connection error'
    );

    if (courtId) {
      courtRegistry.unregister(courtId);
    }
  });

  /**
   * Process individual WebSocket message
   */
  async function handleMessage(socket, message, clientIp) {
    const messageType = detectMessageType(message);

    switch (messageType) {
      case 'registration':
        courtId = await handleRegistration(socket, message, clientIp);
        break;

      case 'command-ack':
        await handleCommandAck(message, clientIp);
        break;

      default:
        logger.warn({ message, clientIp }, 'Unknown message type');
        socket.send(
          JSON.stringify({
            error: 'Unknown message type'
          })
        );
    }
  }
}

/**
 * Detect the type of incoming message
 */
function detectMessageType(message) {
  if (message.courtId && (message.capabilities !== undefined || message.authToken)) {
    return 'registration';
  }
  if (message.commandId !== undefined) {
    return 'command-ack';
  }
  return 'unknown';
}

/**
 * Handle court node registration
 */
async function handleRegistration(socket, message, clientIp) {
  try {
    const { courtId, capabilities, authToken } = registrationSchema.parse(message);

    // Register court in registry
    courtRegistry.register(courtId, socket, capabilities, authToken);

    // Send registration acknowledgment
    socket.send(
      JSON.stringify({
        type: 'registration-ack',
        courtId,
        status: 'registered',
        capabilities,
        timestamp: new Date().toISOString()
      })
    );

    logger.info(
      {
        courtId,
        capabilities,
        clientIp
      },
      'Court registered successfully'
    );

    return courtId;
  } catch (error) {
    logger.error({ error, message, clientIp }, 'Court registration failed');

    socket.send(
      JSON.stringify({
        type: 'registration-error',
        error: error.message || 'Registration failed'
      })
    );

    // Close connection on auth failure
    if (error.message.includes('Invalid authentication token')) {
      socket.terminate();
    }

    throw error;
  }
}

/**
 * Handle command acknowledgment from court
 */
async function handleCommandAck(message, clientIp) {
  try {
    const { commandId, success, error } = commandAckSchema.parse(message);

    courtRegistry.handleCommandAck(commandId, success, error);

    logger.info(
      {
        commandId,
        success,
        error,
        clientIp
      },
      'Command acknowledgment received'
    );
  } catch (error) {
    logger.error({ error, message, clientIp }, 'Invalid command acknowledgment');
    throw error;
  }
}

/**
 * Broadcast message to all connected courts
 */
export function broadcastToAllCourts(message) {
  const courts = courtRegistry.getAllCourts();
  let sentCount = 0;

  for (const courtData of courts) {
    const court = courtRegistry.getCourt(courtData.courtId);
    if (court && court.socket.readyState === 1) {
      // WebSocket.OPEN
      try {
        court.socket.send(JSON.stringify(message));
        sentCount++;
      } catch (error) {
        logger.error(
          {
            courtId: courtData.courtId,
            error
          },
          'Failed to broadcast message to court'
        );
      }
    }
  }

  logger.info({ sentCount, totalCourts: courts.length }, 'Broadcast complete');
  return sentCount;
}

/**
 * Send message to specific court
 */
export function sendToCourtDirect(courtId, message) {
  const court = courtRegistry.getCourt(courtId);
  if (!court) {
    throw new Error(`Court ${courtId} not connected`);
  }

  if (court.socket.readyState !== 1) {
    // WebSocket.OPEN
    throw new Error(`Court ${courtId} connection not ready`);
  }

  court.socket.send(JSON.stringify(message));
  logger.info({ courtId, messageType: message.type || 'command' }, 'Message sent to court');
}
