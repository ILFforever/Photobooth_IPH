@echo off
REM Setup script for downloading and configuring FFmpeg as a Tauri sidecar

echo ========================================
echo FFmpeg Sidecar Setup Script
echo ========================================
echo.

REM Check if ffmpeg-x86_64-pc-windows-msvc.exe already exists
if exist "ffmpeg-x86_64-pc-windows-msvc.exe" (
    echo FFmpeg sidecar already exists!
    echo.
    echo If you want to re-download, delete ffmpeg-x86_64-pc-windows-msvc.exe and run this script again.
    pause
    exit /b 0
)

echo This script will help you download and setup FFmpeg as a bundled sidecar.
echo.
echo Steps:
echo 1. Download FFmpeg from GitHub releases
echo 2. Extract and copy the binary to this directory
echo 3. Rename it to the Tauri sidecar format
echo.
echo Opening FFmpeg releases page...
echo.

REM Open the FFmpeg releases page
start https://github.com/BtbN/FFmpeg-Builds/releases

echo.
echo Please follow these steps:
echo.
echo 1. On the GitHub page that opened, download the latest:
echo    "ffmpeg-master-latest-win64-gpl.zip"
echo.
echo 2. Extract the downloaded ZIP file
echo.
echo 3. Navigate to the "bin" folder inside
echo.
echo 4. Copy "ffmpeg.exe" to this directory: src-tauri\sidecars\
echo.
echo 5. Rename it to: ffmpeg-x86_64-pc-windows-msvc.exe
echo.
echo After you've completed these steps, press any key to verify...
pause > nul

REM Check if the file exists
if exist "ffmpeg-x86_64-pc-windows-msvc.exe" (
    echo.
    echo ========================================
    echo SUCCESS!
    echo ========================================
    echo.
    echo FFmpeg sidecar is now configured!
    echo File: ffmpeg-x86_64-pc-windows-msvc.exe
    echo.
    echo The bundled ffmpeg will be automatically included in your app builds.
) else (
    echo.
    echo ========================================
    echo NOT FOUND
    echo ========================================
    echo.
    echo The file "ffmpeg-x86_64-pc-windows-msvc.exe" was not found in this directory.
    echo.
    echo Please make sure you:
    echo 1. Copied ffmpeg.exe to this directory
    echo 2. Renamed it to ffmpeg-x86_64-pc-windows-msvc.exe
    echo.
)

pause
