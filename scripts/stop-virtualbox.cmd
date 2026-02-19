@echo off
REM Stop Photobooth Linux VM

set VM_NAME="PhotoboothLinux"
set VBOX_MANAGER="C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"

echo Stopping Photobooth Linux VM...
echo.

REM Check if VM exists and get its state in one call
%VBOX_MANAGER% showvminfo %VM_NAME% --machinereadable > "%TEMP%\vbox_stop_%RANDOM%.txt" 2>nul
if errorlevel 1 (
    echo VM "%VM_NAME%" not found or not accessible.
    pause
    exit /b 1
)

findstr /C:"VMState=\"running\"" "%TEMP%\vbox_stop_*.txt" >nul
if errorlevel 1 (
    echo VM is not running.
    del "%TEMP%\vbox_stop_*.txt" 2>nul
    pause
    exit /b 0
)
del "%TEMP%\vbox_stop_*.txt" 2>nul

REM Force poweroff (faster than ACPI for development)
%VBOX_MANAGER% controlvm %VM_NAME% poweroff >nul
if not errorlevel 1 (
    echo VM stopped.
) else (
    echo Failed to stop VM.
)
echo.
