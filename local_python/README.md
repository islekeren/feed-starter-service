# Court Client Documentation

## Overview

The Court Client is a Python script that runs on court-side computers to connect to the Feed Starter Service via WebSocket. It listens for commands from the central API and executes local tasks such as recording video/audio and live streaming.

## Features

- 🔌 **WebSocket Connection**: Maintains persistent connection to Feed Starter Service
- 🎥 **Video Recording**: Records video/audio from RTSP camera streams
- 📡 **Live Streaming**: Streams live video to platforms like YouTube
- 💓 **Heartbeat Monitoring**: Maintains connection health with periodic pings
- 🔄 **Auto-Reconnection**: Automatically reconnects on connection loss
- 📝 **Structured Logging**: Comprehensive logging for monitoring and debugging
- 🛡️ **Graceful Shutdown**: Proper cleanup of resources on exit

## Requirements

### Software Dependencies

- **Python 3.7+**: Required for asyncio and modern Python features
- **FFmpeg**: Required for video processing and streaming
- **websockets library**: Python WebSocket client library

### Hardware Requirements

- **Network Access**: Stable connection to Feed Starter Service
- **RTSP Camera**: IP camera supporting RTSP protocol
- **Storage Space**: Adequate disk space for video recordings

## Installation

### 1. Install System Dependencies

**FFmpeg Installation:**

```bash
# macOS (using Homebrew)
brew install ffmpeg

# Ubuntu/Debian
sudo apt update
sudo apt install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

### 2. Setup Court Client

```bash
# Navigate to the local_python directory
cd /path/to/feed-starter-service/local_python

# Run the setup script (recommended)
./start_client.sh

# Or manual setup:
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your configuration
```

### 3. Configuration

Edit the `.env` file with your specific settings:

```bash
# Court identification
COURT_ID=court-001
AUTH_TOKEN=dev-token-1

# Feed Starter Service connection
SERVER_HOST=your-server-host
SERVER_PORT=3000

# Camera RTSP URL
RTSP_URL=rtsp://username:password@camera-ip:554/stream-path

# Optional: YouTube streaming
YOUTUBE_STREAM_KEY=your-youtube-stream-key

# Local settings
RECORDINGS_DIR=recordings
LOG_LEVEL=INFO
```

## Usage

### Starting the Client

```bash
# Using the startup script (recommended)
./start_client.sh

