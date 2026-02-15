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

  let scale: number;
  if (imgAspect > zoneAspect) {
    // Image wider than zone → scale up to fill height
    scale = imgAspect / zoneAspect;
  } else {
    // Image taller → scale up to fill width
    scale = zoneAspect / imgAspect;
  }

  // Round up to nearest 0.1
  return Math.ceil(scale * 10) / 10;
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
