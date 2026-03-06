# VM Production Packaging Guide

This guide explains how to package the VirtualBox VM with your Photobooth app for production distribution using a **lightweight ISO** (27 MB instead of 2-8 GB OVA).

## Overview

The VM system is now **location-independent** and uses a **custom lightweight ISO** for distribution:

- ✅ **Lightweight**: 27 MB ISO vs 2-8 GB OVA
- ✅ **Portable**: Works anywhere the app is installed
- ✅ **Automatic**: Paths auto-correct on every start
- ✅ **Simple**: VM created from ISO on first use

## How It Works

1. **Lightweight Distribution**: Ship the 27 MB `photobooth.iso` with your app
2. **Automatic VM Creation**: VM is built from ISO on first run
3. **Dynamic Path Detection**: Scripts detect current installation directory
4. **Automatic Path Correction**: Paths are checked and updated before every VM start

## For Development

### Current Issue Fix

If you just moved the project and paths are wrong:

```cmd
# Close VirtualBox GUI if open
scripts\ensure-vm-paths.cmd
scripts\start-virtualbox-gui.cmd
```

## For Production Release

### Step 1: Verify Your ISO

Make sure your ISO is ready:

```cmd
dir linux-build\photobooth.iso
```

Should show: `photobooth.iso` (~27 MB)

### Step 2: Build Your App

The ISO and scripts are automatically bundled with your Tauri app:

```cmd
npm run tauri build
```

**What gets bundled:**
```
YourApp/
├── Photobooth_IPH.exe
├── linux-build/
│   └── photobooth.iso (27 MB)
└── scripts/
    ├── create-vm-from-iso.cmd
    ├── setup-vm.cmd
    ├── ensure-vm-paths.cmd
    ├── start-virtualbox-gui.cmd
    ├── start-virtualbox-headless.cmd
    └── stop-virtualbox.cmd
```

### Step 3: First-Run Setup (User's Machine)

When user installs your app, they should run **once**:

```cmd
scripts\setup-vm.cmd
```

This will:
1. Check for VirtualBox
2. Create a new VM from the ISO
3. Configure all settings (RAM, CPU, network, paths)
4. Set up port forwarding (API on port 58321)
5. Prepare VM for use

**VM Configuration:**
- Memory: 1024 MB (1 GB)
- CPUs: 1
- Network: NAT with port forwarding (8080 → 58321)
- Boot: Directly from ISO (no disk needed)

### Step 4: Normal Operation

After setup, the app starts the VM automatically:

```cmd
scripts\start-virtualbox-headless.cmd
```

The script automatically:
- Checks and fixes ISO path
- Checks and fixes console log path
- Starts VM in background

## Tauri Integration

### Option A: Manual Setup (Current)

User runs `scripts\setup-vm.cmd` after installation.

### Option B: Automatic Setup (Recommended)

Add Tauri commands to handle VM lifecycle:

#### 1. Add Rust Commands

Create `src-tauri/src/vm_manager.rs`:

```rust
use std::path::PathBuf;
use std::process::Command;

#[tauri::command]
pub async fn check_vm_exists() -> Result<bool, String> {
    let output = Command::new("cmd")
        .args(&["/C", "\"C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe\" list vms"])
        .output()
        .map_err(|e| e.to_string())?;

    let output_str = String::from_utf8_lossy(&output.stdout);
    Ok(output_str.contains("PhotoboothLinux"))
}

#[tauri::command]
pub async fn setup_vm() -> Result<String, String> {
    let app_dir = std::env::current_dir()
        .map_err(|e| e.to_string())?;

    let script_path = app_dir
        .join("scripts")
        .join("setup-vm.cmd");

    let output = Command::new("cmd")
        .args(&["/C", script_path.to_str().unwrap()])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok("VM setup complete".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn ensure_vm_ready() -> Result<bool, String> {
    let app_dir = std::env::current_dir()
        .map_err(|e| e.to_string())?;

    let script_path = app_dir
        .join("scripts")
        .join("ensure-vm-paths.cmd");

    let output = Command::new("cmd")
        .args(&["/C", script_path.to_str().unwrap()])
        .output()
        .map_err(|e| e.to_string())?;

    Ok(output.status.success())
}

#[tauri::command]
pub async fn start_vm() -> Result<String, String> {
    let app_dir = std::env::current_dir()
        .map_err(|e| e.to_string())?;

    let script_path = app_dir
        .join("scripts")
        .join("start-virtualbox-headless.cmd");

    // Start in background - don't wait for completion
    Command::new("cmd")
        .args(&["/C", "start", "/B", script_path.to_str().unwrap()])
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok("VM starting...".to_string())
}

#[tauri::command]
pub async fn stop_vm() -> Result<String, String> {
    let app_dir = std::env::current_dir()
        .map_err(|e| e.to_string())?;

    let script_path = app_dir
        .join("scripts")
        .join("stop-virtualbox.cmd");

    let output = Command::new("cmd")
        .args(&["/C", script_path.to_str().unwrap()])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok("VM stopped".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
```

#### 2. Register Commands in `lib.rs`

