//! gphoto2-controller process management and communication

use crate::types::CameraInfo;
use crate::storage::ensure_storage_space;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;
use tokio::process::Command as TokioCommand;
use tokio::fs::OpenOptions;
use tokio::io::{AsyncWriteExt, AsyncBufReadExt};

const CONFIG_RESPONSE_FILE: &str = "/tmp/camera_config_response";

/// Shared state for controller communication
#[derive(Clone)]
pub struct ControllerState {
    /// Cached camera status: camera_id -> (status_json, last_update_time)
    pub cached_status: Arc<TokioMutex<std::collections::HashMap<String, (serde_json::Value, std::time::Instant)>>>,
    /// Cached camera info from controller (manufacturer, model, port)
    /// Only populated when controller successfully connects to camera
    pub cached_cameras: Arc<TokioMutex<Vec<CameraInfo>>>,
    /// Controller running flag
    pub controller_active: Arc<TokioMutex<bool>>,
    /// PTP streaming active flag (also used for /api/liveview/status)
    pub ptp_streaming_active: Arc<TokioMutex<bool>>,
}

impl ControllerState {
    pub fn new() -> Self {
        Self {
            cached_status: Arc::new(TokioMutex::new(std::collections::HashMap::new())),
            cached_cameras: Arc::new(TokioMutex::new(Vec::new())),
            controller_active: Arc::new(TokioMutex::new(false)),
            ptp_streaming_active: Arc::new(TokioMutex::new(false)),
        }
    }
}

