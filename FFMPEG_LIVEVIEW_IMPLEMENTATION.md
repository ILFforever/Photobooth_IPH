# FFmpeg Live View Implementation Prompt

Use this prompt in a new Claude Code conversation to implement the FFmpeg-based live view system.

---

## Prompt

I need to replace the browser-based `getUserMedia` live view with an FFmpeg sidecar approach for HDMI capture cards. The current `getUserMedia` implementation suffers from Chromium's internal Media Foundation pipeline killing the `MediaStreamTrack` (`onended` fires) after random intervals — the device temporarily disappears from `enumerateDevices` for ~5 seconds causing `OverconstrainedError` during recovery. OBS doesn't have this issue because it uses DirectShow with a dedicated thread that never tears down the filter graph. We need to bypass Chromium entirely.

### Proven FFmpeg Command

This command works perfectly on the target machine — 1080p30 MJPEG, zero drops:

```
ffmpeg -f dshow -video_size 1920x1080 -framerate 30 -i video="C1-1 USB3 Video" -f mjpeg -q:v 5 -an -
```

Device listing command:
```
ffmpeg -list_devices true -f dshow -i dummy
```

The capture card is **"C1-1 USB3 Video"** (USB VID `345f`, PID `2130`). Other devices on the system include "USB2.0 FHD UVC WebCam" (built-in) and "LUMIX Webcam Software" (virtual).

### Architecture

```
FFmpeg child process (DirectShow) → stdout MJPEG stream → Rust reads frames → Tauri event/command → Frontend <img> blob URL
```

### What to Build

#### 1. Rust Backend (`src-tauri/src/lib.rs` or new module)

**Tauri Commands:**
- `list_capture_devices` → Runs `ffmpeg -list_devices true -f dshow -i dummy`, parses stderr for `(video)` entries, returns `Vec<CaptureDevice { name, alt_name }>`
- `start_hdmi_capture { device_name: String }` → Spawns FFmpeg as child process, reads MJPEG frames from stdout in a background thread, emits each frame as a Tauri event (`hdmi-frame`) with base64 or raw bytes
- `stop_hdmi_capture` → Kills the FFmpeg child process, cleans up

**FFmpeg Process Management:**
- Use `std::process::Command` or Tauri's `tauri::api::process::Command` (sidecar)
- Spawn: `ffmpeg -f dshow -video_size 1920x1080 -framerate 30 -rtbufsize 100M -i video="{device_name}" -f mjpeg -q:v 5 -an pipe:1`
- `-rtbufsize 100M` prevents DirectShow buffer overflow warnings
- Read stdout in a dedicated thread
- Parse MJPEG stream: each frame starts with `\xff\xd8` (SOI) and ends with `\xff\xd9` (EOI)
- On each complete frame: emit Tauri event `hdmi-frame` with the JPEG bytes (base64-encoded)
- Keep only the latest frame (drop older ones if frontend is slow)
- Handle process crashes: auto-restart with backoff
- Store the child process handle in a `Mutex<Option<Child>>` for clean shutdown

**Frame parsing pseudocode:**
```rust
let mut buf = Vec::new();
let mut in_frame = false;
loop {
    let byte = read_byte_from_stdout()?;
    if !in_frame {
        if prev_byte == 0xFF && byte == 0xD8 {
            buf.clear();
            buf.push(0xFF);
            buf.push(0xD8);
            in_frame = true;
        }
    } else {
        buf.push(byte);
        if prev_byte == 0xFF && byte == 0xD9 {
            // Complete JPEG frame — emit it
            emit_frame(&buf);
            in_frame = false;
        }
    }
    prev_byte = byte;
}
```

Actually, simpler approach: use `-f image2pipe -vcodec mjpeg` and read fixed JPEG frames. Or better yet, use `-f mpjpeg` which outputs multipart MIME boundaries between frames — easier to parse.

**Recommended: Use `-f mpjpeg` output format:**
```
ffmpeg -f dshow -video_size 1920x1080 -framerate 30 -rtbufsize 100M -i video="{device_name}" -f mpjpeg -q:v 5 -boundary_tag ffframe -an pipe:1
```
This outputs frames separated by `--ffframe\r\nContent-Type: image/jpeg\r\nContent-Length: NNNN\r\n\r\n<jpeg bytes>`. Parse the Content-Length header, then read exactly that many bytes for each frame.

#### 2. Frontend Integration

