use std::fs;
use std::path::{Path, PathBuf};
use std::io::Write;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    pub current_bytes: u64,
    pub total_bytes: u64,
    pub percentage: f64,
    pub stage: String,
}

/// Returns the directory where FFmpeg should be stored
pub fn ffmpeg_dir() -> Result<PathBuf, String> {
    let mut dir = dirs::config_dir()
        .ok_or_else(|| "Failed to get config directory".to_string())?;
    dir.push("Photobooth_IPH");
    dir.push("ffmpeg");
    Ok(dir)
}

/// Returns the path to the FFmpeg executable
pub fn ffmpeg_executable_path() -> Result<PathBuf, String> {
    let dir = ffmpeg_dir()?;

    #[cfg(windows)]
    let mut exe = dir.join("ffmpeg.exe");

    #[cfg(not(windows))]
    let mut exe = dir.join("ffmpeg");

    Ok(exe)
}

/// Check if FFmpeg is already downloaded
pub fn is_ffmpeg_installed() -> bool {
    match ffmpeg_executable_path() {
        Ok(path) => path.exists(),
        Err(_) => false,
    }
}

/// Download FFmpeg with progress reporting
pub async fn download_ffmpeg(
    url: &str,
    app: &AppHandle,
) -> Result<PathBuf, String> {
    let dir = ffmpeg_dir()?;

    // Create directory if it doesn't exist
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create ffmpeg directory: {}", e))?;

    // Emit start event
    let _ = app.emit("ffmpeg-download-progress", DownloadProgress {
        current_bytes: 0,
        total_bytes: 0,
        percentage: 0.0,
        stage: "connecting".to_string(),
    });

    // Start download
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to connect to download URL: {}", e))?;

    let total_bytes = response.content_length().unwrap_or(0);

    // Emit progress with total size
    let _ = app.emit("ffmpeg-download-progress", DownloadProgress {
        current_bytes: 0,
        total_bytes,
        percentage: 0.0,
        stage: "downloading".to_string(),
    });

    // Download with progress tracking
    let mut downloaded_bytes = 0u64;
    let mut file = {
        let exe_path = ffmpeg_executable_path()?;
        fs::File::create(&exe_path)
            .map_err(|e| format!("Failed to create ffmpeg file: {}", e))?
    };

    let mut stream = response.bytes_stream();

    use futures::StreamExt;
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result
            .map_err(|e| format!("Download error: {}", e))?;

        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write ffmpeg file: {}", e))?;

        downloaded_bytes += chunk.len() as u64;

        // Emit progress
        if total_bytes > 0 {
            let percentage = (downloaded_bytes as f64 / total_bytes as f64) * 100.0;
            let _ = app.emit("ffmpeg-download-progress", DownloadProgress {
                current_bytes: downloaded_bytes,
                total_bytes,
                percentage,
                stage: "downloading".to_string(),
            });
        }
    }

    // Mark as executable on Unix-like systems
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        let exe_path = ffmpeg_executable_path()?;
        let mut perms = fs::metadata(&exe_path)
            .map_err(|e| format!("Failed to get ffmpeg permissions: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&exe_path, perms)
            .map_err(|e| format!("Failed to set ffmpeg permissions: {}", e))?;
    }

    // Emit complete event
    let _ = app.emit("ffmpeg-download-progress", DownloadProgress {
        current_bytes: downloaded_bytes,
        total_bytes,
        percentage: 100.0,
        stage: "complete".to_string(),
    });

    ffmpeg_executable_path()
}

/// Delete downloaded FFmpeg
pub fn delete_ffmpeg() -> Result<(), String> {
    let exe_path = ffmpeg_executable_path()?;

    if exe_path.exists() {
        fs::remove_file(&exe_path)
            .map_err(|e| format!("Failed to delete ffmpeg: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn check_ffmpeg_installed() -> bool {
    is_ffmpeg_installed()
}

#[tauri::command]
pub async fn get_ffmpeg_version() -> Result<String, String> {
    if !is_ffmpeg_installed() {
        return Err("FFmpeg is not installed".to_string());
    }

    let exe_path = ffmpeg_executable_path()?;

    let output = std::process::Command::new(&exe_path)
        .arg("-version")
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        return Err("FFmpeg failed to run".to_string());
    }

    let version_str = String::from_utf8_lossy(&output.stdout);
    // Extract version line and shorten it
    if let Some(line) = version_str.lines().next() {
        // Parse format: "ffmpeg version N-123175-gcebe0b577e-20260305 Copyright (c) 2000-2026 the FFmpeg developers"
        // Extract just the version part: "N-123175-gcebe0b577e"
        if let Some(version_start) = line.find("version ") {
            let after_version = &line[version_start + 8..]; // Skip "version "
            if let Some(copyright_pos) = after_version.find(" Copyright") {
                return Ok(after_version[..copyright_pos].to_string());
            }
        }
        // Fallback: return first 30 chars if parsing fails
        Ok(line.chars().take(30).collect())
    } else {
        Err("Failed to parse FFmpeg version".to_string())
    }
}

#[tauri::command]
pub async fn get_ffmpeg_size() -> Result<u64, String> {
    if !is_ffmpeg_installed() {
        return Err("FFmpeg is not installed".to_string());
    }

    let exe_path = ffmpeg_executable_path()?;

    let metadata = fs::metadata(&exe_path)
        .map_err(|e| format!("Failed to get ffmpeg metadata: {}", e))?;

    Ok(metadata.len())
}

#[tauri::command]
pub async fn download_ffmpeg_command(
    url: String,
    app: AppHandle,
) -> Result<String, String> {
    let path = download_ffmpeg(&url, &app).await?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_ffmpeg_command() -> Result<(), String> {
    delete_ffmpeg()
}

/// Provides a user-friendly error message when FFmpeg is not found
pub fn ffmpeg_not_found_error() -> String {
    format!(
        "FFmpeg not found. Please download FFmpeg to use this feature. \
        Use the download button in the app or run: download_ffmpeg_command"
    )
}

/// Check if FFmpeg exists and return an error if not
pub fn ensure_ffmpeg_exists() -> Result<(), String> {
    let ffmpeg_path = crate::ffmpeg_sidecar::ffmpeg_path();

    if !ffmpeg_path.exists() {
        return Err(ffmpeg_not_found_error());
    }

    Ok(())
}
