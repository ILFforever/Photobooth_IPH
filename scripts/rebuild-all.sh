#!/bin/bash
# Full rebuild: gphoto2-wrapper, camera-daemon (Rust), rootfs, and ISO
# Run this from Windows via: wsl -d Ubuntu-24.04 bash "/mnt/c/.../scripts/rebuild-all.sh"

set -e

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
BUILDROOT="$HOME/buildroot"
PROJECT_ROOT="/mnt/c/Users/Asus/Desktop/New folder/Photobooth_IPH"

echo "=== Full Photobooth Linux Rebuild ==="
echo

# 1. Build gphoto2-wrapper
echo "=== 1. Building gphoto2-wrapper ==="
bash "$PROJECT_ROOT/scripts/rebuild-wrapper.sh"
echo

# 2. Build camera-daemon (Rust)
echo "=== 2. Building camera-daemon (Rust) ==="
export PATH="$HOME/.cargo/bin:$HOME/buildroot/output/host/bin:$PATH"
cd "$PROJECT_ROOT/photobooth-camera-daemon"
cargo build --release --target x86_64-unknown-linux-musl
echo "Built: target/x86_64-unknown-linux-musl/release/photobooth-camera-daemon"
echo

# 3. Package rootfs and ISO
echo "=== 3. Packaging rootfs and building ISO ==="
bash "$PROJECT_ROOT/scripts/package-rootfs.sh"

echo
echo "=== Full rebuild complete! ==="
echo "Restart the VM to use the new ISO."
