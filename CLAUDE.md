# Claude Development Notes

## Tool Usage Guidelines

### Edit Tool - Correct Format

```json
{
  "file_path": "path/to/file.ext",
  "old_string": "exact text to replace",
  "new_string": "new text",
  "replace_all": false  // BOOLEAN, not string!
}
```

**Practical workflow:**
1. Use `Read` tool to see file contents
2. Copy the exact text from Read output (exclude line numbers like `    1→`)
3. Paste as `old_string` in Edit
4. Set `replace_all: true` to replace all occurrences, `false` or omit for first match only

**Important:**
- `replace_all` must be a boolean (`true`/`false`), NOT a string (`"true"`/`"false"`)
- `old_string` must match **exactly** — indentation, whitespace, newlines all matter
- Use `replace_all: true` when you want to replace the same text everywhere in the file

## Project-Specific Information

### FFmpeg Auto-Download System

The app uses an auto-download system for FFmpeg instead of bundling it (keeps app size small).

**How it works:**
1. When FFmpeg is required but missing, backend returns specific error message
2. Frontend detects the error and shows `FFmpegDownloadModal` automatically
3. User downloads FFmpeg through the modal (hosted on Firebase Storage)
4. Modal closes and operation retries automatically

**Integration Points:**

1. **HDMI Capture** ([LiveViewSection.tsx](src/components/Sidebar/Photobooth/LiveViewSection.tsx))
   - Hook: `useHdmiCapture()` returns `ffmpegRequired` boolean
   - When `ffmpegRequired` is true, shows blue info box (not red error)
   - Only "Download FFmpeg" button shown (no "Retry" button)
   - CSS classes: `.device-info`, `.info-icon`, `.info-message`, `.device-download-btn`

2. **Video Generation** ([GifTabContent.tsx](src/components/Sidebar/Photobooth/components/GifTabContent.tsx))
   - Error handling detects "FFmpeg not found" in error message
   - Automatically shows modal when detected
   - Modal at component root level (sibling to other JSX, not nested)

**Download URL:**
```
https://firebasestorage.googleapis.com/v0/b/iph-ptb.firebasestorage.app/o/ffmpeg%2Fffmpeg.exe?alt=media
```

**Backend Commands:**
- `check_ffmpeg_installed()` - Returns version string or empty
- `get_ffmpeg_version()` - Gets installed version
- `download_ffmpeg_command(url)` - Downloads from URL
- `delete_ffmpeg_command()` - For testing only

**Helper Functions (Rust):**
- `ffmpeg_executable_path()` - Returns path to downloaded ffmpeg.exe
- `is_ffmpeg_installed()` - Checks if ffmpeg exists
- `ensure_ffmpeg_exists()` - Returns error if missing (used by HDMI/video features)
- `ffmpeg_not_found_error()` - Standardized error message

### Import Path Reference

From `src/components/Sidebar/Photobooth/`:
- To Modals: `../../Modals/ComponentName`
- To Contexts: `../../../contexts/ContextName`
- To Hooks: `../../../hooks/hookName`
- To Utils: `../../../utils/utilName`

From `src/components/Sidebar/Photobooth/components/`:
- To Modals: `../../../Modals/ComponentName`
- To Contexts: `../../../../contexts/ContextName`

### Logger Utility

The project uses a custom logger at [`src/utils/logger.ts`](src/utils/logger.ts) for production-ready logging.

**Import and usage:**
```typescript
import { createLogger } from './utils/logger';

const logger = createLogger('MyModuleName');

logger.debug('Verbose trace info');      // dev only
logger.info('User action occurred');     // dev only
logger.warn('Non-critical issue');       // always shown
logger.error('Something failed', err);   // always shown
```

**Migration from console:**
- `console.log(...)` → `logger.debug(...)`
- `console.error(...)` → `logger.error(...)`
- `console.warn(...)` → `logger.warn(...)`

The `[ModuleName]` prefix is added automatically — no need to include it in messages.
