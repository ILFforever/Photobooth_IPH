use crate::vm::types::VmLogsResponse;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

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

/// Read the VM console log file
/// Production: reads from %LOCALAPPDATA%\Photobooth_IPH\logs\vbox-console.log
/// Dev mode: falls back to linux-build/vbox-console.log
#[tauri::command]
pub async fn get_vm_logs(lines: Option<usize>) -> Result<VmLogsResponse, String> {
    let num_lines = lines.unwrap_or(100).min(1000); // Max 1000 lines

    let mut possible_paths: Vec<PathBuf> = vec![];

    // Production location: %LOCALAPPDATA%\Photobooth_IPH\logs\vbox-console.log
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        possible_paths.push(
            PathBuf::from(local_app_data)
                .join("Photobooth_IPH")
                .join("logs")
                .join("vbox-console.log"),
        );
    }

    // Get the current executable's directory to resolve relative paths
    let exe_dir = std::env::current_dir()
        .map_err(|e| format!("Failed to get current directory: {}", e))?;

    // Dev mode fallbacks: in the linux-build folder (relative to exe dir)
    possible_paths.push(exe_dir.join("linux-build").join("vbox-console.log"));
    possible_paths.push(exe_dir.join("../linux-build").join("vbox-console.log"));
    possible_paths.push(
        exe_dir
            .join("../../linux-build")
            .join("vbox-console.log"),
    );

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

/// Wait for the VM session lock to be released (powered off / aborted / saved state)
/// VirtualBox can hold a session lock even after poweroff for several seconds,
/// or indefinitely if the VM was killed uncleanly (aborted but locked).
/// This polls showvminfo until the VM is in a startable state.
/// If still locked after initial wait, kills VBoxHeadless.exe to force-release the lock.
/// Returns Ok(true) if unlocked, Ok(false) if timed out even after kill.
pub async fn wait_for_vm_unlocked(vbox_manage: &str, vm_name: &str, max_wait_secs: u64) -> Result<bool, String> {
    use tokio::time::{sleep, Duration};

    let mut killed_process = false;
    let start = std::time::Instant::now();

    loop {
        if start.elapsed().as_secs() >= max_wait_secs {
            return Ok(false);
        }

        let output = run_command_silent(vbox_manage, &["showvminfo", vm_name, "--machinereadable"])
            .map_err(|e| format!("Failed to get VM info: {}", e))?;

        let info = String::from_utf8_lossy(&output.stdout);

        // Look for SessionState - "Unlocked" means we can start it.
        // If SessionState is absent entirely, the VM has no session (poweroff) = unlocked.
        let mut found_session_state = false;
        let mut is_locked = false;
        for line in info.lines() {
            if line.starts_with("SessionState=") {
                found_session_state = true;
                let state = line.trim_start_matches("SessionState=").trim_matches('"');
                if state != "Unlocked" {
                    is_locked = true;
                }
                break;
            }
        }

        if !is_locked {
            return Ok(true);
        }

        // After 10 seconds of waiting, force-kill VBoxHeadless to release the stale lock
        if !killed_process && start.elapsed().as_secs() >= 10 {
            killed_process = true;
            let _ = run_command_silent("taskkill", &["/F", "/IM", "VBoxHeadless.exe"]);
            // Give it a moment after the kill
            sleep(Duration::from_secs(2)).await;
            continue;
        }

        sleep(Duration::from_secs(1)).await;
    }
}

