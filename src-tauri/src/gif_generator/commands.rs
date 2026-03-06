use image::codecs::gif::{GifEncoder, Repeat};
use image::imageops::FilterType;
use image::{DynamicImage, Frame, RgbaImage};
use rand::Rng;
use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::io::BufWriter;
use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;
use tauri::Emitter;

use crate::ffmpeg_sidecar;

#[derive(Serialize, Clone)]
pub struct GifProgress {
    pub current: usize,
    pub total: usize,
    pub stage: String,
}

#[derive(Serialize)]
pub struct GifResult {
    pub file_path: String,
    pub file_size: u64,
}

/// Load an image from disk, apply EXIF orientation, and downscale to max_dimension.
fn load_and_prepare_image(path: &str, max_dimension: u32) -> Result<RgbaImage, String> {
    let total_start = Instant::now();
    let path_buf = PathBuf::from(path);
    let filename = path_buf.file_name().and_then(|n| n.to_str()).unwrap_or("unknown");

    let is_jpeg = path_buf
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg"))
        .unwrap_or(false);

    let mut dynamic_img = if is_jpeg {
        let t = Instant::now();
        let jpeg_data =
            fs::read(path).map_err(|e| format!("Failed to read JPEG file '{}': {}", path, e))?;
        println!("[GIF] {}: read file ({} KB) in {:?}", filename, jpeg_data.len() / 1024, t.elapsed());

        let t = Instant::now();
        let peek = mozjpeg::Decompress::new_mem(&jpeg_data)
            .map_err(|e| format!("Failed to peek JPEG '{}': {}", path, e))?;
        let full_w = peek.width() as u32;
        let full_h = peek.height() as u32;
        let longest = full_w.max(full_h);

        // mozjpeg scale() takes a numerator N, scaling output to N/8 of original
        let scale_num: u8 = if longest / 8 >= max_dimension {
            1 // 1/8 scale
        } else if longest / 4 >= max_dimension {
            2 // 2/8 = 1/4 scale
        } else if longest / 2 >= max_dimension {
            4 // 4/8 = 1/2 scale
        } else {
            8 // 8/8 = full scale
        };
        println!("[GIF] {}: original {}x{}, scale {}/8, target max {}", filename, full_w, full_h, scale_num, max_dimension);

        let mut decompress = mozjpeg::Decompress::new_mem(&jpeg_data)
            .map_err(|e| format!("Failed to decompress JPEG '{}': {}", path, e))?;
        decompress.scale(scale_num);

        let mut image = decompress
            .rgb()
            .map_err(|e| format!("Failed to decode JPEG '{}': {}", path, e))?;

        let width = image.width() as u32;
        let height = image.height() as u32;

        let img_data = image
            .read_scanlines()
            .map_err(|e| format!("Failed to read scanlines '{}': {}", path, e))?;
        println!("[GIF] {}: mozjpeg decode to {}x{} in {:?}", filename, width, height, t.elapsed());

        let rgb_img = image::RgbImage::from_raw(width, height, img_data)
            .ok_or_else(|| format!("Failed to create image buffer for '{}'", path))?;

        DynamicImage::ImageRgb8(rgb_img)
    } else {
        let t = Instant::now();
        let img = image::ImageReader::open(path)
            .map_err(|e| format!("Failed to open image '{}': {}", path, e))?
            .with_guessed_format()
            .map_err(|e| format!("Failed to guess format '{}': {}", path, e))?
            .decode()
            .map_err(|e| format!("Failed to decode image '{}': {}", path, e))?;
        println!("[GIF] {}: decoded non-JPEG {}x{} in {:?}", filename, img.width(), img.height(), t.elapsed());
        img
    };

    // Apply EXIF orientation for JPEG files
    if is_jpeg {
        let t = Instant::now();
        if let Ok(exif_data) = rexif::parse_file(path) {
            let orientation = exif_data.entries.iter().find_map(|entry| {
                if entry.tag == rexif::ExifTag::Orientation {
                    if let rexif::TagValue::U16(ref shorts) = entry.value {
                        return shorts.first().copied();
                    }
                }
                None
            });

            if let Some(o) = orientation {
                if o != 1 {
                    dynamic_img = match o {
                        2 => DynamicImage::ImageRgb8(image::imageops::flip_horizontal(
                            &dynamic_img.to_rgb8(),
                        )),
                        3 => dynamic_img.rotate180(),
                        4 => DynamicImage::ImageRgb8(image::imageops::flip_vertical(
                            &dynamic_img.to_rgb8(),
                        )),
                        5 => {
                            let flipped =
                                image::imageops::flip_horizontal(&dynamic_img.to_rgb8());
                            DynamicImage::ImageRgb8(flipped).rotate270()
                        }
                        6 => dynamic_img.rotate90(),
                        7 => {
                            let flipped =
                                image::imageops::flip_horizontal(&dynamic_img.to_rgb8());
                            DynamicImage::ImageRgb8(flipped).rotate90()
                        }
                        8 => dynamic_img.rotate270(),
                        _ => dynamic_img,
                    };
                    println!("[GIF] {}: EXIF orientation {} applied in {:?}", filename, o, t.elapsed());
                }
            }
        }
    }

    // Downscale to max_dimension on longest side
    let w = dynamic_img.width();
    let h = dynamic_img.height();
    if w > max_dimension || h > max_dimension {
        let t = Instant::now();
        let scale = max_dimension as f32 / w.max(h) as f32;
        let new_w = (w as f32 * scale).round() as u32;
        let new_h = (h as f32 * scale).round() as u32;
        dynamic_img = dynamic_img.resize(new_w, new_h, FilterType::Triangle);
        println!("[GIF] {}: resize {}x{} -> {}x{} in {:?}", filename, w, h, new_w, new_h, t.elapsed());
    } else {
        println!("[GIF] {}: no resize needed ({}x{})", filename, w, h);
    }

    let t = Instant::now();
    let rgba = dynamic_img.to_rgba8();
    println!("[GIF] {}: to_rgba8 in {:?}", filename, t.elapsed());
    println!("[GIF] {}: total load+prepare in {:?}", filename, total_start.elapsed());

    Ok(rgba)
}

