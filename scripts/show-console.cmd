@echo off
REM Show VirtualBox console/serial output

set VM_NAME="PhotoboothLinux"
set VBOX_MANAGER="C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
set CONSOLE_FILE="linux-build\vbox-console.log"

echo Monitoring Photobooth Linux console...
echo Press Ctrl+C to stop monitoring.
echo.

REM Check if VM is running
%VBOX_MANAGER% showvminfo %VM_NAME% 2>nul | findstr /C:"State:" | findstr /C:"running" >nul
if errorlevel 1 (
    echo VM is not running. Start it first with:
    echo   scripts\start-virtualbox-headless.cmd
    echo   OR
    echo   scripts\start-virtualbox-gui.cmd
    echo.
    pause
    exit /b 1
)

REM Tail the console log (PowerShell for tail-like behavior)
powershell -Command "Get-Content '%CONSOLE_FILE%' -Wait -Tail 50"
