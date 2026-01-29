//! Photobooth Camera Daemon
//!
//! HTTP server for camera operations using libgphoto2
//! Runs on minimal Linux, exposed via HTTP API

use hyper::body::Incoming;
use hyper::{Request, Response, StatusCode, Method};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::body::Bytes;
use http_body_util::Full;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::fs;

// API Response types
#[derive(Serialize, Deserialize, Clone)]
struct CameraInfo {
    id: String,
    model: String,
    port: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    service: String,
    version: String,
    libgphoto2_available: bool,
}

#[derive(Serialize, Deserialize)]
struct CaptureResponse {
    success: bool,
    file_path: Option<String>,
    error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    camera_path: Option<String>,
}

impl CaptureResponse {
    fn error(msg: String) -> Self {
        Self { success: false, file_path: None, error: Some(msg), camera_path: None }
    }
}

#[derive(Deserialize)]
struct CaptureRequest {
    output_folder: Option<String>,
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
        Command::new("gphoto2-wrapper")
            .arg("version")
            .output()
            .map(|_| true)
            .unwrap_or(false)
    }

    fn list_cameras(&self) -> Vec<CameraInfo> {
        match Command::new("gphoto2-wrapper")
            .arg("list")
            .output()
        {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                println!("gphoto2 list stdout: {}", stdout);
                if !stderr.is_empty() {
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

    fn trigger_capture(&self) -> CaptureResponse {
        match Command::new("gphoto2-wrapper")
            .arg("capture")
            .output()
        {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                println!("gphoto2 capture stdout: {}", stdout);
                if !stderr.is_empty() {
                    eprintln!("gphoto2 capture stderr: {}", stderr);
                }
                match serde_json::from_str::<CaptureResponse>(stdout.trim()) {
                    Ok(resp) => resp,
                    Err(e) => CaptureResponse::error(
                        format!("Failed to parse capture response: {}. Raw: {}", e, stdout.trim())
                    ),
                }
            }
            Err(e) => CaptureResponse::error(
                format!("Failed to run gphoto2-wrapper capture: {}", e)
            ),
        }
    }

    fn debug_camera(&self) -> serde_json::Value {
        match Command::new("gphoto2-wrapper")
            .arg("debug")
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

    fn get_camera_config(&self) -> serde_json::Value {
        match Command::new("gphoto2-wrapper")
            .arg("config")
            .output()
        {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                println!("gphoto2 config stdout: {}", stdout);
                if !stderr.is_empty() {
                    eprintln!("gphoto2 config stderr: {}", stderr);
                }
                match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
                    Ok(val) => val,
                    Err(e) => serde_json::json!({
                        "error": format!("Failed to parse config response: {}. Raw: {}", e, stdout.trim()),
                        "stderr": stderr.trim(),
                    }),
                }
            }
            Err(e) => serde_json::json!({
                "error": format!("Failed to run gphoto2-wrapper config: {}", e),
            }),
        }
    }
}

fn make_api_response(data: impl Serialize) -> Response<Full<Bytes>> {
    match serde_json::to_string(&data) {
        Ok(json) => {
            Response::builder()
                .header("content-type", "application/json")
                .header("access-control-allow-origin", "*")
                .body(Full::new(Bytes::from(json)))
                .unwrap()
        }
        Err(e) => {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Full::new(Bytes::from(format!("{{\"error\":\"JSON error: {}\"}}", e))))
                .unwrap()
        }
    }
}

