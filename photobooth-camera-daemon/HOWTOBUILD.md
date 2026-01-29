# Photobooth Linux VM - Build Guide

This document covers how to build the custom Linux VM for the photobooth camera daemon.

## Overview

The photobooth VM consists of:
- **Buildroot Linux** - Minimal Linux distribution
- **gphoto2-wrapper** - C wrapper around libgphoto2 for camera operations
- **camera-daemon** - Rust HTTP server providing REST API for camera control

## Prerequisites

### Windows Setup
1. Install WSL2 (Ubuntu recommended)
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
```

## Project Structure

```
photobooth-iph/
├── photobooth-camera-daemon/     # Source code
│   ├── src/main.rs               # Rust daemon source
│   ├── gphoto2-wrapper/          # C wrapper source
│   │   └── gphoto2-wrapper.c
│   └── Cargo.toml                # Rust dependencies
│
└── linux-build/                  # Build outputs
    ├── buildroot/                # Buildroot SDK (downloaded separately)
    ├── photobooth.iso            # Final VM image
    └── rootfs.cpio.xz            # Compressed root filesystem
```

## Initial Setup - Buildroot

### 1. Download Buildroot

You only need to do this once:

```bash
# In WSL2, navigate to linux-build
cd /mnt/c/Users/Asus/Desktop/New\ folder/Photobooth_IPH/linux-build

# Download Buildroot (version matching your kernel)
wget https://buildroot.org/downloads/buildroot-2024.02.tar.xz

# Extract
tar xf buildroot-2024.02.tar.xz
cd buildroot-2024.02

# Configure for i386 (matching VirtualBox VM)
make defconfig
```

### 2. Build Buildroot SDK

This builds the cross-compiler toolchain:

```bash
# Build the toolchain (takes a while)
make toolchain

# The cross-compiler will be at:
# ./output/host/bin/i386-linux-gcc
```

## Building Components

### 1. Build gphoto2-wrapper (C)

```bash
# In WSL2, from linux-build directory
cd /mnt/c/Users/Asus/Desktop/New\ folder/Photobooth_IPH/linux-build

# Set the cross-compiler path
export BUILDROOT=/mnt/c/Users/Asus/Desktop/New\ folder/Photobooth_IPH/linux-build/buildroot-2024.02
export CC="$BUILDROOT/output/host/bin/i386-linux-gcc"
export STRIP="$BUILDROOT/output/host/bin/i386-linux-strip"

# Compile gphoto2-wrapper (from source in photobooth-camera-daemon)
$CC -static \
  ../photobooth-camera-daemon/gphoto2-wrapper/gphoto2-wrapper.c \
  -I$BUILDROOT/output/host/include/gphoto2 \
  -lgphoto2 \
  -lgphoto2_port \
  -o gphoto2-wrapper

# Strip to reduce size
$STRIP gphoto2-wrapper
```

### 2. Build camera-daemon (Rust)

```bash
# In WSL2, from linux-build directory
cd /mnt/c/Users/Asus/Desktop/New\ folder/Photobooth_IPH/linux-build

# Add i386 target for Rust
rustup target add i686-unknown-linux-gnu

# Create .cargo/config.toml for cross-compilation
mkdir -p ../photobooth-camera-daemon/.cargo
cat > ../photobooth-camera-daemon/.cargo/config.toml << 'EOF'
[target.i686-unknown-linux-gnu]
linker = "/mnt/c/Users/Asus/Desktop/New folder/Photobooth_IPH/linux-build/buildroot-2024.02/output/host/bin/i386-linux-gcc"
rustflags = ["-C", "link-args=-static"]
EOF

# Build for i386
cd ../photobooth-camera-daemon
cargo build --release --target i686-unknown-linux-gnu

# The binary will be at:
# target/i686-unknown-linux-gnu/release/camera-daemon
```

## Creating the Root Filesystem

### 1. Create Directory Structure

```bash
cd /mnt/c/Users/Asus/Desktop/New\ folder/Photobooth_IPH/linux-build

# Create rootfs structure
mkdir -p rootfs/opt/photobooth
mkdir -p rootfs/dev
mkdir -p rootfs/proc
mkdir -p rootfs/sys
mkdir -p rootfs/tmp
mkdir -p rootfs/bin
mkdir -p rootfs/lib
mkdir -p rootfs/etc

# Copy built binaries
cp ../photobooth-camera-daemon/target/i686-unknown-linux-gnu/release/camera-daemon rootfs/opt/photobooth/
cp gphoto2-wrapper rootfs/opt/photobooth/

# Copy necessary libraries from Buildroot
cp $BUILDROOT/output/host/lib/libgphoto2*.so* rootfs/lib/ 2>/dev/null || true
cp $BUILDROOT/output/host/lib/libgphoto2_port*.so* rootfs/lib/ 2>/dev/null || true
cp $BUILDROOT/output/staging/lib/libc.so.6 rootfs/lib/ 2>/dev/null || true
cp $BUILDROOT/output/staging/lib/ld-linux*.so.* rootfs/lib/ 2>/dev/null || true

# Or build static binaries to avoid library issues:
# Use -static flag in compilation
```

### 2. Create Init Script

```bash
cat > rootfs/init << 'EOF'
#!/bin/sh

