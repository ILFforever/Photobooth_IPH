use once_cell::sync::Lazy;
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;
use base64::{Engine as _, engine::general_purpose};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
pub struct CaptureDevice {
    pub name: String,
}

struct HdmiCaptureState {
    shutdown_tx: Option<watch::Sender<bool>>,
    running: bool,
}

static HDMI_STATE: Lazy<Mutex<HdmiCaptureState>> = Lazy::new(|| {
    Mutex::new(HdmiCaptureState {
        shutdown_tx: None,
        running: false,
    })
});

// Recovery configuration
const MAX_RESTART_ATTEMPTS: u32 = 50;
const BASE_RESTART_DELAY_MS: u64 = 800;
const MAX_RESTART_DELAY_MS: u64 = 10_000;
const BACKOFF_FACTOR: f64 = 1.5;
// If FFmpeg runs for this long, reset the backoff (it was a real session, not a startup failure)
const HEALTHY_RUN_SECS: f64 = 5.0;

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// List DirectShow video capture devices via FFmpeg.
#[tauri::command]
pub async fn list_capture_devices() -> Result<Vec<CaptureDevice>, String> {
    println!("[hdmi_capture] list_capture_devices called");

    let output = Command::new("ffmpeg")
        .args(["-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    println!("[hdmi_capture] FFmpeg device list stderr ({} bytes):", stderr.len());
    for line in stderr.lines() {
        println!("[hdmi_capture]   {}", line);
    }

    let mut devices = Vec::new();
    for line in stderr.lines() {
        if line.contains("(video)") {
            if let Some(name) = extract_device_name(line) {
                println!("[hdmi_capture] Found video device: \"{}\"", name);
                devices.push(CaptureDevice { name });
            }
        }
    }

    println!("[hdmi_capture] Total devices found: {}", devices.len());
    Ok(devices)
}

/// Start HDMI capture with auto-restart on failure.
#[tauri::command]
pub async fn start_hdmi_capture(device_name: String, app: AppHandle) -> Result<(), String> {
    println!("[hdmi_capture] start_hdmi_capture called for device: \"{}\"", device_name);

    let mut state = HDMI_STATE.lock().map_err(|e| e.to_string())?;

    // Stop any existing capture
    if state.running {
        println!("[hdmi_capture] Stopping existing capture before starting new one");
        stop_capture_inner(&mut state);
    }

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    state.shutdown_tx = Some(shutdown_tx);
    state.running = true;

    // Spawn the resilient capture loop in a background thread.
    // This thread owns the FFmpeg child process and restarts it on failure.
    let device = device_name.clone();
    thread::spawn(move || {
        capture_loop(device, app, shutdown_rx);
    });

    println!("[hdmi_capture] ✓ Capture loop started for device: {}", device_name);
    Ok(())
}

/// Stop HDMI capture.
#[tauri::command]
pub async fn stop_hdmi_capture() -> Result<(), String> {
    println!("[hdmi_capture] stop_hdmi_capture called");
    let mut state = HDMI_STATE.lock().map_err(|e| e.to_string())?;
    stop_capture_inner(&mut state);
    println!("[hdmi_capture] ✓ Capture stopped");
    Ok(())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn stop_capture_inner(state: &mut HdmiCaptureState) {
    if let Some(tx) = state.shutdown_tx.take() {
        let _ = tx.send(true);
    }
    state.running = false;
}

fn extract_device_name(line: &str) -> Option<String> {
    let start = line.find('"')? + 1;
    let end = line[start..].find('"')? + start;
    Some(line[start..end].to_string())
}

/// Resilient capture loop: spawns FFmpeg, parses frames, auto-restarts on failure.
fn capture_loop(
    device_name: String,
    app: AppHandle,
    shutdown_rx: watch::Receiver<bool>,
) {
    let mut attempt: u32 = 0;
    let mut total_frames: u64 = 0;

    loop {
        if *shutdown_rx.borrow() {
            println!("[hdmi_capture] Capture loop: shutdown signal, exiting");
            return;
        }

        attempt += 1;
        println!(
            "[hdmi_capture] === Spawning FFmpeg (attempt {}/{}) for \"{}\" ===",
            attempt, MAX_RESTART_ATTEMPTS, device_name
        );

        let run_start = std::time::Instant::now();
        let frames_this_run = spawn_and_parse(&device_name, &app, &shutdown_rx);
        let run_duration = run_start.elapsed().as_secs_f64();
        total_frames += frames_this_run;

        // Check if we were told to stop
        if *shutdown_rx.borrow() {
            println!("[hdmi_capture] Capture loop: shutdown after {} total frames", total_frames);
            return;
        }

        // If it ran for a healthy amount of time, reset the backoff
        if run_duration >= HEALTHY_RUN_SECS {
            println!(
                "[hdmi_capture] FFmpeg ran for {:.1}s ({} frames this run, {} total) — resetting backoff",
                run_duration, frames_this_run, total_frames
            );
            attempt = 1; // reset backoff since it was a real session
        } else {
            println!(
                "[hdmi_capture] FFmpeg exited quickly ({:.1}s, {} frames) — attempt {}/{}",
                run_duration, frames_this_run, attempt, MAX_RESTART_ATTEMPTS
            );
        }

        if attempt >= MAX_RESTART_ATTEMPTS {
            println!("[hdmi_capture] Max restart attempts reached, giving up");
            // Emit an error event to the frontend
            let _ = app.emit("hdmi-capture-error", "Capture device lost — max retries exceeded");
            break;
        }

        // Exponential backoff delay
        let delay_ms = (BASE_RESTART_DELAY_MS as f64 * BACKOFF_FACTOR.powi((attempt - 1) as i32)) as u64;
        let delay_ms = delay_ms.min(MAX_RESTART_DELAY_MS);
        println!("[hdmi_capture] Restarting in {}ms...", delay_ms);

        // Sleep in small increments so we can check shutdown
        let sleep_until = std::time::Instant::now() + std::time::Duration::from_millis(delay_ms);
        while std::time::Instant::now() < sleep_until {
            if *shutdown_rx.borrow() {
                println!("[hdmi_capture] Capture loop: shutdown during backoff");
                return;
            }
            thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    // Mark as not running
    if let Ok(mut state) = HDMI_STATE.lock() {
        state.running = false;
    }
}

/// Spawn a single FFmpeg process, parse frames, return frame count when it exits.
fn spawn_and_parse(
    device_name: &str,
    app: &AppHandle,
    shutdown_rx: &watch::Receiver<bool>,
) -> u64 {
    let ffmpeg_cmd = format!("video={device_name}");
    let ffmpeg_args = [
        // Input options - LOW LATENCY
        "-fflags", "nobuffer",
        "-flags", "low_delay",
        "-probesize", "32",
        "-analyzeduration", "0",
        // Input device
        "-f", "dshow",
        "-video_size", "1920x1080",
        "-framerate", "30",
        "-rtbufsize", "4M",  // Reduced from 100M for lower latency
        "-i", &ffmpeg_cmd,
        // Output options
        "-f", "mpjpeg",
        "-q:v", "8",  // Higher number = lower quality = less data = faster
        "-boundary_tag", "ffframe",
        "-an",
        "pipe:1",
    ];

    let mut child = match Command::new("ffmpeg")
        .args(&ffmpeg_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x08000000)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            println!("[hdmi_capture] Failed to spawn ffmpeg: {e}");
            return 0;
        }
    };

    let pid = child.id();
    println!("[hdmi_capture] FFmpeg spawned with PID: {}", pid);

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            println!("[hdmi_capture] No stdout from ffmpeg");
            let _ = child.kill();
            let _ = child.wait();
            return 0;
        }
    };

    // Stderr reader thread (detached — just prints logs)
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(l) => println!("[ffmpeg stderr] {}", l),
                    Err(_) => break,
                }
            }
        });
    }

    // Parse frames on this thread (blocking)
    let frame_count = parse_and_emit_frames(stdout, app, shutdown_rx);

    // Clean up the child process
    let _ = child.kill();
    let _ = child.wait();
    println!("[hdmi_capture] FFmpeg PID {} cleaned up after {} frames", pid, frame_count);

    frame_count
}