async fn handle_request(
    state: CameraState,
    req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let method = req.method();
    let path = req.uri().path();

    println!("{} {}", method, path);

    let response = match (method, path) {
        (&Method::GET, "/api/health") => {
            make_api_response(HealthResponse {
                status: "ok".to_string(),
                service: "photobooth-camera-daemon".to_string(),
                version: "1.0.0".to_string(),
                libgphoto2_available: state.check_libgphoto2(),
            })
        }

        (&Method::GET, "/api/cameras") => {
            let cameras = state.list_cameras();
            make_api_response(cameras)
        }

        (&Method::POST, "/api/capture") => {
            let capture = state.trigger_capture();
            make_api_response(capture)
        }

        (&Method::GET, "/api/debug") => {
            let debug = state.debug_camera();
            make_api_response(debug)
        }

        (&Method::GET, "/api/camera/config") => {
            let config = state.get_camera_config();
            make_api_response(config)
        }

        (&Method::GET, "/api/status") => {
            make_api_response(serde_json::json!({
                "daemon_running": true,
                "libgphoto2_available": state.check_libgphoto2(),
                "active_sessions": state.sessions.len(),
            }))
        }

        // GET /api/photo/{filename} - Serve captured image
        (&Method::GET, path) if path.starts_with("/api/photo/") => {
            let filename = path.strip_prefix("/api/photo/")
                .unwrap_or_default()
                .trim_start_matches('/');

            // Security: only allow alphanumeric, dots, underscores, hyphens
            if !filename.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '_' || c == '-') {
                Response::builder()
                    .status(StatusCode::BAD_REQUEST)
                    .header("content-type", "application/json")
                    .body(Full::new(Bytes::from(r#"{"error":"Invalid filename"}"#)))
                    .unwrap()
            } else {
                let file_path = Path::new("/tmp").join(filename);
                match fs::read(&file_path) {
                    Ok(data) => {
                        // Determine content type based on extension
                        let content_type = if filename.ends_with(".jpg") || filename.ends_with(".jpeg") {
                            "image/jpeg"
                        } else if filename.ends_with(".png") {
                            "image/png"
                        } else {
                            "application/octet-stream"
                        };

                        Response::builder()
                            .status(StatusCode::OK)
                            .header("content-type", content_type)
                            .header("content-length", data.len())
                            .header("access-control-allow-origin", "*")
                            .body(Full::new(Bytes::from(data)))
                            .unwrap()
                    }
                    Err(e) => {
                        eprintln!("Failed to read file {}: {}", file_path.display(), e);
                        Response::builder()
                            .status(StatusCode::NOT_FOUND)
                            .header("content-type", "application/json")
                            .body(Full::new(Bytes::from(format!(r#"{{"error":"File not found: {}"}}"#, filename))))
                            .unwrap()
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
                make_api_response(serde_json::json!({
                    "success": false,
                    "error": "Invalid filename"
                }))
            } else {
                let file_path = Path::new("/tmp").join(filename);
                match fs::remove_file(&file_path) {
                    Ok(_) => {
                        println!("Deleted file: {}", file_path.display());
                        make_api_response(serde_json::json!({
                            "success": true,
                            "message": format!("Deleted {}", filename)
                        }))
                    }
                    Err(e) => {
                        eprintln!("Failed to delete file {}: {}", file_path.display(), e);
                        make_api_response(serde_json::json!({
                            "success": false,
                            "error": format!("Failed to delete: {}", e)
                        }))
                    }
                }
            }
        }

        _ => {
            Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header("content-type", "application/json")
                .body(Full::new(Bytes::from(r#"{"error":"Not found - available endpoints: /api/health, /api/cameras, /api/capture, /api/debug, /api/status, /api/camera/config, /api/photo/{filename}"}"#)))
                .unwrap()
        }
    };

    Ok(response)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let state = CameraState::new();

    // Check if libgphoto2 is available at startup
    println!("Checking libgphoto2 availability...");
    if !state.check_libgphoto2() {
        println!("WARNING: libgphoto2 not available!");
        println!("Camera operations will fail.");
    } else {
        println!("libgphoto2 is available!");
    }

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    println!("Photobooth Camera Daemon v1.0");
    println!("Listening on http://{}", addr);
    println!();
    println!("API Endpoints:");
    println!("  GET    /api/health          - Health check");
    println!("  GET    /api/cameras         - List cameras");
    println!("  POST   /api/capture        - Trigger capture");
    println!("  GET    /api/debug          - Camera debug info");
    println!("  GET    /api/status         - Daemon status");
    println!("  GET    /api/camera/config  - Camera settings (ISO, aperture, etc)");
    println!("  GET    /api/photo/{{filename}} - Download captured image");
    println!("  DELETE /api/photo/{{filename}} - Delete image from VM");
    println!();

    let listener = TcpListener::bind(addr).await?;

    // We run this service for every connection
    loop {
        let (socket, remote_addr) = listener.accept().await?;
        println!("Connection from {}", remote_addr);

        let state = state.clone();

        tokio::task::spawn(async move {
            let socket_wrapper = TokioIo::new(socket);
            let http = http1::Builder::new();
            let svc = service_fn(move |req| {
                handle_request(state.clone(), req)
            });
            http.serve_connection(socket_wrapper, svc).await.unwrap_or_else(|e| {
                eprintln!("Server error: {}", e);
            });
        });
    }
}
