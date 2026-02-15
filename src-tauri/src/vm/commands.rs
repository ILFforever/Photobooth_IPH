use crate::vm::types::VmLogsResponse;
use std::fs;
use std::path::PathBuf;

/// Read the VM console log file
/// In dev mode, reads from linux-build/vbox-console.log
/// In prod mode, path will be configured via app settings
#[tauri::command]
pub async fn get_vm_logs(lines: Option<usize>) -> Result<VmLogsResponse, String> {
    let num_lines = lines.unwrap_or(100).min(1000); // Max 1000 lines

    // Get the current executable's directory to resolve relative paths
    let exe_dir = std::env::current_dir()
        .map_err(|e| format!("Failed to get current directory: {}", e))?;

    // Try to find the log file in multiple possible locations
    let mut possible_paths: Vec<PathBuf> = vec![
        // Dev mode: in the linux-build folder (relative to exe dir)
        exe_dir.join("linux-build").join("vbox-console.log"),
        exe_dir.join("../linux-build").join("vbox-console.log"),
        // Also try parent directory (for dev builds)
        exe_dir
            .join("../../linux-build")
            .join("vbox-console.log"),
    ];

    // In development, also try the project root (up from src-tauri/target/debug)
    if cfg!(debug_assertions) {
        if let Ok(mut path) = std::env::current_exe() {
            // Go up from target/debug to project root
            path.pop(); // debug
            path.pop(); // target
            possible_paths.push(path.join("linux-build").join("vbox-console.log"));
            // Also try from src-tauri
            path.pop(); // src-tauri
            possible_paths.push(path.join("linux-build").join("vbox-console.log"));
        }
    }

    // Try to find and read the log file
    let mut log_content: Option<String> = None;

    for path in &possible_paths {
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => {
                    log_content = Some(content);
                    break;
                }
                Err(e) => {
                    eprintln!(
                        "[get_vm_logs] Found path but failed to read {:?}: {}",
                        path, e
                    );
                    continue;
                }
            }
        }
    }

    let log_content = match log_content {
        Some(content) => content,
        None => {
            // If no log file found, return helpful error message with searched paths
            let paths_str: Vec<String> = possible_paths
                .iter()
                .map(|p| p.display().to_string())
                .collect();
            eprintln!("[get_vm_logs] No log file found. Searched paths:");
            for p in &paths_str {
                eprintln!("  - {}", p);
            }
            return Ok(VmLogsResponse {
                logs: vec![
                    "No log file found. The VM may not be running.".to_string(),
                    format!("Current directory: {:?}", exe_dir.display()),
                    format!("Searched {} possible locations.", possible_paths.len()),
                ],
                line_count: 0,
            });
        }
    };

    // Get the last N lines
    let log_lines: Vec<String> = log_content
        .lines()
        .rev()
        .take(num_lines)
        .map(|s: &str| s.to_string())
        .collect();

    // Reverse back to original order
    let log_lines: Vec<String> = log_lines.into_iter().rev().collect();
    let line_count = log_lines.len();

    Ok(VmLogsResponse {
        logs: log_lines,
        line_count,
    })
}

/// Check if the VM is online by pinging the health endpoint
/// Returns true if the VM daemon is responding
#[tauri::command]
pub async fn check_vm_online() -> Result<bool, String> {
    const DAEMON_URL: &str = "http://localhost:58321/api/health";
    const HEALTH_TIMEOUT_MS: u64 = 2000; // 2 second timeout

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(HEALTH_TIMEOUT_MS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client.get(DAEMON_URL).send().await;

    match response {
        Ok(resp) => {
            let is_online = resp.status().is_success();
            Ok(is_online)
        }
        Err(_) => Ok(false),
    }
}

/// Restart the VirtualBox VM
/// Force stops the VM immediately and starts it again in headless mode
#[tauri::command]
pub async fn restart_vm() -> Result<String, String> {
    use std::process::Command;
    use tokio::time::{sleep, Duration};

    const VM_NAME: &str = "PhotoboothLinux";
    const VBOX_MANAGE: &str = r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe";

    // Check if VBoxManage exists
    if !std::path::Path::new(VBOX_MANAGE).exists() {
        return Err("VBoxManage.exe not found. Is VirtualBox installed?".to_string());
    }

    // Step 1: Check if VM exists
    let list_output = Command::new(VBOX_MANAGE)
        .args(&["list", "vms"])
        .output()
        .map_err(|e| format!("Failed to list VMs: {}", e))?;

    let vms_list = String::from_utf8_lossy(&list_output.stdout);
    if !vms_list.contains(VM_NAME) {
        return Err(format!("VM '{}' not found", VM_NAME));
    }

    // Step 2: Check if VM is running
    let showvminfo_output = Command::new(VBOX_MANAGE)
        .args(&["showvminfo", VM_NAME])
        .output()
        .map_err(|e| format!("Failed to get VM info: {}", e))?;

    let vm_info = String::from_utf8_lossy(&showvminfo_output.stdout);
    let is_running = vm_info.contains("State:") && vm_info.contains("running");

    if !is_running {
        // VM is not running, just start it
        Command::new(VBOX_MANAGE)
            .args(&["startvm", VM_NAME, "--type", "headless"])
            .output()
            .map_err(|e| format!("Failed to start VM: {}", e))?;

        return Ok("VM was not running. Started successfully.".to_string());
    }

    // Step 3: Force power off the VM immediately
    Command::new(VBOX_MANAGE)
        .args(&["controlvm", VM_NAME, "poweroff"])
        .output()
        .map_err(|e| format!("Failed to power off VM: {}", e))?;

    // Wait briefly to ensure the VM has fully stopped
    sleep(Duration::from_secs(2)).await;

    // Step 4: Optimize AHCI port count before starting (reduces startup time)
    let _ = Command::new(VBOX_MANAGE)
        .args(&["storagectl", VM_NAME, "--name", "SATA", "--portcount", "2"])
        .output(); // Ignore errors as this is an optimization

    // Step 5: Start the VM in headless mode
    let start_output = Command::new(VBOX_MANAGE)
        .args(&["startvm", VM_NAME, "--type", "headless"])
        .output()
        .map_err(|e| format!("Failed to start VM: {}", e))?;

    if !start_output.status.success() {
        let error_msg = String::from_utf8_lossy(&start_output.stderr);
        return Err(format!("Failed to start VM: {}", error_msg));
    }

    Ok("VM restarted successfully".to_string())
}
