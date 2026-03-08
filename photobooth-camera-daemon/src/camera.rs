//! Camera operations using gphoto2-wrapper

use crate::types::CameraInfo;
use std::collections::HashMap;
use std::process::Command as StdCommand;

/// State for camera sessions
#[derive(Clone)]
pub struct CameraState {
    pub sessions: HashMap<String, CameraInfo>,
}

impl CameraState {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Check if libgphoto2 is available via gphoto2-wrapper
    pub fn check_libgphoto2(&self) -> bool {
        // Check if gphoto2-wrapper is available
        StdCommand::new("/opt/photobooth/gphoto2-wrapper")
            .arg("version")
            .output()
            .map(|_| true)
            .unwrap_or(false)
    }

    /// List connected cameras
    pub fn list_cameras(&self) -> Vec<CameraInfo> {
        match StdCommand::new("/opt/photobooth/gphoto2-wrapper")
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

    /// Get debug info from camera
    pub fn debug_camera(&self, camera_id: Option<u32>) -> serde_json::Value {
        let camera_idx = camera_id.unwrap_or(0).to_string();
        match StdCommand::new("/opt/photobooth/gphoto2-wrapper")
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

    /// List all available configuration widgets
    pub fn list_widgets(&self, camera_id: Option<u32>) -> serde_json::Value {
        let camera_idx = camera_id.unwrap_or(0).to_string();
        match StdCommand::new("/opt/photobooth/gphoto2-wrapper")
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