/// Restart the VirtualBox VM
/// Force stops the VM immediately and starts it again in headless mode
#[tauri::command]
pub async fn restart_vm() -> Result<String, String> {
    use tokio::time::{sleep, Duration};

    const VM_NAME: &str = "PhotoboothLinux";
    const VBOX_MANAGE: &str = r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe";

    // Check if VBoxManage exists
    if !std::path::Path::new(VBOX_MANAGE).exists() {
        return Err("VBoxManage.exe not found. Is VirtualBox installed?".to_string());
    }

    // Step 1: Check if VM exists
    let list_output = run_command_silent(VBOX_MANAGE, &["list", "vms"])
        .map_err(|e| format!("Failed to list VMs: {}", e))?;

    let vms_list = String::from_utf8_lossy(&list_output.stdout);
    if !vms_list.contains(VM_NAME) {
        return Err(format!("VM '{}' not found", VM_NAME));
    }

    // Step 2: Check if VM is running
    let showvminfo_output = run_command_silent(VBOX_MANAGE, &["showvminfo", VM_NAME])
        .map_err(|e| format!("Failed to get VM info: {}", e))?;

    let vm_info = String::from_utf8_lossy(&showvminfo_output.stdout);
    let is_running = vm_info.contains("State:") && vm_info.contains("running");

    if is_running {
        // Force power off the VM
        let _ = run_command_silent(VBOX_MANAGE, &["controlvm", VM_NAME, "poweroff"]);
    }

    // Wait for session lock to be released (up to 30s)
    if !wait_for_vm_unlocked(VBOX_MANAGE, VM_NAME, 30).await? {
        return Err("Timed out waiting for VM session to unlock".to_string());
    }

    // Optimize AHCI port count before starting (reduces startup time)
    let _ = run_command_silent(VBOX_MANAGE, &["storagectl", VM_NAME, "--name", "SATA", "--portcount", "2"]);

    // Start the VM in headless mode
    let start_output = run_command_silent(VBOX_MANAGE, &["startvm", VM_NAME, "--type", "headless"])
        .map_err(|e| format!("Failed to start VM: {}", e))?;

    if !start_output.status.success() {
        let error_msg = String::from_utf8_lossy(&start_output.stderr);
        return Err(format!("Failed to start VM: {}", error_msg));
    }

    Ok("VM restarted successfully".to_string())
}

/// Shutdown the VirtualBox VM
/// Force stops the VM immediately
#[tauri::command]
pub async fn shutdown_vm() -> Result<String, String> {

    const VM_NAME: &str = "PhotoboothLinux";
    const VBOX_MANAGE: &str = r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe";

    // Check if VBoxManage exists
    if !std::path::Path::new(VBOX_MANAGE).exists() {
        return Err("VBoxManage.exe not found. Is VirtualBox installed?".to_string());
    }

    // Skip existence/running checks — just fire poweroff directly.
    // If the VM isn't running or doesn't exist, VBoxManage will return an error
    // which is fine — the end result is the same (VM not running).
    let output = run_command_silent(VBOX_MANAGE, &["controlvm", VM_NAME, "poweroff"]);

    match output {
        Ok(o) if o.status.success() => Ok("VM shutdown successfully".to_string()),
        _ => Ok("VM is not running or already stopped".to_string()),
    }
}

/// Exit the application after shutting down the VM
/// First shuts down the photobooth VM, then exits the app
#[tauri::command]
pub async fn exit_app(app_handle: tauri::AppHandle) -> Result<(), String> {
    const VM_NAME: &str = "PhotoboothLinux";
    const VBOX_MANAGE: &str = r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe";

    // Attempt to shutdown the VM if it's running (ignore errors)
    if std::path::Path::new(VBOX_MANAGE).exists() {
        let _ = run_command_silent(VBOX_MANAGE, &["controlvm", VM_NAME, "poweroff"]);
    }

    // Exit the application
    app_handle.exit(0);
    Ok(())
}

/// Force exit the application immediately without any cleanup
/// Used after the frontend has already performed cleanup (VM shutdown etc.)
#[tauri::command]
pub fn force_exit_app(app_handle: tauri::AppHandle) {
    // Close guest display window if open
    if let Some(guest) = app_handle.get_webview_window("guest-display") {
        let _ = guest.destroy();
    }
    app_handle.exit(0);
}
