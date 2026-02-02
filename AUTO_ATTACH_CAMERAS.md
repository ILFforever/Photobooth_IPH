# Auto-Attach Cameras System

## Overview
This system automatically detects and attaches USB cameras to a VirtualBox VM at runtime, without making permanent configuration changes to the VM.

## Architecture

### Backend (Rust)

#### Files
- `src-tauri/src/usb_camera.rs` - Core USB camera management module
- `src-tauri/src/lib.rs` - Registers Tauri commands

#### Key Components

**1. CameraManager Struct**
```rust
pub struct CameraManager {
    pub attached_cameras: Arc<Mutex<HashMap<String, AttachedCamera>>>,
    pub vm_name: String,
    pub vbox_manage_path: String,
}
```
- `attached_cameras`: Tracks currently attached cameras using a thread-safe HashMap
- `vm_name`: Name of the VirtualBox VM ("PhotoboothLinux")
- `vbox_manage_path`: Path to VBoxManage executable

**2. Data Structures**

```rust
pub struct UsbCamera {
    pub uuid: String,              // Unique USB device UUID
    pub vendor_id: String,
    pub product_id: String,
    pub manufacturer: String,
    pub product: String,
    pub serial: String,
    pub address: String,
}

pub struct AttachedCamera {
    pub camera: UsbCamera,
    pub attached_at: String,        // RFC3339 timestamp
}
```

**3. Core Methods**

##### `list_cameras() -> Result<Vec<UsbCamera>, String>`
1. Executes `VBoxManage list usbhosts` to get all USB devices
2. Parses the output to extract camera information
3. Filters for cameras using keyword matching (Fuji, Canon, Nikon, Sony, etc.)
4. Returns list of detected cameras

##### `attach_camera(camera: &UsbCamera) -> Result<(), String>`
1. Checks if VM is running using `VBoxManage showvminfo`
2. Executes `VBoxManage controlvm <vm> usbattach <uuid>`
3. Uses `controlvm` (runtime-only) instead of `modifyvm` (permanent)
4. Tracks attached camera in HashMap for cleanup
5. Returns success if already attached (idempotent)

##### `attach_all_cameras() -> Result<Vec<String>, String>`
1. Calls `list_cameras()` to get all available cameras
2. Iterates through each camera
3. Calls `attach_camera()` for each one
4. Continues even if individual cameras fail
5. Returns list of successfully attached cameras

##### `detach_camera(camera: &UsbCamera) -> Result<(), String>`
1. Executes `VBoxManage controlvm <vm> usbdetach <uuid>`
2. Removes from tracking HashMap
3. Ignores "not attached" errors (idempotent)

**4. Tauri Commands (exposed to frontend)**

| Command | Purpose |
|---------|---------|
| `list_usb_cameras()` | Get all detected cameras |
| `attach_usb_camera(camera)` | Attach single camera |
| `detach_usb_camera(camera)` | Detach single camera |
| `get_attached_cameras()` | Get list of attached cameras |
| `is_camera_attached(uuid)` | Check if camera is attached |
| `attach_all_cameras()` | Attach all detected cameras |
| `cleanup_all_cameras()` | Detach all tracked cameras |

### Frontend (TypeScript/React)

#### File
- `src/components/Sidebar/Photobooth/CameraManager.tsx`

#### Component Structure

**State Management**
```typescript
const [availableCameras, setAvailableCameras] = useState<UsbCamera[]>([]);
const [attachedCameras, setAttachedCameras] = useState<AttachedCamera[]>([]);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
```

**Core Function: `loadCameras(autoAttach = true)`**

This function handles camera detection and optional auto-attachment:

```typescript
const loadCameras = async (autoAttach = true) => {
    setLoading(true);
    setError(null);

    // 1. Fetch camera lists in parallel
    const [available, attached] = await Promise.all([
        invoke<UsbCamera[]>('list_usb_cameras'),
        invoke<AttachedCamera[]>('get_attached_cameras'),
    ]);

    // 2. Filter out already attached cameras
    const attachedUuids = new Set(attached.map(a => a.camera.uuid));
    const notAttached = available.filter(c => !attachedUuids.has(c.uuid));

    // 3. Auto-attach if requested and cameras are available
    if (autoAttach && notAttached.length > 0 && vmRunning) {
        // Attach all cameras
        const results = await invoke<string[]>('attach_all_cameras');

        // Reload after attaching to get updated state
        const [newAvailable, newAttached] = await Promise.all([...]);

        setAvailableCameras(stillNotAttached);
        setAttachedCameras(newAttached);
    } else {
        setAvailableCameras(notAttached);
        setAttachedCameras(attached);
    }
};
```

