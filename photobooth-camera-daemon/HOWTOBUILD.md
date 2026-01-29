# Photobooth Linux VM - Build Guide

This document covers how to build the custom Linux VM for the photobooth camera daemon.

## Overview

The photobooth VM consists of:
- **Buildroot Linux** - Minimal x86_64 Linux distribution
- **gphoto2-wrapper** - C wrapper around libgphoto2 for camera operations
- **camera-daemon** - Rust HTTP server providing REST API for camera control

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
│   │   └── gphoto2-wrapper.c
│   └── Cargo.toml                   # Rust dependencies
│
├── scripts/                         # Build & VM scripts
│   ├── rebuild-wrapper.sh           # Compiles gphoto2-wrapper.c
│   ├── package-rootfs.sh            # Copies binaries to overlay, rebuilds rootfs + ISO
│   ├── rebuild-all.sh               # Full rebuild (wrapper + daemon + rootfs + ISO)
│   ├── start-virtualbox-headless.cmd # Start VM headless (Windows)
│   ├── start-virtualbox-gui.cmd     # Start VM with GUI (Windows)
│   ├── stop-virtualbox.cmd          # Stop VM (Windows)
│   └── show-console.cmd             # Show VM console (Windows)
│
└── linux-build/                     # Build outputs
    ├── gphoto2-wrapper              # Compiled C wrapper
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
1. Compiles `gphoto2-wrapper.c` using the Buildroot cross-compiler
2. Builds `camera-daemon` with Cargo (`--target x86_64-unknown-linux-musl`)
3. Copies binaries to the Buildroot overlay, rebuilds rootfs, and creates the ISO

After the rebuild, restart the VM and the new code will be loaded.

## Building - Individual Steps

### 1. Rebuild gphoto2-wrapper only

```bash
wsl.exe -d Ubuntu-24.04 -e bash '/mnt/c/Users/Asus/Desktop/New folder/Photobooth_IPH/scripts/rebuild-wrapper.sh'
```

This compiles `gphoto2-wrapper.c` with the Buildroot cross-compiler, strips the binary, and copies it to `linux-build/`.

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
```

### VM Configuration

- **Type:** Linux, Other Linux (64-bit)
- **Memory:** 512 MB
- **Network:** NAT with port forwarding (Host 3000 -> Guest 3000)
- **USB:** USB 2.0 (EHCI) controller enabled, with device filter for your camera
- **Storage:** `photobooth.iso` mounted as CD/DVD
- **Serial:** Console output on ttyS0 at 115200 baud

## Testing the API

Once the VM is running:

```bash
# Health check
curl http://localhost:3000/api/health

# List cameras
curl http://localhost:3000/api/cameras

# Get camera configuration
curl http://localhost:3000/api/camera/config

# Capture photo
curl -X POST http://localhost:3000/api/capture

# Download photo
curl http://localhost:3000/api/photo/DSCF0001.jpg --output photo.jpg

# Delete photo from VM
curl -X DELETE http://localhost:3000/api/photo/DSCF0001.jpg
```

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
- Check VM console output

**Daemon not responding:**
- Check VM is running: `curl http://localhost:3000/api/health`
- Verify port forwarding: Host 3000 -> Guest 3000
- Check daemon logs in VM console

## API Endpoints Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check, returns libgphoto2 status |
| `/api/cameras` | GET | List connected cameras |
| `/api/capture` | POST | Trigger photo capture |
| `/api/debug` | GET | Camera debug info (model, capabilities) |
| `/api/camera/config` | GET | Current camera settings (ISO, aperture, etc.) |
| `/api/status` | GET | Daemon status |
| `/api/photo/{filename}` | GET | Download captured image |
| `/api/photo/{filename}` | DELETE | Delete image from VM |