# Or direct execution
source venv/bin/activate
python3 court_client.py
```

### Stopping the Client

- Press `Ctrl+C` for graceful shutdown
- The client will automatically stop all running processes
- All resources will be cleaned up properly

## API Commands

The client responds to the following WebSocket commands from the Feed Starter Service:

### START_RECORD

Starts video/audio recording from the RTSP camera.

**Command Structure:**

```json
{
  "cmd": "START_RECORD",
  "commandId": "unique-command-id",
  "by": "user-uuid",
  "source": "mobile|admin",
  "timestamp": "2025-01-01T12:00:00Z",
  "meta": {
    "quality": "1080p|720p",
    "duration": 1800,
    "format": "mp4"
  }
}
```

**Behavior:**

- Creates timestamped recording file in `recordings/` directory
- Supports configurable duration (default: 30 minutes)
- Records both video and audio streams
- Runs in background, allowing multiple concurrent recordings

### STOP_RECORD

Stops all active video recordings.

**Command Structure:**

```json
{
  "cmd": "STOP_RECORD",
  "commandId": "unique-command-id",
  "by": "user-uuid",
  "source": "mobile|admin",
  "timestamp": "2025-01-01T12:00:00Z"
}
```

**Behavior:**

- Gracefully terminates all active recording processes
- Forces termination if graceful shutdown fails
- Preserves recorded content up to the stop point

### START_STREAM

Starts live streaming to external platforms.

**Command Structure:**

```json
{
  "cmd": "START_STREAM",
  "commandId": "unique-command-id",
  "by": "user-uuid",
  "source": "mobile|admin",
  "timestamp": "2025-01-01T12:00:00Z",
  "meta": {
    "platform": "youtube",
    "stream_key": "your-stream-key",
    "quality": "1080p"
  }
}
```

**Behavior:**

- Starts real-time streaming to specified platform
- Currently supports YouTube (more platforms can be added)
- Optimized for low-latency streaming

### STOP_STREAM

Stops active live streaming.

**Command Structure:**

```json
{
  "cmd": "STOP_STREAM",
  "commandId": "unique-command-id",
  "by": "user-uuid",
  "source": "mobile|admin",
  "timestamp": "2025-01-01T12:00:00Z"
}
```

## Client Registration

When the client starts, it automatically registers with the Feed Starter Service:

```json
{
  "courtId": "court-001",
  "capabilities": ["live", "record"],
  "authToken": "dev-token-1"
}
```

The server responds with an acknowledgment:

```json
{
  "type": "registration-ack",
  "courtId": "court-001",
  "status": "registered",
  "capabilities": ["live", "record"],
  "timestamp": "2025-01-01T12:00:00Z"
}
```

## Command Acknowledgments

For each command received, the client sends an acknowledgment:

**Success:**

```json
{
  "commandId": "unique-command-id",
  "success": true
}
```

**Failure:**

```json
{
  "commandId": "unique-command-id",
  "success": false,
  "error": "Description of what went wrong"
}
```

## File Structure

```
local_python/
├── court_client.py           # Main client application
├── requirements.txt          # Python dependencies
├── .env.example             # Configuration template
├── .env                     # Your actual configuration (create from example)
├── start_client.sh          # Startup script
├── recordings/              # Directory for recorded videos (auto-created)
├── venv/                    # Python virtual environment (auto-created)
└── README.md               # This documentation
```

## Logging

The client provides structured logging with the following levels:

- **INFO**: Normal operation messages
- **WARNING**: Non-critical issues
- **ERROR**: Error conditions
- **DEBUG**: Detailed debugging information

Log format:

```
2025-01-01 12:00:00,000 - court-client - INFO - WebSocket connection established
2025-01-01 12:00:01,000 - court-client - INFO - Registration acknowledged by server
2025-01-01 12:00:05,000 - court-client - INFO - Received command: START_RECORD (ID: cmd_123456)
```

## Process Management

The client manages multiple concurrent processes:

- **Recording Processes**: One per active recording
- **Streaming Process**: One active stream at a time
- **Heartbeat Task**: Continuous connection monitoring

All processes are properly tracked and cleaned up on shutdown.

## Troubleshooting

### Common Issues

**1. Connection Failed**

```
Connection attempt 1 failed: [Errno 61] Connection refused
```

- Check if Feed Starter Service is running
- Verify SERVER_HOST and SERVER_PORT in .env
- Check network connectivity

**2. Registration Failed**

```
Registration failed: Invalid authentication token
```

- Verify AUTH_TOKEN in .env matches server configuration
- Check COURT_NODES_ALLOWED in server's .env

**3. FFmpeg Not Found**

```
FileNotFoundError: [Errno 2] No such file or directory: 'ffmpeg'
```

- Install FFmpeg system-wide
- Ensure FFmpeg is in PATH

**4. RTSP Connection Issues**

```
Failed to start recording: [rtsp @ 0x...] Connection failed
```

- Verify RTSP_URL is correct
- Check camera credentials and network access
- Test RTSP URL with VLC or similar player

**5. Permission Denied**

```
PermissionError: [Errno 13] Permission denied: 'recordings'
```

- Ensure write permissions to recordings directory
- Run with appropriate user permissions

### Debug Mode

Enable debug logging by setting in .env:

```bash
LOG_LEVEL=DEBUG
```

This provides detailed information about:

- WebSocket message exchange
- Process creation and termination
- FFmpeg command execution
- Network connectivity

### Testing RTSP Connection

Test your RTSP connection independently:

```bash
# Test with FFmpeg
ffmpeg -rtsp_transport tcp -i "rtsp://user:pass@camera-ip:554/stream" -t 10 test.mp4

# Test with VLC
vlc "rtsp://user:pass@camera-ip:554/stream"
```

## Security Considerations

- **Authentication**: Use secure auth tokens
- **Network**: Consider VPN for remote cameras
- **Storage**: Secure recording storage location
- **Updates**: Keep FFmpeg and Python dependencies updated

## Performance Optimization

- **Recording Quality**: Adjust CRF values (18=high quality, 23=balanced)
- **Encoding Speed**: Use appropriate FFmpeg presets
- **Network**: Ensure sufficient bandwidth for streaming
- **Storage**: Use fast storage for recordings

## Integration with Feed Starter Service

The client is designed to work seamlessly with the Feed Starter Service:

1. **REST to WebSocket Bridge**: Commands from mobile apps are converted to WebSocket messages
2. **Real-time Events**: Client status is broadcast via Server-Sent Events
3. **Command Timeouts**: Failed commands timeout after 3 seconds
4. **Health Monitoring**: Regular heartbeat checks ensure connection health

## Future Enhancements

Potential improvements for future versions:

- **Multiple Camera Support**: Handle multiple RTSP streams
- **Stream Quality Selection**: Dynamic quality adjustment
- **Recording Scheduling**: Automated recording schedules
- **Motion Detection**: Start recording on motion events
- **Cloud Storage**: Upload recordings to cloud storage
- **MQTT Support**: Alternative communication protocol
- **Web Interface**: Local web UI for manual control

## Support

For issues and questions:

1. Check the logs for error messages
2. Verify configuration in .env file
3. Test RTSP connection independently
4. Check Feed Starter Service status
5. Review this documentation

## License

This software is part of the Feed Starter Service project and follows the same MIT license terms.
