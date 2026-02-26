//! System requirements checking module
//! Validates that required software (VirtualBox, etc.) is installed

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::usb_camera::ensure_usb_filters;
use crate::vm::commands::wait_for_vm_unlocked;
use crate::version::APP_VERSION;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// Import Manager trait for window management
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemRequirements {
    pub virtualbox_installed: bool,
    pub virtualbox_version: Option<String>,
    pub bundled_installer_available: bool,
    pub recommendations: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RequirementCheck {
    pub passed: bool,
    pub requirements: SystemRequirements,
}

/// App version info from update server
#[derive(Debug, Serialize, Deserialize)]
pub struct AppVersionInfo {
    pub version: String,
    pub download_url: String,
    pub release_date: String,
    pub changelog: String,
}

/// VM version info from update server
#[derive(Debug, Serialize, Deserialize)]
pub struct VMVersionInfo {
    pub version: String,
    pub iso_url: String,
    pub release_date: String,
    pub changelog: String,
}

/// Extended app version info with update status
#[derive(Debug, Serialize, Deserialize)]
pub struct AppVersionStatus {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub update_available: bool,
}

/// Extended VM version info with update status
#[derive(Debug, Serialize, Deserialize)]
pub struct VMVersionStatus {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub iso_exists: bool,
    pub iso_modified_date: Option<String>,
}

/// Combined version status for both app and VM
#[derive(Debug, Serialize, Deserialize)]
pub struct VersionStatus {
    pub app: AppVersionStatus,
    pub vm: VMVersionStatus,
}

/// Represents a semantic version (major.minor.patch)
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
struct SemVer {
    major: u32,
    minor: u32,
    patch: u32,
}

/// Parse version string "MAJOR.MINOR.PATCH" into SemVer
fn parse_version(version: &str) -> Option<SemVer> {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    Some(SemVer {
        major: parts[0].parse::<u32>().ok()?,
        minor: parts[1].parse::<u32>().ok()?,
        patch: parts[2].parse::<u32>().ok()?,
    })
}

impl std::cmp::PartialOrd for SemVer {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl std::cmp::Ord for SemVer {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        match self.major.cmp(&other.major) {
            std::cmp::Ordering::Equal => {}
            ord => return ord,
        }
        match self.minor.cmp(&other.minor) {
            std::cmp::Ordering::Equal => {}
            ord => return ord,
        }
        self.patch.cmp(&other.patch)
    }
}

/// Compare two version strings
/// Returns Ok(true) if version1 > version2 (newer available), Ok(false) otherwise
/// Returns Err if either version is invalid
fn compare_versions(current: &str, latest: &str) -> Result<bool, String> {
    let current_ver = parse_version(current)
        .ok_or_else(|| format!("Invalid version format: {}", current))?;
    let latest_ver = parse_version(latest)
        .ok_or_else(|| format!("Invalid version format: {}", latest))?;

    Ok(latest_ver > current_ver)
}

/// Get the embedded app version (set at compile time)
pub fn get_embedded_app_version() -> String {
    APP_VERSION.to_string()
}

/// Get app version status
pub fn get_app_version_status() -> AppVersionStatus {
    AppVersionStatus {
        current_version: get_embedded_app_version(),
        latest_version: None,
        update_available: false,
    }
}

/// Read VM version from the ISO file
/// Checks for a version file embedded in the ISO or uses the ISO modification time
fn read_vm_version_from_iso() -> Option<String> {
    // Check all possible ISO locations
    for iso_path in get_possible_iso_paths() {
        if iso_path.exists() {
            // Try to read version from a version.txt file next to the ISO
            let version_file_path = iso_path.with_file_name("photobooth.version.txt");
            if version_file_path.exists() {
                if let Ok(content) = std::fs::read_to_string(&version_file_path) {
                    let version = content.trim().to_string();
                    if !version.is_empty() && parse_version(&version).is_some() {
                        return Some(version);
                    }
                }
            }

            // Fallback: use ISO modification time as version indicator
            if let Ok(metadata) = std::fs::metadata(&iso_path) {
                if let Ok(modified) = metadata.modified() {
                    let datetime: chrono::DateTime<chrono::Utc> = modified.into();
                    return Some(datetime.format("%Y.%m.%d").to_string());
                }
            }
        }
    }

    None
}

/// Check current VM version
/// Reads from ISO file - returns error if no ISO found
pub fn get_current_vm_version() -> Result<String, String> {
    read_vm_version_from_iso()
        .ok_or_else(|| "VM ISO not found. Please reinstall the application.".to_string())
}

/// Get detailed VM version status including file information
pub fn get_vm_version_status() -> VMVersionStatus {
    // Check multiple possible ISO locations
    let iso_paths = get_possible_iso_paths();

    let mut iso_exists = false;
    let mut iso_modified_date = None;
    let mut found_iso_path = None;

    for path in &iso_paths {
        if path.exists() {
            iso_exists = true;
            found_iso_path = Some(path.clone());
            if let Ok(metadata) = std::fs::metadata(&path) {
                if let Ok(modified) = metadata.modified() {
                    let datetime: chrono::DateTime<chrono::Utc> = modified.into();
                    iso_modified_date = Some(datetime.format("%Y.%m.%d").to_string());
                }
            }
            break;
        }
    }

    let current_version = if iso_exists {
        get_current_vm_version_for_path(found_iso_path.as_ref().unwrap())
    } else {
        "none".to_string()
    };

    VMVersionStatus {
        current_version,
        latest_version: None, // Will be filled if checking for updates
        update_available: false,
        iso_exists,
        iso_modified_date,
    }
}

/// Get all possible ISO paths in order of priority
fn get_possible_iso_paths() -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();

    // First check AppData (where ISO is extracted on first run)
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        paths.push(std::path::PathBuf::from(local_app_data)
            .join("Photobooth_IPH")
            .join("linux-build")
            .join("photobooth.iso"));
    }

    // Then check next to exe (for dev mode or direct installations)
    if let Ok(exe_path) = std::env::current_exe() {
        let mut exe_dir = exe_path;
        exe_dir.pop();
        paths.push(exe_dir.join("linux-build").join("photobooth.iso"));
    }

    paths
}

