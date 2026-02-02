@echo off
REM Configure Photobooth Linux VM memory to 1GB

set VM_NAME="PhotoboothLinux"
set VBOX_MANAGER="C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
set MEMORY_MB=1024

echo Configuring Photobooth Linux VM memory to %MEMORY_MB% MB...
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

REM Check if VM is running - must be powered off to modify
%VBOX_MANAGER% showvminfo %VM_NAME% | findstr /C:"State:" | findstr /C:"running" >nul
if not errorlevel 1 (
    echo ERROR: VM "%VM_NAME%" is currently running!
    echo Please stop the VM first with: scripts\stop-virtualbox.cmd
    echo.
    pause
    exit /b 1
)

REM Modify memory
echo Setting memory to %MEMORY_MB% MB...
%VBOX_MANAGER% modifyvm %VM_NAME% --memory %MEMORY_MB%

if errorlevel 1 (
    echo.
    echo ERROR: Failed to modify VM memory!
    pause
    exit /b 1
)

echo.
echo Success! VM memory configured to %MEMORY_MB% MB (1 GB)
echo.
echo You can now start the VM with:
echo   scripts\start-virtualbox-headless.cmd
echo.
pause
