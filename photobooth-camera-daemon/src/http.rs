//! HTTP request handling and routing

use hyper::body::Incoming;
use hyper::{Request, Response, StatusCode, Method};
use hyper::body::{Bytes, Frame};
use http_body_util::{Full, StreamBody, BodyExt, combinators::BoxBody};
use tokio_util::io::ReaderStream;
use futures_util::stream::StreamExt;
use std::path::Path;
use serde::Serialize;
use sha1::{Sha1, Digest};
use base64::Engine;

/// Type alias for boxed response body that can be either Full or streaming
pub type ResponseBody = BoxBody<Bytes, std::io::Error>;

/// Convert a Full<Bytes> body to a boxed body
pub fn full_body(data: impl Into<Bytes>) -> ResponseBody {
    Full::new(data.into())
        .map_err(|never| match never {})
        .boxed()
}

/// Compute the Sec-WebSocket-Accept value per RFC 6455
pub fn compute_websocket_accept(key: &str) -> String {
    const WS_MAGIC: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    let mut hasher = Sha1::new();
    hasher.update(key.as_bytes());
    hasher.update(WS_MAGIC.as_bytes());
    let result = hasher.finalize();
    base64::engine::general_purpose::STANDARD.encode(&result)
}

use crate::camera::CameraState;
use crate::controller::ControllerState;
use crate::storage::ensure_storage_space;