/// Get VM version for a specific ISO path
fn get_current_vm_version_for_path(iso_path: &std::path::Path) -> String {
    // Try to read version from a version.txt file next to the ISO
    let version_file_path = iso_path.with_file_name("photobooth.version.txt");
    if version_file_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&version_file_path) {
            let version = content.trim().to_string();
            if !version.is_empty() && parse_version(&version).is_some() {
                return version;
            }
        }
    }

    // Fallback: use ISO modification time as version indicator
    if let Ok(metadata) = std::fs::metadata(iso_path) {
        if let Ok(modified) = metadata.modified() {
            let datetime: chrono::DateTime<chrono::Utc> = modified.into();
            return datetime.format("%Y.%m.%d").to_string();
        }
    }

    "unknown".to_string()
}

/// Fetch latest VM version from update server
pub async fn check_vm_update_server(url: &str) -> Result<VMVersionInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client.get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch version info: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server returned status: {}", response.status()));
    }

    let info: VMVersionInfo = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse version info: {}", e))?;

    Ok(info)
}

/// Download and install VM update
pub async fn download_vm_update(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300)) // 5 min timeout
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Get the destination path
    let mut iso_path = std::env::current_exe().unwrap_or_default();
    iso_path.pop(); // Remove exe name
    iso_path.push("linux-build");

    // Ensure directory exists
    std::fs::create_dir_all(&iso_path)
        .map_err(|e| format!("Failed to create linux-build directory: {}", e))?;

    let output_path = iso_path.join("photobooth.iso");

    // Download to temporary file first
    let temp_path = iso_path.join("photobooth.new.iso");

    let mut response = client.get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to download update: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    // Copy download to file
    while let Some(chunk) = response.chunk().await
        .map_err(|e| format!("Failed to read chunk: {}", e))?
    {
        // Bytes implements Deref<Target=[u8]>, so we can use it directly
        std::io::Write::write_all(&mut file, &chunk)
            .map_err(|e| format!("Failed to write to file: {}", e))?;
    }

    // Replace old ISO with new one
    std::fs::rename(&temp_path, &output_path)
        .map_err(|e| format!("Failed to replace VM ISO: {}", e))?;

    Ok(output_path.display().to_string())
}

