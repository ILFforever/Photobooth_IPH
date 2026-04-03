#!/bin/bash
# Rebuild gphoto2-wrapper and gphoto2-controller for x86_64 photobooth-linux

set -e

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
BUILDROOT="$HOME/buildroot"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRAPPER_DIR="${PROJECT_ROOT}/photobooth-camera-daemon/gphoto2-wrapper"

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

# Compile common modules (shared by wrapper and controller)
echo "Compiling common modules..."
$CC "${WRAPPER_DIR}/common/camera-brand.c" \
    -c -fPIC -o camera-brand.o
echo "  camera-brand.o"

$CC "${WRAPPER_DIR}/common/widget_ops.c" \
    -c -fPIC -o widget_ops.o
echo "  widget_ops.o"

echo

# Compile wrapper-specific modules
echo "Compiling wrapper-specific modules..."
$CC "${WRAPPER_DIR}/wrapper/wrapper_open.c" \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
    -c -fPIC -o wrapper_open.o
echo "  wrapper_open.o"

$CC "${WRAPPER_DIR}/wrapper/wrapper_capture.c" \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
    -c -fPIC -o wrapper_capture.o
echo "  wrapper_capture.o"

$CC "${WRAPPER_DIR}/wrapper/wrapper_config.c" \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
    -c -fPIC -o wrapper_config.o
echo "  wrapper_config.o"

$CC "${WRAPPER_DIR}/wrapper/wrapper_status.c" \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
    -c -fPIC -o wrapper_status.o
echo "  wrapper_status.o"

$CC "${WRAPPER_DIR}/wrapper/wrapper_widgets.c" \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
    -c -fPIC -o wrapper_widgets.o
echo "  wrapper_widgets.o"

echo

# Compile controller-specific modules
echo "Compiling controller-specific modules..."
$CC "${WRAPPER_DIR}/controller/camera_open.c" \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
    -c -fPIC -o camera_open.o
echo "  camera_open.o"

$CC "${WRAPPER_DIR}/controller/camera_storage.c" \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
    -c -fPIC -o camera_storage.o
echo "  camera_storage.o"

$CC "${WRAPPER_DIR}/controller/camera_capture.c" \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
    -c -fPIC -o camera_capture.o
echo "  camera_capture.o"

$CC "${WRAPPER_DIR}/controller/camera_preview.c" \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
    -c -fPIC -o camera_preview.o
echo "  camera_preview.o"

$CC "${WRAPPER_DIR}/controller/camera_config.c" \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
    -c -fPIC -o camera_config.o
echo "  camera_config.o"

$CC "${WRAPPER_DIR}/controller/camera_filemgmt.c" \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
    -c -fPIC -o camera_filemgmt.o
echo "  camera_filemgmt.o"

$CC "${WRAPPER_DIR}/controller/streaming.c" \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
    -c -fPIC -o streaming.o
echo "  streaming.o"

echo

# Compile gphoto2-wrapper
echo "Compiling gphoto2-wrapper..."
$CC "${WRAPPER_DIR}/gphoto2-wrapper.c" \
    camera-brand.o widget_ops.o \
    wrapper_open.o wrapper_capture.o wrapper_config.o wrapper_status.o wrapper_widgets.o \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
    -I"$SYSROOT/usr/include/gphoto2" \
    -L"$SYSROOT/usr/lib" \
    -lgphoto2 \
    -lgphoto2_port \
    -o gphoto2-wrapper

$STRIP gphoto2-wrapper
echo "Built: gphoto2-wrapper"
ls -lh gphoto2-wrapper
echo

# Compile gphoto2-controller
echo "Compiling gphoto2-controller..."
$CC "${WRAPPER_DIR}/gphoto2-controller.c" \
    camera-brand.o widget_ops.o \
    camera_open.o camera_storage.o camera_capture.o camera_preview.o \
    camera_config.o camera_filemgmt.o \
    -I"${WRAPPER_DIR}" -I"${WRAPPER_DIR}/common" \
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
