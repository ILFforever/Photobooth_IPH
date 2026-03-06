use std::path::PathBuf;

/// Returns the path to the FFmpeg executable.
///
/// Priority order:
/// 1. Downloaded FFmpeg in app data folder
/// 2. System FFmpeg from PATH
///
/// This allows the app to work with auto-downloaded FFmpeg or system-installed FFmpeg.
pub fn ffmpeg_path() -> PathBuf {
    // First, try to use the downloaded FFmpeg
    if let Ok(path) = crate::ffmpeg_manager::ffmpeg_executable_path() {
        if path.exists() {
            return path;
        }
    }

    // Fallback to system ffmpeg from PATH
    PathBuf::from("ffmpeg")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ffmpeg_path() {
        let path = ffmpeg_path();
        // Should return a path ending with ffmpeg or ffmpeg.exe
        let path_str = path.to_string_lossy();
        assert!(path_str.ends_with("ffmpeg") || path_str.ends_with("ffmpeg.exe"));
    }
}
