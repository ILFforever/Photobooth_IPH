use crate::types::{ImageDimensions, ThumbnailLoadProgress, WorkingFolderInfo, WorkingImage, ImageFileInfo};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Deserialize)]
pub struct CachedThumbnailResult {
    pub original_path: String,
    pub thumbnail_url: String,
}

#[derive(Clone)]
pub struct ThumbnailResult {
    pub thumbnail: String,
    pub dimensions: Option<ImageDimensions>,
}

#[tauri::command]
pub async fn get_images_in_folder(folder_path: String) -> Result<Vec<String>, String> {
    let mut paths = Vec::new();
    if let Ok(entries) = fs::read_dir(folder_path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Some(ext) = p.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if matches!(ext_str.as_str(), "jpg" | "jpeg" | "png") {
                    paths.push(p.to_string_lossy().to_string());
                }
            }
        }
    }
    Ok(paths)
}

#[tauri::command]
pub async fn get_images_with_metadata(folder_path: String) -> Result<Vec<ImageFileInfo>, String> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(folder_path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Some(ext) = p.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if matches!(ext_str.as_str(), "jpg" | "jpeg" | "png") {
                    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
                    files.push(ImageFileInfo {
                        path: p.to_string_lossy().to_string(),
                        size: meta.len(),
                        extension: ext_str,
                    });
                }
            }
        }
    }
    Ok(files)
}

#[tauri::command]
pub async fn save_dropped_image(
    app: tauri::AppHandle,
    data_url: String,
    filename: String,
) -> Result<WorkingImage, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("dropped_images");
    let _ = fs::create_dir_all(&dir);
    let parts: Vec<&str> = data_url.split(',').collect();
    let bytes = general_purpose::STANDARD
        .decode(parts[1])
        .map_err(|e| e.to_string())?;
    let path = dir.join(&filename);
    fs::write(&path, bytes).map_err(|e| e.to_string())?;

    let path_str = path.to_string_lossy().to_string();
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    Ok(WorkingImage {
        path: path_str.clone(),
        filename,
        thumbnail: path_str,
        size: meta.len(),
        extension: ext,
        dimensions: None,
    })
}

#[tauri::command]
pub async fn generate_cached_thumbnail(
    app: tauri::AppHandle,
    image_path: String,
) -> Result<String, String> {
    println!("=== CACHED THUMBNAIL GENERATION ===");
    println!("Mode: HIGH RESOLUTION");
    println!("Settings: 400px max, 1/2 JPEG scale, Lanczos3 filter");
    println!("Input: {}", image_path);

    // Use the high-res thumbnail function (400px, 1/2 scale, Lanczos3 filter)
    let result = generate_cached_thumbnail_high_res(&image_path, &app).await?;

    println!("✓ Cached thumbnail generated: {}", result.thumbnail);
    println!("===================================");
    Ok(result.thumbnail)
}

#[tauri::command]
pub async fn generate_cached_thumbnails_batch(
    app: tauri::AppHandle,
    image_paths: Vec<String>,
) -> Result<Vec<CachedThumbnailResult>, String> {
    println!(
        "Generating {} cached thumbnails in batch...",
        image_paths.len()
    );

    let total_files = image_paths.len();

    // Limit concurrent thumbnail generation
    let max_concurrent_tasks = std::cmp::min(8, total_files);
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(max_concurrent_tasks));

    // Use JoinSet for concurrent processing
    let mut join_set = tokio::task::JoinSet::new();

    // Spawn tasks for thumbnail generation
    for (index, image_path) in image_paths.into_iter().enumerate() {
        let app_clone = app.clone();
        let semaphore_clone = semaphore.clone();
        let path_clone = image_path.clone();

        join_set.spawn_blocking(move || {
            tokio::runtime::Handle::current().block_on(async {
                // Acquire semaphore permit to limit concurrency
                let _permit = semaphore_clone.acquire().await.unwrap();

                let result = generate_thumbnail_cached(&path_clone, &app_clone, index).await;
                (path_clone, result)
            })
        });
    }

    // Collect results as they complete
    let mut results = Vec::new();
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok((original_path, thumb_result)) => {
                if let Ok(thumb) = thumb_result {
                    results.push(CachedThumbnailResult {
                        original_path,
                        thumbnail_url: thumb.thumbnail,
                    });
                } else {
                    eprintln!("Failed to generate thumbnail for: {}", original_path);
                }
            }
            Err(e) => {
                eprintln!("Join error: {}", e);
            }
        }
    }

    println!(
        "Batch thumbnail generation complete: {} thumbnails",
        results.len()
    );
    Ok(results)
}

