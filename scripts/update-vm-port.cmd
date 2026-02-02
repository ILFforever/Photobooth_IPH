@echo off
REM Update VirtualBox port forwarding from port 3000 to port 58321

set VM_NAME="PhotoboothLinux"
set VBOX_MANAGER="C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"
set OLD_PORT=3000
set NEW_PORT=58321

echo =====================================================
echo Photobooth Linux VM - Port Forwarding Update
echo =====================================================
echo.
echo This script will update the VM port forwarding:
echo   From: Host port %OLD_PORT% -^> Guest port %OLD_PORT%
echo   To:   Host port %NEW_PORT% -^> Guest port %NEW_PORT%
echo.

REM Check if VM exists
%VBOX_MANAGER% list vms | findstr /C:"%VM_NAME%" >nul
if errorlevel 1 (
    echo ERROR: VM %VM_NAME% not found!
    echo.
    echo Available VMs:
    %VBOX_MANAGER% list vms
    echo.
    pause
    exit /b 1
)

echo VM %VM_NAME% found.
echo.

REM Check if VM is running
%VBOX_MANAGER% showvminfo %VM_NAME% | findstr /C:"State:" | findstr /C:"running" >nul
if not errorlevel 1 (
    echo VM is currently running. Stopping VM first...
    echo.
    %VBOX_MANAGER% controlvm %VM_NAME% acpipowerbutton

    echo Waiting for VM to shut down...
    :waitloop
    timeout /t 1 >nul
    %VBOX_MANAGER% showvminfo %VM_NAME% | findstr /C:"State:" | findstr /C:"running" >nul
    if not errorlevel 1 (
        echo VM still running, waiting...
        goto waitloop
    )
    echo VM stopped.
    echo.
)

REM Show current NAT rules
echo Current NAT port forwarding rules:
%VBOX_MANAGER% showvminfo %VM_NAME% | findstr /C:"NAT"
echo.

REM Remove old port forwarding rule (if exists)
echo Removing old port forwarding rule (port %OLD_PORT%)...
%VBOX_MANAGER% modifyvm %VM_NAME% --natpf1 delete "photobooth" 2>nul
if errorlevel 1 (
    echo No existing rule found or already removed.
) else (
    echo Old rule removed.
)
echo.

REM Add new port forwarding rule
echo Adding new port forwarding rule (port %NEW_PORT%)...
%VBOX_MANAGER% modifyvm %VM_NAME% --natpf1 "photobooth,tcp,,%NEW_PORT%,,%NEW_PORT%"
if errorlevel 1 (
    echo ERROR: Failed to add new port forwarding rule!
    pause
    exit /b 1
)
echo New rule added successfully.
echo.

REM Show updated NAT rules
echo Updated NAT port forwarding rules:
%VBOX_MANAGER% showvminfo %VM_NAME% | findstr /C:"NAT"
echo.

echo =====================================================
echo Port forwarding update complete!
echo =====================================================
echo.
echo The VM will now be accessible at:
echo   http://localhost:%NEW_PORT%/api/health
echo.
echo Next steps:
echo   1. Start the VM: scripts/start-virtualbox-headless.cmd
echo   2. Test connection: curl http://localhost:%NEW_PORT%/api/health
echo.

pause
