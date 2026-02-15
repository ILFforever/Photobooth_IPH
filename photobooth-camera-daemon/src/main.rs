//! Photobooth Camera Daemon
//!
//! HTTP server for camera operations using libgphoto2
//! Runs on minimal Linux, exposed via HTTP API

use hyper::body::Incoming;
use hyper::{Request, Response, StatusCode, Method};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::body::{Bytes, Frame};
use http_body_util::{Full, BodyExt, StreamBody, combinators::BoxBody};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use std::process::Command as StdCommand;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use std::fs;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use futures_util::stream::StreamExt;
use futures_util::SinkExt;
use tokio::sync::broadcast;
use tokio::io::AsyncBufReadExt;
use tokio_util::io::ReaderStream;
use tokio::process::Command as TokioCommand;
use sha1::{Sha1, Digest};
use base64::Engine;

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

/// Type alias for boxed response body that can be either Full or streaming
type ResponseBody = BoxBody<Bytes, std::io::Error>;

/// Convert a Full<Bytes> body to a boxed body
fn full_body(data: impl Into<Bytes>) -> ResponseBody {
    Full::new(data.into())
        .map_err(|never| match never {})
        .boxed()
}

/// Compute the Sec-WebSocket-Accept value per RFC 6455
fn compute_websocket_accept(key: &str) -> String {
    const WS_MAGIC: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    let mut hasher = Sha1::new();
    hasher.update(key.as_bytes());
    hasher.update(WS_MAGIC.as_bytes());
    let result = hasher.finalize();
    base64::engine::general_purpose::STANDARD.encode(&result)
}

/// Get available disk space in bytes for a given path (Unix only)
#[cfg(unix)]
fn get_available_space(path: &str) -> Result<u64, String> {
    use std::ffi::CString;
    use std::mem::MaybeUninit;

    let path_c = CString::new(path).map_err(|e| format!("Invalid path: {}", e))?;
    let mut stat: MaybeUninit<libc::statvfs> = MaybeUninit::uninit();

    unsafe {
        if libc::statvfs(path_c.as_ptr(), stat.as_mut_ptr()) != 0 {
            return Err("Failed to get filesystem stats".to_string());
        }
        let stat = stat.assume_init();
        // Available space = block size * available blocks
        Ok(stat.f_bavail * stat.f_bsize)
    }
}

/// Stub for non-Unix platforms
#[cfg(not(unix))]
fn get_available_space(_path: &str) -> Result<u64, String> {
    // Return a large value on Windows (used only for development)
    Ok(1024 * 1024 * 1024) // 1GB
}

/// Clean up old photos to free space. Deletes oldest files first until target space is freed.
/// Returns number of files deleted.
fn cleanup_old_photos(target_free_bytes: u64) -> Result<usize, String> {
    let photo_dir = Path::new("/tmp");

    // Get all photo files with their metadata
    let mut photos: Vec<(std::path::PathBuf, std::fs::Metadata)> = Vec::new();

    match fs::read_dir(photo_dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    // Only consider image files
                    if ext_str == "jpg" || ext_str == "jpeg" || ext_str == "png" || ext_str == "raf" || ext_str == "arw" {
                        if let Ok(metadata) = entry.metadata() {
                            photos.push((path, metadata));
                        }
                    }
                }
            }
        }
        Err(e) => return Err(format!("Failed to read photo directory: {}", e)),
    }

    if photos.is_empty() {
        return Ok(0);
    }

    // Sort by modification time (oldest first)
    #[cfg(unix)]
    photos.sort_by_key(|(_, metadata)| metadata.mtime());

    #[cfg(not(unix))]
    photos.sort_by_key(|(_, metadata)| {
        metadata.modified().ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    });

    let mut deleted_count = 0;
    let mut freed_space = 0u64;

    for (path, metadata) in photos {
        if freed_space >= target_free_bytes {
            break;
        }

        let file_size = metadata.len();
        match fs::remove_file(&path) {
            Ok(_) => {
                println!("Deleted old photo: {} ({} bytes)", path.display(), file_size);
                deleted_count += 1;
                freed_space += file_size;
            }
            Err(e) => {
                eprintln!("Failed to delete {}: {}", path.display(), e);
            }
        }
    }

    Ok(deleted_count)
}