#[tauri::command]
pub async fn clear_temp_images(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("dropped_images");
    let _ = fs::remove_dir_all(dir);
    Ok(())
}

#[tauri::command]
pub async fn remove_temp_image(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let file_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("dropped_images")
        .join(path);
    let _ = fs::remove_file(file_path);
    Ok(())
}

#[tauri::command]
pub async fn select_working_folder(app: tauri::AppHandle) -> Result<WorkingFolderInfo, String> {
    println!("=== SELECT WORKING FOLDER START ===");

    // Open folder picker
    let folder_path = app
        .dialog()
        .file()
        .set_title("Select Working Folder")
        .blocking_pick_folder()
        .ok_or("No folder selected")?;

    let folder_path_str = folder_path.to_string();
    println!("Selected folder: {}", folder_path_str);

    // Scan folder for images
    println!("Starting folder scan...");
    let images = scan_folder_for_images(&folder_path_str, &app).await?;
    println!("Folder scan complete. Found {} images", images.len());

    println!("=== SELECT WORKING FOLDER END ===");
    Ok(WorkingFolderInfo {
        path: folder_path_str,
        images,
    })
}

// Helper functions

async fn scan_folder_for_images(
    folder_path: &str,
    app: &tauri::AppHandle,
) -> Result<Vec<WorkingImage>, String> {
    println!("Scanning folder: {}", folder_path);

    let path = PathBuf::from(folder_path);
    let mut images = Vec::new();

    let entries = fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;

    // Collect all valid image files first
    let mut image_files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let file_path = entry.path();

        if !file_path.is_file() {
            continue;
        }

        let extension = file_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        // Support common image formats
        if !matches!(
            extension.as_str(),
            "jpg" | "jpeg" | "png" | "raw" | "cr2" | "nef" | "arw"
        ) {
            continue;
        }

        let filename = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let metadata =
            fs::metadata(&file_path).map_err(|e| format!("Failed to read metadata: {}", e))?;

        let size = metadata.len();
        let modified = metadata
            .modified()
            .map_err(|e| format!("Failed to read modified time: {}", e))?;

        let file_path_str = file_path.to_string_lossy().to_string();

        image_files.push((file_path_str, filename, size, extension, modified));
    }

    // Sort by modification time, newest first
    image_files.sort_by(|a, b| b.4.cmp(&a.4));

    let total_files = image_files.len();
    println!("Found {} image files (sorted newest first)", total_files);

    // Emit total count first so frontend can show correct skeleton count
    let _ = app.emit("thumbnail-total-count", total_files);

    // Limit concurrent thumbnail generation to avoid overwhelming CPU
    let max_concurrent_tasks = std::cmp::min(8, total_files); // Max 8 concurrent thumbnails
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(max_concurrent_tasks));

    // Use JoinSet for concurrent processing
    let mut join_set = tokio::task::JoinSet::new();

    // Spawn tasks for thumbnail generation
    for (index, (file_path, filename, size, extension, _modified)) in
        image_files.into_iter().enumerate()
    {
        if matches!(extension.as_str(), "jpg" | "jpeg" | "png") {
            let file_path_clone = file_path.clone();
            let filename_clone = filename.clone();
            let extension_clone = extension.clone();
            let app_clone = app.clone();
            let semaphore_clone = semaphore.clone();

            join_set.spawn_blocking(move || {
                tokio::runtime::Handle::current().block_on(async {
                    // Acquire semaphore permit to limit concurrency
                    let _permit = semaphore_clone.acquire().await.unwrap();

                    let result =
                        generate_thumbnail_cached(&file_path_clone, &app_clone, index).await;
                    (
                        index,
                        result,
                        file_path_clone,
                        filename_clone,
                        size,
                        extension_clone,
                    )
                })
            });
        } else {
            // RAW files - emit immediately without thumbnail
            let working_image = WorkingImage {
                path: file_path.clone(),
                filename: filename.clone(),
                thumbnail: String::new(),
                size,
                extension,
                dimensions: None,
            };

            images.push(working_image.clone());

            let _ = app.emit(
                "thumbnail-loaded",
                ThumbnailLoadProgress {
                    current: index + 1,
                    total: total_files,
                    image: working_image,
                },
            );
        }
    }

    // Collect results as they complete
    let mut results = Vec::new();
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok((index, thumb_result, file_path, filename, size, extension)) => {
                let (thumbnail, dimensions) = match thumb_result {
                    Ok(r) => (Some(r.thumbnail), r.dimensions),
                    Err(_) => (None, None),
                };

                let working_image = WorkingImage {
                    path: file_path,
                    filename,
                    thumbnail: thumbnail.unwrap_or_default(),
                    size,
                    extension,
                    dimensions,
                };

                // Emit immediately as each completes
                let _ = app.emit(
                    "thumbnail-loaded",
                    ThumbnailLoadProgress {
                        current: index + 1,
                        total: total_files,
                        image: working_image.clone(),
                    },
                );

                results.push((index, working_image));
            }
            _ => {}
        }
    }

    // Sort results by original index and add to images
    results.sort_by_key(|(index, _)| *index);
    for (_, image) in results {
        images.push(image);
    }

    println!("Scan complete: {} images", images.len());
    Ok(images)
}

