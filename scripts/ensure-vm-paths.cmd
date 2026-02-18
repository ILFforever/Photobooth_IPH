@echo off
REM Ensures VM paths are correct for the current installation location
REM This should run before starting the VM to fix any path issues

setlocal enabledelayedexpansion

set VM_NAME=PhotoboothLinux
set VBOX_MANAGER=C:\Program Files\Oracle\VirtualBox\VBoxManage.exe

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0
REM Remove trailing backslash
set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%
REM Get the project root (parent of scripts directory)
for %%I in ("%SCRIPT_DIR%\..") do set PROJECT_ROOT=%%~fI

REM Build expected paths
set APP_DATA_DIR=%LOCALAPPDATA%\Photobooth_IPH
set EXPECTED_LOG=%APP_DATA_DIR%\logs\vbox-console.log
set EXPECTED_ISO=%PROJECT_ROOT%\linux-build\photobooth.iso

REM Ensure log directory exists
if not exist "%APP_DATA_DIR%\logs" mkdir "%APP_DATA_DIR%\logs"

REM Single VBoxManage call - dump all VM info to a temp file
set VM_INFO_FILE=%TEMP%\vbox_vm_info_%RANDOM%.txt
"%VBOX_MANAGER%" showvminfo "%VM_NAME%" --machinereadable > "%VM_INFO_FILE%" 2>nul
if errorlevel 1 (
    del "%VM_INFO_FILE%" 2>nul
    echo VM "%VM_NAME%" not found. Run setup-vm.cmd first.
    exit /b 1
)

echo Checking VM paths...

REM Extract UART path from cached info
set TEMP_LINE_FILE=%TEMP%\vbox_vm_line_%RANDOM%.txt
findstr "uartmode1=" "%VM_INFO_FILE%" > "%TEMP_LINE_FILE%"
set /p CURRENT_UART=<"%TEMP_LINE_FILE%"
del "%TEMP_LINE_FILE%" 2>nul

REM Extract the path part (after "file,")
for /f "tokens=2 delims=," %%a in ("!CURRENT_UART!") do set CURRENT_PATH=%%a
REM Remove quotes and leading/trailing spaces
set CURRENT_PATH=!CURRENT_PATH:"=!
set CURRENT_PATH=!CURRENT_PATH: =!

REM Extract ISO path from cached info
set TEMP_LINE_FILE=%TEMP%\vbox_vm_line_%RANDOM%.txt
findstr "SATA-0-0" "%VM_INFO_FILE%" > "%TEMP_LINE_FILE%"
set /p CURRENT_ISO_LINE=<"%TEMP_LINE_FILE%"
del "%TEMP_LINE_FILE%" 2>nul

REM Check if VM is running (from cached info) and export for caller
findstr /C:"VMState=""running""" "%VM_INFO_FILE%" >nul
if not errorlevel 1 (
    set VM_IS_RUNNING=1
) else (
    set VM_IS_RUNNING=0
)

REM Clean up the main info file
del "%VM_INFO_FILE%" 2>nul

for /f "tokens=2 delims==" %%a in ("!CURRENT_ISO_LINE!") do set CURRENT_ISO=%%a
set CURRENT_ISO=!CURRENT_ISO:"=!

REM Normalize paths (replace double backslashes with single)
set CURRENT_PATH=!CURRENT_PATH:\\=\!
set CURRENT_ISO=!CURRENT_ISO:\\=\!

REM Compare paths (case-insensitive)
set PATHS_OK=1

echo Checking console log path...
echo   Current:  !CURRENT_PATH!
echo   Expected: !EXPECTED_LOG!
if /I not "!CURRENT_PATH!"=="!EXPECTED_LOG!" set PATHS_OK=0

echo Checking ISO path...
echo   Current:  !CURRENT_ISO!
echo   Expected: !EXPECTED_ISO!
if /I not "!CURRENT_ISO!"=="!EXPECTED_ISO!" set PATHS_OK=0

if !PATHS_OK!==0 (
    echo.
    echo Paths don't match. Updating VM configuration...

    REM Check if VM is running (using cached result)
    if !VM_IS_RUNNING!==1 (
        echo ERROR: VM is running. Please stop it first with: scripts\stop-virtualbox.cmd
        exit /b 1
    )

    REM Update the UART configuration (always reconfigure to ensure correct syntax)
    if /I not "!CURRENT_PATH!"=="!EXPECTED_LOG!" (
        echo Updating console log path...
        "%VBOX_MANAGER%" modifyvm "%VM_NAME%" --uart1 0x3F8 4
        if errorlevel 1 (
            echo ERROR: Failed to configure UART port.
            exit /b 1
        )
        "%VBOX_MANAGER%" modifyvm "%VM_NAME%" --uartmode1 file "!EXPECTED_LOG!"
        if errorlevel 1 (
            echo ERROR: Failed to set UART mode.
            exit /b 1
        )
    )

    REM Update the ISO path
    if /I not "!CURRENT_ISO!"=="!EXPECTED_ISO!" (
        echo Updating ISO path...
        "%VBOX_MANAGER%" storageattach "%VM_NAME%" --storagectl "SATA" --port 0 --device 0 --type dvddrive --medium "%EXPECTED_ISO%"
        if errorlevel 1 (
            echo ERROR: Failed to update ISO path. Make sure VirtualBox GUI is closed.
            exit /b 1
        )
    )

    echo VM paths updated successfully!
) else (
    echo All paths are correct.
)

REM Export VM_IS_RUNNING to the caller's scope
endlocal & set VM_IS_RUNNING=%VM_IS_RUNNING%
exit /b 0