/// Core GIF encoding function shared by both commands.
fn encode_gif_internal(
    app: &tauri::AppHandle,
    image_paths: &[String],
    output_path: &PathBuf,
    frame_delay_ms: u32,
    max_dimension: u32,
    repeat: Repeat,
) -> Result<GifResult, String> {
    let gif_start = Instant::now();
    let total = image_paths.len();
    if total == 0 {
        return Err("No images provided".to_string());
    }
    println!("[GIF] Starting GIF encoding: {} images, max_dim={}, delay={}ms", total, max_dimension, frame_delay_ms);

    // Load and prepare all frames in parallel
    let load_start = Instant::now();
    let _ = app.emit(
        "gif-generation-progress",
        GifProgress {
            current: 0,
            total,
            stage: "loading".to_string(),
        },
    );

    let results: Vec<Result<RgbaImage, String>> = image_paths
        .par_iter()
        .map(|path| load_and_prepare_image(path, max_dimension))
        .collect();

    let mut frames: Vec<RgbaImage> = Vec::with_capacity(total);
    for result in results {
        frames.push(result?);
    }

    let _ = app.emit(
        "gif-generation-progress",
        GifProgress {
            current: total,
            total,
            stage: "loading".to_string(),
        },
    );
    println!("[GIF] All {} frames loaded in parallel in {:?}", total, load_start.elapsed());

    // Find max dimensions and pad all frames to uniform size (GIF requires it)
    let max_w = frames.iter().map(|f| f.width()).max().unwrap_or(1);
    let max_h = frames.iter().map(|f| f.height()).max().unwrap_or(1);

    let uniform_frames: Vec<RgbaImage> = frames
        .into_iter()
        .enumerate()
        .map(|(i, frame)| {
            let _ = app.emit(
                "gif-generation-progress",
                GifProgress {
                    current: i + 1,
                    total,
                    stage: "processing".to_string(),
                },
            );

            if frame.width() == max_w && frame.height() == max_h {
                return frame;
            }

            // Center the image on a white background
            let mut canvas = RgbaImage::from_pixel(max_w, max_h, image::Rgba([255, 255, 255, 255]));
            let offset_x = (max_w - frame.width()) / 2;
            let offset_y = (max_h - frame.height()) / 2;
            image::imageops::overlay(&mut canvas, &frame, offset_x as i64, offset_y as i64);
            canvas
        })
        .collect();

    // Ensure output directory exists
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    // Encode GIF
    let _ = app.emit(
        "gif-generation-progress",
        GifProgress {
            current: 0,
            total,
            stage: "encoding".to_string(),
        },
    );

    let file = fs::File::create(output_path)
        .map_err(|e| format!("Failed to create output file: {}", e))?;
    let writer = BufWriter::new(file);

    let encode_start = Instant::now();
    let mut encoder = GifEncoder::new_with_speed(writer, 10);
    encoder.set_repeat(repeat).map_err(|e| format!("Failed to set repeat: {}", e))?;
    println!("[GIF] Encoder created (speed=10), uniform frame size: {}x{}", max_w, max_h);

    for (i, rgba_frame) in uniform_frames.into_iter().enumerate() {
        let _ = app.emit(
            "gif-generation-progress",
            GifProgress {
                current: i + 1,
                total,
                stage: "encoding".to_string(),
            },
        );

        let frame_start = Instant::now();
        let delay = image::Delay::from_numer_denom_ms(frame_delay_ms, 1);
        let frame = Frame::from_parts(rgba_frame, 0, 0, delay);
        encoder
            .encode_frame(frame)
            .map_err(|e| format!("Failed to encode frame {}: {}", i + 1, e))?;
        println!("[GIF] Frame {}/{} encoded in {:?}", i + 1, total, frame_start.elapsed());
    }

    // Drop encoder to flush the writer
    drop(encoder);
    println!("[GIF] All frames encoded in {:?}", encode_start.elapsed());

    let _ = app.emit(
        "gif-generation-progress",
        GifProgress {
            current: total,
            total,
            stage: "complete".to_string(),
        },
    );

    let file_size = fs::metadata(output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    println!("[GIF] Done! Output: {} KB, total time: {:?}", file_size / 1024, gif_start.elapsed());

    let file_path = output_path.to_string_lossy().replace('\\', "/");

    Ok(GifResult {
        file_path,
        file_size,
    })
}

fn generate_random_suffix() -> String {
    let mut rng = rand::thread_rng();
    (0..8)
        .map(|_| {
            let idx = rng.gen_range(0..36u8);
            if idx < 26 {
                (b'A' + idx) as char
            } else {
                (b'0' + (idx - 26)) as char
            }
        })
        .collect()
}

#[tauri::command]
pub async fn generate_gif(
    app: tauri::AppHandle,
    image_paths: Vec<String>,
    output_folder: String,
    session_id: String,
    frame_delay_ms: Option<u32>,
    max_dimension: Option<u32>,
) -> Result<GifResult, String> {
    let delay = frame_delay_ms.unwrap_or(1000);
    let max_dim = max_dimension.unwrap_or(1024);
    let filename = format!("Slideshow_{}.gif", generate_random_suffix());
    let output_path = PathBuf::from(&output_folder)
        .join(&session_id)
        .join(&filename);

    // Run the blocking encoding on a dedicated thread
    let result = tokio::task::spawn_blocking(move || {
        encode_gif_internal(&app, &image_paths, &output_path, delay, max_dim, Repeat::Infinite)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    result
}

/// Load images, prepare frames, and save them as temporary PNGs for ffmpeg.
/// Returns (temp_dir, list of frame paths, frame dimensions w x h).
fn prepare_frames_for_video(
    app: &tauri::AppHandle,
    image_paths: &[String],
    temp_dir: &PathBuf,
    max_dimension: u32,
) -> Result<(u32, u32), String> {
    let total = image_paths.len();

    // Load all frames in parallel
    let _ = app.emit(
        "video-generation-progress",
        GifProgress {
            current: 0,
            total,
            stage: "loading".to_string(),
        },
    );

    let results: Vec<Result<RgbaImage, String>> = image_paths
        .par_iter()
        .map(|path| load_and_prepare_image(path, max_dimension))
        .collect();

    let mut frames: Vec<RgbaImage> = Vec::with_capacity(total);
    for result in results {
        frames.push(result?);
    }

    // Find max dimensions and pad to uniform size
    let max_w = frames.iter().map(|f| f.width()).max().unwrap_or(1);
    let max_h = frames.iter().map(|f| f.height()).max().unwrap_or(1);

    // Ensure dimensions are even (required by most video codecs)
    let max_w = if max_w % 2 != 0 { max_w + 1 } else { max_w };
    let max_h = if max_h % 2 != 0 { max_h + 1 } else { max_h };

    fs::create_dir_all(temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    for (i, frame) in frames.into_iter().enumerate() {
        let _ = app.emit(
            "video-generation-progress",
            GifProgress {
                current: i + 1,
                total,
                stage: "processing".to_string(),
            },
        );

        // Center on white background at uniform size
        let mut canvas = RgbaImage::from_pixel(max_w, max_h, image::Rgba([255, 255, 255, 255]));
        let offset_x = (max_w - frame.width()) / 2;
        let offset_y = (max_h - frame.height()) / 2;
        image::imageops::overlay(&mut canvas, &frame, offset_x as i64, offset_y as i64);

        let frame_path = temp_dir.join(format!("frame_{:04}.png", i));
        canvas
            .save(&frame_path)
            .map_err(|e| format!("Failed to save temp frame {}: {}", i, e))?;
    }

    Ok((max_w, max_h))
}

#[tauri::command]
pub async fn generate_slideshow_video(
    app: tauri::AppHandle,
    image_paths: Vec<String>,
    output_folder: String,
    session_id: String,
    frame_delay_ms: Option<u32>,
    max_dimension: Option<u32>,
    loop_count: Option<u32>,
    crf: Option<u32>,
) -> Result<GifResult, String> {
    let delay_ms = frame_delay_ms.unwrap_or(1000);
    let max_dim = max_dimension.unwrap_or(1280);
    let loops = loop_count.unwrap_or(2);
    let crf_value = crf.unwrap_or(18); // 18 is high quality (lower is better)
    let filename = format!("Slideshow_{}.mp4", generate_random_suffix());
    let session_dir = PathBuf::from(&output_folder).join(&session_id);
    let output_path = session_dir.join(&filename);

    let result = tokio::task::spawn_blocking(move || {
        let total = image_paths.len();
        if total == 0 {
            return Err("No images provided".to_string());
        }

        // Create temp directory for frames
        let temp_dir = session_dir.join(".slideshow_temp");
        let _cleanup = TempDirCleanup(&temp_dir);

        // Check if FFmpeg exists before running
        crate::ffmpeg_manager::ensure_ffmpeg_exists()?;

        let (_w, _h) = prepare_frames_for_video(&app, &image_paths, &temp_dir, max_dim)?;

        let _ = app.emit(
            "video-generation-progress",
            GifProgress {
                current: 0,
                total,
                stage: "encoding".to_string(),
            },
        );

        // Build the frame list for looping: duplicate the sequence `loops` times
        // Using ffmpeg concat demuxer with a file list
        let mut concat_content = String::new();
        for _loop_idx in 0..loops {
            for i in 0..total {
                let frame_path = temp_dir.join(format!("frame_{:04}.png", i));
                let path_str = frame_path.to_string_lossy().replace('\\', "/");
                concat_content.push_str(&format!("file '{}'\n", path_str));
                concat_content.push_str(&format!("duration {}\n", delay_ms as f64 / 1000.0));
            }
        }
        // Add the last frame again (ffmpeg concat demuxer needs it for the last duration)
        let last_frame = temp_dir.join(format!("frame_{:04}.png", total - 1));
        concat_content.push_str(&format!(
            "file '{}'\n",
            last_frame.to_string_lossy().replace('\\', "/")
        ));

        let concat_file = temp_dir.join("concat.txt");
        fs::write(&concat_file, &concat_content)
            .map_err(|e| format!("Failed to write concat file: {}", e))?;

        // Run ffmpeg
        let ffmpeg_path = ffmpeg_sidecar::ffmpeg_path();
        let output = Command::new(&ffmpeg_path)
            .args([
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                &concat_file.to_string_lossy(),
                "-vf",
                "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-preset",
                "medium",
                "-crf",
                &crf_value.to_string(),
                &output_path.to_string_lossy(),
            ])
            .output()
            .map_err(|e| {
                format!(
                    "Failed to run ffmpeg. Make sure ffmpeg is installed and in PATH. Error: {}",
                    e
                )
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("ffmpeg failed: {}", stderr));
        }

        let _ = app.emit(
            "video-generation-progress",
            GifProgress {
                current: total,
                total,
                stage: "complete".to_string(),
            },
        );

        let file_size = fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0);
        let file_path = output_path.to_string_lossy().replace('\\', "/");

        Ok(GifResult {
            file_path,
            file_size,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    result
}

/// RAII guard to clean up a temp directory on drop.
struct TempDirCleanup<'a>(&'a PathBuf);

impl<'a> Drop for TempDirCleanup<'a> {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.0);
    }
}