/// Check available space and cleanup if needed
/// Ensures at least min_free_mb MB is available
async fn ensure_storage_space(min_free_mb: u64) {
    let min_free_bytes = min_free_mb * 1024 * 1024;

    match get_available_space("/tmp") {
        Ok(available) => {
            let available_mb = available / (1024 * 1024);
            println!("Storage: {} MB available in /tmp", available_mb);

            if available < min_free_bytes {
                let needed = min_free_bytes - available;
                let _needed_mb = needed / (1024 * 1024);
                println!("WARNING: Low storage! Only {} MB free, need {} MB. Cleaning up old photos...",
                    available_mb, min_free_mb);

                match cleanup_old_photos(needed + (10 * 1024 * 1024)) { // Add 10MB buffer
                    Ok(count) => {
                        if count > 0 {
                            println!("Cleaned up {} old photo(s) to free space", count);
                        } else {
                            eprintln!("WARNING: No photos to delete, but storage is low!");
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to cleanup old photos: {}", e);
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to check storage space: {}", e);
        }
    }
}

/// Parse query parameter from URI
fn parse_query_param(uri: &str, param_name: &str) -> Option<u32> {
    let query_start = uri.find('?')?;
    let query = &uri[query_start + 1..];

    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if let Some(key) = parts.next() {
            if key == param_name {
                if let Some(value) = parts.next() {
                    return value.parse::<u32>().ok();
                }
            }
        }
    }
    None
}

// API Response types
#[derive(Serialize, Deserialize, Clone)]
struct CameraInfo {
    id: String,
    manufacturer: String,
    model: String,
    port: String,
    #[serde(default)]
    usb_version: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    service: String,
    version: String,
    libgphoto2_available: bool,
}

// Shared state for WebSocket clients
#[derive(Clone)]
struct SharedState {
    ws_tx: broadcast::Sender<Message>,
    /// Live view active flag
    liveview_active: Arc<tokio::sync::Mutex<bool>>,
    /// Cached camera status: camera_id -> (status_json, last_update_time)
    cached_status: Arc<tokio::sync::Mutex<HashMap<String, (serde_json::Value, std::time::Instant)>>>,
    /// Cached camera info from controller (manufacturer, model, port)
    /// Only populated when controller successfully connects to camera
    cached_cameras: Arc<tokio::sync::Mutex<Vec<CameraInfo>>>,
    /// Controller running flag
    controller_active: Arc<tokio::sync::Mutex<bool>>,
}

impl SharedState {
    fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        Self {
            ws_tx: tx,
            liveview_active: Arc::new(tokio::sync::Mutex::new(false)),
            cached_status: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            cached_cameras: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            controller_active: Arc::new(tokio::sync::Mutex::new(false)),
        }
    }
}


// State for camera sessions
#[derive(Clone)]
struct CameraState {
    sessions: HashMap<String, CameraInfo>,
}

impl CameraState {
    fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    fn check_libgphoto2(&self) -> bool {
        // Check if gphoto2-wrapper is available
        StdCommand::new("gphoto2-wrapper")
            .arg("version")
            .output()
            .map(|_| true)
            .unwrap_or(false)
    }

    fn list_cameras(&self) -> Vec<CameraInfo> {
        match StdCommand::new("gphoto2-wrapper")
            .arg("list")
            .output()
        {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);

                // Only log if not silent (reduce spam)
                if !stderr.contains("Could not claim the USB device") {
                    println!("gphoto2 list stdout: {}", stdout);
                }
                if !stderr.is_empty() && !stderr.contains("Could not claim the USB device") {
                    eprintln!("gphoto2 list stderr: {}", stderr);
                }

                match serde_json::from_str::<Vec<CameraInfo>>(stdout.trim()) {
                    Ok(cameras) => cameras,
                    Err(e) => {
                        eprintln!("Failed to parse camera list JSON: {}", e);
                        vec![]
                    }
                }
            }
            Err(e) => {
                eprintln!("Failed to run gphoto2-wrapper list: {}", e);
                vec![]
            }
        }
    }

    fn debug_camera(&self, camera_id: Option<u32>) -> serde_json::Value {
        let camera_idx = camera_id.unwrap_or(0).to_string();
        match StdCommand::new("gphoto2-wrapper")
            .arg("debug")
            .arg(&camera_idx)
            .output()
        {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                println!("gphoto2 debug stdout: {}", stdout);
                if !stderr.is_empty() {
                    eprintln!("gphoto2 debug stderr: {}", stderr);
                }
                match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
                    Ok(val) => val,
                    Err(e) => serde_json::json!({
                        "error": format!("Failed to parse debug response: {}. Raw: {}", e, stdout.trim()),
                        "stderr": stderr.trim(),
                    }),
                }
            }
            Err(e) => serde_json::json!({
                "error": format!("Failed to run gphoto2-wrapper debug: {}", e),
            }),
        }
    }

    fn list_widgets(&self, camera_id: Option<u32>) -> serde_json::Value {
        let camera_idx = camera_id.unwrap_or(0).to_string();
        match StdCommand::new("gphoto2-wrapper")
            .arg("widgets")
            .arg(&camera_idx)
            .output()
        {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                println!("gphoto2 widgets stdout: {}", stdout);
                if !stderr.is_empty() {
                    eprintln!("gphoto2 widgets stderr: {}", stderr);
                }
                match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
                    Ok(val) => val,
                    Err(e) => serde_json::json!({
                        "error": format!("Failed to parse widgets response: {}. Raw: {}", e, stdout.trim()),
                        "stderr": stderr.trim(),
                    }),
                }
            }
            Err(e) => serde_json::json!({
                "error": format!("Failed to run gphoto2-wrapper widgets: {}", e),
            }),
        }
    }

}

