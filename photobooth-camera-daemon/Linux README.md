# Photobooth Linux VM - Build Guide

This document covers how to build the custom Linux VM for the photobooth camera daemon.

## Overview

The photobooth VM consists of:
- **Buildroot Linux** - Minimal x86_64 Linux distribution
- **gphoto2-wrapper** - C wrapper around libgphoto2 for one-shot camera operations
- **gphoto2-controller** - Long-running C controller that manages camera connection via named pipes
- **camera-daemon** - Rust HTTP server providing REST API for camera control

## Architecture

### Camera Connection Management

The system uses a **named pipe architecture** for camera control:

1. **gphoto2-controller** (C process) holds the long-running camera connection
   - Opens the camera briefly for each operation, then releases it
   - Polls for new files from physical shutter button presses
   - Accepts commands via `/tmp/camera_cmd` named pipe
   - Writes status/events to `/tmp/camera_status` named pipe

2. **camera-daemon** (Rust HTTP server)
   - Provides REST API to the frontend
   - Forwards capture commands to the controller
   - Broadcasts status events via WebSocket to connected clients

3. **Named Pipe Protocol**
   - Commands (write to `/tmp/camera_cmd`): `CAPTURE`, `STATUS`, `QUIT`
   - Status (read from `/tmp/camera_status`): JSON events like `{"mode":"idle"}`, `{"mode":"capture"}`, `{"type":"photo_downloaded",...}`

This design ensures the camera is only locked when actively in use, allowing the physical shutter button to work normally.

## Prerequisites

### Windows Setup
1. Install WSL2 with Ubuntu 24.04
2. Install VirtualBox on Windows

### WSL2 Setup
```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install basic build tools
sudo apt install -y build-essential git wget rsync

# Install Rust (for building the daemon)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Add musl target for static Rust builds
rustup target add x86_64-unknown-linux-musl
```

## Project Structure

```
Photobooth_IPH/
├── photobooth-camera-daemon/        # Source code
│   ├── src/main.rs                  # Rust daemon source
│   ├── gphoto2-wrapper/             # C wrapper source
│   │   ├── gphoto2-wrapper.c        # One-shot operations
│   │   └── gphoto2-controller.c     # Long-running controller
│   └── Cargo.toml                   # Rust dependencies
│
├── scripts/                         # Build & VM scripts
│   ├── rebuild-wrapper.sh           # Compiles both C wrappers
│   ├── package-rootfs.sh            # Copies binaries to overlay, rebuilds rootfs + ISO
│   ├── rebuild-all.sh               # Full rebuild (wrappers + daemon + rootfs + ISO)
│   ├── start-virtualbox-headless.cmd # Start VM headless (Windows)
│   ├── start-virtualbox-gui.cmd     # Start VM with GUI (Windows)
│   ├── stop-virtualbox.cmd          # Stop VM (Windows)
│   ├── show-console.cmd             # Show VM console (Windows)
│   └── configure-vm-memory.cmd      # Update VM memory (Windows)
│
└── linux-build/                     # Build outputs
    ├── gphoto2-wrapper              # Compiled one-shot wrapper
    ├── gphoto2-controller           # Compiled controller
    ├── photobooth.iso               # Final VM image
    └── rootfs.cpio.xz              # Compressed root filesystem
```

Buildroot lives at `~/buildroot` inside WSL.

## Initial Setup - Buildroot

You only need to do this once:

```bash
# In WSL2
cd ~

# Download Buildroot
wget https://buildroot.org/downloads/buildroot-2024.02.tar.xz
tar xf buildroot-2024.02.tar.xz
mv buildroot-2024.02 buildroot
cd buildroot

# Configure and build the toolchain (this takes a while)
make defconfig
make toolchain
```

The cross-compiler will be at:
```
~/buildroot/output/host/bin/x86_64-photobooth-linux-gnu-gcc
```

## Building - Quick Start

The easiest way to rebuild everything is with the `rebuild-all.sh` script:

```bash
wsl.exe -d Ubuntu-24.04 -e bash '/mnt/c/Users/Asus/Desktop/New folder/Photobooth_IPH/scripts/rebuild-all.sh'
```

This runs all three steps:
1. Compiles both C wrappers (`gphoto2-wrapper.c` and `gphoto2-controller.c`)
2. Builds `camera-daemon` with Cargo (`--target x86_64-unknown-linux-musl`)
3. Copies binaries to the Buildroot overlay, rebuilds rootfs, and creates the ISO

After the rebuild, restart the VM and the new code will be loaded.

## Building - Individual Steps

### 1. Rebuild C wrappers only

```bash
wsl.exe -d Ubuntu-24.04 -e bash '/mnt/c/Users/Asus/Desktop/New folder/Photobooth_IPH/scripts/rebuild-wrapper.sh'
```

This compiles both `gphoto2-wrapper.c` and `gphoto2-controller.c` with the Buildroot cross-compiler, strips the binaries, and copies them to `linux-build/`.

### 2. Rebuild camera-daemon only (Rust)

