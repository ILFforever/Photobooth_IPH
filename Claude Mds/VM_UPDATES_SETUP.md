# VM Update Server Example

This file demonstrates the format for the version.json file that the Photobooth_IPH app will poll for updates.

## File Structure

```
your-domain.com/
├── version.json          # Version information
└── photobooth-v1.0.12.iso  # The actual VM disk image
```

## version.json Format

```json
{
  "version": "2025.02.24",
  "iso_url": "https://your-domain.com/updates/photobooth-v2025.02.24.iso",
  "iso_size_mb": 2048,
  "release_date": "2025-02-24T12:00:00Z",
  "changelog": "Added support for Canon R50 camera, improved gphoto2 compatibility, fixed VM memory issues"
}
```

## Fields Explained

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | Version identifier (recommended format: YYYY.MM.DD) |
| `iso_url` | string | Direct download URL for the ISO file |
| `iso_size_mb` | number | File size in MB (for progress display) |
| `release_date` | string | ISO 8601 date string |
| `changelog` | string | Release notes and changes |

## Endpoint Configuration

Configure the update URL in Photobooth_IPH settings (stored in app settings):

```json
{
  "vmUpdateUrl": "https://your-domain.com/version.json"
}
```

## Example Website Files

### index.html (Simple download page)

```html
<!DOCTYPE html>
<html>
<head>
    <title>Photobooth_IPH VM Updates</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
        .download-box { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .version-badge { background: #4CAF50; color: white; padding: 4px 8px; border-radius: 4px; display: inline-block; }
    </style>
</head>
<body>
    <h1>Photobooth_IPH VM Updates</h1>

    <div class="download-box">
        <h2>Latest Version: <span class="version-badge">2025.02.24</span></h2>
        <p>File size: 2.0 GB</p>
        <a href="photobooth-v2025.02.24.iso" download class="btn">
            <button style="padding: 12px 24px; font-size: 16px; cursor: pointer; background: #0078d4; color: white; border: none; border-radius: 4px;">
                Download VM Update
            </button>
        </a>
        <p>Released: February 24, 2025</p>
    </div>

    <h2>What's New</h2>
    <ul>
        <li>Added support for Canon R50 camera</li>
        <li>Improved gphoto2 2.5.33+ compatibility</li>
        <li>Fixed VM memory allocation issues</li>
        <li>Optimized boot performance</li>
    </ul>

    <h2>Installation</h2>
    <ol>
        <li>Download the ISO file above</li>
        <li>Copy to <code>C:\Users\YourUser\Photobooth_IPH\linux-build\</code></li>
        <li>Replace the existing <code>photobooth.iso</code></li>
        <li>Restart Photobooth_IPH</li>
    </ol>
</body>
</html>
```

## Version Strategy

Use date-based versioning (YYYY.MM.DD) for the VM:
- Easy to identify build age
- Sortable chronologically
- Can include hotfixes: `2025.02.24.1` for first hotfix
