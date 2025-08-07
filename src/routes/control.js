import express from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { courtRegistry } from '../ws/registry.js';

const router = express.Router();

// Validation schema for control requests
const controlRequestSchema = z.object({
  action: z.enum(['start', 'stop']),
  userId: z.string().uuid('Invalid userId format'),
  source: z.enum(['mobile', 'admin']).optional().default('mobile'),
  meta: z
    .object({
      quality: z.string().optional(),
      duration: z.number().positive().optional(),
      format: z.string().optional(),
      bitrate: z.string().optional()
    })
    .optional()
    .default({})
});

/**
 * POST /v1/courts/:courtId/control
 * Bridge REST API to WebSocket commands
 */
router.post('/:courtId/control', async (req, res) => {
  const { courtId } = req.params;
  const requestId = req.id; // From express-pino-logger

  try {
    // Validate request body
    const { action, userId, source, meta } = controlRequestSchema.parse(req.body);

    logger.info(
      {
        courtId,
        action,
        userId,
        source,
        requestId
      },
      'Control request received'
    );

    // Check if court is connected
    const court = courtRegistry.getCourt(courtId);
    if (!court) {
      return res.status(404).json({
        type: 'https://httpstatuses.com/404',
        title: 'Court Not Found',
        status: 404,
        detail: `Court ${courtId} is not connected`,
        instance: req.originalUrl,
        requestId
      });
    }

    // Map REST action to WebSocket command
    const wsCommand = mapActionToCommand(action, userId, source, meta);

    // Send command to court and wait for ACK
    try {
      const result = await courtRegistry.sendCommand(courtId, wsCommand);

      logger.info(
        {
          courtId,
          action,
          userId,
          commandId: result.commandId,
          requestId
        },
        'Control command acknowledged by court'
      );

      res.status(200).json({
        success: true,
        courtId,
        action,
        commandId: result.commandId,
        timestamp: new Date().toISOString(),
        requestId
      });
    } catch (commandError) {
      logger.error(
        {
          courtId,
          action,
          userId,
          error: commandError.message,
          requestId
        },
        'Control command failed or timed out'
      );

      if (commandError.message.includes('timeout')) {
        return res.status(504).json({
          type: 'https://httpstatuses.com/504',
          title: 'Gateway Timeout',
          status: 504,
          detail: 'Court did not acknowledge command within timeout period',
          instance: req.originalUrl,
          requestId
        });
      }

      return res.status(502).json({
        type: 'https://httpstatuses.com/502',
        title: 'Bad Gateway',
        status: 502,
        detail: commandError.message,
        instance: req.originalUrl,
        requestId
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(
        {
          courtId,
          validationErrors: error.errors,
          requestId
        },
        'Invalid control request'
      );

      return res.status(422).json({
        type: 'https://httpstatuses.com/422',
        title: 'Unprocessable Entity',
        status: 422,
        detail: 'Request validation failed',
        errors: error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message
        })),
        instance: req.originalUrl,
        requestId
      });
    }

    logger.error(
      {
        courtId,
        error,
        requestId
      },
      'Unexpected error processing control request'
    );

    res.status(500).json({
      type: 'https://httpstatuses.com/500',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred',
      instance: req.originalUrl,
      requestId
    });
  }
});

/**
 * GET /v1/courts
 * Get list of all connected courts
 */
router.get('/', (req, res) => {
  const courts = courtRegistry.getAllCourts();
  const requestId = req.id;

  logger.info(
    {
      courtCount: courts.length,
      requestId
    },
    'Courts list requested'
  );

  res.json({
    courts,
    totalCount: courts.length,
    timestamp: new Date().toISOString(),
    requestId
  });
});

/**
 * GET /v1/courts/:courtId
 * Get specific court information
 */
router.get('/:courtId', (req, res) => {
  const { courtId } = req.params;
  const requestId = req.id;

  const court = courtRegistry.getCourt(courtId);
  if (!court) {
    return res.status(404).json({
      type: 'https://httpstatuses.com/404',
      title: 'Court Not Found',
      status: 404,
      detail: `Court ${courtId} is not connected`,
      instance: req.originalUrl,
      requestId
    });
  }

  res.json({
    courtId,
    status: court.status,
    capabilities: court.capabilities,
    lastHeartbeat: court.lastHeartbeat,
    connectedAt: court.connectedAt,
    timestamp: new Date().toISOString(),
    requestId
  });
});

/**
 * Map REST action to WebSocket command
 */
function mapActionToCommand(action, userId, source, meta) {
  const baseCommand = {
    by: userId,
    source,
    timestamp: new Date().toISOString(),
    meta
  };

  switch (action) {
    case 'start':
      return {
        ...baseCommand,
        cmd: 'START_RECORD'
      };
    case 'stop':
      return {
        ...baseCommand,
        cmd: 'STOP_RECORD'
      };
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

export default router;
