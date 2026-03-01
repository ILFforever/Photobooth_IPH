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
    let output = Command::new("ffmpeg")
        .args(["-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);

    let mut devices = Vec::new();
    for line in stderr.lines() {
        if line.contains("(video)") {
            if let Some(name) = extract_device_name(line) {
                devices.push(CaptureDevice { name });
            }
        }
    }

    Ok(devices)
}

/// Start HDMI capture with auto-restart on failure.
#[tauri::command]
pub async fn start_hdmi_capture(device_name: String, app: AppHandle) -> Result<(), String> {
    let mut state = HDMI_STATE.lock().map_err(|e| e.to_string())?;

    if state.running {
        stop_capture_inner(&mut state);
    }

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    state.shutdown_tx = Some(shutdown_tx);
    state.running = true;

    let device = device_name.clone();
    thread::spawn(move || {
        capture_loop(device, app, shutdown_rx);
    });

    Ok(())
}

/// Stop HDMI capture.
#[tauri::command]
pub async fn stop_hdmi_capture() -> Result<(), String> {
    let mut state = HDMI_STATE.lock().map_err(|e| e.to_string())?;
    stop_capture_inner(&mut state);
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

    loop {
        if *shutdown_rx.borrow() {
            return;
        }

        attempt += 1;

        let run_start = std::time::Instant::now();
        spawn_and_parse(&device_name, &app, &shutdown_rx);
        let run_duration = run_start.elapsed().as_secs_f64();

        if *shutdown_rx.borrow() {
            return;
        }

        if run_duration >= HEALTHY_RUN_SECS {
            attempt = 1;
        }

        if attempt >= MAX_RESTART_ATTEMPTS {
            let _ = app.emit("hdmi-capture-error", "Capture device lost — max retries exceeded");
            break;
        }

        // Exponential backoff delay
        let delay_ms = (BASE_RESTART_DELAY_MS as f64 * BACKOFF_FACTOR.powi((attempt - 1) as i32)) as u64;
        let delay_ms = delay_ms.min(MAX_RESTART_DELAY_MS);

        let sleep_until = std::time::Instant::now() + std::time::Duration::from_millis(delay_ms);
        while std::time::Instant::now() < sleep_until {
            if *shutdown_rx.borrow() {
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
        Err(_) => return 0,
    };

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return 0;
        }
    };

    // Consume stderr silently to prevent pipe blocking
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if line.is_err() { break; }
            }
        });
    }

    let frame_count = parse_and_emit_frames(stdout, app, shutdown_rx);

    let _ = child.kill();
    let _ = child.wait();

    frame_count
}

/// Parse mpjpeg frames from FFmpeg stdout and emit each as a Tauri event.
/// Returns the number of frames successfully parsed.
fn parse_and_emit_frames(
    stdout: impl Read,
    app: &AppHandle,
    shutdown_rx: &watch::Receiver<bool>,
) -> u64 {
    let mut reader = BufReader::with_capacity(64 * 1024, stdout);
    let mut line_buf = String::new();
    let mut frame_count: u64 = 0;
    let mut last_emit_time = std::time::Instant::now();

    loop {
        if *shutdown_rx.borrow() {
            return frame_count;
        }

        // Read headers until we find Content-Length
        let mut content_length: Option<usize> = None;

        loop {
            line_buf.clear();
            match reader.read_line(&mut line_buf) {
                Ok(0) => return frame_count,
                Ok(_) => {}
                Err(_) => return frame_count,
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

                    // Skip frames if frontend is consuming too slowly (max 30fps)
                    if last_emit_time.elapsed().as_secs_f64() < 0.020 {
                        continue;
                    }

                    let b64 = general_purpose::STANDARD.encode(&jpeg_data);
                    let _ = app.emit("hdmi-frame", &b64);
                    last_emit_time = std::time::Instant::now();
                }
                Err(_) => return frame_count,
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
