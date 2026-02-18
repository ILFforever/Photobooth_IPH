# Photobooth IPH - Setup Guide

Welcome to Photobooth IPH! This guide will help you set up and run the application with its integrated Linux VM for camera control.

## What's Included

Your Photobooth IPH installation includes:

- **Main Application**: The Photobooth IPH desktop app
- **Linux VM (ISO)**: A lightweight 27 MB Linux system for camera hardware control
- **Setup Scripts**: Automated scripts for VM configuration and management

## Prerequisites

Before starting, you need:

1. **Windows 10/11** (64-bit)
2. **VirtualBox** installed ([Download here](https://www.virtualbox.org/wiki/Downloads))
   - Install the latest version of VirtualBox
   - No special configuration needed - default settings work fine
3. **At least 1 GB free RAM** for the VM
4. **100 MB disk space** for VM configuration

## First-Time Setup

### Step 1: Install VirtualBox

If you haven't already:

1. Download VirtualBox from https://www.virtualbox.org/wiki/Downloads
2. Run the installer with default options
3. Restart your computer if prompted

### Step 2: Create the Photobooth VM

Open a Command Prompt or PowerShell in your Photobooth installation folder and run:

```cmd
scripts\setup-vm.cmd
```

This will:
- ✅ Check if VirtualBox is installed
- ✅ Create a new VM from the lightweight ISO
- ✅ Configure memory (1 GB), CPU, and networking
- ✅ Set up port forwarding (VM port 8080 → Windows port 58321)
- ✅ Configure console logging to `%LOCALAPPDATA%\Photobooth_IPH\logs\`

**This is a one-time process!** The VM will be ready to use after this completes.

### Step 3: Start the Application

After setup completes, you can:

**Option A: Let the app start the VM automatically** (recommended)
- Just launch Photobooth_IPH.exe
- The app will start the VM in the background

**Option B: Start the VM manually**

With GUI (to see console output):
```cmd
scripts\start-virtualbox-gui.cmd
```

In background (headless mode):
```cmd
scripts\start-virtualbox-headless.cmd
```

## Available Scripts

All scripts are in the `scripts\` folder:

### Setup Scripts

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `setup-vm.cmd` | Initial VM creation and configuration | First time only, or to recreate VM |
| `ensure-vm-paths.cmd` | Verify and fix VM paths | After moving installation to different location |

### Runtime Scripts

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `start-virtualbox-gui.cmd` | Start VM with visual console | For debugging or monitoring |
| `start-virtualbox-headless.cmd` | Start VM in background | Normal operation (used by app) |
| `stop-virtualbox.cmd` | Stop the VM gracefully | When closing the app |

### Advanced Scripts

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `create-vm-from-iso.cmd` | Create fresh VM from ISO | Advanced users - same as setup-vm option 2 |
| `show-console.cmd` | View VM console output | Troubleshooting VM issues |

## How the VM Works

The Linux VM provides camera hardware control through:

1. **gphoto2**: Professional camera control library
2. **Camera Daemon**: Rust-based API server running on port 8080 (VM)
3. **Port Forwarding**: VM port 8080 → Windows port 58321
4. **API Endpoint**: The app connects to `http://localhost:58321/api/...`

### Log Files

Console logs are stored in:
```
%LOCALAPPDATA%\Photobooth_IPH\logs\vbox-console.log
```

This is typically:
```
C:\Users\YourUsername\AppData\Local\Photobooth_IPH\logs\vbox-console.log
```

## Troubleshooting

### "VirtualBox not found" error

**Solution:** Install VirtualBox from https://www.virtualbox.org/wiki/Downloads

### "VM already exists" message

If you run `setup-vm.cmd` and the VM exists, you'll see options:
1. **Update paths only** (recommended) - Fixes paths without recreating VM
2. **Delete and recreate VM** - Completely rebuilds the VM
3. **Cancel** - Exit without changes

Choose option 1 unless you need to rebuild the VM completely.

### VM fails to start

**Symptoms:** Error message when starting VM

**Solutions:**
1. Close VirtualBox GUI if open
2. Run the path fixer:
   ```cmd
   scripts\ensure-vm-paths.cmd
   ```
3. Try starting again:
   ```cmd
   scripts\start-virtualbox-gui.cmd
   ```

### "VM is locked" error

**Cause:** VirtualBox GUI has the VM open

**Solution:** Close the VirtualBox Manager window completely, then try again

### Camera not detected

**Symptoms:** App shows "No camera found"

**Check these:**
1. Is the VM running?
   ```cmd
   scripts\start-virtualbox-gui.cmd
   ```
2. Check the console log for errors:
   ```cmd
   type "%LOCALAPPDATA%\Photobooth_IPH\logs\vbox-console.log"
   ```
3. Test the API endpoint:
   - Open browser: http://localhost:58321/api/health
   - Should show: `{"status":"ok"}`

### Port already in use

**Symptoms:** VM starts but port 58321 is busy

**Solution:**
1. Stop other applications using port 58321
2. Or stop the VM and restart:
   ```cmd
   scripts\stop-virtualbox.cmd
   scripts\start-virtualbox-headless.cmd
   ```

### After moving installation to different drive

**Symptoms:** VM won't start after moving the app folder

**Solution:** The scripts auto-detect the new location, but if issues persist:
```cmd
scripts\ensure-vm-paths.cmd
```

This updates the ISO path and log file path automatically.

## Moving Your Installation

The Photobooth system is **location-independent**. You can:

1. Copy the entire folder to a new location
2. Run `scripts\ensure-vm-paths.cmd` to update paths
3. Start the VM normally

Or simply run `setup-vm.cmd` and choose option 1 to update paths.

## Updating

When you receive an updated version:

### If the app was updated:
- Just replace `Photobooth_IPH.exe`
- No VM changes needed

### If the Linux VM was updated:
1. Stop the running VM:
   ```cmd
   scripts\stop-virtualbox.cmd
   ```
2. Replace `linux-build\photobooth.iso` with the new version
3. Run the path fixer to attach the new ISO:
   ```cmd
   scripts\ensure-vm-paths.cmd
   ```
4. Start the VM:
   ```cmd
   scripts\start-virtualbox-headless.cmd
   ```

## Advanced Configuration

### Changing VM Memory

Default: 1 GB (1024 MB)

To change:
```cmd
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" modifyvm PhotoboothLinux --memory 2048
```
(Replace 2048 with desired MB)

### Changing API Port

The VM forwards port 8080 (inside VM) to 58321 (Windows).

To change the Windows port to 58322:
```cmd
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" modifyvm PhotoboothLinux --natpf1 delete "photoboothapi"
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" modifyvm PhotoboothLinux --natpf1 "photoboothapi,tcp,,58322,,8080"
```

Then update your app configuration to use the new port.

## Uninstallation

To completely remove the VM:

1. Stop the VM:
   ```cmd
   scripts\stop-virtualbox.cmd
   ```

2. Delete the VM:
   ```cmd
   "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" unregistervm PhotoboothLinux --delete
   ```

3. Delete log files (optional):
   ```cmd
   rmdir /s "%LOCALAPPDATA%\Photobooth_IPH"
   ```

4. Delete the application folder

5. Uninstall VirtualBox (optional) via Windows Settings

## Technical Details

For developers and advanced users, see:
- [VM-PRODUCTION-GUIDE.md](VM-PRODUCTION-GUIDE.md) - Complete technical documentation
- [README.md](README.md) - Development guide

### VM Configuration Summary

- **VM Name:** PhotoboothLinux
- **OS Type:** Linux 64-bit
- **Memory:** 1024 MB (1 GB)
- **CPUs:** 1
- **Video Memory:** 8 MB
- **Storage:** Boot from ISO (no disk needed)
- **Network:** NAT with port forwarding
- **Serial Port:** COM1, logged to AppData
- **ISO Location:** `<install-dir>\linux-build\photobooth.iso`
- **Log Location:** `%LOCALAPPDATA%\Photobooth_IPH\logs\vbox-console.log`

## Getting Help

If you encounter issues not covered in this guide:

1. Check the console log:
   ```cmd
   type "%LOCALAPPDATA%\Photobooth_IPH\logs\vbox-console.log"
   ```

2. Verify VM status:
   ```cmd
   "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" showvminfo PhotoboothLinux
   ```

3. Report issues with:
   - Your Windows version
   - VirtualBox version
   - Error messages from console log
   - Steps to reproduce the problem

---

**Note:** This setup process is designed to be simple and automatic. Most users will only need to run `scripts\setup-vm.cmd` once and then use the main application normally.
