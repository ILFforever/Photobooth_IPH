@echo off
REM Start Photobooth Linux VM in VirtualBox (headless mode - no GUI)

set VM_NAME="PhotoboothLinux"
set VBOX_MANAGER="C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"

echo Starting Photobooth Linux VM (headless)...
echo.

REM Check if VM exists
%VBOX_MANAGER% list vms | findstr /C:"%VM_NAME%" >nul
if errorlevel 1 (
    echo ERROR: VM "%VM_NAME%" not found!
    echo Available VMs:
    %VBOX_MANAGER% list vms
    pause
    exit /b 1
)

REM Check if VM is already running
%VBOX_MANAGER% showvminfo %VM_NAME% | findstr /C:"State:" | findstr /C:"running" >nul
if not errorlevel 1 (
    echo VM "%VM_NAME%" is already running!
    echo.
    echo VM is accessible at:
    echo   http://localhost:3000/api/health
    echo.
    pause
    exit /b 0
)

REM Start VM in headless mode
echo Starting VM in headless mode...
%VBOX_MANAGER% startvm %VM_NAME% --type headless

timeout /t 2 >nul

echo.
echo VM started in background!
echo.
echo The VM is now running. You can:
echo   - Test API: http://localhost:3000/api/health
echo   - View console: scripts/show-console.cmd
echo   - Stop VM:   scripts/stop-virtualbox.cmd
echo.
