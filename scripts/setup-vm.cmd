@echo off
REM Initial VM setup - creates VM from ISO for first use
REM Run this after installing the app or when VM is missing

setlocal enabledelayedexpansion

set VM_NAME=PhotoboothLinux
set VBOX_MANAGER=C:\Program Files\Oracle\VirtualBox\VBoxManage.exe

REM Get project root
set SCRIPT_DIR=%~dp0
set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%
for %%I in ("%SCRIPT_DIR%\..") do set PROJECT_ROOT=%%~fI

echo ========================================
echo Photobooth VM Setup
echo ========================================
echo.

REM Check if VirtualBox is installed
if not exist "%VBOX_MANAGER%" (
    echo ERROR: VirtualBox not found at %VBOX_MANAGER%
    echo Please install VirtualBox first.
    pause
    exit /b 1
)

REM Check if VM already exists
"%VBOX_MANAGER%" list vms | findstr /C:"%VM_NAME%" >nul
if not errorlevel 1 (
    echo VM "%VM_NAME%" already exists.
    echo.
    echo Do you want to:
    echo   1. Update paths only (recommended)
    echo   2. Delete and recreate VM
    echo   3. Cancel
    echo.
    set /p CHOICE="Enter choice (1-3): "

    if "!CHOICE!"=="1" (
        call "%SCRIPT_DIR%\ensure-vm-paths.cmd"
        exit /b !errorlevel!
    )

    if "!CHOICE!"=="2" (
        call "%SCRIPT_DIR%\create-vm-from-iso.cmd"
        exit /b !errorlevel!
    ) else (
        echo Cancelled.
        exit /b 0
    )
)

REM VM doesn't exist, create it
call "%SCRIPT_DIR%\create-vm-from-iso.cmd"
exit /b !errorlevel!
