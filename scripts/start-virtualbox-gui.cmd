@echo off
REM Start Photobooth Linux VM in VirtualBox with GUI

set VM_NAME="PhotoboothLinux"
set VBOX_MANAGER="C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"

echo Starting Photobooth Linux VM...
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

REM Start VM with GUI
echo Starting VM with GUI...
%VBOX_MANAGER% startvm %VM_NAME% --type gui

echo.
echo VM started. You can connect to the API at:
echo   http://localhost:3000/api/health
echo.
