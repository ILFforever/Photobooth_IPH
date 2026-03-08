//! Storage management and cleanup

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

/// Get available disk space in bytes for a given path (Unix only)
#[cfg(unix)]
pub fn get_available_space(path: &str) -> Result<u64, String> {
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
pub fn get_available_space(_path: &str) -> Result<u64, String> {
    // Return a large value on Windows (used only for development)
    Ok(1024 * 1024 * 1024) // 1GB
}

/// Clean up old photos to free space. Deletes oldest files first until target space is freed.
/// Returns number of files deleted.
pub fn cleanup_old_photos(target_free_bytes: u64) -> Result<usize, String> {
    let photo_dir = std::path::Path::new("/tmp");

    // Get all photo files with their metadata
    let mut photos: Vec<(std::path::PathBuf, std::fs::Metadata)> = Vec::new();

    match std::fs::read_dir(photo_dir) {
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
        match std::fs::remove_file(&path) {
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
pub async fn ensure_storage_space(min_free_mb: u64) {
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
