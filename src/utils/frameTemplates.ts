// Frame template utilities for creating and managing custom frame layouts

import { Frame, FrameZone, FrameShape } from '../types/frame';

export interface FrameTemplateConfig {
  canvasWidth: number;
  canvasHeight: number;
  margin: number; // Margin around the canvas in pixels
  gap: number; // Gap between zones in pixels
}

export interface ZoneConfig {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape?: FrameShape;
  rotation?: number;
}

/**
 * Create a single photo frame template
 */
export function createSinglePhotoFrame(config: FrameTemplateConfig): Omit<Frame, 'id' | 'name' | 'description' | 'is_default' | 'created_at' | 'thumbnail'> {
  const { canvasWidth, canvasHeight, margin } = config;

  return {
    width: canvasWidth,
    height: canvasHeight,
    zones: [
      {
        id: 'zone-1',
        x: margin,
        y: margin,
        width: canvasWidth - (margin * 2),
        height: canvasHeight - (margin * 2),
        rotation: 0,
        shape: 'rectangle',
      }
    ]
  };
}

/**
 * Create a side-by-side two photo frame template
 */
export function createSideBySideFrame(config: FrameTemplateConfig): Omit<Frame, 'id' | 'name' | 'description' | 'is_default' | 'created_at' | 'thumbnail'> {
  const { canvasWidth, canvasHeight, margin, gap } = config;

  const zoneWidth = (canvasWidth - (margin * 2) - gap) / 2;
  const zoneHeight = canvasHeight - (margin * 2);

  return {
    width: canvasWidth,
    height: canvasHeight,
    zones: [
      {
        id: 'zone-1',
        x: margin,
        y: margin,
        width: zoneWidth,
        height: zoneHeight,
        rotation: 0,
        shape: 'rectangle',
        margin_right: gap,
      },
      {
        id: 'zone-2',
        x: margin + zoneWidth + gap,
        y: margin,
        width: zoneWidth,
        height: zoneHeight,
        rotation: 0,
        shape: 'rectangle',
      }
    ]
  };
}

/**
 * Create a 2x2 grid frame template
 */
export function createGridFrame(config: FrameTemplateConfig): Omit<Frame, 'id' | 'name' | 'description' | 'is_default' | 'created_at' | 'thumbnail'> {
  const { canvasWidth, canvasHeight, margin, gap } = config;

  const zoneWidth = (canvasWidth - (margin * 2) - gap) / 2;
  const zoneHeight = (canvasHeight - (margin * 2) - gap) / 2;

  return {
    width: canvasWidth,
    height: canvasHeight,
    zones: [
      {
        id: 'zone-1',
        x: margin,
        y: margin,
        width: zoneWidth,
        height: zoneHeight,
        rotation: 0,
        shape: 'rectangle',
        margin_right: gap,
        margin_bottom: gap,
      },
      {
        id: 'zone-2',
        x: margin + zoneWidth + gap,
        y: margin,
        width: zoneWidth,
        height: zoneHeight,
        rotation: 0,
        shape: 'rectangle',
        margin_bottom: gap,
      },
      {
        id: 'zone-3',
        x: margin,
        y: margin + zoneHeight + gap,
        width: zoneWidth,
        height: zoneHeight,
        rotation: 0,
        shape: 'rectangle',
        margin_right: gap,
      },
      {
        id: 'zone-4',
        x: margin + zoneWidth + gap,
        y: margin + zoneHeight + gap,
        width: zoneWidth,
        height: zoneHeight,
        rotation: 0,
        shape: 'rectangle',
      }
    ]
  };
}

/**
 * Create a custom frame from zone configurations
 */
export function createCustomFrame(
  name: string,
  description: string,
  canvasWidth: number,
  canvasHeight: number,
  zones: ZoneConfig[]
): Omit<Frame, 'id' | 'is_default' | 'created_at' | 'thumbnail'> {
  return {
    name,
    description,
    width: canvasWidth,
    height: canvasHeight,
    zones: zones.map(zone => ({
      ...zone,
      rotation: zone.rotation || 0,
      shape: zone.shape || 'rectangle',
    }))
  };
}

/**
 * Generate a unique ID for a new frame
 */
export function generateFrameId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Calculate zone position based on row, col, and spacing
 */
export function calculateZonePosition(
  row: number,
  col: number,
  zoneWidth: number,
  zoneHeight: number,
  margin: number,
  gap: number
): { x: number; y: number } {
  return {
    x: margin + col * (zoneWidth + gap),
    y: margin + row * (zoneHeight + gap),
  };
}

/**
 * Validate that zones don't overlap
 */
export function validateZones(zones: FrameZone[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const zone1 = zones[i];
      const zone2 = zones[j];

      // Check for overlap (excluding rotation for simplicity)
      const noOverlap =
        zone1.x + zone1.width <= zone2.x ||
        zone2.x + zone2.width <= zone1.x ||
        zone1.y + zone1.height <= zone2.y ||
        zone2.y + zone2.height <= zone1.y;

      if (!noOverlap) {
        errors.push(`Zones ${zone1.id} and ${zone2.id} overlap`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that zones are within canvas bounds
 */
export function validateZoneBounds(
  zones: FrameZone[],
  canvasWidth: number,
  canvasHeight: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  zones.forEach(zone => {
    if (zone.x < 0 || zone.y < 0) {
      errors.push(`Zone ${zone.id} has negative position`);
    }

    if (zone.x + zone.width > canvasWidth) {
      errors.push(`Zone ${zone.id} exceeds canvas width`);
    }

    if (zone.y + zone.height > canvasHeight) {
      errors.push(`Zone ${zone.id} exceeds canvas height`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