/// Check if VirtualBox is installed by looking for VBoxManage.exe
pub fn check_virtualbox_installed() -> (bool, Option<String>) {
    // Check common installation paths for VBoxManage.exe
    let common_paths = vec![
        r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe",
        r"C:\Program Files (x86)\Oracle\VirtualBox\VBoxManage.exe",
        r"C:\VirtualBox\VBoxManage.exe",
    ];

    for path in common_paths {
        if std::path::Path::new(path).exists() {
            // Try to get version by running VBoxManage (without showing console window)
            let mut cmd = std::process::Command::new(path);
            cmd.args(&["--version"]);

            #[cfg(windows)]
            {
                // Hide console window on Windows
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }

            match cmd.output() {
                Ok(output) => {
                    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    return (true, Some(version));
                }
                Err(_) => {
                    // Found VBoxManage but couldn't run it - still consider VirtualBox installed
                    return (true, None);
                }
            }
        }
    }

    (false, None)
}

/// Check for bundled VirtualBox installer
pub fn check_bundled_installer() -> bool {
    // Check in the installers folder relative to the executable
    let mut exe_path = std::env::current_exe().unwrap_or_default();
    exe_path.pop(); // Remove exe name
    exe_path.push("installers");

    if let Ok(entries) = std::fs::read_dir(&exe_path) {
        for entry in entries.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                if name.contains("VirtualBox") && name.ends_with(".exe") {
                    return true;
                }
            }
        }
    }
    false
}

/// Get path to bundled VirtualBox installer
pub fn get_bundled_installer_path() -> Option<PathBuf> {
    let mut exe_path = std::env::current_exe().unwrap_or_default();
    exe_path.pop();
    exe_path.push("installers");

    if let Ok(entries) = std::fs::read_dir(&exe_path) {
        for entry in entries.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                if name.contains("VirtualBox") && name.ends_with(".exe") {
                    let mut path = exe_path.clone();
                    path.push(&name);
                    return Some(path);
                }
            }
        }
    }
    None
}

/// Check all system requirements
pub fn check_system_requirements() -> RequirementCheck {
    let (vb_installed, vb_version) = check_virtualbox_installed();
    let bundled_available = check_bundled_installer();

    let mut recommendations = Vec::new();

    if !vb_installed {
        if bundled_available {
            recommendations.push(
                "VirtualBox is not installed. A bundled installer is available in the installers folder.".to_string()
            );
        } else {
            recommendations.push(
                "VirtualBox is not installed. Please install Oracle VirtualBox to use camera features.".to_string()
            );
            recommendations.push(
                "Download VirtualBox from: https://www.virtualbox.org/wiki/Downloads".to_string()
            );
        }
    } else {
        recommendations.push(
            format!("VirtualBox {} is installed and ready.", vb_version.as_deref().unwrap_or("unknown"))
        );
    }

    RequirementCheck {
        passed: vb_installed,
        requirements: SystemRequirements {
            virtualbox_installed: vb_installed,
            virtualbox_version: vb_version,
            bundled_installer_available: bundled_available,
            recommendations,
        },
    }
}

/// Launch the bundled VirtualBox installer
#[tauri::command]
pub fn launch_virtualbox_installer() -> Result<(), String> {
    if let Some(installer_path) = get_bundled_installer_path() {
        std::process::Command::new(&installer_path)
            .args(["--silent", "--msiparams", "REBOOT=ReallySuppress"])
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {}", e))?;
        Ok(())
    } else {
        Err("VirtualBox installer not found in installers folder.".to_string())
    }
}

