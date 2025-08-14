@echo off
setlocal enabledelayedexpansion

REM Court Client Startup Script
REM This script sets up and starts the court client

echo 🏟️  Court Client Setup ^& Startup
echo ================================

REM Check if Python 3 is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python 3 is required but not installed
    exit /b 1
)

REM Check if ffmpeg is available
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo ❌ FFmpeg is required but not installed
    echo    Please install FFmpeg: https://ffmpeg.org/download.html
    exit /b 1
)

REM Create virtual environment if it doesn't exist
if not exist "venv" (
    echo 📦 Creating Python virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo 🔧 Activating virtual environment...
call venv\Scripts\activate.bat

REM Install dependencies
echo 📥 Installing Python dependencies...
pip install -r requirements.txt

REM Check if .env file exists
if not exist ".env" (
    echo ⚠️  No .env file found
    if exist ".env.example" (
        echo 📋 Copying .env.example to .env
        copy ".env.example" ".env"
        echo ✏️  Please edit .env file with your configuration before running again
        exit /b 1
    ) else (
        echo ❌ No .env.example file found
        exit /b 1
    )
)

REM Load environment variables
echo 🔧 Loading environment configuration...
for /f "usebackq delims=" %%a in (".env") do (
    set "line=%%a"
    if not "!line:~0,1!"=="#" (
        if not "!line!"=="" (
            for /f "tokens=1,2 delims==" %%b in ("!line!") do (
                set "%%b=%%c"
            )
        )
    )
)

REM Validate required environment variables
set "required_vars=COURT_ID AUTH_TOKEN RTSP_URL"
for %%v in (%required_vars%) do (
    if "!%%v!"=="" (
        echo ❌ Required environment variable %%v is not set
        echo    Please check your .env file
        exit /b 1
    )
)

echo ✅ All checks passed
echo.
echo 🚀 Starting Court Client...
echo    Court ID: %COURT_ID%
echo    Server: %SERVER_HOST%:%SERVER_PORT%
echo    RTSP URL: %RTSP_URL%
echo.
echo    Press Ctrl+C to stop
echo.

REM Start the client
python court_client.py