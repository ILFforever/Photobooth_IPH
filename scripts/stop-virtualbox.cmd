@echo off
REM Stop Photobooth Linux VM

set VM_NAME="PhotoboothLinux"
set VBOX_MANAGER="C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"

echo Stopping Photobooth Linux VM...
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
if errorlevel 1 (
    echo VM "%VM_NAME%" is not running!
    pause
    exit /b 0
)

REM Stop VM ( ACPI power button )
echo Stopping VM...
%VBOX_MANAGER% controlvm %VM_NAME% acpipowerbutton

echo Waiting for VM to shut down...
timeout /t 3 >nul

REM Force stop if still running after 10 seconds
:waitloop
timeout /t 1 >nul
%VBOX_MANAGER% showvminfo %VM_NAME% | findstr /C:"State:" | findstr /C:"running" >nul
if not errorlevel 1 (
    echo VM still running, waiting...
    goto waitloop
)

echo.
echo VM stopped.
echo.
