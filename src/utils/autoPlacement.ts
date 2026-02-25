import { FrameZone } from '../types/frame';
import { PlacedImage, DEFAULT_TRANSFORM } from '../types/collage';

/**
 * Calculate scale factor so the image fills the zone (cover style).
 * Uses objectFit: contain internally, so the scale compensates for the gap.
 */
export function calculateCoverScale(
  imgWidth: number,
  imgHeight: number,
  zoneWidth: number,
  zoneHeight: number
): number {
  const imgAspect = imgWidth / imgHeight;
  const zoneAspect = zoneWidth / zoneHeight;

  console.log('=== calculateCoverScale ===');
  console.log('Image:', imgWidth, 'x', imgHeight, '→ aspect:', imgAspect);
  console.log('Zone:', zoneWidth, 'x', zoneHeight, '→ aspect:', zoneAspect);

  let scale: number;
  if (imgAspect > zoneAspect) {
    // Image wider than zone → scale up to fill height
    scale = imgAspect / zoneAspect;
    console.log('Image wider → scale = imgAspect/zoneAspect =', scale);
  } else {
    // Image taller → scale up to fill width
    scale = zoneAspect / imgAspect;
    console.log('Image taller/equal → scale = zoneAspect/imgAspect =', scale);
  }

  // Snap to 1.0 if the difference is negligible (within ~1%)
  if (scale > 0.99 && scale < 1.01) {
    console.log('Scale', scale, 'within 0.99-1.01 → snapping to 1.0');
    console.log('===========================');
    return 1.0;
  }

  // Round up to nearest 0.1
  const result = Math.ceil(scale * 10 - 1e-9) / 10;
  console.log('Final scale:', result);
  console.log('===========================');
  return result;
}

export interface PhotoForPlacement {
  id: string;
  filePath: string;
  thumbnail?: string;
}

/**
 * Auto-place photos into frame zones in order, computing optimal cover scale.
 */
export function autoPlacePhotos(
  zones: FrameZone[],
  photos: PhotoForPlacement[],
  imageDimensions: Map<string, { width: number; height: number }>
): Map<string, PlacedImage> {
  const placed = new Map<string, PlacedImage>();

  zones.forEach((zone, index) => {
    if (index >= photos.length) return;
    const photo = photos[index];
    const dims = imageDimensions.get(photo.id);

    let scale = 1.0;
    if (dims) {
      scale = calculateCoverScale(dims.width, dims.height, zone.width, zone.height);
    }

    placed.set(zone.id, {
      sourceFile: photo.filePath,
      thumbnail: photo.thumbnail,
      zoneId: zone.id,
      transform: { ...DEFAULT_TRANSFORM, scale },
      originalScale: scale,
    });
  });

  return placed;
}