async fn generate_thumbnail_cached(
    image_path: &str,
    app: &tauri::AppHandle,
    _task_id: usize,
) -> Result<ThumbnailResult, String> {
    // Get thumbnail path
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let thumbnails_dir = app_data_dir.join("thumbnails");
    fs::create_dir_all(&thumbnails_dir)
        .map_err(|e| format!("Failed to create thumbnails dir: {}", e))?;

    let path_buf = PathBuf::from(image_path);
    let filename = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?;

    let thumbnail_path = thumbnails_dir.join(format!("thumb_{}", filename));

    // Check if thumbnail and metadata already exist and are newer than source
    let metadata_path = thumbnails_dir.join(format!("thumb_{}.meta", filename));

    if thumbnail_path.exists() && metadata_path.exists() {
        if let Ok(source_mtime) = fs::metadata(&path_buf).and_then(|m| m.modified()) {
            if let Ok(thumb_mtime) = fs::metadata(&thumbnail_path).and_then(|m| m.modified()) {
                if thumb_mtime > source_mtime {
                    // Thumbnail exists and is newer, load dimensions from metadata file
                    let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
                    let asset_url = format!("asset://{}", path_str);
                    let dimensions = fs::read_to_string(&metadata_path).ok().and_then(|meta| {
                        let parts: Vec<&str> = meta.split('x').collect();
                        if parts.len() == 2 {
                            let width = parts[0].parse::<u32>().ok()?;
                            let height = parts[1].parse::<u32>().ok()?;
                            Some(ImageDimensions { width, height })
                        } else {
                            None
                        }
                    });

                    // OPTIMIZATION: Verify EXIF DateTimeOriginal matches cached thumbnail
                    let cached_datetime_valid = if dimensions.is_some() {
                        let current_datetime: Option<String> =
                            rexif::parse_file(image_path).ok().and_then(|exif_data| {
                                for entry in &exif_data.entries {
                                    if entry.tag == rexif::ExifTag::DateTimeOriginal {
                                        if let rexif::TagValue::Ascii(ref datetime_str) =
                                            entry.value
                                        {
                                            return Some(datetime_str.clone());
                                        }
                                    }
                                }
                                None::<String>
                            });

                        // Read cached datetime from thumbnail metadata
                        let cached_datetime_path = thumbnail_path.with_extension("jpg.datetime");
                        let cached_datetime: Option<String> =
                            fs::read_to_string(&cached_datetime_path).ok();

                        // Check if datetimes match
                        current_datetime == cached_datetime
                    } else {
                        true // No dimension info means no check possible
                    };

                    if cached_datetime_valid {
                        return Ok(ThumbnailResult {
                            thumbnail: asset_url,
                            dimensions,
                        });
                    }
                }
            }
        }
    }

    // Check if this is a JPEG file
    let is_jpeg = path_buf
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg"))
        .unwrap_or(false);

    if is_jpeg {
        // Read JPEG file once
        let jpeg_data = fs::read(image_path).map_err(|e| format!("Failed to read JPEG file: {}", e))?;

        // Get dimensions from mozjpeg header
        let decompress_dims = mozjpeg::Decompress::new_mem(&jpeg_data)
            .map_err(|e| format!("Failed to create mozjpeg decompressor: {}", e))?;

        let stored_width = decompress_dims.width() as u32;
        let stored_height = decompress_dims.height() as u32;

        // Read EXIF orientation
        let exif_orientation_value = rexif::parse_file(image_path).ok().and_then(|exif_data| {
            for entry in &exif_data.entries {
                if entry.tag == rexif::ExifTag::Orientation {
                    if let rexif::TagValue::U16(ref shorts) = entry.value {
                        return shorts.first().copied();
                    }
                }
            }
            None
        });

        let needs_dimension_swap =
            matches!(exif_orientation_value, Some(5) | Some(6) | Some(7) | Some(8));

        let (img_width, img_height) = if needs_dimension_swap {
            (stored_height, stored_width)
        } else {
            (stored_width, stored_height)
        };

        let dimensions = ImageDimensions {
            width: img_width,
            height: img_height,
        };

        // Fast decode with 1/4 scale
        let mut decompress = mozjpeg::Decompress::new_mem(&jpeg_data)
            .map_err(|e| format!("Failed to create mozjpeg decompressor: {}", e))?;

        decompress.scale(4); // 1/4 scale for faster processing

        let mut image = decompress
            .rgb()
            .map_err(|e| format!("Failed to decompress JPEG: {}", e))?;

        let scaled_width = image.width();
        let scaled_height = image.height();

        // Convert mozjpeg data to RGB image
        let img_data = image
            .read_scanlines()
            .map_err(|e| format!("Failed to read scanlines: {}", e))?;

        let rgb_img = image::RgbImage::from_raw(scaled_width as u32, scaled_height as u32, img_data)
            .ok_or("Failed to create image buffer")?;

        let mut dynamic_img = image::DynamicImage::ImageRgb8(rgb_img);

        // Apply EXIF rotation
        if let Some(orientation) = exif_orientation_value {
            if orientation != 1 {
                dynamic_img = match orientation {
                    2 => image::DynamicImage::ImageRgb8(image::imageops::flip_horizontal(
                        &dynamic_img.to_rgb8(),
                    )),
                    3 => dynamic_img.rotate180(),
                    4 => image::DynamicImage::ImageRgb8(image::imageops::flip_vertical(
                        &dynamic_img.to_rgb8(),
                    )),
                    5 => {
                        let flipped = image::imageops::flip_horizontal(&dynamic_img.to_rgb8());
                        image::DynamicImage::ImageRgb8(flipped).rotate270()
                    }
                    6 => dynamic_img.rotate90(),
                    7 => {
                        let flipped = image::imageops::flip_horizontal(&dynamic_img.to_rgb8());
                        image::DynamicImage::ImageRgb8(flipped).rotate90()
                    }
                    8 => dynamic_img.rotate270(),
                    _ => dynamic_img,
                };
            }
        }

        // Resize to thumbnail size (200px max dimension)
        let max_dim = 200;
        let thumbnail = if dynamic_img.width() > max_dim || dynamic_img.height() > max_dim {
            let scale = max_dim as f32 / (dynamic_img.width().max(dynamic_img.height()) as f32);
            let new_width = (dynamic_img.width() as f32 * scale).round() as u32;
            let new_height = (dynamic_img.height() as f32 * scale).round() as u32;
            dynamic_img.resize(new_width, new_height, image::imageops::FilterType::Nearest)
        } else {
            dynamic_img
        };

        // Save thumbnail
        thumbnail
            .save_with_format(&thumbnail_path, image::ImageFormat::Jpeg)
            .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

        // Save dimensions to metadata
        let metadata_content = format!("{}x{}", dimensions.width, dimensions.height);
        let _ = fs::write(&metadata_path, metadata_content);

        // Save EXIF DateTimeOriginal for cache validation
        let datetime_original: Option<String> =
            rexif::parse_file(image_path).ok().and_then(|exif_data| {
                for entry in &exif_data.entries {
                    if entry.tag == rexif::ExifTag::DateTimeOriginal {
                        if let rexif::TagValue::Ascii(ref datetime_str) = entry.value {
                            return Some(datetime_str.clone());
                        }
                    }
                }
                None::<String>
            });

        if let Some(datetime) = datetime_original {
            let datetime_path = thumbnail_path.with_extension("jpg.datetime");
            let _ = fs::write(&datetime_path, datetime.clone());
        }

        let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
        let asset_url = format!("asset://{}", path_str);
        return Ok(ThumbnailResult {
            thumbnail: asset_url,
            dimensions: Some(dimensions),
        });
    }

    // Fallback for non-JPEG images (PNG, etc.)
    let img = image::ImageReader::open(image_path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to guess format: {}", e))?
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let dimensions = ImageDimensions {
        width: img.width(),
        height: img.height(),
    };

    // Resize to thumbnail size (200px max dimension)
    let max_dim = 200;
    let thumbnail = if dimensions.width > max_dim || dimensions.height > max_dim {
        let scale = max_dim as f32 / dimensions.width.max(dimensions.height) as f32;
        let new_width = (dimensions.width as f32 * scale).round() as u32;
        let new_height = (dimensions.height as f32 * scale).round() as u32;
        img.resize(
            new_width,
            new_height,
            image::imageops::FilterType::Nearest,
        )
    } else {
        img
    };

    thumbnail
        .save_with_format(&thumbnail_path, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    // Save dimensions to metadata
    let metadata_content = format!("{}x{}", dimensions.width, dimensions.height);
    let _ = fs::write(&metadata_path, metadata_content);

    let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
    let asset_url = format!("asset://{}", path_str);
    Ok(ThumbnailResult {
        thumbnail: asset_url,
        dimensions: Some(dimensions),
    })
}

pub async fn generate_cached_thumbnail_high_res(
    image_path: &str,
    app: &tauri::AppHandle,
) -> Result<ThumbnailResult, String> {
    generate_thumbnail_with_settings(
        image_path,
        app,
        400,
        2,
        image::imageops::FilterType::Lanczos3,
        "cached_thumbnails",
        "cached_thumb",
    )
    .await
}

async fn generate_thumbnail_with_settings(
    image_path: &str,
    app: &tauri::AppHandle,
    max_dimension: u32,
    jpeg_scale: u8,
    resize_filter: image::imageops::FilterType,
    cache_dir_name: &str,
    thumb_prefix: &str,
) -> Result<ThumbnailResult, String> {
    // Get thumbnail path
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let thumbnails_dir = app_data_dir.join(cache_dir_name);
    fs::create_dir_all(&thumbnails_dir).map_err(|e| {
        format!("Failed to create {} dir: {}", cache_dir_name, e)
    })?;

    let path_buf = PathBuf::from(image_path);
    let filename = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?;

    let thumbnail_path = thumbnails_dir.join(format!("{}_{}", thumb_prefix, filename));
    let metadata_path = thumbnails_dir.join(format!("{}_{}.meta", thumb_prefix, filename));

    // Check if thumbnail and metadata already exist and are newer than source
    if thumbnail_path.exists() && metadata_path.exists() {
        if let Ok(source_mtime) = fs::metadata(&path_buf).and_then(|m| m.modified()) {
            if let Ok(thumb_mtime) = fs::metadata(&thumbnail_path).and_then(|m| m.modified()) {
                if thumb_mtime > source_mtime {
                    let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
                    let asset_url = format!("asset://{}", path_str);
                    let dimensions = fs::read_to_string(&metadata_path).ok().and_then(|meta| {
                        let parts: Vec<&str> = meta.split('x').collect();
                        if parts.len() == 2 {
                            let width = parts[0].parse::<u32>().ok()?;
                            let height = parts[1].parse::<u32>().ok()?;
                            Some(ImageDimensions { width, height })
                        } else {
                            None
                        }
                    });

                    return Ok(ThumbnailResult {
                        thumbnail: asset_url,
                        dimensions,
                    });
                }
            }
        }
    }

    // Check if this is a JPEG file
    let is_jpeg = path_buf
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg"))
        .unwrap_or(false);

    if is_jpeg {
        // Read JPEG file once
        let jpeg_data =
            fs::read(image_path).map_err(|e| format!("Failed to read JPEG file: {}", e))?;

        // Get dimensions from mozjpeg header
        let decompress_dims = mozjpeg::Decompress::new_mem(&jpeg_data)
            .map_err(|e| format!("Failed to create mozjpeg decompressor: {}", e))?;

        let stored_width = decompress_dims.width() as u32;
        let stored_height = decompress_dims.height() as u32;

        // Read EXIF orientation
        let exif_orientation_value = rexif::parse_file(image_path).ok().and_then(|exif_data| {
            for entry in &exif_data.entries {
                if entry.tag == rexif::ExifTag::Orientation {
                    if let rexif::TagValue::U16(ref shorts) = entry.value {
                        return shorts.first().copied();
                    }
                }
            }
            None
        });

        let needs_dimension_swap =
            matches!(exif_orientation_value, Some(5) | Some(6) | Some(7) | Some(8));

        let (img_width, img_height) = if needs_dimension_swap {
            (stored_height, stored_width)
        } else {
            (stored_width, stored_height)
        };

        let dimensions = ImageDimensions {
            width: img_width,
            height: img_height,
        };

        // Fast decode with configurable scale
        let mut decompress = mozjpeg::Decompress::new_mem(&jpeg_data)
            .map_err(|e| format!("Failed to create mozjpeg decompressor: {}", e))?;

        decompress.scale(jpeg_scale);

        let mut image = decompress
            .rgb()
            .map_err(|e| format!("Failed to decompress JPEG: {}", e))?;

        let scaled_width = image.width();
        let scaled_height = image.height();

        // Convert mozjpeg data to RGB image
        let img_data = image
            .read_scanlines()
            .map_err(|e| format!("Failed to read scanlines: {}", e))?;

        let rgb_img =
            image::RgbImage::from_raw(scaled_width as u32, scaled_height as u32, img_data)
                .ok_or("Failed to create image buffer")?;

        let mut dynamic_img = image::DynamicImage::ImageRgb8(rgb_img);

        // Apply EXIF rotation
        if let Some(orientation) = exif_orientation_value {
            if orientation != 1 {
                dynamic_img = match orientation {
                    2 => image::DynamicImage::ImageRgb8(image::imageops::flip_horizontal(
                        &dynamic_img.to_rgb8(),
                    )),
                    3 => dynamic_img.rotate180(),
                    4 => image::DynamicImage::ImageRgb8(image::imageops::flip_vertical(
                        &dynamic_img.to_rgb8(),
                    )),
                    5 => {
                        let flipped = image::imageops::flip_horizontal(&dynamic_img.to_rgb8());
                        image::DynamicImage::ImageRgb8(flipped).rotate270()
                    }
                    6 => dynamic_img.rotate90(),
                    7 => {
                        let flipped = image::imageops::flip_horizontal(&dynamic_img.to_rgb8());
                        image::DynamicImage::ImageRgb8(flipped).rotate90()
                    }
                    8 => dynamic_img.rotate270(),
                    _ => dynamic_img,
                };
            }
        }

        // Resize to configurable max dimension with configurable filter
        let thumbnail = if dynamic_img.width() > max_dimension || dynamic_img.height() > max_dimension {
            let scale = max_dimension as f32 / (dynamic_img.width().max(dynamic_img.height()) as f32);
            let new_width = (dynamic_img.width() as f32 * scale).round() as u32;
            let new_height = (dynamic_img.height() as f32 * scale).round() as u32;
            dynamic_img.resize(new_width, new_height, resize_filter)
        } else {
            dynamic_img
        };

        // Save thumbnail with higher quality
        thumbnail
            .save_with_format(&thumbnail_path, image::ImageFormat::Jpeg)
            .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

        // Save dimensions to metadata
        let metadata_content = format!("{}x{}", dimensions.width, dimensions.height);
        let _ = fs::write(&metadata_path, metadata_content);

        let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
        let asset_url = format!("asset://{}", path_str);
        return Ok(ThumbnailResult {
            thumbnail: asset_url,
            dimensions: Some(dimensions),
        });
    }

    // Fallback for non-JPEG images (PNG, etc.)
    let img = image::ImageReader::open(image_path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to guess format: {}", e))?
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let dimensions = ImageDimensions {
        width: img.width(),
        height: img.height(),
    };

    // Resize to configurable max dimension with configurable filter
    let thumbnail = if dimensions.width > max_dimension || dimensions.height > max_dimension {
        let scale = max_dimension as f32 / dimensions.width.max(dimensions.height) as f32;
        let new_width = (dimensions.width as f32 * scale).round() as u32;
        let new_height = (dimensions.height as f32 * scale).round() as u32;
        img.resize(new_width, new_height, resize_filter)
    } else {
        img
    };

    thumbnail
        .save_with_format(&thumbnail_path, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    // Save dimensions to metadata
    let metadata_content = format!("{}x{}", dimensions.width, dimensions.height);
    let _ = fs::write(&metadata_path, metadata_content);

    let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
    let asset_url = format!("asset://{}", path_str);
    Ok(ThumbnailResult {
        thumbnail: asset_url,
        dimensions: Some(dimensions),
    })
}
