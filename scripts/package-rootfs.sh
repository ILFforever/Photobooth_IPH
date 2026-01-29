#!/bin/bash
# Package rootfs and rebuild ISO
# This copies binaries to Buildroot overlay, rebuilds rootfs, and creates ISO

set -e

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
BUILDROOT="$HOME/buildroot"
PROJECT_ROOT="/mnt/c/Users/Asus/Desktop/New folder/Photobooth_IPH"
LINUX_BUILD="$PROJECT_ROOT/linux-build"

echo "=== Packaging Rootfs and Rebuilding ISO ==="
echo

# Ensure overlay directory exists
mkdir -p "$BUILDROOT/board/photobooth/overlay/opt/photobooth"

# Copy gphoto2-wrapper from linux-build (built by rebuild-wrapper.sh)
if [ -f "$LINUX_BUILD/gphoto2-wrapper" ]; then
    echo "Copying gphoto2-wrapper to overlay..."
    cp "$LINUX_BUILD/gphoto2-wrapper" "$BUILDROOT/board/photobooth/overlay/opt/photobooth/"
    chmod +x "$BUILDROOT/board/photobooth/overlay/opt/photobooth/gphoto2-wrapper"
else
    echo "WARNING: gphoto2-wrapper not found in $LINUX_BUILD"
    echo "Run rebuild-wrapper.sh first!"
fi

# Copy camera-daemon if it exists (built separately)
if [ -f "$PROJECT_ROOT/photobooth-camera-daemon/target/x86_64-unknown-linux-musl/release/photobooth-camera-daemon" ]; then
    echo "Copying camera-daemon to overlay..."
    cp "$PROJECT_ROOT/photobooth-camera-daemon/target/x86_64-unknown-linux-musl/release/photobooth-camera-daemon" \
       "$BUILDROOT/board/photobooth/overlay/opt/photobooth/camera-daemon"
    chmod +x "$BUILDROOT/board/photobooth/overlay/opt/photobooth/camera-daemon"
else
    echo "WARNING: camera-daemon not found"
    echo "Build it with: cd $PROJECT_ROOT/photobooth-camera-daemon && cargo build --release --target x86_64-unknown-linux-musl"
fi

echo
echo "Overlay contents:"
ls -la "$BUILDROOT/board/photobooth/overlay/opt/photobooth/"

# Rebuild rootfs with Buildroot
echo
echo "=== Rebuilding rootfs with Buildroot ==="
cd "$BUILDROOT"
make 2>&1 | tail -20

# Copy rootfs to Windows
echo
echo "=== Copying rootfs to Windows ==="
mkdir -p "$LINUX_BUILD"
cp "$BUILDROOT/output/images/rootfs.cpio.xz" "$LINUX_BUILD/rootfs.cpio.xz"

# Build ISO
echo
echo "=== Building ISO ==="
export PATH="$BUILDROOT/output/host/bin:$PATH"

ISODIR=$(mktemp -d /tmp/iso_build.XXXXXX)
mkdir -p "$ISODIR/boot/grub"
cp "$BUILDROOT/output/images/bzImage" "$ISODIR/vmlinuz"
cp "$BUILDROOT/output/images/rootfs.cpio.xz" "$ISODIR/initrd.xz"

cat > "$ISODIR/boot/grub/grub.cfg" <<'GRUBEOF'
set default=0
set timeout=3
menuentry "Photobooth Linux" {
    linux /vmlinuz console=tty0 console=ttyS0,115200 earlyprintk=ttyS0,115200
    initrd /initrd.xz
}
GRUBEOF

grub-mkrescue -o "$LINUX_BUILD/photobooth.iso" "$ISODIR" 2>&1 | grep -E "(ISO image|Written|sectors)" || true
rm -rf "$ISODIR"

echo
echo "=== Done ==="
ls -la "$LINUX_BUILD/photobooth.iso"
echo
echo "To start VM (from Windows): ${PROJECT_ROOT}/scripts/start-virtualbox-headless.cmd"
