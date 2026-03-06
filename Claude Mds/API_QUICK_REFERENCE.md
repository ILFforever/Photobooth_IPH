# Photobooth Camera Daemon - API Quick Reference

**Base URL:** `http://localhost:58321`

## Quick Start

```bash
# Check if daemon is running
curl http://localhost:58321/api/health

# List connected cameras
curl http://localhost:58321/api/cameras

# Get current camera status
curl http://localhost:58321/api/camera/status

# Take a photo
curl -X POST http://localhost:58321/api/capture
```

## Endpoints

### Health & Status

```bash
GET /api/health                  # Daemon health check
GET /api/status                  # Daemon running status
GET /api/cameras                 # List all connected cameras
GET /api/camera/status           # Battery, ISO, shutter, aperture, focus, WB
```

### Camera Configuration

```bash
# Get all camera settings with available choices
GET /api/camera/config

# Get complete widget tree (100+ Fuji-specific settings)
GET /api/widgets

# Set camera setting (JSON format)
POST /api/camera/config
  Content-Type: application/json
  {"setting":"iso","value":"800"}

# Set camera setting (form data format)
POST /api/camera/config
  iso=800

# Get camera debug info
GET /api/debug
```

### Capture

```bash
# Trigger capture
POST /api/capture

# Download photo
GET /api/photo/DSCF0042.JPG

# Delete photo from VM
DELETE /api/photo/DSCF0042.JPG
```

### Live View

```bash
GET /api/liveview/status         # Check if live view is active
POST /api/liveview/start         # Start live view (locks camera)
POST /api/liveview/stop          # Stop live view (unlocks camera)
GET /api/liveview/frame          # Request preview frame
```

### Multi-Camera Support

Add `?camera=N` to any endpoint (0-based index):

```bash
curl http://localhost:58321/api/camera/config?camera=1
curl -X POST http://localhost:58321/api/capture?camera=1
```

## Common Settings

| Setting | Values | Example |
|---------|--------|---------|
| `iso` | 64-51200, Auto | `{"setting":"iso","value":"800"}` |
| `shutterspeed` | 1/8000 to 60s | `{"setting":"shutterspeed","value":"1/1000"}` |
| `whitebalance` | Auto, Daylight, Tungsten, etc. | `{"setting":"whitebalance","value":"Daylight"}` |
| `focusmode` | Manual, Single-Servo AF, Continuous-Servo AF | `{"setting":"focusmode","value":"Manual"}` |
| `imageformat` | RAW, JPEG Fine, RAW+JPEG Fine | `{"setting":"imageformat","value":"RAW"}` |
| `imagesize` | Various resolutions | `{"setting":"imagesize","value":"7728x5152"}` |
| `exposurecompensation` | -5 to +5 EV | `{"setting":"exposurecompensation","value":"0"}` |

## Sample Code

### JavaScript/TypeScript

```typescript
// Get camera status
const status = await fetch('http://localhost:58321/api/camera/status')
  .then(r => r.json());

// Set ISO
await fetch('http://localhost:58321/api/camera/config', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ setting: 'iso', value: '800' })
});

// Capture photo
const result = await fetch('http://localhost:58321/api/capture', {
  method: 'POST'
}).then(r => r.json());
logger.debug(result.files[0].file_path); // /tmp/DSCF0042.JPG
```

### Python

```python
import requests

base_url = 'http://localhost:58321'

# Get camera status
status = requests.get(f'{base_url}/api/camera/status').json()
print(status['status']['iso'])

# Set ISO
requests.post(f'{base_url}/api/camera/config',
    json={'setting': 'iso', 'value': '800'})

# Capture photo
result = requests.post(f'{base_url}/api/capture').json()
print(result['files'][0]['file_path'])
```

### cURL

```bash
# Set ISO
curl -X POST http://localhost:58321/api/camera/config \
  -H "Content-Type: application/json" \
  -d '{"setting":"iso","value":"800"}'

# Set shutter speed
curl -X POST http://localhost:58321/api/camera/config \
  -H "Content-Type: application/json" \
  -d '{"setting":"shutterspeed","value":"1/1000"}'

# Capture photo
curl -X POST http://localhost:58321/api/capture

# Download photo
curl http://localhost:58321/api/photo/DSCF0042.JPG --output photo.jpg
```

## WebSocket Events

```javascript
const ws = new WebSocket('ws://localhost:58321/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  // Mode changes
  if (data.mode === 'capture') {
    logger.debug('Capture in progress');
  }

  // Photo downloaded
  if (data.type === 'photo_downloaded') {
    logger.debug('New photo:', data.file_path);
    // Download and display
    fetch(`http://localhost:58321/api/photo/${data.file_path.split('/').pop()}`)
      .then(r => r.blob())
      .then(blob => /* display image */);
  }
};
```

## Response Formats

### Success Response (Setting Config)
```json
{
  "success": true,
  "setting": "iso",
  "value": "800"
}
```

### Capture Response
```json
{
  "success": true,
  "files": [
    {
      "file_path": "/tmp/DSCF0042.JPG",
      "camera_path": "/store_10000001/DSCF0042.JPG"
    }
  ]
}
```

### Error Response
```json
{
  "error": "Choice not found in available options"
}
```

## Troubleshooting

| Error | Solution |
|-------|----------|
| "Could not claim USB device" | Wait 1-2 seconds, retry (camera was busy) |
| "Choice not found" | Use `/api/camera/config` to see valid values |
| "Setting not found" | Use `/api/widgets` to find correct widget name |

## Tips

1. **Query valid choices first**: Always use `/api/camera/config` to see available values for a setting
2. **Use JSON format**: More reliable than form data for special characters
3. **Add delays**: Wait 100-500ms between rapid commands to avoid USB claim errors
4. **Check camera status**: Use `/api/camera/status` to verify settings were applied

## Full Documentation

See [API_TEST_RESULTS.md](./API_TEST_RESULTS.md) for comprehensive test results and detailed documentation.