/// Get system requirements info (non-blocking, doesn't fail if VirtualBox is missing)
#[tauri::command]
pub fn get_system_requirements() -> RequirementCheck {
    check_system_requirements()
}

/// Get current app version
#[tauri::command]
pub fn get_app_version() -> String {
    get_embedded_app_version()
}

/// Get app version status
#[tauri::command]
pub fn get_app_status() -> AppVersionStatus {
    get_app_version_status()
}

/// Get current VM version
#[tauri::command]
pub fn get_vm_version() -> Result<String, String> {
    get_current_vm_version()
}

/// Get detailed VM version status
#[tauri::command]
pub fn get_vm_status() -> VMVersionStatus {
    get_vm_version_status()
}

/// Get combined version status for both app and VM
#[tauri::command]
pub fn get_version_status() -> VersionStatus {
    VersionStatus {
        app: get_app_version_status(),
        vm: get_vm_version_status(),
    }
}

/// Check for app updates from server
#[tauri::command]
pub async fn check_app_updates(url: String) -> Result<AppVersionStatus, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch app version info: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server returned status: {}", response.status()));
    }

    let info: AppVersionInfo = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse app version info: {}", e))?;

    let current_version = get_embedded_app_version();
    let update_available = match compare_versions(&info.version, &current_version) {
        Ok(is_newer) => is_newer,
        Err(_) => false,
    };

    Ok(AppVersionStatus {
        current_version,
        latest_version: Some(info.version.clone()),
        update_available,
    })
}

/// Check for VM updates from server
#[tauri::command]
pub async fn check_vm_updates(url: String) -> Result<VMVersionStatus, String> {
    let info = check_vm_update_server(&url).await?;
    let current_status = get_vm_version_status();

    // Compare versions to check if update is available
    let update_available = match compare_versions(&info.version, &current_status.current_version) {
        Ok(is_newer) => is_newer,
        Err(_) => false,
    };

    Ok(VMVersionStatus {
        current_version: current_status.current_version,
        latest_version: Some(info.version.clone()),
        update_available,
        iso_exists: current_status.iso_exists,
        iso_modified_date: current_status.iso_modified_date,
    })
}

/// Check for both app and VM updates from servers
#[tauri::command]
pub async fn check_all_updates(app_url: String, vm_url: String) -> Result<VersionStatus, String> {
    let (app_result, vm_result) = tokio::join!(
        check_app_updates(app_url),
        check_vm_updates(vm_url)
    );

    Ok(VersionStatus {
        app: app_result?,
        vm: vm_result?,
    })
}

/// Download and install VM update
#[tauri::command]
pub async fn install_vm_update(url: String) -> Result<String, String> {
    download_vm_update(&url).await
}

