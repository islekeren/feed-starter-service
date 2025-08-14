#!/bin/bash

# Court Client Startup Script
# This script sets up and starts the court client

set -e

echo "🏟️  Court Client Setup & Startup"
echo "================================"

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not installed"
    exit 1
fi

# Check if ffmpeg is available
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ FFmpeg is required but not installed"
    echo "   Please install FFmpeg: https://ffmpeg.org/download.html"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "📦 Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "📥 Installing Python dependencies..."
pip install -r requirements.txt

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found"
    if [ -f ".env.example" ]; then
        echo "📋 Copying .env.example to .env"
        cp .env.example .env
        echo "✏️  Please edit .env file with your configuration before running again"
        exit 1
    else
        echo "❌ No .env.example file found"
        exit 1
    fi
fi

# Load environment variables
echo "🔧 Loading environment configuration..."
export $(cat .env | grep -v '^#' | xargs)

# Validate required environment variables
required_vars=("COURT_ID" "AUTH_TOKEN" "RTSP_URL")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ Required environment variable $var is not set"
        echo "   Please check your .env file"
        exit 1
    fi
done

echo "✅ All checks passed"
echo ""
echo "🚀 Starting Court Client..."
echo "   Court ID: $COURT_ID"
echo "   Server: $SERVER_HOST:$SERVER_PORT"
echo "   RTSP URL: $RTSP_URL"
echo ""
echo "   Press Ctrl+C to stop"
echo ""

# Start the client
python3 court_client.py
