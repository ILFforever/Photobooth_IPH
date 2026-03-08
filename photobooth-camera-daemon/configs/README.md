# Buildroot Rebuild Files

This directory contains all the configuration needed to rebuild the Buildroot environment on a new PC.

## Files

| File | Purpose | Destination in Buildroot |
|------|---------|--------------------------|
| `buildroot-board-files/photobooth_defconfig` | Main Buildroot config | `configs/photobooth_defconfig` |
| `buildroot-board-files/linux.config` | Kernel config | `board/photobooth/linux.config` |
| `buildroot-board-files/init` | Init script | `board/photobooth/overlay/init` |
| `setup-buildroot.sh` | Automated setup script | Run on new PC |
| `BUILDROOT_MANIFEST.md` | Full documentation | Reference only |

## Quick Rebuild on New PC

### Option 1: Automated Script

```bash
# Copy this entire configs/ directory to the new PC
cd configs/
chmod +x setup-buildroot.sh
./setup-buildroot.sh
```

### Option 2: Manual Setup

```bash
# 1. Install dependencies
sudo apt-get install -y build-essential libncurses5-dev bc flex bison git rsync cpio unzip zlib1g-dev lz4 libssl-dev wget curl grub2 xorriso

# 2. Clone Buildroot
cd ~
git clone https://gitlab.com/buildroot.org/buildroot.git
cd buildroot
git checkout 2024.02.13

# 3. Create board directory
mkdir -p board/photobooth/overlay/opt/photobooth

# 4. Copy config files from buildroot-board-files/
cp buildroot-board-files/photobooth_defconfig configs/
cp buildroot-board-files/linux.config board/photobooth/
cp buildroot-board-files/init board/photobooth/overlay/
chmod +x board/photobooth/overlay/init

# 5. Load config and build
make BR2_DEF_CONFIG=configs/photobooth_defconfig defconfig
make -j$(nproc)
```

## After Build

Output files will be in:
- `~/buildroot/output/images/bzImage` - Kernel
- `~/buildroot/output/images/rootfs.cpio.xz` - Root filesystem

## Overlay Binaries

The overlay expects these binaries in `/opt/photobooth/`:

1. **camera-daemon** - Rust daemon (build from `photobooth-camera-daemon/`)
2. **gphoto2-wrapper** - C wrapper (build from `linux-build/`)
3. **gphoto2-controller** - C controller (build from `linux-build/`)

These are copied during the `package-rootfs.sh` script execution.