/// Extract ISO from MSI installation to AppData on first run
/// Called once when the app first launches to copy the bundled ISO to a writable location
/// Also checks if the source ISO is newer than the one in AppData and updates it if so.
#[tauri::command]
pub fn extract_iso_to_appdata() -> Result<String, String> {
    use std::path::PathBuf;

    // Get destination path (AppData)
    let dest_dir = if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        PathBuf::from(local_app_data)
            .join("Photobooth_IPH")
            .join("linux-build")
    } else {
        return Err("Failed to get LOCALAPPDATA".to_string());
    };

    // Create destination directory
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create destination directory: {}", e))?;

    let dest_path = dest_dir.join("photobooth.iso");

    // Build list of possible source ISO locations
    let mut source_candidates = Vec::new();

    // 1. Next to exe (MSI installation)
    if let Ok(mut exe_dir) = std::env::current_exe() {
        exe_dir.pop();
        source_candidates.push(exe_dir.join("linux-build").join("photobooth.iso"));
    }

    // 2. In _up_ next to exe (Tauri dev mode with resources)
    if let Ok(mut exe_dir) = std::env::current_exe() {
        exe_dir.pop();
        source_candidates.push(exe_dir.join("_up_").join("linux-build").join("photobooth.iso"));
    }

    // 3. Project root linux-build (dev mode)
    if let Ok(mut exe_dir) = std::env::current_exe() {
        exe_dir.pop(); // Remove debug/release
        exe_dir.pop(); // Remove target
        exe_dir.pop(); // Remove src-tauri
        source_candidates.push(exe_dir.join("linux-build").join("photobooth.iso"));
    }

    // Find the first existing source ISO
    let mut source_path = None;
    for candidate in &source_candidates {
        if candidate.exists() {
            source_path = Some(candidate.clone());
            break;
        }
    }

    let source_path = source_path.ok_or_else(|| {
        format!(
            "Source ISO not found. Checked: {}",
            source_candidates
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )
    })?;

    // Helper function to get ISO version (modification time as date)
    let get_iso_date = |path: &PathBuf| -> Option<chrono::DateTime<chrono::Utc>> {
        std::fs::metadata(path)
            .ok()?
            .modified()
            .ok()
            .map(|t| t.into())
    };

    // Check if we need to copy/update
    if dest_path.exists() {
        // Compare modification dates to see if source is newer
        if let (Some(source_date), Some(dest_date)) = (get_iso_date(&source_path), get_iso_date(&dest_path)) {
            if source_date > dest_date {
                // Source is newer, update the ISO
                std::fs::copy(&source_path, &dest_path)
                    .map_err(|e| format!("Failed to update ISO: {}", e))?;

                // Also update the version file if it exists
                let version_source = source_path.with_file_name("photobooth.version.txt");
                let version_dest = dest_dir.join("photobooth.version.txt");
                if version_source.exists() {
                    let _ = std::fs::copy(&version_source, &version_dest);
                }

                return Ok(format!(
                    "ISO updated from {} (newer) to: {}",
                    source_date.format("%Y-%m-%d"),
                    dest_path.display()
                ));
            } else {
                return Ok(format!("ISO up to date at: {}", dest_path.display()));
            }
        } else {
            // Couldn't compare dates, assume existing is fine
            return Ok(format!("ISO already exists at: {}", dest_path.display()));
        }
    }

    // ISO doesn't exist in AppData, copy it
    std::fs::copy(&source_path, &dest_path)
        .map_err(|e| format!("Failed to copy ISO: {}", e))?;

    // Also copy the version file if it exists
    let version_source = source_path.with_file_name("photobooth.version.txt");
    let version_dest = dest_dir.join("photobooth.version.txt");
    if version_source.exists() {
        let _ = std::fs::copy(&version_source, &version_dest);
    }

    Ok(format!("ISO extracted from {} to: {}", source_path.display(), dest_path.display()))
}

/// Open VM update website in browser
#[tauri::command]
pub fn open_vm_update_website() -> Result<(), String> {
    open::that("https://intaniaproductionhouse.com/vm-updates")
        .map_err(|e| format!("Failed to open website: {}", e))
}

/// Run a command without showing console window on Windows
fn run_command_silent(program: &str, args: &[&str]) -> Result<std::process::Output, std::io::Error> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args);

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.output()
}

