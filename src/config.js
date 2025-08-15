import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Court node authentication
  courtNodesAllowed: (process.env.COURT_NODES_ALLOWED || 'dev-token-1,dev-token-2')
    .split(',')
    .map(token => token.trim()),

  // WebSocket configuration
  ws: {
    heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 15000,
    heartbeatTimeout: parseInt(process.env.WS_HEARTBEAT_TIMEOUT) || 5000
  },

  // Control command configuration
  controlAckTimeout: parseInt(process.env.CONTROL_ACK_TIMEOUT) || 20000,

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info'
};