**Option A (Recommended): Tauri Event + Blob URL**

In `useLiveViewManager.ts` (or a new `useHdmiCapture.ts` hook):

```typescript
// Listen for frames from Rust
const [frameUrl, setFrameUrl] = useState<string | null>(null);
const prevUrlRef = useRef<string | null>(null);

useEffect(() => {
  const unlisten = listen<string>('hdmi-frame', (event) => {
    // event.payload is base64 JPEG
    const blob = base64ToBlob(event.payload, 'image/jpeg');
    const url = URL.createObjectURL(blob);

    // Revoke previous URL to prevent memory leak
    if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    prevUrlRef.current = url;

    setFrameUrl(url);
  });

  return () => { unlisten.then(fn => fn()); };
}, []);
```

Then render: `<img src={frameUrl} className="liveview-video" />` instead of `<video>`.

**Option B: Local HTTP server**

Alternatively, spawn a tiny HTTP server in Rust that serves the MJPEG stream as `multipart/x-mixed-replace`. The frontend just uses:
```html
<img src="http://localhost:PORT/stream" />
```
This is how many IP cameras work. The browser natively handles `multipart/x-mixed-replace` on `<img>` tags — each JPEG boundary replaces the image. Zero JavaScript needed for frame handling. This might be the simplest approach.

**I'd recommend Option B** — it's simpler, lower latency (no base64 encoding/decoding overhead), and the browser handles frame updates natively.

#### 3. Integration with Existing LiveView System

The existing system has:
- `src/hooks/useLiveViewManager.ts` — Centralized stream manager (currently uses getUserMedia)
- `src/contexts/LiveViewContext.tsx` — React context provider with a hidden keep-alive `<video>`
- `src/components/Sidebar/Photobooth/LiveViewSection.tsx` — UI with device selector, capture method toggle (HDMI vs USB-C)
- `src/components/PhotoboothView/DisplayContent.tsx` — Main workspace display

The `LiveViewSection` already has a `captureMethod` state (`'hdmi' | 'usbc'`). When `captureMethod === 'hdmi'`:
- Use the new FFmpeg-based capture (list devices via `list_capture_devices`, start via `start_hdmi_capture`)
- Render an `<img>` tag instead of `<video>` tag
- The `useLiveViewManager` hook should be extended to support both modes, or create a parallel `useHdmiCapture` hook

When `captureMethod === 'usbc'`:
- Keep the existing USB daemon-based approach (unchanged)

**Key files to modify:**
- `src-tauri/src/lib.rs` — Add Tauri commands (or create `src-tauri/src/hdmi_capture.rs` module)
- `src-tauri/tauri.conf.json` — Register new commands
- `src/hooks/useLiveViewManager.ts` — Add HDMI capture mode or create new hook
- `src/contexts/LiveViewContext.tsx` — Expose frame URL alongside MediaStream
- `src/components/Sidebar/Photobooth/LiveViewSection.tsx` — Switch between `<video>` and `<img>` based on capture method
- `src/components/PhotoboothView/DisplayContent.tsx` — Same: support both `<video>` (getUserMedia) and `<img>` (HDMI FFmpeg)

### Constraints

- FFmpeg is already installed on the system (available in PATH)
- This is a Tauri v2 app (uses `@tauri-apps/api/core` for `invoke`, `@tauri-apps/api/event` for `listen`)
- Windows only for now (DirectShow `-f dshow`)
- The existing `getUserMedia` code can stay as a fallback for webcams — just not used for HDMI capture cards
- Keep the existing device dropdown UI in LiveViewSection — just populate it from `list_capture_devices` when HDMI mode is selected
- Target: 1080p @ 30fps, MJPEG quality 5 (~35 Mbps raw, ~150KB per frame)

### Non-Goals (Don't Do These)

- Don't bundle FFmpeg — assume it's in PATH
- Don't add audio capture
- Don't change the USB-C daemon capture method
- Don't remove the existing getUserMedia code — keep it as fallback
- Don't over-engineer the Rust side — simple child process management is fine

### Testing

After implementation, verify:
1. `list_capture_devices` returns the capture card name
2. `start_hdmi_capture` shows live video in the UI
3. Stream stays alive for 10+ minutes without dropping (the whole point)
4. `stop_hdmi_capture` cleanly kills FFmpeg
5. Switching devices works
6. App shutdown cleanly kills FFmpeg (no orphan processes)