/// Spawn the gphoto2-controller process with respawn logic.
/// If the controller crashes, it will be automatically restarted.
async fn start_controller_process(shared_state: &SharedState) {
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
        // This task will die when the controller dies and pipe closes
        let ws_tx = shared_state.ws_tx.clone();
        let cached_status = shared_state.cached_status.clone();
        let cached_cameras = shared_state.cached_cameras.clone();
        let controller_active = shared_state.controller_active.clone();
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
                                        // Check for camera_connected event with full camera info
                                        if let Some(camera_info_array) = status_json.get("camera_connected").and_then(|v| v.as_array()) {
                                            println!("[status-pipe] Camera connected event, caching camera info");
                                            // Parse camera info and cache it
                                            let mut cameras_vec = Vec::new();
                                            for cam in camera_info_array {
                                                if let Ok(cam_info) = serde_json::from_value::<CameraInfo>(cam.clone()) {
                                                    cameras_vec.push(cam_info);
                                                }
                                            }
                                            if !cameras_vec.is_empty() {
                                                *cached_cameras.lock().await = cameras_vec;
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
                                    match ws_tx.send(Message::Text(trimmed.to_string().into())) {
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
async fn send_controller_command(cmd: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tokio::fs::OpenOptions;
    use tokio::io::AsyncWriteExt;

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

const CONFIG_RESPONSE_FILE: &str = "/tmp/camera_config_response";

/// Wait for the controller to write a config response file.
/// Polls the file with a 200ms interval until content appears or timeout.
async fn wait_for_config_response(timeout_ms: u64) -> Result<serde_json::Value, String> {
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
async fn get_camera_config_via_controller() -> serde_json::Value {
    println!("[config] get_camera_config_via_controller called");

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
    if let Err(e) = send_controller_command("CONFIG").await {
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
            if let Ok(output) = StdCommand::new("pgrep").arg("-f").arg("gphoto2-controller").output() {
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
async fn set_camera_config_via_controller(setting: &str, value: &str) -> serde_json::Value {
    // Remove stale response file
    let _ = tokio::fs::remove_file(CONFIG_RESPONSE_FILE).await;

    // Send SETCONFIG command with JSON payload
    let cmd = format!("SETCONFIG {{\"setting\":\"{}\",\"value\":\"{}\"}}", setting, value);
    if let Err(e) = send_controller_command(&cmd).await {
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

fn make_api_response(data: impl Serialize) -> Response<ResponseBody> {
    match serde_json::to_string(&data) {
        Ok(json) => {
            Response::builder()
                .header("content-type", "application/json")
                .header("access-control-allow-origin", "*")
                .body(full_body(json))
                .unwrap()
        }
        Err(e) => {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(full_body(format!("{{\"error\":\"JSON error: {}\"}}", e)))
                .unwrap()
        }
    }
}

async fn handle_request(
    state: CameraState,
    shared_state: SharedState,
    req: Request<Incoming>,
) -> Result<Option<Response<ResponseBody>>, hyper::Error> {
    let method = req.method();
    let path = req.uri().path();
    let uri_str = req.uri().to_string();

    println!("{} {}", method, path);

    // Handle CORS preflight OPTIONS requests
    if method == Method::OPTIONS {
        return Ok(Some(Response::builder()
            .status(StatusCode::OK)
            .header("access-control-allow-origin", "*")
            .header("access-control-allow-methods", "GET, POST, OPTIONS")
            .header("access-control-allow-headers", "Content-Type, Authorization")
            .body(full_body(""))
            .unwrap()));
    }

    // WebSocket upgrade request
    if path == "/ws" {
        // Check for WebSocket upgrade headers
        let has_upgrade = req.headers()
            .get("upgrade")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.eq_ignore_ascii_case("websocket"))
            .unwrap_or(false);

        if has_upgrade {
            // Return None to signal upgrade
            return Ok(None);
        }
    }

    let response = match (method, path) {
        (&Method::GET, "/api/health") => {
            Some(make_api_response(HealthResponse {
                status: "ok".to_string(),
                service: "photobooth-camera-daemon".to_string(),
                version: "1.0.0".to_string(),
                libgphoto2_available: state.check_libgphoto2(),
            }))
        }

        (&Method::GET, "/api/cameras") => {
            // Check if we have cached camera info from the controller
            let controller_active = *shared_state.controller_active.lock().await;
            let cached_cameras = shared_state.cached_cameras.lock().await.clone();

            let cameras = if controller_active && !cached_cameras.is_empty() {
                // Controller is running and has sent camera info - use cache to avoid USB conflict
                println!("GET /api/cameras - returning cached info from controller (avoiding USB conflict)");
                cached_cameras
            } else if controller_active {
                // Controller is running but hasn't sent camera info yet - don't call wrapper
                // (it would fail with "Could not claim the USB device")
                println!("GET /api/cameras - controller active but no cache yet, returning empty");
                vec![]
            } else {
                // Controller is NOT active - safe to call gphoto2-wrapper list
                println!("GET /api/cameras - controller not active, calling gphoto2-wrapper list");
                let cameras = state.list_cameras();

                // If we get "Unknown Camera", it means wrapper couldn't open the camera
                // This shouldn't happen when controller is inactive, but log it if it does
                if cameras.iter().any(|c| c.model == "Unknown Camera") {
                    eprintln!("WARNING: Got 'Unknown Camera' even though controller is inactive");
                }

                cameras
            };

            Some(make_api_response(cameras))
        }

        (&Method::POST, "/api/capture") => {
            // Ensure we have storage space before capturing
            ensure_storage_space(50).await;

            // Send CAPTURE command to controller
            match send_controller_command("CAPTURE").await {
                Ok(_) => Some(make_api_response(serde_json::json!({
                    "success": true,
                    "message": "Capture command sent"
                }))),
                Err(e) => Some(make_api_response(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to send capture command: {}", e)
                })))
            }
        }

        (&Method::POST, path) if path.starts_with("/api/controller/switch") => {
            // Switch which camera the controller is tracking
            let camera_index = parse_query_param(&uri_str, "camera").unwrap_or(0);
            let cmd = format!("SWITCH_CAMERA {}", camera_index);
            match send_controller_command(&cmd).await {
                Ok(_) => Some(make_api_response(serde_json::json!({
                    "success": true,
                    "message": format!("Switched to camera {}", camera_index),
                    "camera_index": camera_index
                }))),
                Err(e) => Some(make_api_response(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to switch camera: {}", e)
                })))
            }
        }

        (&Method::POST, "/api/liveview/start") => {
            // Send LIVEVIEW_START command to controller
            match send_controller_command("LIVEVIEW_START").await {
                Ok(_) => {
                    // Update live view state
                    *shared_state.liveview_active.lock().await = true;
                    Some(make_api_response(serde_json::json!({
                        "success": true,
                        "message": "Live view started",
                        "active": true
                    })))
                }
                Err(e) => Some(make_api_response(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to start live view: {}", e)
                })))
            }
        }

        (&Method::POST, "/api/liveview/stop") => {
            // Send LIVEVIEW_STOP command to controller
            match send_controller_command("LIVEVIEW_STOP").await {
                Ok(_) => {
                    // Update live view state
                    *shared_state.liveview_active.lock().await = false;
                    Some(make_api_response(serde_json::json!({
                        "success": true,
                        "message": "Live view stopped",
                        "active": false
                    })))
                }
                Err(e) => Some(make_api_response(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to stop live view: {}", e)
                })))
            }
        }

        (&Method::GET, "/api/liveview/status") => {
            let active = *shared_state.liveview_active.lock().await;
            Some(make_api_response(serde_json::json!({
                "active": active
            })))
        }

        (&Method::GET, "/api/liveview/frame") => {
            // Check if live view is active
            let active = *shared_state.liveview_active.lock().await;
            if !active {
                Some(make_api_response(serde_json::json!({
                    "success": false,
                    "error": "Live view is not active. Call POST /api/liveview/start first."
                })))
            } else {
                // Send LIVEVIEW_FRAME command to controller
                match send_controller_command("LIVEVIEW_FRAME").await {
                    Ok(_) => {
                        // Note: The actual frame data will be sent via WebSocket
                        // This endpoint just triggers the capture
                        Some(make_api_response(serde_json::json!({
                            "success": true,
                            "message": "Frame capture requested - check WebSocket for data"
                        })))
                    }
                    Err(e) => Some(make_api_response(serde_json::json!({
                        "success": false,
                        "error": format!("Failed to capture frame: {}", e)
                    })))
                }
            }
        }

        (&Method::POST, "/api/liveview/ptp-stream/start") => {
            // Start continuous PTP streaming
            match send_controller_command("LIVEVIEW_STREAM_START").await {
                Ok(_) => {
                    Some(make_api_response(serde_json::json!({
                        "success": true,
                        "message": "PTP streaming started - connect to GET /api/liveview/ptp-stream to receive frames"
                    })))
                }
                Err(e) => Some(make_api_response(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to start PTP streaming: {}", e)
                })))
            }
        }

        (&Method::POST, "/api/liveview/ptp-stream/stop") => {
            // Stop continuous PTP streaming
            match send_controller_command("LIVEVIEW_STREAM_STOP").await {
                Ok(_) => {
                    Some(make_api_response(serde_json::json!({
                        "success": true,
                        "message": "PTP streaming stopped"
                    })))
                }
                Err(e) => Some(make_api_response(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to stop PTP streaming: {}", e)
                })))
            }
        }

        (&Method::GET, "/api/liveview/ptp-stream") => {
            // Stream MJPEG directly from controller pipe (already in correct format)
            use tokio::fs::File;

            let stream_file = match File::open("/tmp/camera_stream").await {
                Ok(f) => f,
                Err(e) => {
                    return Ok(Some(make_api_response(serde_json::json!({
                        "success": false,
                        "error": format!("Failed to open stream pipe: {}", e)
                    }))));
                }
            };

            // Pass through the stream directly - controller writes MJPEG format
            // Use 256KB buffer for better throughput (default 8KB is too small for 200KB frames)
            let byte_stream = ReaderStream::with_capacity(stream_file, 256 * 1024);
            use http_body_util::BodyExt;

            let body = StreamBody::new(byte_stream.map(|r| r.map(Frame::data)));
            let boxed_body = BodyExt::boxed(body);

            let response = Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "multipart/x-mixed-replace; boundary=FRAME")
                .header("Cache-Control", "no-cache, no-store, must-revalidate")
                .header("Pragma", "no-cache")
                .header("Expires", "0")
                .header("Access-Control-Allow-Origin", "*")
                .body(boxed_body)
                .unwrap();

            return Ok(Some(response));
        }

        (&Method::GET, "/api/debug") => {
            let camera_id = parse_query_param(&uri_str, "camera");
            let debug = state.debug_camera(camera_id);
            Some(make_api_response(debug))
        }

        (&Method::GET, "/api/camera/config") => {
            let config = get_camera_config_via_controller().await;
            Some(make_api_response(config))
        }

        (&Method::GET, "/api/camera/status") => {
            let camera_id = parse_query_param(&uri_str, "camera");
            let camera_id_str = camera_id.unwrap_or(0).to_string();

            // Return cached status
            let cached = shared_state.cached_status.lock().await;
            let status = cached.get(&camera_id_str)
                .map(|(v, _)| v.clone())
                .unwrap_or_else(|| serde_json::json!({"error": "No cached status available"}));
            drop(cached);

            Some(make_api_response(status))
        }

        (&Method::GET, "/api/widgets") => {
            let camera_id = parse_query_param(&uri_str, "camera");
            let widgets = state.list_widgets(camera_id);
            Some(make_api_response(widgets))
        }

        // POST /api/camera/config - Set camera configuration
        (&Method::POST, "/api/camera/config") => {
            // Read the body - need to take ownership
            let body_bytes = match BodyExt::collect(req.into_body()).await {
                Ok(collected) => collected.to_bytes(),
                Err(e) => {
                    let error_json = serde_json::json!({
                        "error": format!("Failed to read request body: {}", e)
                    });
                    return Ok(Some(make_api_response(error_json)));
                }
            };

            let body_str = String::from_utf8_lossy(&body_bytes);
            let result: serde_json::Value;

            // Try to parse as JSON first
            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&body_str) {
                let setting = config.get("setting").and_then(|v| v.as_str());
                let value_json = config.get("value");

                // Handle both string and numeric values
                let value_string;
                let value = if let Some(v) = value_json.and_then(|v| v.as_str()) {
                    Some(v)
                } else if let Some(v) = value_json.and_then(|v| v.as_i64()) {
                    value_string = v.to_string();
                    Some(value_string.as_str())
                } else if let Some(v) = value_json.and_then(|v| v.as_u64()) {
                    value_string = v.to_string();
                    Some(value_string.as_str())
                } else {
                    None
                };

                if let (Some(s), Some(v)) = (setting, value) {
                    result = set_camera_config_via_controller(s, v).await;
                } else {
                    result = serde_json::json!({
                        "error": "JSON must contain 'setting' and 'value' fields. Example: {\"setting\":\"iso\",\"value\":\"800\"}"
                    });
                }
            } else {
                // Not valid JSON, try form data format: "setting=value"
                if let Some(eq_pos) = body_str.find('=') {
                    let setting = &body_str[..eq_pos];
                    let value = &body_str[eq_pos + 1..];
                    if !setting.is_empty() && !value.is_empty() {
                        result = set_camera_config_via_controller(setting, value).await;
                    } else {
                        result = serde_json::json!({
                            "error": "Invalid format. Use JSON or 'setting=value' format"
                        });
                    }
                } else {
                    result = serde_json::json!({
                        "error": "Invalid format. Use JSON like {\"setting\":\"iso\",\"value\":\"800\"} or form data like 'iso=800'"
                    });
                }
            }

            Some(make_api_response(result))
        }

        (&Method::GET, "/api/status") => {
            Some(make_api_response(serde_json::json!({
                "daemon_running": true,
                "libgphoto2_available": state.check_libgphoto2(),
                "active_sessions": state.sessions.len(),
            })))
        }

        // GET /api/photo/{filename} - Serve captured image (streaming for performance)
        (&Method::GET, path) if path.starts_with("/api/photo/") => {
            let filename = path.strip_prefix("/api/photo/")
                .unwrap_or_default()
                .trim_start_matches('/');

            // Security: only allow alphanumeric, dots, underscores, hyphens
            if !filename.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '_' || c == '-') {
                Some(Response::builder()
                    .status(StatusCode::BAD_REQUEST)
                    .header("content-type", "application/json")
                    .body(full_body(r#"{"error":"Invalid filename"}"#))
                    .unwrap())
            } else {
                let file_path = Path::new("/tmp").join(filename);
                match tokio::fs::File::open(&file_path).await {
                    Ok(file) => {
                        // Determine content type based on extension
                        let content_type = if filename.ends_with(".jpg") || filename.ends_with(".jpeg") {
                            "image/jpeg"
                        } else if filename.ends_with(".png") {
                            "image/png"
                        } else {
                            "application/octet-stream"
                        };

                        // Get file size for Content-Length header
                        let file_size = file.metadata().await.ok().map(|m| m.len());

                        // Stream the file in chunks for better performance
                        let stream = ReaderStream::new(file);
                        let body: ResponseBody = BodyExt::boxed(StreamBody::new(stream.map(|result| {
                            result.map(Frame::data)
                        })));

                        let mut builder = Response::builder()
                            .status(StatusCode::OK)
                            .header("content-type", content_type)
                            .header("access-control-allow-origin", "*");

                        if let Some(size) = file_size {
                            builder = builder.header("content-length", size);
                        }

                        Some(builder.body(body).unwrap())
                    }
                    Err(e) => {
                        eprintln!("Failed to open file {}: {}", file_path.display(), e);
                        Some(Response::builder()
                            .status(StatusCode::NOT_FOUND)
                            .header("content-type", "application/json")
                            .body(full_body(format!(r#"{{"error":"File not found: {}"}}"#, filename)))
                            .unwrap())
                    }
                }
            }
        }

        // DELETE /api/photo/{filename} - Delete captured image
        (&Method::DELETE, path) if path.starts_with("/api/photo/") => {
            let filename = path.strip_prefix("/api/photo/")
                .unwrap_or_default()
                .trim_start_matches('/');

            // Security: only allow alphanumeric, dots, underscores, hyphens
            if !filename.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '_' || c == '-') {
                Some(make_api_response(serde_json::json!({
                    "success": false,
                    "error": "Invalid filename"
                })))
            } else {
                let file_path = Path::new("/tmp").join(filename);
                match fs::remove_file(&file_path) {
                    Ok(_) => {
                        println!("Deleted file: {}", file_path.display());
                        Some(make_api_response(serde_json::json!({
                            "success": true,
                            "message": format!("Deleted {}", filename)
                        })))
                    }
                    Err(e) => {
                        eprintln!("Failed to delete file {}: {}", file_path.display(), e);
                        Some(make_api_response(serde_json::json!({
                            "success": false,
                            "error": format!("Failed to delete: {}", e)
                        })))
                    }
                }
            }
        }

        _ => {
            Some(Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header("content-type", "application/json")
                .body(full_body(r#"{"error":"Not found"}"#))
                .unwrap())
        }
    };

    Ok(response)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let state = CameraState::new();
    let shared_state = SharedState::new();

    // Check if libgphoto2 is available at startup
    println!("Checking libgphoto2 availability...");
    if !state.check_libgphoto2() {
        println!("WARNING: libgphoto2 not available!");
        println!("Camera operations will fail.");
    } else {
        println!("libgphoto2 is available!");
    }

    // Clean up old pipes before starting the controller
    let _ = std::fs::remove_file("/tmp/camera_cmd");
    let _ = std::fs::remove_file("/tmp/camera_status");

    // Start the gphoto2-controller process with respawn logic
    println!("Starting gphoto2-controller with auto-restart...");
    let shared_state_for_controller = shared_state.clone();
    tokio::spawn(async move {
        start_controller_process(&shared_state_for_controller).await;
    });

    // Wait for controller to create the status pipe (typically <500ms)
    {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if std::path::Path::new("/tmp/camera_status").exists() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    // Get port from environment variable or use default
    // Default: 58321 for production (less common than 3000)
    let port = std::env::var("PHOTOBOOTH_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(58321);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("Photobooth Camera Daemon v1.4");
    println!("Listening on http://{}", addr);
    println!();
    println!("API Endpoints:");
    println!("  GET    /api/health           - Health check");
    println!("  GET    /api/cameras          - List cameras");
    println!("  POST   /api/capture         - Trigger capture");
    println!("  GET    /api/debug           - Camera debug info");
    println!("  GET    /api/status          - Daemon status");
    println!("  GET    /api/camera/config   - Camera settings (ISO, aperture, etc)");
    println!("  POST   /api/camera/config   - Set camera setting (JSON or form data)");
    println!("  GET    /api/camera/status   - Quick status check (battery, ISO, etc)");
    println!("  GET    /api/photo/{{filename}} - Download captured image");
    println!("  DELETE /api/photo/{{filename}} - Delete image from VM");
    println!("  WS     /ws                  - WebSocket for photo events");
    println!();
    println!("Live View Options:");
    println!("  HDMI Capture: Uses HDMI-to-USB adapter (no camera lock, low latency)");
    println!("  USB Live View: Direct via libgphoto2 (locks camera buttons, slightly higher latency)");
    println!();
    println!("  POST   /api/liveview/start  - Start USB live view (locks camera, pauses polling)");
    println!("  POST   /api/liveview/stop   - Stop USB live view (unlocks camera, resumes polling)");
    println!("  GET    /api/liveview/status - Check live view status");
    println!("  GET    /api/liveview/frame  - Request preview frame (data via WebSocket)");
    println!("  POST   /api/liveview/ptp-stream/start - Start continuous PTP streaming");
    println!("  POST   /api/liveview/ptp-stream/stop  - Stop continuous PTP streaming");
    println!("  GET    /api/liveview/ptp-stream       - MJPEG stream from PTP camera (multipart/x-mixed-replace)");
    println!();

    let listener = TcpListener::bind(addr).await?;

    // We run this service for every connection
    loop {
        let (socket, remote_addr) = listener.accept().await?;
        println!("Connection from {}", remote_addr);

        let state = state.clone();
        let shared_state = shared_state.clone();

        tokio::task::spawn(async move {
            let socket_wrapper = TokioIo::new(socket);

            let svc = service_fn(move |mut req| {
                let state = state.clone();
                let shared_state = shared_state.clone();

                async move {
                    // Check if this is a WebSocket upgrade request
                    if req.uri().path() == "/ws" &&
                       req.headers().get("upgrade")
                           .and_then(|v| v.to_str().ok())
                           .map(|v| v.eq_ignore_ascii_case("websocket"))
                           .unwrap_or(false) {
                        // Compute Sec-WebSocket-Accept from client's key (RFC 6455)
                        let ws_key = req.headers().get("sec-websocket-key")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("")
                            .to_string();
                        let accept_key = compute_websocket_accept(&ws_key);

                        // Schedule the WebSocket handler to run after the 101 response is sent
                        let upgrade_future = hyper::upgrade::on(&mut req);
                        tokio::spawn(async move {
                            match upgrade_future.await {
                                Ok(upgraded) => {
                                    let ws_stream = WebSocketStream::from_raw_socket(
                                        TokioIo::new(upgraded),
                                        tokio_tungstenite::tungstenite::protocol::Role::Server,
                                        None,
                                    ).await;
                                    handle_websocket(ws_stream, shared_state).await;
                                }
                                Err(e) => {
                                    eprintln!("WebSocket upgrade error: {}", e);
                                }
                            }
                        });

                        // Return 101 Switching Protocols with proper accept key
                        Ok(Response::builder()
                            .status(StatusCode::SWITCHING_PROTOCOLS)
                            .header("upgrade", "websocket")
                            .header("connection", "Upgrade")
                            .header("sec-websocket-accept", accept_key)
                            .body(full_body(""))
                            .unwrap())
                    } else {
                        // Regular HTTP request
                        match handle_request(state, shared_state, req).await {
                            Ok(Some(resp)) => Ok(resp),
                            Ok(None) => {
                                // Should not happen for non-WS requests
                                Ok(Response::builder()
                                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                                    .body(full_body("Internal error"))
                                    .unwrap())
                            }
                            Err(e) => Err(e),
                        }
                    }
                }
            });

            http1::Builder::new()
                .serve_connection(socket_wrapper, svc)
                .with_upgrades()
                .await
                .unwrap_or_else(|e| {
                    eprintln!("Server error: {}", e);
                });
        });
    }
}

// Handle WebSocket connection
async fn handle_websocket(
    ws_stream: WebSocketStream<TokioIo<hyper::upgrade::Upgraded>>,
    shared_state: SharedState,
) {
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let mut rx = shared_state.ws_tx.subscribe();

    println!("WebSocket client connected");

    // Task to forward broadcast messages to this client
    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Task to handle incoming messages from client (keepalive, control)
    let recv_task = tokio::spawn(async move {
        while let Some(result) = ws_receiver.next().await {
            match result {
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(e) => {
                    eprintln!("WebSocket error: {}", e);
                    break;
                }
            }
        }
    });

    // Wait for either task to complete
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    println!("WebSocket client disconnected");
}
