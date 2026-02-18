@echo off
REM NOTE: This script is deprecated - use the lightweight ISO instead!
REM The photobooth.iso (27 MB) is much smaller than an OVA export (2-8 GB)
REM For production, just bundle linux-build/photobooth.iso with your app
REM
REM Export VM for distribution (OVA format - LARGE file)
REM This creates a portable OVA file that can be imported on any machine

set VM_NAME=PhotoboothLinux
set VBOX_MANAGER="C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"

REM Get project root
set SCRIPT_DIR=%~dp0
set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%
for %%I in ("%SCRIPT_DIR%\..") do set PROJECT_ROOT=%%~fI

set OUTPUT_DIR=%PROJECT_ROOT%\vm
set OUTPUT_FILE=%OUTPUT_DIR%\PhotoboothLinux.ova

echo ========================================
echo Export VM for Distribution
echo ========================================
echo.

REM Check if VM exists
%VBOX_MANAGER% list vms | findstr /C:"%VM_NAME%" >nul
if errorlevel 1 (
    echo ERROR: VM "%VM_NAME%" not found!
    pause
    exit /b 1
)

REM Check if VM is running
%VBOX_MANAGER% showvminfo %VM_NAME% | findstr /C:"State:" | findstr /C:"running" >nul
if not errorlevel 1 (
    echo ERROR: VM is running. Please stop it first with: scripts\stop-virtualbox.cmd
    pause
    exit /b 1
)

REM Create output directory
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

echo Exporting VM to: %OUTPUT_FILE%
echo This may take several minutes depending on VM size...
echo.

%VBOX_MANAGER% export %VM_NAME% --output "%OUTPUT_FILE%" --options manifest,nomacs
if errorlevel 1 (
    echo ERROR: Failed to export VM
    pause
    exit /b 1
)

echo.
echo ========================================
echo Export Complete!
echo ========================================
echo.
echo VM exported to: %OUTPUT_FILE%
echo Size:
dir "%OUTPUT_FILE%" | findstr "ova"
echo.
echo This file can be bundled with your app for distribution.
echo.
pause
