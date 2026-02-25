/**
 * Applies the correct Canvas 2D clip path for a frame zone based on its shape.
 * Assumes the canvas context is already translated to the zone center.
 */

type ZoneClipInfo = {
  width: number;
  height: number;
  shape: string;
  borderRadius?: number;
};

// Polygon points as normalized 0-1 coordinates, matching the CSS clip-path polygons
function getPolygonPoints(shape: string): [number, number][] {
  switch (shape) {
    case 'triangle':
      return [[0.5, 0], [0, 1], [1, 1]];
    case 'pentagon':
      return [[0.5, 0], [1, 0.38], [0.82, 1], [0.18, 1], [0, 0.38]];
    case 'hexagon':
      return [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]];
    case 'octagon':
      return [[0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]];
    case 'star':
      return [[0.5, 0], [0.61, 0.35], [0.98, 0.35], [0.68, 0.57], [0.79, 0.91], [0.5, 0.7], [0.21, 0.91], [0.32, 0.57], [0.02, 0.35], [0.39, 0.35]];
    case 'diamond':
      return [[0.5, 0], [0.78, 0.5], [0.5, 1], [0.22, 0.5]];
    case 'heart':
      return [[0.5, 0.15], [0.65, 0], [0.85, 0], [1, 0.15], [1, 0.35], [0.85, 0.5], [0.5, 1], [0.15, 0.5], [0, 0.35], [0, 0.15], [0.15, 0], [0.35, 0]];
    case 'cross':
      return [[0.2, 0], [0.8, 0], [0.8, 0.2], [1, 0.2], [1, 0.8], [0.8, 0.8], [0.8, 1], [0.2, 1], [0.2, 0.8], [0, 0.8], [0, 0.2], [0.2, 0.2]];
    default:
      return [];
  }
}

export function applyZoneClipPath(ctx: CanvasRenderingContext2D, zone: ZoneClipInfo): void {
  const w = zone.width;
  const h = zone.height;
  const hw = w / 2;
  const hh = h / 2;

  ctx.beginPath();

  switch (zone.shape) {
    case 'circle':
      ctx.ellipse(0, 0, Math.min(hw, hh), Math.min(hw, hh), 0, 0, Math.PI * 2);
      break;

    case 'ellipse':
      ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      break;

    case 'rounded_rect': {
      const r = zone.borderRadius || 12;
      ctx.roundRect(-hw, -hh, w, h, r);
      break;
    }

    case 'pill': {
      const r = Math.min(hw, hh);
      ctx.roundRect(-hw, -hh, w, h, r);
      break;
    }

    case 'triangle':
    case 'pentagon':
    case 'hexagon':
    case 'octagon':
    case 'star':
    case 'diamond':
    case 'heart':
    case 'cross': {
      const points = getPolygonPoints(zone.shape);
      for (let i = 0; i < points.length; i++) {
        const px = -hw + points[i][0] * w;
        const py = -hh + points[i][1] * h;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }

    default: // rectangle
      ctx.rect(-hw, -hh, w, h);
      break;
  }

  ctx.clip();
}
