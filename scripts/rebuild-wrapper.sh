#!/bin/bash
# Rebuild gphoto2-wrapper and gphoto2-controller for x86_64 photobooth-linux

set -e

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
BUILDROOT="$HOME/buildroot"
PROJECT_ROOT="/mnt/c/Users/Asus/Desktop/New folder/Photobooth_IPH"

echo "Rebuilding gphoto2-wrapper and gphoto2-controller..."
echo "  Buildroot: $BUILDROOT"
echo

cd "$BUILDROOT"

# Set compiler paths
CC="$BUILDROOT/output/host/bin/x86_64-photobooth-linux-gnu-gcc"
STRIP="$BUILDROOT/output/host/bin/x86_64-photobooth-linux-gnu-strip"
SYSROOT="$BUILDROOT/output/host/x86_64-photobooth-linux-gnu/sysroot"

# Check if compiler exists
if [ ! -f "$CC" ]; then
    echo "ERROR: Compiler not found at $CC"
    echo "Build Buildroot toolchain first: cd ~/buildroot && make toolchain"
    exit 1
fi

# Compile gphoto2-wrapper
echo "Compiling gphoto2-wrapper..."
$CC "${PROJECT_ROOT}/photobooth-camera-daemon/gphoto2-wrapper/gphoto2-wrapper.c" \
    -I"$SYSROOT/usr/include/gphoto2" \
    -L"$SYSROOT/usr/lib" \
    -lgphoto2 \
    -lgphoto2_port \
    -o gphoto2-wrapper

$STRIP gphoto2-wrapper
echo "Built: gphoto2-wrapper"
ls -lh gphoto2-wrapper

# Compile gphoto2-controller
echo "Compiling gphoto2-controller..."
$CC "${PROJECT_ROOT}/photobooth-camera-daemon/gphoto2-wrapper/gphoto2-controller.c" \
    -I"$SYSROOT/usr/include/gphoto2" \
    -L"$SYSROOT/usr/lib" \
    -lgphoto2 \
    -lgphoto2_port \
    -o gphoto2-controller

$STRIP gphoto2-controller
echo "Built: gphoto2-controller"
ls -lh gphoto2-controller
echo

# Copy to project linux-build folder
echo "Copying to project..."
mkdir -p "${PROJECT_ROOT}/linux-build"
cp gphoto2-wrapper "${PROJECT_ROOT}/linux-build/"
cp gphoto2-controller "${PROJECT_ROOT}/linux-build/"
echo "Copied to: ${PROJECT_ROOT}/linux-build/"
echo

echo "Done! Now rebuild rootfs:"
echo "  bash ${PROJECT_ROOT}/scripts/package-rootfs.sh"
