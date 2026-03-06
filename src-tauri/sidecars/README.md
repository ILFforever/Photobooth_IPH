# Sidecar Binaries

This directory contains external binaries that are bundled with the application.

## FFmpeg

### Windows (Current Target)

Download the static FFmpeg build for Windows:

1. **Download**: https://github.com/BtbN/FFmpeg-Builds/releases
   - Look for the latest release
   - Download: `ffmpeg-master-latest-win64-gpl.zip` (or similar)

2. **Extract**:
   - Extract the downloaded ZIP file
   - Navigate to the `bin` folder inside
   - Copy `ffmpeg.exe` to this directory (src-tauri/sidecars/)

3. **Verify**:
   - You should now have: `src-tauri/sidecars/ffmpeg.exe`
   - The file size should be around 50-70 MB

### Linux (Future)

For Linux builds, download from:
- https://johnvansickle.com/ffmpeg/ (static builds)
- Or use your distro's package manager

### macOS (Future)

For macOS builds, use Homebrew:
```bash
brew install ffmpeg
```

Then copy from `/usr/local/bin/ffmpeg` or `/opt/homebrew/bin/ffmpeg`

---

## Notes

- The sidecar binaries are automatically bundled with the app during build
- In development mode, the app will fall back to system PATH
- In production builds, the bundled sidecar is used
