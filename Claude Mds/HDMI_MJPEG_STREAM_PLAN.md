# Plan: Replace base64 Tauri Events with HTTP MJPEG Stream

## Context

The HDMI live view via FFmpeg/DirectShow drops out periodically. Root cause: every frame (~150KB JPEG) is base64-encoded (+33% → ~200KB), serialized as JSON through Tauri's IPC event system, deserialized in the WebView, JS-decoded, converted to Blob, loaded via `createObjectURL`. At 30fps = ~6MB/s of strings through IPC. When the WebView stalls (GC, render), FFmpeg's stdout pipe backs up and the process crashes.

**Solution:** Serve MJPEG directly over HTTP from Rust. The browser natively handles `multipart/x-mixed-replace` — zero JS per frame. This is identical to how IP cameras work.

## Architecture

```
FFmpeg (DirectShow) → stdout pipe → Rust shared buffer → HTTP MJPEG server
                                                              ↓
                                          <img src="http://127.0.0.1:9876/stream">
```

## Resilience Design

### Signal glitch (brief HDMI frame gap)
- FFmpeg's DirectShow input uses `-rtbufsize` — it simply waits for frames (like OBS)
- FFmpeg stdout produces nothing during the gap — the pipe doesn't back up
- HTTP server serves the **last good frame** to all connected clients
- `<img>` shows last frame (frozen), then resumes when new frames arrive
- **Recovery: instant, invisible to user**

### FFmpeg crash (process dies)
- Rust capture loop detects exit, respawns with exponential backoff (existing logic)
- HTTP server stays running — it just serves the last frame until new ones arrive
- `<img src>` URL never changes — browser sees a frozen image, then new frames flow in
- **No frontend state change needed. No placeholder/spinner. No blob URL churn.**
- Recovery time: ~500ms (FFmpeg spawn) + ~200ms (first frame) = <1s visual freeze

### Backpressure
- If `<img>` can't render fast enough, HTTP response buffer fills, server skips frames
- FFmpeg reader thread overwrites the shared buffer (always latest frame)
- **No cascade: slow consumer cannot cause FFmpeg to crash**

## Files to Modify

### 1. `src-tauri/Cargo.toml`
- Add `bytes = "1"` (efficient shared byte buffers)
- Use existing `hyper` + `http` deps for the HTTP server (no new framework needed)
- Add `tokio-stream` if needed for async streaming response

### 2. `src-tauri/src/hdmi_capture.rs` — Major rewrite

**Remove:**
- `base64` import and encoding
- `app.emit("hdmi-frame", ...)` per-frame events
- `AppHandle` parameter from `parse_and_emit_frames`

**Add:**
- Shared frame buffer: `Arc<RwLock<Bytes>>` + `watch::Sender<u64>` (frame counter)
- HTTP server function using `hyper` (already in deps):
  - `GET /stream` → `Content-Type: multipart/x-mixed-replace; boundary=frame`
  - `GET /snapshot` → single JPEG of latest frame
- Server spawned once on first `start_hdmi_capture`, reused across restarts
- CORS header `Access-Control-Allow-Origin: *` for WebView access

**Keep unchanged:**
- `list_capture_devices` (FFmpeg device enumeration)
- `capture_loop` (backoff, restart logic, shutdown signaling)
- `spawn_and_parse` structure (FFmpeg spawn, stderr logging)
- `stop_capture_inner` (shutdown channel)
- Error event: `app.emit("hdmi-capture-error", ...)` (still useful for UI toasts)

**Frame flow in `parse_and_emit_frames`:**
```
1. Read JPEG bytes from FFmpeg stdout (same as now)
2. Write directly to shared Arc<RwLock<Bytes>> (replaces base64+emit)
3. Notify via watch::Sender (bump frame counter)
4. HTTP handler receives notification, reads buffer, writes multipart chunk
```

### 3. `src-tauri/src/lib.rs`
- Register new command: `get_hdmi_stream_port` → returns the port number
- Or: hardcode port 9876, frontend just knows it

### 4. `src/hooks/useHdmiCapture.ts` — Simplify

**Remove entirely:**
- `base64ToBlob` function
- `prevUrlRef` + `URL.revokeObjectURL` blob management
- `unlistenRef` + Tauri event listener for `hdmi-frame`
- `frameCountRef` (no longer tracking JS-side frame count)

**New logic:**
```typescript
const STREAM_PORT = 9876;

startCapture(deviceName) {
  await invoke('start_hdmi_capture', { deviceName });
  setFrameUrl(`http://127.0.0.1:${STREAM_PORT}/stream`);
  setIsCapturing(true);
}

stopCapture() {
  await invoke('stop_hdmi_capture');
  setFrameUrl(null);
  setIsCapturing(false);
}
```

That's it. ~30 lines instead of ~180.

### 5. No changes needed
- `src/contexts/LiveViewContext.tsx` — already passes `hdmi.frameUrl`
- `src/components/Sidebar/Photobooth/LiveViewSection.tsx` — already renders `<img src={hdmi.frameUrl}>`
- `src/components/PhotoboothView/DisplayContent.tsx` — already renders `<img src={hdmiStreamUrl}>`

## Why This Is Better Than Current Approach

| Problem | Before (base64 events) | After (HTTP MJPEG) |
|---------|----------------------|-------------------|
| **CPU per frame** | base64 encode + JSON serialize + JS decode + Blob | Zero JS — native browser decode |
| **Memory per frame** | 2x copies (base64 string + blob) | Zero copies in JS |
| **Backpressure** | IPC queue fills → FFmpeg pipe blocks → crash | HTTP stream handles naturally |
| **Frame drops** | Causes FFmpeg exit | Browser just skips, no crash |
| **Signal glitch** | FFmpeg may crash from pipe backup | FFmpeg stays alive, serves last frame |
| **FFmpeg restart** | Frontend must re-setup event listeners, manage blob URLs | Same URL, browser auto-resumes |
| **Frontend code** | ~180 lines (base64, blob, events) | ~30 lines (just a URL) |

## Why This Matches OBS's Resilience

OBS's key advantage: **no IPC between capture and render**. Our HTTP MJPEG approach minimizes IPC to the absolute minimum — raw JPEG bytes over a TCP socket, which the browser handles natively. The only overhead vs OBS is TCP framing (~50 bytes per frame), which is negligible.

## Verification

1. Build Rust backend: `cargo build`
2. Start app, select HDMI capture device
3. Stream should display in sidebar preview and main workspace
4. Let it run for 10+ minutes — zero dropouts, zero FFmpeg restarts
5. Browser DevTools → Network tab: single long-lived HTTP request to `localhost:9876/stream`
6. Collapse/expand live view section → stream resumes instantly (same URL)
7. Switch display modes (single/center/canvas) → stream resumes instantly
8. Open `http://127.0.0.1:9876/snapshot` in browser → single JPEG frame (debug)
