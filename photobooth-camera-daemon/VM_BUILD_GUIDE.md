# Photobooth VM - Complete Build Guide

Complete guide to set up the build environment and build the Photobooth Linux VM from scratch.

## What This Builds

The VM is a minimal Buildroot Linux that runs inside VirtualBox. It contains:

- **gphoto2-controller** - C process that manages the camera connection via named pipes
- **gphoto2-wrapper** - C binary for one-shot camera operations
- **camera-daemon** - Rust HTTP server that provides a REST API + WebSocket for the frontend

## Quick Summary

| Item | Value |
|------|-------|
| Buildroot | **2024.02.13** (git tag) |
| Kernel | **6.6.84** |
| Architecture | **x86_64** |
| Toolchain | GCC 12.4.0, GLIBC |
| Init system | **Custom /init script** (not BusyBox init) |
| Camera Lib | **libgphoto2 2.5.33** (patched for cross-compile) |

## Prerequisites

- Windows 10/11 with WSL2 (Ubuntu)
- VirtualBox installed on Windows
- Git

## Step 1: Install WSL Ubuntu

Open PowerShell as admin:

```powershell
wsl --install -d Ubuntu
```

Reboot if prompted, then open Ubuntu from the Start menu and set up your user account.

## Step 2: Install Build Tools

Inside WSL Ubuntu:

```bash
sudo apt update && sudo apt upgrade -y

sudo apt install -y build-essential git wget rsync cpio xz-utils \
    grub-common grub-pc-bin xorriso mtools unzip bc file \
    libncurses-dev libssl-dev flex bison zlib1g-dev lz4
```

## Step 3: Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env

# Add musl target for static builds
rustup target add x86_64-unknown-linux-musl
```

## Step 4: Clone and Configure Buildroot (One-Time, ~60 min)

This downloads and compiles the entire cross-compilation toolchain, Linux kernel, and libgphoto2.

### 4a. Clone Buildroot

```bash
cd ~
git clone https://gitlab.com/buildroot.org/buildroot.git
cd buildroot
git checkout 2024.02.13
```

### 4b. Copy Configuration Files

The project contains all required config files in `linux-build/configs/buildroot-board-files/`:

```bash
# Create board directory structure
mkdir -p ~/buildroot/configs
mkdir -p ~/buildroot/board/photobooth

# Copy defconfig, kernel config, and init script
cp /mnt/<DRIVE>/Photobooth_IPH/linux-build/configs/buildroot-board-files/photobooth_defconfig ~/buildroot/configs/
cp /mnt/<DRIVE>/Photobooth_IPH/linux-build/configs/buildroot-board-files/linux.config ~/buildroot/board/photobooth/
cp /mnt/<DRIVE>/Photobooth_IPH/linux-build/configs/buildroot-board-files/init ~/buildroot/board/photobooth/overlay/
chmod +x ~/buildroot/board/photobooth/overlay/init

# IMPORTANT: Fix CRLF line endings in init script
sed -i 's/\r$//' ~/buildroot/board/photobooth/overlay/init
```

> Replace `<DRIVE>` with your actual drive letter (e.g., `w`).

### 4c. Load Defconfig

```bash
cd ~/buildroot
make photobooth_defconfig
```

### 4d. Patch libgphoto2 (CRITICAL)

libgphoto2 has a libtool cross-compilation bug. Run the fix:

```bash
python3 /mnt/<DRIVE>/Photobooth_IPH/scripts/fix_libgphoto2_mk.py
```

### 4e. Build

```bash
# IMPORTANT: Use a clean PATH (no Windows paths with spaces)
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.cargo/bin"

cd ~/buildroot
make -j$(nproc)
```

This takes 30-90 minutes depending on your machine.

### Verify the Build

```bash
ls ~/buildroot/output/images/
# Should see: bzImage, rootfs.cpio.xz, rootfs.tar
```

## Step 5: Build the Application Binaries

Once Buildroot is built, use the `rebuild-all.sh` script to compile the photobooth binaries and package the ISO:

```bash
wsl -d Ubuntu -e bash -c "bash '/mnt/<DRIVE>/Photobooth_IPH/scripts/rebuild-all.sh'"
```

This runs in order:
1. **rebuild-wrapper.sh** - Compiles `gphoto2-wrapper` and `gphoto2-controller` (C, links against libgphoto2)
2. **cargo build** - Compiles `camera-daemon` (Rust, musl static)
3. **package-rootfs.sh** - Copies binaries to overlay, rebuilds rootfs, creates ISO

Output: `linux-build/photobooth.iso`

## Step 6: Set Up VirtualBox VM

Create a new VM in VirtualBox with these settings:

| Setting | Value |
|---------|-------|
| Name | `PhotoboothLinux` |
| Type | Linux, Other Linux (64-bit) |
| Memory | 512-1024 MB |
| Graphics | VMSVGA |
| Network | NAT |
| Port Forward | Host 58321 → Guest 58321 |
| Storage | SATA Port 0: Attach `linux-build/photobooth.iso` as DVD |
| SATA Ports | 2 (reduce from default 30 for faster boot) |

### USB Setup (for camera)

1. Enable USB 2.0 (EHCI) Controller
2. Add USB Device Filter for your camera

## Step 7: Start the VM

```cmd
scripts\start-virtualbox-headless.cmd
```

After 5-10 seconds, verify it's running:

```bash
curl http://localhost:58321/api/health
```

Should return:
```json
{"status":"ok","service":"photobooth-camera-daemon","version":"1.0.0","libgphoto2_available":true}
```

## Day-to-Day Workflow

After initial setup, rebuilding is just one command:

```bash
wsl -d Ubuntu -e bash -c "bash '/mnt/<DRIVE>/Photobooth_IPH/scripts/rebuild-all.sh'"
```

Then restart the VM to load the new ISO.

### Individual Build Steps

If you only changed one thing, you can run individual scripts to save time:

**C wrappers only** (gphoto2-wrapper + gphoto2-controller):
```bash
wsl -d Ubuntu -e bash -c "bash '/mnt/<DRIVE>/Photobooth_IPH/scripts/rebuild-wrapper.sh'"
```

**Rust daemon only:**
```bash
wsl -d Ubuntu -e bash -c "
  source ~/.cargo/env
  export PATH=\"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:\$HOME/.cargo/bin\"
  cd '/mnt/<DRIVE>/Photobooth_IPH/photobooth-camera-daemon'
  cargo build --release --target x86_64-unknown-linux-musl
