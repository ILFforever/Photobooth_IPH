//! Photobooth Camera Daemon
//!
//! HTTP server for camera operations using libgphoto2
//! Runs on minimal Linux, exposed via HTTP API

mod types;
mod storage;
mod camera;
mod controller;
mod http;
mod websocket;

use hyper::Response;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use std::net::SocketAddr;
use tokio_tungstenite::WebSocketStream;

use camera::CameraState;
use controller::{ControllerState, start_controller_process};
use http::{handle_request, full_body, compute_websocket_accept};
use websocket::{SharedState, handle_websocket};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let state = CameraState::new();
    let controller_state = ControllerState::new();
    let ws_state = SharedState::new();

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
    let controller_state_for_controller = controller_state.clone();
    let ws_tx = ws_state.ws_tx.clone();
    tokio::spawn(async move {
        start_controller_process(controller_state_for_controller, ws_tx).await;
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
    println!("  GET    /api/liveview/status - Check live view status");
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
        let controller_state = controller_state.clone();
        let ws_state = ws_state.clone();

        tokio::task::spawn(async move {
            let socket_wrapper = TokioIo::new(socket);

            let svc = service_fn(move |mut req| {
                let state = state.clone();
                let controller_state = controller_state.clone();
                let ws_state = ws_state.clone();

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
                                    handle_websocket(ws_stream, ws_state).await;
                                }
                                Err(e) => {
                                    eprintln!("WebSocket upgrade error: {}", e);
                                }
                            }
                        });

                        // Return 101 Switching Protocols with proper accept key
                        Ok(Response::builder()
                            .status(hyper::StatusCode::SWITCHING_PROTOCOLS)
                            .header("upgrade", "websocket")
                            .header("connection", "Upgrade")
                            .header("sec-websocket-accept", accept_key)
                            .body(full_body(""))
                            .unwrap())
                    } else {
                        // Regular HTTP request
                        match handle_request(state, controller_state, req).await {
                            Ok(Some(resp)) => Ok(resp),
                            Ok(None) => {
                                // Should not happen for non-WS requests
                                Ok(Response::builder()
                                    .status(hyper::StatusCode::INTERNAL_SERVER_ERROR)
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