/// Spawn the gphoto2-controller process with respawn logic.
/// If the controller crashes, it will be automatically restarted.
pub async fn start_controller_process(
    controller_state: ControllerState,
    ws_tx: tokio::sync::broadcast::Sender<tokio_tungstenite::tungstenite::Message>,
) {
    // Spawn storage monitor task (runs once every 30 seconds)
    tokio::spawn(async {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            ensure_storage_space(50).await; // Ensure at least 50MB free
        }
    });

    loop {
        // Check storage before starting controller
        ensure_storage_space(50).await;

        let mut child = match TokioCommand::new("/opt/photobooth/gphoto2-controller")
            .arg("0")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Failed to spawn gphoto2-controller: {}", e);
                eprintln!("Retrying in 5 seconds...");
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            }
        };

        let pid = child.id();
        println!("gphoto2-controller started (pid: {:?})", pid);

        // Wait for the status pipe to be created
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // Spawn a task to monitor the status pipe for events
        let ws_tx = ws_tx.clone();
        let cached_status = controller_state.cached_status.clone();
        let cached_cameras = controller_state.cached_cameras.clone();
        let controller_active = controller_state.controller_active.clone();
        let _status_monitor = tokio::spawn(async move {
            let mut retry_count = 0;
            loop {
                // Try to open the status pipe
                match tokio::fs::File::open("/tmp/camera_status").await {
                    Ok(file) => {
                        let mut reader = tokio::io::BufReader::new(file);
                        let mut line = String::new();
                        retry_count = 0; // Reset retry count on success

                        // Mark controller as active
                        *controller_active.lock().await = true;

                        loop {
                            line.clear();
                            match reader.read_line(&mut line).await {
                                Ok(0) => {
                                    eprintln!("Status pipe closed (controller died?)");
                                    // Mark controller as inactive
                                    *controller_active.lock().await = false;
                                    break;
                                }
                                Ok(_) => {
                                    let trimmed = line.trim();
                                    if trimmed.is_empty() {
                                        continue;
                                    }

                                    // Log photo events so we can trace the broadcast path
                                    if trimmed.contains("photo_downloaded") {
                                        println!("[status-pipe] photo_downloaded event received, broadcasting to WS");
                                    }

                                    // Parse and cache the status for /api/camera/status endpoint
                                    if let Ok(status_json) = serde_json::from_str::<serde_json::Value>(&trimmed) {
                                        // Check for camera_connected event with camera info
                                        if status_json.get("type").and_then(|v| v.as_str()) == Some("camera_connected") {
                                            let cam_id = status_json.get("camera_id").and_then(|v| v.as_str()).unwrap_or("0").to_string();
                                            let manufacturer = status_json.get("manufacturer").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            let model = status_json.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            let port = status_json.get("port").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            let usb_version = status_json.get("usb_version").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            let serial_number = status_json.get("serial_number").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            let firmware = status_json.get("firmware").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            let lens = status_json.get("lens").and_then(|v| v.as_str()).unwrap_or("").to_string();

                                            if !manufacturer.is_empty() && !model.is_empty() {
                                                let cam_info = CameraInfo {
                                                    id: cam_id,
                                                    manufacturer,
                                                    model,
                                                    port,
                                                    usb_version,
                                                    serial_number,
                                                    firmware,
                                                    lens,
                                                };
                                                println!("[status-pipe] Camera connected event, caching camera info: {} {}", cam_info.manufacturer, cam_info.model);
                                                *cached_cameras.lock().await = vec![cam_info];
                                            }
                                        }

                                        // Check for camera_disconnected event - clear cache
                                        if status_json.get("type").and_then(|v| v.as_str()) == Some("camera_disconnected") {
                                            println!("[status-pipe] Camera disconnected event, clearing camera cache");
                                            cached_cameras.lock().await.clear();
                                        }

                                        let mut cached = cached_status.lock().await;
                                        // Use "0" as default camera ID for single camera setup
                                        cached.insert("0".to_string(), (status_json, std::time::Instant::now()));
                                    }

                                    // Broadcast to all WebSocket clients
                                    match ws_tx.send(tokio_tungstenite::tungstenite::Message::Text(trimmed.to_string().into())) {
                                        Ok(n) => {
                                            if trimmed.contains("photo_downloaded") {
                                                println!("[status-pipe] Broadcast photo_downloaded to {} WS clients", n);
                                            }
                                        }
                                        Err(_) => {
                                            // No active WebSocket receivers - this is normal when no clients connected
                                        }
                                    }
                                }
                                Err(e) => {
                                    eprintln!("Error reading status pipe: {}", e);
                                    *controller_active.lock().await = false;
                                    break;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        retry_count += 1;
                        if retry_count <= 5 {
                            eprintln!("Failed to open status pipe (attempt {}): {}, retrying in 1s...", retry_count, e);
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            continue;
                        } else {
                            eprintln!("Failed to open status pipe after {} attempts, giving up: {}", retry_count, e);
                            *controller_active.lock().await = false;
                            break;
                        }
                    }
                }
            }
        });

        // Wait for the process to exit
        let status = match child.wait().await {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Error waiting for controller: {}", e);
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            }
        };

        eprintln!("gphoto2-controller exited with status: {}", status);

        // Clean up pipes
        let _ = std::fs::remove_file("/tmp/camera_cmd");
        let _ = std::fs::remove_file("/tmp/camera_status");

        // Wait a bit before restarting
        println!("Restarting controller in 3 seconds...");
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
}

/// Send a command to the gphoto2-controller via named pipe.
/// Retries a few times if the pipe isn't available yet.
pub async fn send_command(cmd: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cmd_pipe = "/tmp/camera_cmd";

    // Retry opening the pipe in case the controller is briefly unavailable
    let mut last_err = None;
    for attempt in 1..=5 {
        match OpenOptions::new().write(true).open(cmd_pipe).await {
            Ok(mut file) => {
                let full_cmd = format!("{}\n", cmd);
                file.write_all(full_cmd.as_bytes()).await?;
                file.flush().await?;
                println!("Sent command to controller: {}", cmd);
                return Ok(());
            }
            Err(e) => {
                eprintln!("Failed to open command pipe (attempt {}/5): {}", attempt, e);
                last_err = Some(e);
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
    }

    Err(Box::new(last_err.unwrap()))
}

/// Wait for the controller to write a config response file.
/// Polls the file with a 200ms interval until content appears or timeout.
pub async fn wait_for_config_response(timeout_ms: u64) -> Result<serde_json::Value, String> {
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_millis(timeout_ms);
    let mut poll_count = 0u32;

    loop {
        if start.elapsed() > timeout {
            return Err(format!(
                "Timeout waiting for controller config response after {}ms ({} polls). \
                 Is the controller running with CONFIG command support?",
                timeout_ms, poll_count
            ));
        }

        poll_count += 1;
        match tokio::fs::read_to_string(CONFIG_RESPONSE_FILE).await {
            Ok(content) => {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    println!("[config] Got response after {}ms ({} polls)",
                             start.elapsed().as_millis(), poll_count);
                    // Delete the response file so it doesn't get stale
                    let _ = tokio::fs::remove_file(CONFIG_RESPONSE_FILE).await;
                    return serde_json::from_str(trimmed)
                        .map_err(|e| format!("Failed to parse config response: {}. Raw: {}", e, trimmed));
                }
            }
            Err(_) => {
                // File doesn't exist yet, keep waiting
            }
        }

        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

/// Get camera config by routing through the controller (avoids USB contention).
pub async fn get_camera_config() -> serde_json::Value {
    println!("[config] get_camera_config called");

    // Check if controller command pipe exists
    match tokio::fs::metadata("/tmp/camera_cmd").await {
        Ok(_) => println!("[config] Command pipe /tmp/camera_cmd exists"),
        Err(e) => {
            println!("[config] Command pipe /tmp/camera_cmd NOT found: {}", e);
            return serde_json::json!({
                "error": format!("Controller command pipe not found - is the controller running? ({})", e)
            });
        }
    }

    // Remove stale response file
    match tokio::fs::remove_file(CONFIG_RESPONSE_FILE).await {
        Ok(_) => println!("[config] Removed stale response file"),
        Err(_) => println!("[config] No stale response file to remove (ok)"),
    }

    // Send CONFIG command to controller
    println!("[config] Sending CONFIG command to controller...");
    if let Err(e) = send_command("CONFIG").await {
        println!("[config] ERROR: Failed to send CONFIG command: {}", e);
        return serde_json::json!({
            "error": format!("Failed to send CONFIG command: {}", e)
        });
    }
    println!("[config] CONFIG command sent successfully, waiting for response...");

    // Wait for response (up to 20s — controller may need to finish its current poll cycle first)
    match wait_for_config_response(20000).await {
        Ok(val) => {
            println!("[config] Got config response successfully");
            val
        },
        Err(e) => {
            println!("[config] ERROR: {}", e);
            // Check if controller process is running
            if let Ok(output) = std::process::Command::new("pgrep").arg("-f").arg("gphoto2-controller").output() {
                let pid = String::from_utf8_lossy(&output.stdout);
                if pid.trim().is_empty() {
                    println!("[config] WARNING: gphoto2-controller process NOT running!");
                } else {
                    println!("[config] gphoto2-controller PID: {}", pid.trim());
                }
            }
            serde_json::json!({
                "error": e
            })
        },
    }
}

/// Set camera config by routing through the controller (avoids USB contention).
pub async fn set_camera_config(setting: &str, value: &str) -> serde_json::Value {
    // Remove stale response file
    let _ = tokio::fs::remove_file(CONFIG_RESPONSE_FILE).await;

    // Send SETCONFIG command with JSON payload
    let cmd = format!("SETCONFIG {{\"setting\":\"{}\",\"value\":\"{}\"}}", setting, value);
    if let Err(e) = send_command(&cmd).await {
        return serde_json::json!({
            "error": format!("Failed to send SETCONFIG command: {}", e)
        });
    }

    // Wait for response
    match wait_for_config_response(15000).await {
        Ok(val) => val,
        Err(e) => serde_json::json!({
            "error": e
        }),
    }
}
