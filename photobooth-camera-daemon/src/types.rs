//! Shared types for the photobooth camera daemon

use serde::{Deserialize, Serialize};

/// Camera information returned by gphoto2
#[derive(Serialize, Deserialize, Clone)]
pub struct CameraInfo {
    pub id: String,
    pub manufacturer: String,
    pub model: String,
    pub port: String,
    #[serde(default)]
    pub usb_version: String,
    #[serde(default)]
    pub serial_number: String,
    #[serde(default)]
    pub firmware: String,
    #[serde(default)]
    pub lens: String,
}

/// Health check response
#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
    pub libgphoto2_available: bool,
}

impl HealthResponse {
    pub fn new(libgphoto2_available: bool) -> Self {
        Self {
            status: "ok".to_string(),
            service: "photobooth-camera-daemon".to_string(),
            version: "1.0.0".to_string(),
            libgphoto2_available,
        }
    }
}