/// Parse query parameter from URI
pub fn parse_query_param(uri: &str, param_name: &str) -> Option<u32> {
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

/// Make a JSON API response
pub fn make_api_response(data: impl Serialize) -> Response<ResponseBody> {
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
                .body(full_body(format!(r#"{{"error":"JSON error: {}"}}"#, e)))
                .unwrap()
        }
    }
}

/// Get USB device info from VBoxManage (runs on Windows host)
pub fn get_vbox_usb_info() -> serde_json::Value {
    use std::process::Command;

    let vbox_paths = [
        r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe",
        r"C:\Program Files (x86)\Oracle\VirtualBox\VBoxManage.exe",
    ];

    let find_vbox = || -> Option<&'static str> {
        for path in &vbox_paths {
            if std::path::Path::new(path).exists() {
                return Some(path);
            }
        }
        None
    };

    let vbox_path = match find_vbox() {
        Some(p) => p,
        None => return serde_json::json!({
            "source": "VBoxManage",
            "error": "VBoxManage not found",
            "success": false
        }),
    };

    let mut result = serde_json::json!({
        "source": "VBoxManage",
        "success": true
    });

    // Get VM info to check USB controller type
    if let Ok(output) = Command::new(vbox_path)
        .args(&["showvminfo", "PhotoboothLinux", "--machinereadable"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Parse USB controller type
            let mut usb_controller = "unknown";
            for line in stdout.lines() {
                if line.starts_with("USBControllerName") {
                    if line.contains("xHCI") {
                        usb_controller = "USB 3.0 (xHCI)";
                    } else if line.contains("EHCI") {
                        usb_controller = "USB 2.0 (EHCI)";
                    } else if line.contains("OHCI") {
                        usb_controller = "USB 1.1 (OHCI)";
                    }
                }
            }
            result["vm_usb_controller"] = serde_json::json!(usb_controller);
        }
    }

    // Get host USB devices with actual speeds
    if let Ok(output) = Command::new(vbox_path)
        .args(&["list", "usbhost"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut devices = Vec::new();
            let mut current_device: Option<serde_json::Map<String, serde_json::Value>> = None;

            for line in stdout.lines() {
                let line = line.trim();
                if line.starts_with("UUID:") {
                    // Save previous device
                    if let Some(dev) = current_device.take() {
                        devices.push(serde_json::Value::Object(dev));
                    }
                    current_device = Some(serde_json::Map::new());
                }
                if let Some(ref mut dev) = current_device {
                    if let Some((key, val)) = line.split_once(':') {
                        let key = key.trim().to_lowercase().replace(' ', "_");
                        let val = val.trim().to_string();
                        dev.insert(key, serde_json::Value::String(val));
                    }
                }
            }
            if let Some(dev) = current_device.take() {
                devices.push(serde_json::Value::Object(dev));
            }

            // Find camera devices and extract speed info
            let camera_keywords = ["fujifilm", "canon", "nikon", "sony", "camera", "x-h2", "x-t", "x-s"];
            let mut camera_usb_speed = String::new();
            for dev in &devices {
                let product = dev.get("product").and_then(|v| v.as_str()).unwrap_or("");
                let manufacturer = dev.get("manufacturer").and_then(|v| v.as_str()).unwrap_or("");
                let speed = dev.get("speed").and_then(|v| v.as_str()).unwrap_or("");
                let combined = format!("{} {}", manufacturer, product).to_lowercase();

                if camera_keywords.iter().any(|kw| combined.contains(kw)) {
                    camera_usb_speed = speed.to_string();
                    result["camera_product"] = serde_json::json!(product);
                    result["camera_manufacturer"] = serde_json::json!(manufacturer);
                    result["camera_host_speed"] = serde_json::json!(speed);
                }
            }

            // Determine actual USB version from host speed string
            let camera_usb_speed_lower = camera_usb_speed.to_lowercase();
            if camera_usb_speed_lower.contains("super") || camera_usb_speed_lower.contains("5000") {
                result["camera_usb_version"] = serde_json::json!("USB 3.0");
            } else if camera_usb_speed_lower.contains("high") || camera_usb_speed_lower.contains("480") {
                result["camera_usb_version"] = serde_json::json!("USB 2.0");
            }

            result["host_usb_devices_count"] = serde_json::json!(devices.len());
            result["host_usb_devices"] = serde_json::json!(devices);
        }
    }

    result
}

/// Handle incoming HTTP requests
pub async fn handle_request(
    state: CameraState,
    controller_state: ControllerState,
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

    // WebSocket upgrade request - return None to signal upgrade
    if path == "/ws" {
        let has_upgrade = req.headers()
            .get("upgrade")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.eq_ignore_ascii_case("websocket"))
            .unwrap_or(false);

        if has_upgrade {
            return Ok(None);
        }
    }

    let response = match (method, path) {
        // Health check
        (&Method::GET, "/api/health") => {
            Some(make_api_response(crate::types::HealthResponse::new(state.check_libgphoto2())))
        }

        // List cameras
        (&Method::GET, "/api/cameras") => {
            let controller_active = *controller_state.controller_active.lock().await;
            let cached_cameras = controller_state.cached_cameras.lock().await.clone();

            let cameras = if controller_active && !cached_cameras.is_empty() {
                println!("GET /api/cameras - returning cached info from controller");
                cached_cameras
            } else if controller_active {
                println!("GET /api/cameras - controller active but no cache yet, returning empty");
                vec![]
            } else {
                println!("GET /api/cameras - controller not active, calling gphoto2-wrapper list");
                let cameras = state.list_cameras();
                if cameras.iter().any(|c| c.model == "Unknown Camera") {
                    eprintln!("WARNING: Got 'Unknown Camera' even though controller is inactive");
                }
                cameras
            };

            Some(make_api_response(cameras))
        }

        // Capture photo
        (&Method::POST, "/api/capture") => {
            ensure_storage_space(50).await;
            match crate::controller::send_command("CAPTURE").await {
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

        // Controller switch camera
        (&Method::POST, path) if path.starts_with("/api/controller/switch") => {
            let camera_index = parse_query_param(&uri_str, "camera").unwrap_or(0);
            let cmd = format!("SWITCH_CAMERA {}", camera_index);
            match crate::controller::send_command(&cmd).await {
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

        // Controller disconnect
        (&Method::POST, "/api/controller/disconnect") => {
            match crate::controller::send_command("DISCONNECT").await {
                Ok(_) => Some(make_api_response(serde_json::json!({
                    "success": true,
                    "message": "Polling stopped"
                }))),
                Err(e) => Some(make_api_response(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to stop polling: {}", e)
                })))
            }
        }

        // Pause polling
        (&Method::POST, "/api/controller/pause-polling") => {
            match crate::controller::send_command("PAUSE_POLLING").await {
                Ok(_) => Some(make_api_response(serde_json::json!({
                    "success": true,
                    "message": "Polling paused"
                }))),
                Err(e) => Some(make_api_response(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to pause polling: {}", e)
                })))
            }
        }

        // Resume polling
        (&Method::POST, "/api/controller/resume-polling") => {
            match crate::controller::send_command("RESUME_POLLING").await {
                Ok(_) => Some(make_api_response(serde_json::json!({
                    "success": true,
                    "message": "Polling resumed"
                }))),
                Err(e) => Some(make_api_response(serde_json::json!({
                    "success": false,
                    "error": format!("Failed to resume polling: {}", e)
                })))
            }
        }

        // Live view start
        (&Method::POST, "/api/liveview/start") => {
            match crate::controller::send_command("LIVEVIEW_START").await {
                Ok(_) => {
                    *controller_state.liveview_active.lock().await = true;
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

        // Live view stop
        (&Method::POST, "/api/liveview/stop") => {
            match crate::controller::send_command("LIVEVIEW_STOP").await {
                Ok(_) => {
                    *controller_state.liveview_active.lock().await = false;
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

        // Live view status
        (&Method::GET, "/api/liveview/status") => {
            let active = *controller_state.liveview_active.lock().await;
            Some(make_api_response(serde_json::json!({
                "active": active
            })))
        }

        // Live view frame
        (&Method::GET, "/api/liveview/frame") => {
            let active = *controller_state.liveview_active.lock().await;
            if !active {
                Some(make_api_response(serde_json::json!({
                    "success": false,
                    "error": "Live view is not active. Call POST /api/liveview/start first."
                })))
            } else {
                match crate::controller::send_command("LIVEVIEW_FRAME").await {
                    Ok(_) => Some(make_api_response(serde_json::json!({
                        "success": true,
                        "message": "Frame capture requested - check WebSocket for data"
                    }))),
                    Err(e) => Some(make_api_response(serde_json::json!({
                        "success": false,
                        "error": format!("Failed to capture frame: {}", e)
                    })))
                }
            }
        }

        // PTP stream start
        (&Method::POST, "/api/liveview/ptp-stream/start") => {
            match crate::controller::send_command("LIVEVIEW_STREAM_START").await {
                Ok(_) => {
                    *controller_state.ptp_streaming_active.lock().await = true;
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

        // PTP stream stop
        (&Method::POST, "/api/liveview/ptp-stream/stop") => {
            match crate::controller::send_command("LIVEVIEW_STREAM_STOP").await {
                Ok(_) => {
                    *controller_state.ptp_streaming_active.lock().await = false;
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

        // PTP stream
        (&Method::GET, "/api/liveview/ptp-stream") => {
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

            let byte_stream = ReaderStream::with_capacity(stream_file, 256 * 1024);
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

        // USB info
        (&Method::GET, "/api/usb-info") => {
            Some(make_api_response(get_vbox_usb_info()))
        }

        // Debug info
        (&Method::GET, "/api/debug") => {
            let camera_id = parse_query_param(&uri_str, "camera");
            let debug = state.debug_camera(camera_id);
            Some(make_api_response(debug))
        }

        // Camera config (GET)
        (&Method::GET, "/api/camera/config") => {
            let config = crate::controller::get_camera_config().await;
            Some(make_api_response(config))
        }

        // Camera status
        (&Method::GET, "/api/camera/status") => {
            let camera_id = parse_query_param(&uri_str, "camera");
            let camera_id_str = camera_id.unwrap_or(0).to_string();

            let cached = controller_state.cached_status.lock().await;
            let status = cached.get(&camera_id_str)
                .map(|(v, _)| v.clone())
                .unwrap_or_else(|| serde_json::json!({"error": "No cached status available"}));
            drop(cached);

            Some(make_api_response(status))
        }

        // Widgets
        (&Method::GET, "/api/widgets") => {
            let camera_id = parse_query_param(&uri_str, "camera");
            let widgets = state.list_widgets(camera_id);
            Some(make_api_response(widgets))
        }

        // Camera config (POST)
        (&Method::POST, "/api/camera/config") => {
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

            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&body_str) {
                let setting = config.get("setting").and_then(|v| v.as_str());
                let value_json = config.get("value");

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
                    result = crate::controller::set_camera_config(s, v).await;
                } else {
                    result = serde_json::json!({
                        "error": "JSON must contain 'setting' and 'value' fields. Example: {\"setting\":\"iso\",\"value\":\"800\"}"
                    });
                }
            } else {
                if let Some(eq_pos) = body_str.find('=') {
                    let setting = &body_str[..eq_pos];
                    let value = &body_str[eq_pos + 1..];
                    if !setting.is_empty() && !value.is_empty() {
                        result = crate::controller::set_camera_config(setting, value).await;
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

        // Status endpoint
        (&Method::GET, "/api/status") => {
            Some(make_api_response(serde_json::json!({
                "daemon_running": true,
                "libgphoto2_available": state.check_libgphoto2(),
                "active_sessions": state.sessions.len(),
            })))
        }

        // Get photo
        (&Method::GET, path) if path.starts_with("/api/photo/") => {
            let filename = path.strip_prefix("/api/photo/")
                .unwrap_or_default()
                .trim_start_matches('/');

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
                        let content_type = if filename.ends_with(".jpg") || filename.ends_with(".jpeg") {
                            "image/jpeg"
                        } else if filename.ends_with(".png") {
                            "image/png"
                        } else {
                            "application/octet-stream"
                        };

                        let file_size = file.metadata().await.ok().map(|m| m.len());

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

        // Delete photo
        (&Method::DELETE, path) if path.starts_with("/api/photo/") => {
            let filename = path.strip_prefix("/api/photo/")
                .unwrap_or_default()
                .trim_start_matches('/');

            if !filename.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '_' || c == '-') {
                Some(make_api_response(serde_json::json!({
                    "success": false,
                    "error": "Invalid filename"
                })))
            } else {
                let file_path = Path::new("/tmp").join(filename);
                match std::fs::remove_file(&file_path) {
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

        // 404
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