```bash
wsl.exe -d Ubuntu-24.04 -e bash -c "
  export PATH=\"\$HOME/.cargo/bin:\$HOME/buildroot/output/host/bin:\$PATH\"
  cd '/mnt/c/Users/Asus/Desktop/New folder/Photobooth_IPH/photobooth-camera-daemon'
  cargo build --release --target x86_64-unknown-linux-musl
"
```

### 3. Package rootfs and rebuild ISO only

```bash
wsl.exe -d Ubuntu-24.04 -e bash '/mnt/c/Users/Asus/Desktop/New folder/Photobooth_IPH/scripts/package-rootfs.sh'
```

This copies the built binaries into the Buildroot overlay at `~/buildroot/board/photobooth/overlay/opt/photobooth/`, runs `make` to regenerate the rootfs, then creates the bootable ISO with `grub-mkrescue`.

## VirtualBox VM Management

Use the Windows `.cmd` scripts in `scripts/`:

```cmd
:: Start VM headless (no GUI window)
scripts\start-virtualbox-headless.cmd

:: Start VM with GUI
scripts\start-virtualbox-gui.cmd

:: Stop VM
scripts\stop-virtualbox.cmd

:: Show console output
scripts\show-console.cmd

:: Update VM memory (requires VM to be stopped)
scripts\configure-vm-memory.cmd
```

### VM Configuration

- **Type:** Linux, Other Linux (64-bit)
- **Memory:** 1024 MB (1 GB) - Use `scripts\configure-vm-memory.cmd` to update
- **Network:** NAT with port forwarding (Host 58321 -> Guest 3000)
- **USB:** USB 2.0 (EHCI) controller enabled, with device filter for your camera
- **Storage:** `photobooth.iso` mounted as CD/DVD
- **Serial:** Console output on ttyS0 at 115200 baud

## Testing the API

Once the VM is running:

```bash
# Health check
curl http://localhost:58321/api/health

# List cameras
curl http://localhost:58321/api/cameras

# Get camera configuration (uses camera 0 by default)
curl http://localhost:58321/api/camera/config

# Get configuration for specific camera (e.g., camera 1)
curl http://localhost:58321/api/camera/config?camera=1

# Capture photo from default camera (0)
curl -X POST http://localhost:58321/api/capture

# Capture from specific camera
curl -X POST http://localhost:58321/api/capture?camera=1

# Set camera configuration (JSON format)
curl -X POST http://localhost:58321/api/camera/config -H "Content-Type: application/json" -d "{\"setting\":\"iso\",\"value\":\"800\"}

# Set camera configuration (form data format)
curl -X POST http://localhost:58321/api/camera/config -d "iso=800"

# Get quick status (battery, ISO, shutter, aperture, focus, white balance, etc.)
curl http://localhost:58321/api/camera/status

# Download photo
curl http://localhost:58321/api/photo/DSCF0001.jpg --output photo.jpg

# Delete photo from VM
curl -X DELETE http://localhost:58321/api/photo/DSCF0001.jpg
```

### Multi-Camera Support

The API supports multiple cameras via the `camera` query parameter:

1. First, list all connected cameras:
   ```bash
   curl http://localhost:58321/api/cameras
   # Returns: [{"id":"0","model":"Fujifilm X-H2","port":"usb:001,004"}, ...]
   ```

2. Use the `camera` parameter to specify which camera to operate on:
   ```bash
   # Use camera 0 (first/default)
   curl http://localhost:58321/api/camera/config?camera=0
   curl -X POST http://localhost:58321/api/capture?camera=0

   # Use camera 1 (second camera)
   curl http://localhost:58321/api/camera/config?camera=1
   curl -X POST http://localhost:58321/api/capture?camera=1
   ```

The frontend is responsible for managing which camera is active and passing the appropriate `camera` parameter to each request.

## WebSocket Events

The WebSocket endpoint at `/ws` broadcasts status events to all connected clients.

### Event Types

**Mode Changes:**
```json
{"mode":"idle"}
{"mode":"capture"}
```

**Photo Downloaded:**
```json
{"type":"photo_downloaded","file_path":"/tmp/DSCF0042.JPG","camera_path":"/store_10000001/DSCF0042.JPG"}
```

### Example WebSocket Client (Browser Console)

