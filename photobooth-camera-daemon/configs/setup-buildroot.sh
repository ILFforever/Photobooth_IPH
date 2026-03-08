#!/bin/bash
# Buildroot Setup Script for Photobooth Project
# Run this on a fresh Ubuntu/Debian WSL or Linux system to set up Buildroot

set -e

echo "=== Photobooth Buildroot Setup ==="
echo

# Detect if running in WSL
if grep -qi microsoft /proc/version 2>/dev/null; then
    echo "Running in WSL - detected!"
    IS_WSL=1
else
    IS_WSL=0
fi

# Check if buildroot already exists
if [ -d "$HOME/buildroot" ]; then
    echo "Buildroot directory already exists at $HOME/buildroot"
    read -p "Continue and overwrite configuration? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Install dependencies
echo "=== Installing dependencies ==="
sudo apt-get update
sudo apt-get install -y \
    build-essential libncurses5-dev libncursesw5-dev \
    bc flex bison git rsync cpio unzip zlib1g-dev \
    lz4 sudo libssl-dev wget curl grub2 grub-pc-bin \
    xorriso mtools linux-base

# Clone Buildroot if it doesn't exist
if [ ! -d "$HOME/buildroot" ]; then
    echo "=== Cloning Buildroot ==="
    cd ~
    git clone https://gitlab.com/buildroot.org/buildroot.git
    cd buildroot
    git checkout 2024.02.13
else
    echo "=== Using existing Buildroot at $HOME/buildroot ==="
    cd ~/buildroot
fi

# Create board configuration directory
echo "=== Creating board configuration ==="
mkdir -p ~/buildroot/board/photobooth/overlay/opt/photobooth

# Determine script location (for Windows paths in WSL)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if we're running from the Windows mount
if [ -d "/mnt/d/Photobooth_IPH" ]; then
    WINDOWS_PROJECT="/mnt/d/Photobooth_IPH"
elif [ "$IS_WSL" = "1" ]; then
    # Try to find the Windows project path
    echo "Note: If your project is on Windows, access it via /mnt/<drive>/<path>"
    WINDOWS_PROJECT=""
else
    WINDOWS_PROJECT="$SCRIPT_DIR/.."
fi

# Copy configuration files
echo "=== Copying configuration files ==="

# Option 1: Copy from the configs directory if running from there
if [ -f "$SCRIPT_DIR/buildroot-board-files/photobooth_defconfig" ]; then
    cp "$SCRIPT_DIR/buildroot-board-files/photobooth_defconfig" ~/buildroot/configs/
    cp "$SCRIPT_DIR/buildroot-board-files/linux.config" ~/buildroot/board/photobooth/
    cp "$SCRIPT_DIR/buildroot-board-files/init" ~/buildroot/board/photobooth/overlay/
    chmod +x ~/buildroot/board/photobooth/overlay/init
    echo "Configuration files copied from: $SCRIPT_DIR/buildroot-board-files/"
else
    echo "Warning: Configuration files not found in $SCRIPT_DIR/buildroot-board-files/"
    echo "Please copy them manually or create them from BUILDROOT_MANIFEST.md"
fi

# Create the overlay structure
echo "=== Creating overlay structure ==="
mkdir -p ~/buildroot/board/photobooth/overlay/opt/photobooth

# Load the defconfig
echo "=== Loading defconfig ==="
cd ~/buildroot
make BR2_DEF_CONFIG=configs/photobooth_defconfig defconfig

echo
echo "=== Setup Complete! ==="
echo
echo "To build Buildroot, run:"
echo "  cd ~/buildroot"
echo "  make -j\$(nproc)"
echo
echo "After building, the output will be in:"
echo "  ~/buildroot/output/images/"
echo "    - bzImage (kernel)"
echo "    - rootfs.cpio.xz (initramfs)"
echo
echo "For project integration, update these paths in your scripts:"
echo "  BUILDROOT=\"\$HOME/buildroot\""
echo "  PROJECT_ROOT=\"/mnt/d/Photobooth_IPH\"  # Adjust if needed"
