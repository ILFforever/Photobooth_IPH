@echo off
REM Creates a fresh VM from scratch using the photobooth.iso
REM This is used for production deployments - much lighter than OVA

setlocal enabledelayedexpansion

set VM_NAME=PhotoboothLinux
set VBOX_MANAGER=C:\Program Files\Oracle\VirtualBox\VBoxManage.exe

REM Get project root
set SCRIPT_DIR=%~dp0
set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%
for %%I in ("%SCRIPT_DIR%\..") do set PROJECT_ROOT=%%~fI

set ISO_PATH=%PROJECT_ROOT%\linux-build\photobooth.iso
set APP_DATA_DIR=%LOCALAPPDATA%\Photobooth_IPH
set CONSOLE_LOG=%APP_DATA_DIR%\logs\vbox-console.log

REM Ensure log directory exists
if not exist "%APP_DATA_DIR%\logs" mkdir "%APP_DATA_DIR%\logs"

echo ========================================
echo Create Photobooth VM from ISO
echo ========================================
echo.

REM Check if VirtualBox is installed
if not exist "%VBOX_MANAGER%" (
    echo ERROR: VirtualBox not found at %VBOX_MANAGER%
    echo Please install VirtualBox first.
    pause
    exit /b 1
)

REM Check if ISO exists
if not exist "%ISO_PATH%" (
    echo ERROR: ISO file not found at %ISO_PATH%
    echo Please ensure the ISO is in the linux-build directory.
    pause
    exit /b 1
)

REM Check if VM already exists
"%VBOX_MANAGER%" list vms | findstr /C:"%VM_NAME%" >nul
if not errorlevel 1 (
    echo VM "%VM_NAME%" already exists.
    echo.
    set /p CHOICE="Do you want to delete and recreate it? (y/n): "
    if /I not "!CHOICE!"=="y" (
        echo Cancelled.
        exit /b 0
    )
    echo Removing existing VM...
    "%VBOX_MANAGER%" unregistervm "%VM_NAME%" --delete
)

echo.
echo Creating VM...
"%VBOX_MANAGER%" createvm --name "%VM_NAME%" --ostype "Linux_64" --register
if errorlevel 1 (
    echo ERROR: Failed to create VM
    pause
    exit /b 1
)

echo Configuring VM settings...

REM Set memory and CPU
"%VBOX_MANAGER%" modifyvm "%VM_NAME%" --memory 1024 --cpus 1 --vram 8

REM Set boot order
"%VBOX_MANAGER%" modifyvm "%VM_NAME%" --boot1 dvd --boot2 none --boot3 none --boot4 none

REM Configure network - NAT with API port forwarding
"%VBOX_MANAGER%" modifyvm "%VM_NAME%" --nic1 nat --nictype1 82540EM
"%VBOX_MANAGER%" modifyvm "%VM_NAME%" --natpf1 "photoboothapi,tcp,,58321,,8080"

REM Configure serial console for logging (using correct Oracle syntax - no comma)
"%VBOX_MANAGER%" modifyvm "%VM_NAME%" --uart1 0x3F8 4
"%VBOX_MANAGER%" modifyvm "%VM_NAME%" --uartmode1 file "%CONSOLE_LOG%"

REM Disable audio
"%VBOX_MANAGER%" modifyvm "%VM_NAME%" --audio none

REM Create SATA storage controller
"%VBOX_MANAGER%" storagectl "%VM_NAME%" --name "SATA" --add sata --controller IntelAhci --portcount 2

REM Attach ISO
echo Attaching ISO: %ISO_PATH%
"%VBOX_MANAGER%" storageattach "%VM_NAME%" --storagectl "SATA" --port 0 --device 0 --type dvddrive --medium "%ISO_PATH%"

echo.
echo ========================================
echo VM Created Successfully!
echo ========================================
echo.
echo VM Configuration:
echo   Name:     %VM_NAME%
echo   Memory:   1024 MB
echo   CPUs:     1
echo   ISO:      %ISO_PATH%
echo   Console:  %CONSOLE_LOG%
echo   API Port: 58321 (forwarded from VM port 8080)
echo.
echo You can now start the VM with:
echo   scripts\start-virtualbox-headless.cmd
echo   or
echo   scripts\start-virtualbox-gui.cmd
echo.
pause