**Auto-Attach Behavior**

```typescript
useEffect(() => {
    // Initial load WITH auto-attach
    loadCameras(true);

    // Periodic refresh WITHOUT auto-attach (every 5 seconds)
    const interval = setInterval(() => loadCameras(false), 5000);

    return () => clearInterval(interval);
}, []);
```

## Flow Diagrams

### Startup Flow
```
App Start
    ↓
CameraManager mounts
    ↓
loadCameras(true)
    ↓
Detect cameras (list_usb_cameras)
    ↓
Get already attached cameras
    ↓
Filter: available - attached = to_attach
    ↓
attach_all_cameras()
    ↓
For each camera: VBoxManage controlvm usbattach
    ↓
Refresh camera lists
    ↓
Update UI
```

### Periodic Refresh Flow
```
Every 5 seconds
    ↓
loadCameras(false)
    ↓
Detect cameras (list_usb_cameras)
    ↓
Get already attached cameras
    ↓
Update UI (no auto-attach)
```

## Key Design Decisions

### 1. Runtime-Only Attachment
- **Choice**: Used `VBoxManage controlvm` instead of `modifyvm`
- **Reason**: `controlvm` makes temporary changes that don't persist after VM reboot
- **Benefit**: No permanent VM configuration changes

### 2. Auto-Attach on Initial Load Only
- **Choice**: Auto-attach on mount, not on periodic refreshes
- **Reason**: Prevents repeated attachment attempts and unnecessary UI updates
- **Benefit**: Better user experience, reduced system calls

### 3. Idempotent Operations
- **Choice**: Attach/detach operations succeed if camera already in target state
- **Reason**: Simplifies error handling and logic
- **Benefit**: Robust against duplicate calls

### 4. Continue on Failure
- **Choice**: `attach_all_cameras()` continues even if individual cameras fail
- **Reason**: One faulty camera shouldn't prevent others from working
- **Benefit**: Better partial success handling

### 5. Thread-Safe Camera Tracking
- **Choice**: Used `Arc<Mutex<HashMap>>` for tracking attached cameras
- **Reason**: Multiple async operations may access camera state
- **Benefit**: Prevents race conditions in camera management

## Usage

### For Users
1. Start the PhotoboothLinux VM
2. Open the application
3. Go to Photobooth → Settings tab
4. Cameras are automatically attached (no manual action needed)
5. View attached cameras in "Active Cameras" section
6. View available cameras in "Available Cameras" section
7. Manually attach/detach using buttons if needed

### For Developers

**Adding a new camera to detection:**
Modify the `parse_usb_devices()` function in `usb_camera.rs`:
```rust
let is_camera = camera.product.to_lowercase().contains("camera")
    || camera.manufacturer.to_lowercase().contains("your_brand")
    // ... add more conditions
```

**Changing VM name:**
Modify the `CameraManager::new()` constructor:
```rust
vm_name: "YourVMName".to_string(),
```

**Changing VBoxManage path:**
Modify the `CameraManager::new()` constructor:
```rust
vbox_manage_path: r"C:\Path\To\VBoxManage.exe".to_string(),
```

## Error Handling

### VM Not Running
```
Error: "VM is not running. Please start the PhotoboothLinux VM first."
Action: Show warning message in UI, disable attach buttons
```

### VBoxManage Not Found
```
Error: "Failed to execute VBoxManage: ..."
Action: Display error in camera manager component
```

### Attachment Failure
```
Error: "Failed to attach camera: ..."
Action: Continue with other cameras, log error to console
```

## Future Enhancements

1. **VM State Monitoring**: Auto-detect when VM starts/stops
2. **Camera Hotplug**: Detect cameras plugged in after app starts
3. **Camera Settings**: Persist preferred cameras per session
4. **Batch Operations**: Attach/detach multiple cameras with one click
5. **Status Indicators**: Show camera connection quality/status