/// Initialize the app - runs ISO extraction, USB filter setup, and VM boot with progress updates
/// Includes a timeout and skip option if VM fails to boot
#[tauri::command]
pub async fn initialize_app(window: tauri::Window) -> Result<String, String> {
    use tauri::Emitter;
    use tokio::time::{sleep, Duration};

    const VM_NAME: &str = "PhotoboothLinux";
    const VBOX_MANAGE: &str = r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe";
    const DAEMON_URL: &str = "http://localhost:58321/api/health";
    const HEALTH_TIMEOUT_MS: u64 = 2000;
    const MAX_BOOT_WAIT_SECS: u64 = 30; // Reduced from 90s to 30s for faster startup

    // Step 1: ISO extraction
    let _ = window.emit("init-progress", serde_json::json!({
        "step": 1,
        "total_steps": 5,
        "message": "Preparing virtual machine environment..."
    }));

    match extract_iso_to_appdata() {
        Ok(_msg) => {
            let _ = window.emit("init-progress", serde_json::json!({
                "step": 1,
                "total_steps": 5,
                "message": "VM environment ready"
            }));
        }
        Err(e) => {
            let msg = if e.contains("Source ISO not found") {
                "No source ISO found (dev mode - VM features disabled)".to_string()
            } else {
                format!("ISO extraction warning: {}", e)
            };
            let _ = window.emit("init-progress", serde_json::json!({
                "step": 1,
                "total_steps": 5,
                "message": msg
            }));
        }
    }

    // Step 2: USB filters setup
    let _ = window.emit("init-progress", serde_json::json!({
        "step": 2,
        "total_steps": 5,
        "message": "Setting up USB camera filters..."
    }));

    match ensure_usb_filters().await {
        Ok(count) => {
            let _ = window.emit("init-progress", serde_json::json!({
                "step": 2,
                "total_steps": 5,
                "message": format!("Configured {} camera USB filters", count)
            }));
        }
        Err(e) => {
            let _ = window.emit("init-progress", serde_json::json!({
                "step": 2,
                "total_steps": 5,
                "message": format!("USB filters setup: {}", e)
            }));
        }
    }

    // Step 3: Check VirtualBox installation
    let _ = window.emit("init-progress", serde_json::json!({
        "step": 3,
        "total_steps": 5,
        "message": "Checking VirtualBox installation..."
    }));

    if !std::path::Path::new(VBOX_MANAGE).exists() {
        let _ = window.emit("init-progress", serde_json::json!({
            "step": 3,
            "total_steps": 5,
            "message": "VirtualBox not found - camera features unavailable"
        }));
        // Skip VM boot steps, go straight to complete
        let _ = window.emit("init-complete", ());
        return Ok("Initialization complete (VirtualBox not installed - camera features disabled)".to_string());
    }

    // Check if VM exists
    let list_output = run_command_silent(VBOX_MANAGE, &["list", "vms"]);
    let vm_exists = match &list_output {
        Ok(output) => String::from_utf8_lossy(&output.stdout).contains(VM_NAME),
        Err(_) => false,
    };

    if !vm_exists {
        let _ = window.emit("init-progress", serde_json::json!({
            "step": 3,
            "total_steps": 5,
            "message": format!("VM '{}' not found - camera features unavailable", VM_NAME)
        }));
        let _ = window.emit("init-complete", ());
        return Ok("Initialization complete (VM not found - run VM setup first)".to_string());
    }

    let _ = window.emit("init-progress", serde_json::json!({
        "step": 3,
        "total_steps": 5,
        "message": "VirtualBox and VM found"
    }));

    // Step 4: Check VM state and boot/reboot
    let _ = window.emit("init-progress", serde_json::json!({
        "step": 4,
        "total_steps": 5,
        "message": "Checking VM state..."
    }));

    let showvminfo_output = run_command_silent(VBOX_MANAGE, &["showvminfo", VM_NAME]);
    let vm_state = match &showvminfo_output {
        Ok(output) => {
            let info = String::from_utf8_lossy(&output.stdout);
            // Extract VM state info (format: "State: running (since...)")
            if let Some(line) = info.lines().find(|l| l.starts_with("State:")) {
                line.trim().to_string()
            } else {
                "State: unknown".to_string()
            }
        }
        Err(e) => {
            format!("State: error - {}", e)
        }
    };

    let is_running = vm_state.contains("running");
    let is_aborted = vm_state.contains("aborted") || vm_state.contains("saved");
    let is_powered_off = vm_state.contains("powered off") || vm_state.contains("offline");

    // Log VM state for debugging
    eprintln!("[initialize_app] VM state: {}", vm_state);

    if is_running {
        // VM is already running - power it off first
        let _ = window.emit("init-progress", serde_json::json!({
            "step": 4,
            "total_steps": 5,
            "message": "VM is running - shutting down..."
        }));

        let _ = run_command_silent(VBOX_MANAGE, &["controlvm", VM_NAME, "poweroff"]);
        eprintln!("[initialize_app] Powered off running VM");
    } else if is_aborted {
        let _ = window.emit("init-progress", serde_json::json!({
            "step": 4,
            "total_steps": 5,
            "message": "VM was aborted - cleaning up..."
        }));
        eprintln!("[initialize_app] VM is in aborted state");
    } else if is_powered_off {
        let _ = window.emit("init-progress", serde_json::json!({
            "step": 4,
            "total_steps": 5,
            "message": "VM is powered off - starting..."
        }));
    } else {
        let _ = window.emit("init-progress", serde_json::json!({
            "step": 4,
            "total_steps": 5,
            "message": format!("VM state: {} - starting...", vm_state)
        }));
    }

    // Wait for VM session lock to be released before starting
    let _ = window.emit("init-progress", serde_json::json!({
        "step": 4,
        "total_steps": 5,
        "message": "Releasing VM lock..."
    }));

    match wait_for_vm_unlocked(VBOX_MANAGE, VM_NAME, 20).await {
        Ok(true) => {
            eprintln!("[initialize_app] VM unlocked successfully");
            // Add a small delay to ensure VirtualBox fully releases the lock
            sleep(Duration::from_millis(500)).await;
        }
        Ok(false) => {
            eprintln!("[initialize_app] VM unlock timeout - will try to start anyway");
            let _ = window.emit("init-progress", serde_json::json!({
                "step": 4,
                "total_steps": 5,
                "message": "VM lock timeout - trying anyway..."
            }));
        }
        Err(e) => {
            eprintln!("[initialize_app] VM unlock error: {} - continuing anyway", e);
            let _ = window.emit("init-progress", serde_json::json!({
                "step": 4,
                "total_steps": 5,
                "message": format!("VM check: {} - continuing", e)
            }));
        }
    }

    // Ensure logs directory exists (UART console output needs this)
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let logs_dir = PathBuf::from(&local_app_data).join("Photobooth_IPH").join("logs");
        let _ = std::fs::create_dir_all(&logs_dir);
    }

    // Optimize AHCI port count
    let _ = run_command_silent(VBOX_MANAGE, &["storagectl", VM_NAME, "--name", "SATA", "--portcount", "2"]);

    // Start VM headless with retry logic for lock errors
    let _ = window.emit("init-progress", serde_json::json!({
        "step": 4,
        "total_steps": 5,
        "message": "Booting VirtualBox VM..."
    }));

    eprintln!("[initialize_app] Starting VM: {}", VM_NAME);

    // Try to start VM with up to 3 retries for lock errors
    let mut vm_started = false;
    let mut start_error = String::new();

    for attempt in 0..3 {
        let start_output = run_command_silent(VBOX_MANAGE, &["startvm", VM_NAME, "--type", "headless"]);

        match start_output {
            Ok(output) if output.status.success() => {
                eprintln!("[initialize_app] VM start command succeeded");
                vm_started = true;
                let _ = window.emit("init-progress", serde_json::json!({
                    "step": 4,
                    "total_steps": 5,
                    "message": if is_running { "VM rebooted" } else { "VM started" }
                }));
                break;
            }
            Ok(output) => {
                let err = String::from_utf8_lossy(&output.stderr).to_string();
                start_error = err.clone();

                // Check if this is a lock error that might resolve with retry
                if err.contains("locked") || err.contains("VBOX_E_INVALID_OBJECT_STATE") {
                    eprintln!("[initialize_app] VM start attempt {} failed (locked): {}", attempt + 1, err);
                    if attempt < 2 {
                        // Wait before retry
                        sleep(Duration::from_millis(500)).await;
                        continue;
                    }
                }

                eprintln!("[initialize_app] VM start failed (non-zero exit): {}", err);
                break;
            }
            Err(e) => {
                start_error = format!("{}", e);
                eprintln!("[initialize_app] VM start error: {}", e);
                break;
            }
        }
    }

    if !vm_started {
        eprintln!("[initialize_app] Failed to start VM after retries: {}", start_error);
        let _ = window.emit("init-progress", serde_json::json!({
            "step": 4,
            "total_steps": 5,
            "message": format!("VM start failed - camera unavailable")
        }));
        let _ = window.emit("init-complete", ());
        return Ok("Initialization complete (VM start failed - camera features disabled)".to_string());
    }

    // Step 5: Wait for VM daemon to come online
    let _ = window.emit("init-progress", serde_json::json!({
        "step": 5,
        "total_steps": 5,
        "message": "Connecting to VM daemon..."
    }));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(HEALTH_TIMEOUT_MS))
        .build()
        .unwrap_or_default();

    let start_time = std::time::Instant::now();
    let mut vm_online = false;
    let mut last_error = String::new();

    eprintln!("[initialize_app] Waiting for daemon at {} (max {}s)", DAEMON_URL, MAX_BOOT_WAIT_SECS);

    while start_time.elapsed().as_secs() < MAX_BOOT_WAIT_SECS {
        let elapsed = start_time.elapsed().as_secs();
        let remaining = MAX_BOOT_WAIT_SECS.saturating_sub(elapsed);

        // Update progress every 3 seconds
        if elapsed % 3 == 0 || remaining < 5 {
            let _ = window.emit("init-progress", serde_json::json!({
                "step": 5,
                "total_steps": 5,
                "message": format!("Waiting for VM daemon... {}s remaining", remaining)
            }));
        }

        match client.get(DAEMON_URL).send().await {
            Ok(resp) if resp.status().is_success() => {
                vm_online = true;
                eprintln!("[initialize_app] Daemon is online! (took {}s)", elapsed);
                break;
            }
            Ok(resp) => {
                last_error = format!("HTTP {}", resp.status());
            }
            Err(e) => {
                last_error = format!("{}", e);
            }
        }

        sleep(Duration::from_secs(1)).await;
    }

    if vm_online {
        let _ = window.emit("init-progress", serde_json::json!({
            "step": 5,
            "total_steps": 5,
            "message": "VM online - camera features ready"
        }));
    } else {
        let elapsed = start_time.elapsed().as_secs();
        eprintln!("[initialize_app] Daemon timeout after {}s. Last error: {}", elapsed, last_error);
        let _ = window.emit("init-progress", serde_json::json!({
            "step": 5,
            "total_steps": 5,
            "message": format!("VM timeout ({}s) - camera features unavailable", elapsed)
        }));
    }

    // Initialization complete - always emit this so the splash screen closes
    let _ = window.emit("init-complete", ());

    if vm_online {
        Ok("Initialization complete - VM online".to_string())
    } else {
        Ok("Initialization complete - VM not responding (camera features disabled)".to_string())
    }
}

/// Close the splash screen and show the main window
#[tauri::command]
pub async fn close_splash_and_show_main(window: tauri::Window) -> Result<(), String> {
    // Get the app handle to access other windows
    let app = window.app_handle();

    // Show and focus the main window
    if let Some(main_window) = app.get_webview_window("main") {
        main_window.show()
            .map_err(|e| format!("Failed to show main window: {}", e))?;
        main_window.set_focus()
            .map_err(|e| format!("Failed to focus main window: {}", e))?;
        main_window.set_fullscreen(true)
            .map_err(|e| format!("Failed to set fullscreen: {}", e))?;
    }

    // Close the splash window
    if window.label() == "splash" {
        window.close()
            .map_err(|e| format!("Failed to close splash window: {}", e))?;
    }

    Ok(())
}