```javascript
const ws = new WebSocket("ws://localhost:58321/ws");

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("Event:", data);

  if (data.type === "photo_downloaded") {
    console.log("New photo:", data.file_path);
    // Fetch and display the photo
    fetch(`http://localhost:58321/api/photo/${data.file_path.split('/').pop()}`)
      .then(r => r.blob())
      .then(blob => {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(blob);
        document.body.appendChild(img);
      });
  }
};
```

## Camera Control Features

### Physical Shutter Button Support

The controller automatically detects and downloads photos taken with the physical shutter button:
- Polls camera every 2 seconds for new files
- Downloads new photos to `/tmp`
- Emits `photo_downloaded` events via WebSocket
- Deletes photos from camera after successful download

### Camera Configuration

The daemon supports reading and writing camera settings:
- **ISO**: Auto, 100-102400 (camera-dependent)
- **Shutter Speed**: 30s to 1/8000 (camera-dependent)
- **Aperture**: f/1.0 to f/64 (camera-dependent)
- **White Balance**: Auto, Daylight, Cloudy, Tungsten, Fluorescent, Flash, Custom
- **Exposure Compensation**: -2.0 to +2.0 EV
- **Image Format**: RAW, JPEG, RAW+JPEG (camera-dependent)

Use `/api/widgets` to enumerate all available configuration widgets for your camera.

### Storage Management

The system automatically manages storage space:
- Monitors available disk space in `/tmp`
- Automatically deletes oldest photos when space is low
- Ensures at least 50 MB free space before captures
- Runs cleanup every 30 seconds

## Troubleshooting

### VS Code Terminal (Git Bash) Path Mangling

If you run WSL commands from VS Code's integrated terminal, it typically uses **Git Bash**, which automatically rewrites `/mnt/...` paths to `C:/Program Files/Git/mnt/...` before WSL ever sees them. This breaks all script invocations.

```bash
# BROKEN - Git Bash rewrites the /mnt/c/ path
wsl -d Ubuntu-24.04 bash "/mnt/c/Users/Asus/Desktop/New folder/Photobooth_IPH/scripts/rebuild-all.sh"

# WORKS - wsl.exe -e bypasses Git Bash path mangling
wsl.exe -d Ubuntu-24.04 -e bash -c "bash '/mnt/c/Users/Asus/Desktop/New folder/Photobooth_IPH/scripts/rebuild-all.sh'"
```

The key is `wsl.exe -e`, which passes arguments directly to the Linux side. The inner single quotes handle the space in "New folder".

Alternatively, run from **cmd** or **PowerShell** instead of Git Bash to avoid the issue entirely.

### Build Issues

**Cross-compiler not found:**
```bash
# Verify Buildroot toolchain exists
ls ~/buildroot/output/host/bin/x86_64-photobooth-linux-gnu-gcc

# If missing, rebuild toolchain
cd ~/buildroot && make toolchain
```

**Rust cross-compilation fails:**
```bash
# Verify musl target is installed
rustup target list --installed | grep musl

# If missing
rustup target add x86_64-unknown-linux-musl
```

### Runtime Issues

**Camera not detected:**
- Check USB passthrough is enabled in VirtualBox
- Verify camera USB filters are correct
- Check VM console output for "Waiting for camera..." message
- The controller will retry for up to 60 seconds at startup

**Daemon not responding:**
- Check VM is running: `curl http://localhost:58321/api/health`
- Verify port forwarding: Host 58321 -> Guest 58321
- Check daemon logs in VM console

**Capture command times out:**
- The controller will retry camera open up to 5 times with exponential backoff
- Check console logs for retry attempts
- Physical shutter button should still work if USB connection is healthy

**Camera "Access Denied" errors:**
- This can happen if the camera is held open too long
- The controller automatically releases the camera after each operation
- If the issue persists, check that no other process is accessing the camera

## API Endpoints Reference

| Endpoint | Method | Query Params | Body | Description |
|----------|--------|--------------|------|-------------|
| `/api/health` | GET | - | - | Health check, returns libgphoto2 status |
| `/api/cameras` | GET | - | - | List connected cameras |
| `/api/capture` | POST | `camera` (optional) | - | Trigger photo capture from specified camera (default: 0) |
| `/api/debug` | GET | `camera` (optional) | - | Camera debug info for specified camera (default: 0) |
| `/api/camera/config` | GET | `camera` (optional) | - | Current camera settings for specified camera (default: 0) |
| `/api/camera/config` | POST | `camera` (optional) | JSON or form data | Set camera setting (e.g., `{"setting":"iso","value":"800"}` or `iso=800`) |
| `/api/camera/status` | GET | `camera` (optional) | - | Quick status check (battery, ISO, shutter, aperture, focus, white balance, etc.) for specified camera (default: 0) |
| `/api/status` | GET | - | - | Daemon status |
| `/api/widgets` | GET | `camera` (optional) | - | List all config widgets for specified camera (default: 0) |
| `/api/photo/{filename}` | GET | - | - | Download captured image |
| `/api/photo/{filename}` | DELETE | - | - | Delete image from VM |
| `/ws` | WebSocket | - | - | WebSocket endpoint for status events (mode changes, photo downloads) |

## Key Implementation Notes

### Camera Exclusivity

USB PTP only allows one process to hold the camera connection at a time. The controller manages this by:
1. Opening the camera only when needed (capture or polling)
2. Releasing the camera immediately after the operation
3. Using retry logic with exponential backoff for failed opens

This means other camera commands will briefly conflict with whichever operation holds the camera, but the camera is released quickly.

### Fuji Camera Quirks

Some Fuji cameras (like the X-H2) return an error when triggering capture via software, but the photo is actually taken. The controller handles this by treating the error as success and letting the polling loop pick up the files.

### Named Pipes

The system uses two named pipes for communication:
- `/tmp/camera_cmd` - Command input (write-only, non-blocking)
- `/tmp/camera_status` - Status output (write-only, blocking until reader connects)

Both pipes are recreated when the controller starts up.