# Mount filesystems
mount -t proc none /proc
mount -t sysfs none /sys
mount -t devtmpfs none /dev

echo "Photobooth Linux starting..."

# Set up network
/sbin/ip link set lo up
/sbin/ip link set eth0 up
/sbin/ip addr add 10.0.2.15/24 dev eth0

echo "Network configured:"
/sbin/ip addr show eth0

# Start camera daemon
echo "Starting camera daemon..."
/opt/photobooth/camera-daemon &

# Provide shell on console
exec /bin/sh
EOF

chmod +x rootfs/init
```

### 3. Create Busybox

If you need basic commands (ip, sh, etc.):

```bash
# Build busybox in Buildroot or download static binary
wget https://busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox
chmod +x busybox

# Create symlinks in rootfs/bin
cd rootfs/bin
ln -s /busybox sh
cd ../..
```

## Creating the ISO

### 1. Package Root Filesystem

```bash
cd /mnt/c/Users/Asus/Desktop/New\ folder/Photobooth_IPH/linux-build

# Create the cpio archive
cd rootfs
find . | cpio -o -H newc | xz -9 --check=crc32 > ../rootfs.cpio.xz
cd ..
```

### 2. Create ISO Structure

```bash
# Create ISO directory
mkdir -p iso/boot

# Copy kernel (reuse existing or build new in Buildroot)
cp linux-build/kernel iso/boot/vmlinuz  # or use existing
cp rootfs.cpio.xz iso/boot/initramfs.xz

# Create ISO with xorriso or genisoimage
genisoimage -o photobooth.iso \
  -b boot/isolinux/isolinux.bin \
  -c boot/isolinux/boot.cat \
  -no-emul-boot \
  -boot-load-size 4 \
  -boot-info-table \
  iso/

# Or simpler: just use the kernel directly in VirtualBox
# VirtualBox can boot kernel + initrd directly without ISO
```

## Alternative: Using Existing Kernel

The project already has a working kernel. To rebuild the root filesystem only:

```bash
cd /mnt/c/Users/Asus/Desktop/New\ folder/Photobooth_IPH/linux-build

# After building new binaries, recreate rootfs.cpio.xz
cd rootfs
find . | cpio -o -H newc | xz -9 --check=crc32 > ../rootfs.cpio.xz

# Copy to VirtualBox shared folder or mount location
```

## VirtualBox Setup

### VM Configuration

1. Create new VM in VirtualBox:
   - Name: Photobooth Linux
   - Type: Linux
   - Version: Other Linux (32-bit)
   - Base Memory: 512 MB
   - Boot order: EFI disabled, enable PXE boot if needed

2. Network Settings:
   - NAT
   - Port Forwarding: Host 3000 → Guest 3000

3. USB Settings:
   - Enable USB 2.0 (EHCI) Controller
   - Add USB Device Filter for your camera

4. Storage:
   - Mount `photobooth.iso` as CD/DVD
   - Or boot directly with kernel/initrd

### Booting the VM

```bash
# In Windows, using VBoxManage
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" startvm "Photobooth Linux"

# Monitor console output
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" controlvm "Photobooth Linux" screenshotout console.png
```

Or use the serial console logging:
```bash
# Redirect serial port to file
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" modifyvm "Photobooth Linux" --uartmode1 client vbox-console.log
```

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

# Download photo (response includes filename)
curl http://localhost:3000/api/photo/DSCF0001.jpg --output photo.jpg

# Delete photo from VM
curl -X DELETE http://localhost:3000/api/photo/DSCF0001.jpg
```

## Troubleshooting

### Build Issues

**Cross-compiler not found:**
```bash
# Verify Buildroot toolchain exists
ls $BUILDROOT/output/host/bin/i386-linux-gcc
```

**Rust cross-compilation fails:**
```bash
# Verify target is installed
rustup target list | grep i686

# Check .cargo/config.toml syntax
cat ../photobooth-camera-daemon/.cargo/config.toml
```

### Runtime Issues

**Camera not detected:**
- Check USB passthrough is enabled in VirtualBox
- Verify camera USB filters are correct
- Check VM logs: `tail -f vbox-console.log`

**Daemon not responding:**
- Check VM is running: `curl http://localhost:3000/api/health`
- Verify port forwarding: Host 3000 → Guest 3000
- Check daemon logs in VM console

### Rebuilding After Changes

```bash
# 1. Rebuild C wrapper
$CC -static ../photobooth-camera-daemon/gphoto2-wrapper/gphoto2-wrapper.c \
  -I$BUILDROOT/output/host/include/gphoto2 \
  -lgphoto2 -lgphoto2_port -o gphoto2-wrapper

# 2. Rebuild Rust daemon
cd ../photobooth-camera-daemon
cargo build --release --target i686-unknown-linux-gnu

# 3. Copy to rootfs
cd ../linux-build
cp ../photobooth-camera-daemon/target/i686-unknown-linux-gnu/release/camera-daemon rootfs/opt/photobooth/
cp gphoto2-wrapper rootfs/opt/photobooth/

# 4. Repackage rootfs
cd rootfs
find . | cpio -o -H newc | xz -9 --check=crc32 > ../rootfs.cpio.xz

# 5. Restart VM with new rootfs
```

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
