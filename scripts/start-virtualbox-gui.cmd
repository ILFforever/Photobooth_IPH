@echo off
REM Start Photobooth Linux VM in VirtualBox with GUI

set VM_NAME=PhotoboothLinux
set VBOX_MANAGER=C:\Program Files\Oracle\VirtualBox\VBoxManage.exe

echo Starting Photobooth Linux VM...
echo.

REM Ensure VM paths are correct for current location (also checks VM exists and running state)
call "%~dp0ensure-vm-paths.cmd"
if errorlevel 1 (
    pause
    exit /b 1
)
echo.

REM Check if VM is already running (VM_IS_RUNNING set by ensure-vm-paths.cmd)
if "%VM_IS_RUNNING%"=="1" (
    echo VM "%VM_NAME%" is already running!
    echo.
    echo VM is accessible at:
    echo   http://localhost:58321/api/health
    echo.
    pause
    exit /b 0
)

REM Optimize AHCI port count (30 default is slow - only need 2)
"%VBOX_MANAGER%" storagectl "%VM_NAME%" --name "SATA" --portcount 2 2>nul

REM Start VM with GUI
echo Starting VM with GUI...
"%VBOX_MANAGER%" startvm "%VM_NAME%" --type gui

echo.
echo VM started. You can connect to the API at:
echo   http://localhost:58321/api/health
echo.