"
```

**Package rootfs + ISO only** (after building binaries):
```bash
wsl -d Ubuntu -e bash -c "bash '/mnt/<DRIVE>/Photobooth_IPH/scripts/package-rootfs.sh'"
```

## Project Structure

```
Photobooth_IPH/
├── photobooth-camera-daemon/       # Source code
│   ├── src/main.rs                 # Rust daemon
│   ├── gphoto2-wrapper/            # C sources
│   │   ├── gphoto2-wrapper.c
│   │   ├── gphoto2-controller.c
│   │   └── camera-brand.c
│   └── Cargo.toml
│
├── linux-build/configs/buildroot-board-files/  # Buildroot configs
│   ├── photobooth_defconfig       # Buildroot defconfig
│   ├── linux.config               # Kernel config
│   └── init                       # Custom init script
│
├── scripts/                        # Build & VM scripts
│   ├── rebuild-all.sh              # Full rebuild
│   ├── rebuild-wrapper.sh          # C wrappers only
│   ├── package-rootfs.sh           # Rootfs + ISO packaging
│   ├── fix_libgphoto2_mk.py       # Buildroot patch (one-time)
│   ├── start-virtualbox-headless.cmd
│   └── start-virtualbox-gui.cmd
│
└── linux-build/                    # Build outputs
    ├── gphoto2-wrapper             # Compiled wrapper
    ├── gphoto2-controller          # Compiled controller
    ├── photobooth.iso              # Bootable VM image
    └── rootfs.cpio.xz              # Root filesystem
```

Buildroot lives at `~/buildroot` inside WSL.

## Troubleshooting

### Buildroot fails with "PATH contains spaces"

Windows injects its own PATH into WSL which contains spaces. The build scripts already handle this with a clean `export PATH=...` at the top. If running `make` manually:

```bash
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.cargo/bin"
```

### libgphoto2 build fails with rpath error

Run `fix_libgphoto2_mk.py` again and do:
```bash
cd ~/buildroot
make libgphoto2-dirclean
make
```

### VM kernel panic: "Requested init /init failed"

The `init` script has CRLF line endings. Fix:
```bash
sed -i 's/\r$//' ~/buildroot/board/photobooth/overlay/init
```
Then rebuild ISO with `package-rootfs.sh`.

### API returns `libgphoto2_available: false`

1. Check `gphoto2-wrapper` is using full path `/opt/photobooth/gphoto2-wrapper` in `main.rs`
2. Verify libgphoto2 libraries are in the rootfs: `ls ~/buildroot/output/target/usr/lib/libgphoto2*`

### Git Bash path mangling (VS Code terminal)

VS Code's Git Bash rewrites `/mnt/...` paths. Use `wsl.exe -e` to bypass:

```bash
# BROKEN in Git Bash
wsl -d Ubuntu bash "/mnt/w/Photobooth_IPH/scripts/rebuild-all.sh"

# WORKS
wsl -d Ubuntu -e bash -c "bash '/mnt/w/Photobooth_IPH/scripts/rebuild-all.sh'"
```

Or run from **cmd** or **PowerShell** instead.

### Starting fresh

If you need to completely reset the build environment:

```bash
# In WSL
cd ~/buildroot
make distclean
rm -f .config
# Then repeat from Step 4c
```

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check, libgphoto2 status |
| `/api/cameras` | GET | List connected cameras |
| `/api/capture` | POST | Trigger photo capture |
| `/api/camera/config` | GET | Current camera settings |
| `/api/camera/config` | POST | Set camera setting |
| `/api/camera/status` | GET | Quick status (battery, ISO, etc.) |
| `/api/photo/{filename}` | GET | Download captured image |
| `/api/photo/{filename}` | DELETE | Delete image from VM |
| `/ws` | WebSocket | Status events (mode changes, photo downloads) |

## Key Configuration Files

### Buildroot Defconfig Highlights

- **BR2_INIT_NONE=y** - Uses custom `/init` script instead of BusyBox init
- **BR2_TOOLCHAIN_BUILDROOT_VENDOR="photobooth"** - Creates x86_64-photobooth-linux-gnu-gcc
- **BR2_PACKAGE_LIBGPHOTO2=y** - Camera control library
- **BR2_TARGET_ROOTFS_CPIO_XZ=y** - Compressed initramfs output

### Kernel Config Highlights

- USB: Full stack (EHCI/OHCI/XHCI PCI), USB storage
- Network: E1000 (VirtualBox default), IPv4/IPv6, DHCP
- VirtualBox: VBoxGuest, DRM VBOXVIDEO, VESA framebuffer
- Boot: Initramfs with XZ decompression

### Custom Init Script

The `/init` script:
1. Mounts proc/sysfs/tmpfs/devtmpfs/devpts
2. Loads e1000 network module
3. Configures DHCP (fallback: VirtualBox NAT 10.0.2.15)
4. Sets LD_LIBRARY_PATH
5. Starts camera-daemon in background
6. Drops to shell