```rust
mod vm_manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            // ... your existing commands ...
            vm_manager::check_vm_exists,
            vm_manager::setup_vm,
            vm_manager::ensure_vm_ready,
            vm_manager::start_vm,
            vm_manager::stop_vm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 3. Use in React App

```typescript
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export function useVMManager() {
    const [vmStatus, setVmStatus] = useState<'checking' | 'missing' | 'ready' | 'starting' | 'running' | 'error'>('checking');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        initVM();
    }, []);

    const initVM = async () => {
        try {
            // Check if VM exists
            const exists = await invoke<boolean>('check_vm_exists');

            if (!exists) {
                setVmStatus('missing');
                // Optionally auto-setup or prompt user
                return;
            }

            // Ensure paths are correct
            setVmStatus('ready');
            const ready = await invoke<boolean>('ensure_vm_ready');

            if (!ready) {
                throw new Error('Failed to prepare VM');
            }

            // Start VM
            setVmStatus('starting');
            await invoke<string>('start_vm');

            // Wait a bit for VM to boot
            setTimeout(() => {
                setVmStatus('running');
            }, 3000);

        } catch (err) {
            logger.error('VM initialization failed:', err);
            setError(String(err));
            setVmStatus('error');
        }
    };

    const setupVM = async () => {
        try {
            setVmStatus('checking');
            await invoke<string>('setup_vm');
            await initVM();
        } catch (err) {
            setError(String(err));
            setVmStatus('error');
        }
    };

    return { vmStatus, error, setupVM };
}

// In your main component
function App() {
    const { vmStatus, error, setupVM } = useVMManager();

    if (vmStatus === 'missing') {
        return (
            <div>
                <h2>VM Setup Required</h2>
                <p>The Photobooth VM needs to be set up. This is a one-time process.</p>
                <button onClick={setupVM}>Setup VM</button>
            </div>
        );
    }

    if (vmStatus === 'error') {
        return <div>Error: {error}</div>;
    }

    if (vmStatus !== 'running') {
        return <div>Starting VM... ({vmStatus})</div>;
    }

    return <YourMainApp />;
}
```

## Installer Considerations

### Using Windows Installer (MSI/EXE)

Your installer should:

1. **Check for VirtualBox**
   ```batch
   if not exist "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" (
       echo VirtualBox is required
       echo Download from: https://www.virtualbox.org/
   )
   ```

2. **Install app files** including:
   - `linux-build\photobooth.iso` (27 MB)
   - All `scripts\*.cmd` files

3. **Optional: Auto-setup VM on first launch**
   - Let your app detect missing VM and run setup
   - Or run `scripts\setup-vm.cmd` during installation

### Distribution Size

- **Your app**: ~few MB (Tauri binary + web assets)
- **Photobooth ISO**: 27 MB
- **Scripts**: <1 MB
- **Total**: ~30-40 MB (excluding VirtualBox)

**Much better than 2-8 GB OVA!** 🎉

## Path Management Details

### What Gets Auto-Updated

The following are automatically updated based on installation location:

1. **ISO path**: Where VirtualBox finds the boot ISO
2. **Console log path**: Where VM serial output is logged
3. **Any future additions** you add to `ensure-vm-paths.cmd`

### Adding More Dynamic Paths

If you add shared folders or other file-based VM settings:

Edit `scripts\ensure-vm-paths.cmd` and add:

```batch
REM Example: Update shared folder path
set EXPECTED_SHARED=%PROJECT_ROOT%\shared
%VBOX_MANAGER% sharedfolder modify %VM_NAME% --name "ShareName" --hostpath "%EXPECTED_SHARED%"
```

## Testing Portability

To verify the system works correctly:

1. **On dev machine**: Ensure VM works
   ```cmd
   scripts\start-virtualbox-headless.cmd
   ```

2. **Export project to different location**:
   - Copy entire folder to different drive (e.g., D:\ to E:\)
   - Or move from Desktop to Program Files
   - Paths should be completely different

3. **Recreate VM**:
   ```cmd
   scripts\setup-vm.cmd
   # Choose option 2 to recreate
   ```

4. **Start VM**:
   ```cmd
   scripts\start-virtualbox-headless.cmd
   ```

VM should start without any path errors!

## Updating the ISO

When you update your Linux system and need a new ISO:

1. **Build new ISO** (your existing process)
2. **Overwrite** `linux-build\photobooth.iso`
3. **Commit** the updated ISO to git
4. **Rebuild** your Tauri app
5. Users get the updated ISO automatically

### For Existing Installations

Users can update their VM's ISO:

```cmd
scripts\ensure-vm-paths.cmd
# This will reattach the new ISO automatically
```

## Troubleshooting

### "VM is locked" error
Close VirtualBox GUI window completely.

### "Path not found" error
```cmd
scripts\ensure-vm-paths.cmd
```

### "ISO not found" error
Ensure `linux-build\photobooth.iso` exists in your installation.

### VM won't create
- Check VirtualBox is installed
- Check you have enough disk space (~100 MB)
- Try running as administrator

### Paths wrong after moving app
Paths are automatically checked on every VM start. Manual check:
```cmd
scripts\ensure-vm-paths.cmd
```

### VM stuck at boot
Check console output:
```cmd
type linux-build\vbox-console.txt
```

## Advanced: Network Configuration

The VM is configured with NAT port forwarding:

- **VM Internal Port**: 8080 (your daemon API)
- **Host Port**: 58321 (accessible from Windows)

To change ports, edit `scripts\create-vm-from-iso.cmd`:

```batch
REM Change this line:
%VBOX_MANAGER% modifyvm %VM_NAME% --natpf1 "photoboothapi,tcp,,58321,,8080"
REM                                                    ^^^^^ host  ^^^^ VM
```

## File Size Comparison

| Method | Size | Pros | Cons |
|--------|------|------|------|
| **ISO (Current)** | 27 MB | ✅ Very small<br>✅ Easy to update<br>✅ Fast download | ℹ️ Requires VM creation |
| OVA Export | 2-8 GB | ✅ Pre-configured | ❌ Huge file<br>❌ Slow download<br>❌ Hard to update |
| Custom Installer | Varies | ✅ Fully automated | ❌ Complex to maintain |

**Recommendation**: Stick with the ISO approach! 🎯
