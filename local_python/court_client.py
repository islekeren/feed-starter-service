#!/usr/bin/env python3
"""
Court-side Client for Feed Starter Service

This script runs on court-side computers to connect to the central API
via WebSocket, listen for commands, and execute local tasks like recording
and streaming.

Requirements:
- Python 3.7+
- websockets library: pip install websockets
- ffmpeg installed and accessible in PATH

Author: Feed Starter Service
"""

import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
import time
from datetime import datetime
from typing import Dict, Optional, Set
import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException


class CourtClient:
    """Court-side client that connects to Feed Starter Service via WebSocket"""
    
    def __init__(self, config: Dict):
        self.config = config
        self.ws = None
        self.running = False
        self.current_processes: Dict[str, subprocess.Popen] = {}
        self.logger = self._setup_logging()
        
        # Register signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        
    def _setup_logging(self) -> logging.Logger:
        """Setup structured logging with UTC timestamps to match server"""
        # Set up websockets debug logging
        websockets_logger = logging.getLogger('websockets')
        websockets_logger.setLevel(logging.DEBUG)
        
        # Enable all websockets logging including frame-level details
        websockets_client_logger = logging.getLogger('websockets.client')
        websockets_client_logger.setLevel(logging.DEBUG)

        websockets_protocol_logger = logging.getLogger('websockets.protocol')
        websockets_protocol_logger.setLevel(logging.DEBUG)
        
        # Configure logging to use UTC timestamps to match the server
        logging.basicConfig(
            level=getattr(logging, self.config.get('log_level', 'INFO').upper()),
            format='%(asctime)s UTC - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        
        # Set all loggers to use UTC time
        logging.Formatter.converter = time.gmtime
        
        return logging.getLogger('court-client')
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals gracefully"""
        self.logger.info(f"Received signal {signum}, shutting down...")
        self.running = False
        
    async def connect(self):
        """Connect to the Feed Starter Service WebSocket"""
        uri = f"wss://{self.config['server_host']}:{self.config['server_port']}/ws"
        max_retries = self.config.get('max_retries', 5)
        retry_delay = self.config.get('retry_delay', 5)
        
        for attempt in range(max_retries):
            try:
                self.logger.info(f"Connecting to {uri} (attempt {attempt + 1}/{max_retries})")
                
                # Connect with settings that work well with Node.js ws library
                # Disable client-side ping - let server handle ping/pong entirely
                self.ws = await websockets.connect(
                    uri,
                    ping_interval=None,     # Disable client ping - server will ping us
                    ping_timeout=None,      # Disable client ping timeout
                    close_timeout=10,
                    # Additional options to improve compatibility
                    compression=None        # Disable compression for simpler protocol
                )
                
                self.logger.info("WebSocket connection established")
                self.logger.debug("Server-side ping/pong handling enabled (client ping disabled)")
                return True
                
            except Exception as e:
                self.logger.error(f"Connection attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    self.logger.info(f"Retrying in {retry_delay} seconds...")
                    await asyncio.sleep(retry_delay)
                else:
                    self.logger.error("Max retries exceeded, giving up")
                    return False
    
    async def register(self):
        """Register this court with the central service"""
        registration_message = {
            "courtId": self.config['court_id'],
            "capabilities": self.config.get('capabilities', ['live', 'record']),
            "authToken": self.config['auth_token']
        }
        
        await self.ws.send(json.dumps(registration_message))
        self.logger.info(f"Registration sent for court {self.config['court_id']}")
        
        # Wait for registration acknowledgment
        try:
            response = await asyncio.wait_for(self.ws.recv(), timeout=10)
            response_data = json.loads(response)
            
            if response_data.get('type') == 'registration-ack':
                self.logger.info("Registration acknowledged by server")
                return True
            elif response_data.get('type') == 'registration-error':
                self.logger.error(f"Registration failed: {response_data.get('error')}")
                return False
                
        except asyncio.TimeoutError:
            self.logger.error("Registration timeout")
            return False
        except json.JSONDecodeError as e:
            self.logger.error(f"Invalid registration response: {e}")
            return False
    
    async def handle_message(self, message: str):
        """Handle incoming WebSocket messages"""
        try:
            data = json.loads(message)
            command_id = data.get('commandId')
            command = data.get('cmd')
            
            # Add more detailed logging to see what's being received
            self.logger.info(f"Received command: {command} (ID: {command_id})")
            self.logger.debug(f"Full message data: {data}")
            
            success = False  # Default to False
            
            if command == 'START_RECORD':
                success = await self._handle_start_record(data)
            elif command == 'STOP_RECORD':
                success = await self._handle_stop_record(data)
            elif command == 'START_STREAM':
                success = await self._handle_start_stream(data)
            elif command == 'STOP_STREAM':
                success = await self._handle_stop_stream(data)
            elif command == 'TEST_RECORD':
                success = await self._handle_test_record(data)
            elif command == 'TEST_STREAM':
                success = await self._handle_test_stream(data)
            else:
                self.logger.warning(f"Unknown command: {command}")
                success = False
            
            # Send acknowledgment
            if command_id:
                ack_message = {
                    "commandId": command_id,
                    "success": success
                }
                if not success:
                    ack_message["error"] = f"Failed to execute command: {command}"
                
                await self.ws.send(json.dumps(ack_message))
                self.logger.info(f"Sent ACK for command {command_id}: {'success' if success else 'failed'}")
                
        except json.JSONDecodeError as e:
            self.logger.error(f"Invalid message format: {e}")
        except Exception as e:
            self.logger.error(f"Error handling message: {e}")
    
    async def _handle_start_record(self, data: Dict) -> bool:
        """Start recording video/audio"""
        try:
            self.logger.info("=== START_RECORD handler called ===")
            
            meta = data.get('meta', {})
            duration = meta.get('duration', 1800)  # Default 30 minutes
            quality = meta.get('quality', '1080p')
            
            self.logger.info(f"Recording parameters - duration: {duration}s, quality: {quality}")
            
            # Create recordings directory
            recordings_dir = self.config.get('recordings_dir', 'recordings')
            os.makedirs(recordings_dir, exist_ok=True)
            self.logger.info(f"Recordings directory: {recordings_dir}")
            
            # Generate timestamped filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            user_id = data.get('by', 'unknown')
            output_file = os.path.join(recordings_dir, f"record_{timestamp}_{user_id}.mp4")
            
            self.logger.info(f"Output file: {output_file}")
            self.logger.info(f"RTSP URL: {self.config['rtsp_url']}")
            
            # Convert duration from seconds to HH:MM:SS format
            hours = duration // 3600
            minutes = (duration % 3600) // 60
            seconds = duration % 60
            duration_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
            
            # Build ffmpeg command
            ffmpeg_cmd = [
                "ffmpeg",
                "-rtsp_transport", "tcp",
                "-i", self.config['rtsp_url'],
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-crf", "18" if quality == "1080p" else "23",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "128k",
                "-ar", "44100",
                "-ac", "1",
                "-t", duration_str,
                "-y",  # Overwrite output file
                output_file
            ]
            
            self.logger.info(f"FFmpeg command: {' '.join(ffmpeg_cmd)}")
            
            # Check if ffmpeg is available
            try:
                subprocess.run(["ffmpeg", "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                self.logger.info("FFmpeg is available")
            except Exception as e:
                self.logger.error(f"FFmpeg not available: {e}")
                return False
            
            # Test RTSP connection before starting recording
            self.logger.info("Testing RTSP connection...")
            test_result = await self._test_rtsp_connection()
            if not test_result:
                self.logger.error("RTSP connection test failed, aborting recording")
                return False
            
            self.logger.info(f"Starting recording process...")
            
            # Add timeout and better error handling for RTSP connection
            process = subprocess.Popen(
                ffmpeg_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True,
                bufsize=1
            )
            
            # Store process for potential stopping
            process_key = f"record_{timestamp}"
            self.current_processes[process_key] = process
            
            # Give FFmpeg a moment to start and check for immediate errors
            await asyncio.sleep(2)
            
            # Check if process is still running
            if process.poll() is None:
                self.logger.info(f"Recording started successfully with PID {process.pid}")
                
                # Start a background task to monitor the process and log errors
                asyncio.create_task(self._monitor_ffmpeg_process(process, process_key))
                
                return True
            else:
                # Process already terminated - capture error output
                stdout, stderr = process.communicate()
                self.logger.error(f"Recording process failed immediately:")
                self.logger.error(f"Return code: {process.returncode}")
                if stdout:
                    self.logger.error(f"STDOUT: {stdout}")
                if stderr:
                    self.logger.error(f"STDERR: {stderr}")
                
                # Clean up
                if process_key in self.current_processes:
                    del self.current_processes[process_key]
                return False
            
        except Exception as e:
            self.logger.error(f"Failed to start recording: {e}")
            import traceback
            self.logger.error(f"Traceback: {traceback.format_exc()}")
            return False
    
    async def _monitor_stream_process(self, process: subprocess.Popen):
        """Monitor FFmpeg streaming process and log any errors"""
        try:
            self.logger.info("Starting stream monitoring...")
            
            # Monitor the process in a non-blocking way
            while process.poll() is None:
                # Read some stderr to check for errors
                if process.stderr and process.stderr.readable():
                    try:
                        # Use non-blocking read with a small timeout
                        import select
                        import sys
                        
                        if hasattr(select, 'select'):
                            ready, _, _ = select.select([process.stderr], [], [], 1)
                            if ready:
                                line = process.stderr.readline()
                                if line:
                                    line = line.strip()
                                    # Log important FFmpeg messages
                                    if any(keyword in line.lower() for keyword in ['error', 'failed', 'invalid', 'timeout']):
                                        self.logger.error(f"FFmpeg streaming error: {line}")
                                    elif 'connection refused' in line.lower() or 'rtmp' in line.lower():
                                        self.logger.warning(f"FFmpeg streaming info: {line}")
                                    elif 'input/output error' in line.lower():
                                        self.logger.error(f"FFmpeg streaming I/O error: {line}")
                                        break
                                    elif 'frame=' in line.lower() and len(line) > 50:
                                        # This is FFmpeg progress output, log occasionally
                                        if 'fps=' in line.lower():
                                            self.logger.debug(f"Stream progress: {line}")
                    except Exception as e:
                        self.logger.debug(f"Error reading FFmpeg stderr: {e}")
                
                await asyncio.sleep(2)
            
            # Process has ended
            return_code = process.returncode
            if return_code != 0:
                # Get any remaining output
                try:
                    stdout, stderr = process.communicate(timeout=5)
                    if stderr:
                        self.logger.error(f"FFmpeg streaming process failed with code {return_code}")
                        self.logger.error(f"Final stderr: {stderr}")
                    if stdout:
                        self.logger.info(f"Final stdout: {stdout}")
                except subprocess.TimeoutExpired:
                    self.logger.error("FFmpeg streaming process failed and timed out during cleanup")
            else:
                self.logger.info("FFmpeg streaming process completed successfully")
            
            # Clean up from our tracking
            if 'live_stream' in self.current_processes:
                del self.current_processes['live_stream']
                
        except Exception as e:
            self.logger.error(f"Error monitoring FFmpeg streaming process: {e}")
    
    async def _monitor_ffmpeg_process(self, process: subprocess.Popen, process_key: str):
        """Monitor FFmpeg process and log any errors"""
        try:
            # Monitor the process in a non-blocking way
            while process.poll() is None:
                # Read some stderr to check for errors
                if process.stderr and process.stderr.readable():
                    try:
                        # Use non-blocking read with a small timeout
                        import select
                        import sys
                        
                        if hasattr(select, 'select'):
                            ready, _, _ = select.select([process.stderr], [], [], 1)
                            if ready:
                                line = process.stderr.readline()
                                if line:
                                    line = line.strip()
                                    # Log important FFmpeg messages
                                    if any(keyword in line.lower() for keyword in ['error', 'failed', 'invalid', 'timeout']):
                                        self.logger.error(f"FFmpeg error: {line}")
                                    elif 'Input/output error' in line:
                                        self.logger.error(f"FFmpeg I/O error: {line}")
                                        break
                    except Exception as e:
                        self.logger.debug(f"Error reading FFmpeg stderr: {e}")
                
                await asyncio.sleep(1)
            
            # Process has ended
            return_code = process.returncode
            if return_code != 0:
                # Get any remaining output
                try:
                    stdout, stderr = process.communicate(timeout=5)
                    if stderr:
                        self.logger.error(f"FFmpeg process {process_key} failed with code {return_code}")
                        self.logger.error(f"Final stderr: {stderr}")
                except subprocess.TimeoutExpired:
                    self.logger.error(f"FFmpeg process {process_key} failed and timed out during cleanup")
            else:
                self.logger.info(f"FFmpeg process {process_key} completed successfully")
            
            # Clean up from our tracking
            if process_key in self.current_processes:
                del self.current_processes[process_key]
                
        except Exception as e:
            self.logger.error(f"Error monitoring FFmpeg process {process_key}: {e}")
    
    async def _test_rtsp_connection(self) -> bool:
        """Test RTSP connection with a quick probe"""
        try:
            # Use ffprobe to test connection quickly
            test_cmd = [
                "ffprobe",
                "-rtsp_transport", "tcp",
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "csv=p=0",
                "-timeout", "10000000",  # 10 second timeout in microseconds
                self.config['rtsp_url']
            ]
            
            self.logger.debug(f"Testing RTSP with: {' '.join(test_cmd[:-1])} [RTSP_URL]")
            
            # Run the test with timeout
            result = subprocess.run(
                test_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=15,  # 15 second timeout for the entire operation
                universal_newlines=True
            )
            
            if result.returncode == 0:
                self.logger.info("RTSP connection test successful")
                return True
            else:
                self.logger.error(f"RTSP connection test failed with code {result.returncode}")
                if result.stderr:
                    self.logger.error(f"RTSP test error: {result.stderr.strip()}")
                return False
                
        except subprocess.TimeoutExpired:
            self.logger.error("RTSP connection test timed out")
            return False
        except Exception as e:
            self.logger.error(f"RTSP connection test failed: {e}")
            return False
    
    async def _handle_stop_record(self, data: Dict) -> bool:
        """Stop all running recordings"""
        try:
            stopped_count = 0
            
            # Stop all recording processes
            for key, process in list(self.current_processes.items()):
                if key.startswith('record_') and process.poll() is None:
                    self.logger.info(f"Stopping recording process {process.pid}")
                    process.terminate()
                    
                    # Wait for graceful termination
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        self.logger.warning(f"Force killing recording process {process.pid}")
                        process.kill()
                    
                    del self.current_processes[key]
                    stopped_count += 1
            
            self.logger.info(f"Stopped {stopped_count} recording processes")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to stop recording: {e}")
            return False
    
    async def _handle_start_stream(self, data: Dict) -> bool:
        """Start live streaming to platforms like YouTube"""
        try:
            self.logger.info("=== START_STREAM handler called ===")
            
            meta = data.get('meta', {})
            platform = meta.get('platform', 'youtube')
            stream_key = meta.get('stream_key', self.config.get('youtube_stream_key'))
            
            self.logger.info(f"Stream parameters - platform: {platform}")
            self.logger.info(f"Using stream key: {stream_key[:10]}..." if stream_key else "No stream key")
            
            if not stream_key:
                self.logger.error("No stream key provided for live streaming")
                return False
            
            # Stop any existing stream first
            if 'live_stream' in self.current_processes:
                await self._handle_stop_stream({})
            
            # Generate stream URL based on platform
            if platform == 'youtube':
                stream_url = f"rtmp://a.rtmp.youtube.com/live2/{stream_key}"
            else:
                self.logger.error(f"Unsupported streaming platform: {platform}")
                return False
            
            self.logger.info(f"Stream URL: {stream_url[:50]}...")  # Hide full stream key
            self.logger.info(f"RTSP URL: {self.config['rtsp_url']}")
            
            # Build ffmpeg command for streaming (matching the working hikvision script)
            ffmpeg_cmd = [
                "ffmpeg",
                "-rtsp_transport", "tcp",
                "-i", self.config['rtsp_url'],
                "-vcodec", "libx264",
                "-preset", "veryfast",
                "-tune", "zerolatency",
                "-maxrate", "3000k",
                "-bufsize", "6000k",
                "-g", "50",
                "-acodec", "aac",
                "-b:a", "128k",
                "-ar", "44100",
                "-f", "flv",
                stream_url
            ]
            
            self.logger.info(f"FFmpeg streaming command: {' '.join(ffmpeg_cmd[:-1])} [STREAM_URL]")
            
            # Check if ffmpeg is available
            try:
                subprocess.run(["ffmpeg", "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                self.logger.info("FFmpeg is available")
            except Exception as e:
                self.logger.error(f"FFmpeg not available: {e}")
                return False
            
            # Test RTSP connection before starting stream
            self.logger.info("Testing RTSP connection...")
            test_result = await self._test_rtsp_connection()
            if not test_result:
                self.logger.error("RTSP connection test failed, aborting stream")
                return False
            
            self.logger.info(f"Starting live stream process...")
            process = subprocess.Popen(
                ffmpeg_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True,
                bufsize=1
            )
            
            # Store process for potential stopping
            self.current_processes['live_stream'] = process
            
            # Give FFmpeg a moment to start and check for immediate errors
            await asyncio.sleep(3)
            
            # Check if process is still running
            if process.poll() is None:
                self.logger.info(f"Live stream started successfully with PID {process.pid}")
                
                # Start a background task to monitor the streaming process
                asyncio.create_task(self._monitor_stream_process(process))
                
                return True
            else:
                # Process already terminated - capture error output
                stdout, stderr = process.communicate()
                self.logger.error(f"Streaming process failed immediately:")
                self.logger.error(f"Return code: {process.returncode}")
                if stdout:
                    self.logger.error(f"STDOUT: {stdout}")
                if stderr:
                    self.logger.error(f"STDERR: {stderr}")
                
                # Clean up
                if 'live_stream' in self.current_processes:
                    del self.current_processes['live_stream']
                return False
            
        except Exception as e:
            self.logger.error(f"Failed to start live stream: {e}")
            import traceback
            self.logger.error(f"Traceback: {traceback.format_exc()}")
            return False
    
    async def _handle_stop_stream(self, data: Dict) -> bool:
        """Stop live streaming"""
        try:
            if 'live_stream' in self.current_processes:
                process = self.current_processes['live_stream']
                if process.poll() is None:
                    self.logger.info(f"Stopping live stream process {process.pid}")
                    process.terminate()
                    
                    # Wait for graceful termination
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        self.logger.warning(f"Force killing stream process {process.pid}")
                        process.kill()
                    
                    del self.current_processes['live_stream']
                    self.logger.info("Live stream stopped")
                    return True
            
            self.logger.warning("No active live stream to stop")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to stop live stream: {e}")
            return False
    
    async def _handle_test_record(self, data: Dict) -> bool:
        """Test recording functionality by creating a dummy output file"""
        try:
            meta = data.get('meta', {})
            duration = meta.get('duration', 30)  # Default 30 seconds for test
            quality = meta.get('quality', '1080p')
            
            # Create recordings directory
            recordings_dir = self.config.get('recordings_dir', 'recordings')
            os.makedirs(recordings_dir, exist_ok=True)
            
            # Generate timestamped filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            user_id = data.get('by', 'unknown')
            output_file = os.path.join(recordings_dir, f"test_record_{timestamp}_{user_id}.txt")
            
            # Create a dummy command that writes to a file (no ffmpeg required)
            test_cmd = [
                "bash", "-c", 
                f"echo 'Test recording started at {datetime.now().isoformat()}' > '{output_file}' && "
                f"for i in {{1..{duration}}}; do "
                f"echo 'Recording frame $i at' $(date) >> '{output_file}'; "
                f"sleep 1; "
                f"done && "
                f"echo 'Test recording completed at {datetime.now().isoformat()}' >> '{output_file}'"
            ]
            
            self.logger.info(f"Starting test recording: {output_file}")
            process = subprocess.Popen(
                test_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
            # Store process for potential stopping
            process_key = f"test_record_{timestamp}"
            self.current_processes[process_key] = process
            
            self.logger.info(f"Test recording started with PID {process.pid}")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to start test recording: {e}")
            return False
    
    async def _handle_test_stream(self, data: Dict) -> bool:
        """Test streaming functionality by creating a dummy stream simulation"""
        try:
            meta = data.get('meta', {})
            platform = meta.get('platform', 'youtube')
            
            # Create logs directory for test output
            logs_dir = os.path.join(self.config.get('recordings_dir', 'recordings'), 'logs')
            os.makedirs(logs_dir, exist_ok=True)
            
            # Generate timestamped filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_file = os.path.join(logs_dir, f"test_stream_{timestamp}_{platform}.log")
            
            # Create a dummy streaming simulation command
            test_cmd = [
                "bash", "-c",
                f"echo 'Test stream to {platform} started at {datetime.now().isoformat()}' > '{output_file}' && "
                f"while true; do "
                f"echo 'Streaming frame at' $(date) >> '{output_file}'; "
                f"sleep 2; "
                f"done"
            ]
            
            self.logger.info(f"Starting test stream to {platform}: {output_file}")
            process = subprocess.Popen(
                test_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
            # Store process for potential stopping
            self.current_processes['test_stream'] = process
            
            self.logger.info(f"Test stream started with PID {process.pid}")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to start test stream: {e}")
            return False
    
    async def heartbeat_loop(self):
        """Send periodic heartbeat messages to keep connection alive"""
        self.logger.info("Starting heartbeat loop with explicit heartbeat messages")
        
        # Send heartbeat more frequently than server timeout (every 4 seconds vs 5s timeout)
        heartbeat_interval = 4
        
        while self.running and self.ws:
            try:
                await asyncio.sleep(heartbeat_interval)
                
                # Check if connection is still alive
                if self.ws.closed:
                    self.logger.warning("WebSocket connection is closed")
                    break
                
                # Send a heartbeat message that the server will recognize
                # This is a workaround for ping/pong compatibility issues
                heartbeat_message = {
                    "type": "heartbeat",
                    "timestamp": time.time()
                }
                
                await self.ws.send(json.dumps(heartbeat_message))
                self.logger.debug("Sent heartbeat message to server")
                    
            except Exception as e:
                self.logger.error(f"Heartbeat failed: {e}")
                break
        
        self.logger.info("Heartbeat loop stopped")
    
    async def cleanup(self):
        """Clean up resources and stop all processes"""
        self.logger.info("Cleaning up resources...")
        
        # Stop all running processes
        for key, process in list(self.current_processes.items()):
            if process.poll() is None:
                self.logger.info(f"Terminating process {key} (PID: {process.pid})")
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
        
        self.current_processes.clear()
        
        # Close WebSocket connection
        if self.ws:
            await self.ws.close()
    
    async def run(self):
        """Main event loop with explicit ping/pong handling"""
        self.running = True
        
        # Connect to server
        if not await self.connect():
            return False
        
        # Register with server
        if not await self.register():
            return False
        
        # Start heartbeat monitoring task
        heartbeat_task = asyncio.create_task(self.heartbeat_loop())
        
        try:
            # Use async iteration to handle all frame types
            async for message in self.ws:
                if not self.running:
                    break
                    
                # Handle text messages (JSON commands)
                if isinstance(message, str):
                    await self.handle_message(message)
                elif isinstance(message, bytes):
                    # Binary message (not expected, but handle gracefully)
                    self.logger.warning(f"Received unexpected binary message: {len(message)} bytes")
                else:
                    # This shouldn't happen
                    self.logger.warning(f"Received unexpected message type: {type(message)}")
                    
        except ConnectionClosed:
            self.logger.warning("WebSocket connection closed by server")
        except WebSocketException as e:
            self.logger.error(f"WebSocket error: {e}")
        except Exception as e:
            self.logger.error(f"Unexpected error in main loop: {e}")
        finally:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            await self.cleanup()
            
        return True


def load_config():
    """Load configuration from environment variables or config file"""
    config = {
        'court_id': os.getenv('COURT_ID', 'court-001'),
        'server_host': os.getenv('SERVER_HOST', 'localhost'),
        'server_port': int(os.getenv('SERVER_PORT', '3000')),
        'auth_token': os.getenv('AUTH_TOKEN', 'dev-token-1'),
        'rtsp_url': os.getenv('RTSP_URL', 'rtsp://admin:12345qwe@192.168.88.7:554/Streaming/Channels/101'),
        'youtube_stream_key': os.getenv('YOUTUBE_STREAM_KEY', ''),
        'recordings_dir': os.getenv('RECORDINGS_DIR', 'recordings'),
        'capabilities': ['live', 'record'],
        'log_level': os.getenv('LOG_LEVEL', 'INFO'),
        'heartbeat_interval': int(os.getenv('HEARTBEAT_INTERVAL', '10')),  # Reduced to 10 seconds
        'max_retries': int(os.getenv('MAX_RETRIES', '5')),
        'retry_delay': int(os.getenv('RETRY_DELAY', '5'))
    }
    
    return config


async def main():
    """Main entry point"""
    config = load_config()
    
    # Validate required configuration
    required_fields = ['court_id', 'auth_token', 'rtsp_url']
    for field in required_fields:
        if not config.get(field):
            print(f"Error: {field} is required but not provided")
            return 1
    
    client = CourtClient(config)
    
    print(f"🏟️  Starting Court Client for {config['court_id']}")
    print(f"📡 Connecting to {config['server_host']}:{config['server_port']}")
    print(f"🔧 RTSP Source: {config['rtsp_url']}")
    print("🔄 Press Ctrl+C to stop\n")
    
    success = await client.run()
    return 0 if success else 1


if __name__ == "__main__":
    # Check if websockets is installed
    try:
        import websockets
    except ImportError:
        print("Error: websockets library not found")
        print("Please install it with: pip install websockets")
        sys.exit(1)
    
    # Run the client
    sys.exit(asyncio.run(main()))