/// Parse mpjpeg frames from FFmpeg stdout and emit each as a Tauri event.
/// Returns the number of frames successfully parsed.
fn parse_and_emit_frames(
    stdout: impl Read,
    app: &AppHandle,
    shutdown_rx: &watch::Receiver<bool>,
) -> u64 {
    let mut reader = BufReader::with_capacity(64 * 1024, stdout); // Reduced from 512KB
    let mut line_buf = String::new();
    let mut frame_count: u64 = 0;
    let mut last_emit_time = std::time::Instant::now();
    let start_time = std::time::Instant::now();

    println!("[hdmi_capture:parser] Waiting for first frame...");

    loop {
        if *shutdown_rx.borrow() {
            return frame_count;
        }

        // Read headers until we find Content-Length
        let mut content_length: Option<usize> = None;

        loop {
            line_buf.clear();
            match reader.read_line(&mut line_buf) {
                Ok(0) => {
                    println!("[hdmi_capture:parser] EOF after {} frames", frame_count);
                    return frame_count;
                }
                Ok(n) => {
                    if frame_count < 3 {
                        let display = line_buf.trim();
                        if !display.is_empty() {
                            println!("[hdmi_capture:parser] Header ({} bytes): \"{}\"", n, display);
                        }
                    }
                }
                Err(e) => {
                    println!("[hdmi_capture:parser] Read error after {} frames: {e}", frame_count);
                    return frame_count;
                }
            }

            let trimmed = line_buf.trim();

            if trimmed.is_empty() && content_length.is_some() {
                break;
            }

            let lower = trimmed.to_ascii_lowercase();
            if let Some(cl) = lower.strip_prefix("content-length:") {
                if let Ok(len) = cl.trim().parse::<usize>() {
                    content_length = Some(len);
                }
            }
        }

        // Read the JPEG data
        if let Some(len) = content_length {
            let mut jpeg_data = vec![0u8; len];
            match reader.read_exact(&mut jpeg_data) {
                Ok(()) => {
                    frame_count += 1;

                    if frame_count == 1 {
                        println!(
                            "[hdmi_capture:parser] ✓ First frame! size={} bytes, latency={:.1}s",
                            len, start_time.elapsed().as_secs_f64()
                        );
                    } else if frame_count % 300 == 0 {
                        let fps = frame_count as f64 / start_time.elapsed().as_secs_f64();
                        println!(
                            "[hdmi_capture:parser] Frame #{} | {:.1} fps",
                            frame_count, fps
                        );
                    }

                    // Skip frames if frontend is consuming too slowly (max 30fps)
                    let time_since_last = last_emit_time.elapsed().as_secs_f64();
                    if time_since_last < 0.020 {
                        // Skip this frame - previous one was <20ms ago
                        continue;
                    }

                    let b64 = general_purpose::STANDARD.encode(&jpeg_data);
                    if let Err(e) = app.emit("hdmi-frame", &b64) {
                        println!("[hdmi_capture:parser] Emit error: {e}");
                    }
                    last_emit_time = std::time::Instant::now();
                }
                Err(e) => {
                    println!("[hdmi_capture:parser] JPEG read error ({} bytes): {e}", len);
                    return frame_count;
                }
            }
        }
    }
}

// Windows-specific: CREATE_NO_WINDOW flag
trait CommandExt {
    fn creation_flags(&mut self, flags: u32) -> &mut Self;
}

#[cfg(target_os = "windows")]
impl CommandExt for Command {
    fn creation_flags(&mut self, flags: u32) -> &mut Self {
        use std::os::windows::process::CommandExt as WinCommandExt;
        WinCommandExt::creation_flags(self, flags);
        self
    }
}

#[cfg(not(target_os = "windows"))]
impl CommandExt for Command {
    fn creation_flags(&mut self, _flags: u32) -> &mut Self {
        self
    }
}
