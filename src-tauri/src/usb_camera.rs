use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::sync::{Arc, Mutex};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Helper to run a command without showing console window on Windows
fn run_command_silent(program: &str, args: &[&str]) -> Result<std::process::Output, std::io::Error> {
    let mut cmd = Command::new(program);
    cmd.args(args);

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.output()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsbCamera {
    pub uuid: String,
    pub vendor_id: String,
    pub product_id: String,
    pub manufacturer: String,
    pub product: String,
    pub serial: String,
    pub address: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttachedCamera {
    pub camera: UsbCamera,
    pub attached_at: String,
}

// Track attached cameras for cleanup on app exit
pub struct CameraManager {
    pub attached_cameras: Arc<Mutex<HashMap<String, AttachedCamera>>>,
    pub vm_name: String,
    pub vbox_manage_path: String,
}

impl CameraManager {
    pub fn new() -> Self {
        // Find VBoxManage using the helper function
        let vbox_manage_path = crate::system_requirements::find_vbox_manage()
            .unwrap_or_else(|| {
                // Fallback to default path if not found
                r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe".to_string()
            });

        Self {
            attached_cameras: Arc::new(Mutex::new(HashMap::new())),
            vm_name: "PhotoboothLinux".to_string(),
            vbox_manage_path,
        }
    }

    /// List all USB cameras connected to the host
    pub fn list_cameras(&self) -> Result<Vec<UsbCamera>, String> {
        let output = run_command_silent(&self.vbox_manage_path, &["list", "usbhost"])
            .map_err(|e| format!("Failed to execute VBoxManage: {}", e))?;

        if !output.status.success() {
            return Err(format!("VBoxManage failed: {}", String::from_utf8_lossy(&output.stderr)));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        self.parse_usb_devices(&stdout)
    }

    /// Parse VBoxManage USB device listing
    fn parse_usb_devices(&self, output: &str) -> Result<Vec<UsbCamera>, String> {
        let mut cameras = Vec::new();
        let lines: Vec<&str> = output.lines().collect();
        let mut i = 0;

        while i < lines.len() {
            let line = lines[i].trim();

            // Look for USB device headers
            if line.starts_with("UUID:") {
                let mut camera = UsbCamera {
                    uuid: line.split(':').nth(1).unwrap_or("").trim().to_string(),
                    vendor_id: String::new(),
                    product_id: String::new(),
                    manufacturer: String::new(),
                    product: String::new(),
                    serial: String::new(),
                    address: String::new(),
                };

                // Parse device properties (lines until empty line or next UUID)
                i += 1;
                while i < lines.len() {
                    let prop_line = lines[i].trim();
                    if prop_line.is_empty() || prop_line.starts_with("UUID:") {
                        break;
                    }

                    if let Some((key, value)) = prop_line.split_once(':') {
                        let key = key.trim();
                        let value = value.trim().to_string();

                        match key {
                            "VendorId" => camera.vendor_id = value,
                            "ProductId" => camera.product_id = value,
                            "Manufacturer" => camera.manufacturer = value,
                            "Product" => camera.product = value,
                            "SerialNumber" => camera.serial = value,
                            "Address" => camera.address = value,
                            _ => {}
                        }
                    }
                    i += 1;
                }

                // EXCLUDE all printers - they should stay on Windows, not attach to VM
                let product_lower = camera.product.to_lowercase();
                if product_lower.contains("printer") {
                    continue;
                }

                // EXCLUDE Fuji ASK 400 Printer specifically (double protection)
                if camera.vendor_id.contains("04cb") && camera.product_id.contains("501a") {
                    continue;
                }

                // Only include cameras (PTP class or camera-related keywords)
                let manufacturer_lower = camera.manufacturer.to_lowercase();
                let product_lower = camera.product.to_lowercase();
                let is_camera = product_lower.contains("camera")
                    || product_lower.contains("x-pro")
                    || product_lower.contains("x-t")
                    || product_lower.contains("x-h")
                    || product_lower.contains("x-s")
                    || product_lower.contains("x-e")
                    || product_lower.contains("x100")
                    || product_lower.contains("gfx")
                    || manufacturer_lower.contains("fuji")
                    || manufacturer_lower.contains("canon")
                    || manufacturer_lower.contains("nikon")
                    || manufacturer_lower.contains("sony")
                    || manufacturer_lower.contains("olympus")
                    || manufacturer_lower.contains("panasonic")
                    || manufacturer_lower.contains("ricoh")
                    || manufacturer_lower.contains("pentax")
                    || camera.vendor_id.contains("04cb"); // Fujifilm USB vendor ID

                if is_camera && !camera.vendor_id.is_empty() {
                    cameras.push(camera);
                }
            } else {
                i += 1;
            }
        }

        Ok(cameras)
    }

    /// Get existing USB filters as a map of name → index.
    /// Uses --machinereadable for fast, reliable parsing.
    fn get_existing_filters(&self) -> Result<HashMap<String, usize>, String> {
        let output = run_command_silent(&self.vbox_manage_path, &["showvminfo", &self.vm_name, "--machinereadable"])
            .map_err(|e| format!("Failed to get VM info: {}", e))?;

        if !output.status.success() {
            return Err(format!("VBoxManage failed: {}", String::from_utf8_lossy(&output.stderr)));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut filters = HashMap::new();

        // --machinereadable outputs lines like: USBFilterName1="Canon Cameras"
        for line in stdout.lines() {
            if let Some(rest) = line.strip_prefix("USBFilterName") {
                if let Some((index_str, quoted_name)) = rest.split_once('=') {
                    if let Ok(idx) = index_str.parse::<usize>() {
                        let name = quoted_name.trim_matches('"').to_string();
                        if !name.is_empty() {
                            filters.insert(name, idx);
                        }
                    }
                }
            }
        }

        Ok(filters)
    }

    /// Remove a USB filter by name, using its known index (no extra VBoxManage call needed).
    fn remove_usb_filter(&self, index: usize, name: &str) {
        let result = run_command_silent(&self.vbox_manage_path, &[
            "usbfilter", "remove", &index.to_string(), "--target", &self.vm_name,
        ]);
        match result {
            Ok(o) if o.status.success() => eprintln!("Removed stale USB filter: {}", name),
            Ok(o) => eprintln!("Warning: could not remove filter '{}': {}", name, String::from_utf8_lossy(&o.stderr)),
            Err(e) => eprintln!("Warning: could not remove filter '{}': {}", name, e),
        }
    }

    /// Ensure no broad vendor-level USB filters exist that would cause the VM to grab printers.
    /// All cameras are now attached at runtime via attach_camera(), which identifies them by
    /// product name/model and explicitly excludes printers.
    /// This function only does work on first run after upgrading from an older version that
    /// installed broad vendor filters — after cleanup it becomes a fast no-op.
    pub fn ensure_usb_filters(&self) -> Result<usize, String> {
        // Filters that must NOT exist — broad vendor IDs shared with printer lines.
        // e.g. Fujifilm 04cb covers both cameras and the FUJI ASK 400 printer.
        //      Canon    04a9 covers both cameras and Canon photo printers.
        let banned: &[&str] = &[
            "Fujifilm Cameras",
            "Canon Cameras",
        ];

        let existing = self.get_existing_filters()?;

        for name in banned {
            if let Some(&idx) = existing.get(*name) {
                self.remove_usb_filter(idx, name);
            }
        }

        Ok(0)
    }

    /// Attach a camera to the VM (runtime-only, no permanent config changes)
    pub fn attach_camera(&self, camera: &UsbCamera) -> Result<(), String> {
        // Check if VM is running
        let vm_state_output = run_command_silent(&self.vbox_manage_path, &["showvminfo", &self.vm_name])
            .map_err(|e| format!("Failed to check VM state: {}", e))?;

        let vm_state = String::from_utf8_lossy(&vm_state_output.stdout);
        let state_value = vm_state.lines()
            .find(|line| line.trim().starts_with("State:"))
            .and_then(|line| line.split_once(':'))
            .map(|(_, val)| val.trim().to_lowercase())
            .unwrap_or_default();
        if !state_value.starts_with("running") {
            return Err(format!("VM is not running (state: {}). Please start the PhotoboothLinux VM first.", state_value));
        }

        // Attach the camera using controlvm (runtime-only, no permanent changes)
        let output = run_command_silent(&self.vbox_manage_path, &[
            "controlvm",
            &self.vm_name,
            "usbattach",
            &camera.uuid,
        ])
            .map_err(|e| format!("Failed to attach USB device: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("already captured") {
                return Ok(()); // Already attached, not an error
            }
            return Err(format!("Failed to attach camera: {}", stderr));
        }

        // Track the attached camera for cleanup
        let attached = AttachedCamera {
            camera: camera.clone(),
            attached_at: chrono::Utc::now().to_rfc3339(),
        };

        let mut attached_map = self.attached_cameras.lock().unwrap();
        attached_map.insert(camera.uuid.clone(), attached);

        Ok(())
    }

    /// Detach a camera from the VM
    pub fn detach_camera(&self, camera: &UsbCamera) -> Result<(), String> {
        let output = run_command_silent(&self.vbox_manage_path, &[
            "controlvm",
            &self.vm_name,
            "usbdetach",
            &camera.uuid,
        ])
            .map_err(|e| format!("Failed to detach USB device: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.contains("not attached") {
                return Err(format!("Failed to detach camera: {}", stderr));
            }
        }

        // Remove from tracking
        let mut attached_map = self.attached_cameras.lock().unwrap();
        attached_map.remove(&camera.uuid);

        Ok(())
    }

    /// Detach all tracked cameras (for cleanup on app exit)
    pub fn detach_all_cameras(&self) -> Result<(), String> {
        let cameras_to_detach: Vec<UsbCamera> = {
            let attached_map = self.attached_cameras.lock().unwrap();
            attached_map.values().map(|a| a.camera.clone()).collect()
        };

        for camera in cameras_to_detach {
            if let Err(e) = self.detach_camera(&camera) {
                eprintln!("Failed to detach camera {}: {}", camera.product, e);
            }
        }

        Ok(())
    }

    /// Get list of currently attached cameras
    pub fn get_attached_cameras(&self) -> Vec<AttachedCamera> {
        let attached_map = self.attached_cameras.lock().unwrap();
        attached_map.values().cloned().collect()
    }

    /// Check if a specific camera is attached
    pub fn is_camera_attached(&self, uuid: &str) -> bool {
        let attached_map = self.attached_cameras.lock().unwrap();
        attached_map.contains_key(uuid)
    }

    /// Auto-attach all detected cameras to the VM
    pub fn attach_all_cameras(&self) -> Result<Vec<String>, String> {
        let cameras = self.list_cameras()?;
        let mut attached = Vec::new();

        for camera in &cameras {
            match self.attach_camera(camera) {
                Ok(_) => attached.push(format!("Attached {}", camera.product)),
                Err(e) => {
                    eprintln!("Failed to attach {}: {}", camera.product, e);
                    // Continue with other cameras even if one fails
                }
            }
        }

        Ok(attached)
    }
}

// Global singleton
pub static CAMERA_MANAGER: once_cell::sync::Lazy<CameraManager> =
    once_cell::sync::Lazy::new(CameraManager::new);

// Tauri commands

#[tauri::command]
pub async fn list_usb_cameras() -> Result<Vec<UsbCamera>, String> {
    CAMERA_MANAGER.list_cameras()
}

#[tauri::command]
pub async fn attach_usb_camera(camera: UsbCamera) -> Result<String, String> {
    CAMERA_MANAGER.attach_camera(&camera)?;
    Ok(format!("Attached {}", camera.product))
}

#[tauri::command]
pub async fn detach_usb_camera(camera: UsbCamera) -> Result<String, String> {
    CAMERA_MANAGER.detach_camera(&camera)?;
    Ok(format!("Detached {}", camera.product))
}

#[tauri::command]
pub async fn get_attached_cameras() -> Result<Vec<AttachedCamera>, String> {
    Ok(CAMERA_MANAGER.get_attached_cameras())
}

#[tauri::command]
pub async fn is_camera_attached(uuid: String) -> bool {
    CAMERA_MANAGER.is_camera_attached(&uuid)
}

/// Cleanup all attached cameras (call this manually if needed)
#[tauri::command]
pub async fn cleanup_all_cameras() -> Result<(), String> {
    CAMERA_MANAGER.detach_all_cameras()
}

/// Auto-attach all detected cameras
#[tauri::command]
pub async fn attach_all_cameras() -> Result<Vec<String>, String> {
    CAMERA_MANAGER.attach_all_cameras()
}

/// Ensure USB filters exist for all supported camera brands
/// Returns the number of filters added
#[tauri::command]
pub async fn ensure_usb_filters() -> Result<usize, String> {
    CAMERA_MANAGER.ensure_usb_filters()
}