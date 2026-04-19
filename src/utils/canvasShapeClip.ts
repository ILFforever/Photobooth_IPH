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
      return [[0.5, 0.95], [0.65, 0.75], [0.78, 0.60], [0.90, 0.48], [0.97, 0.35], [0.98, 0.22], [0.96, 0.14], [0.93, 0.08], [0.87, 0.03], [0.80, 0.01], [0.76, 0.01], [0.73, 0.02], [0.71, 0.03], [0.69, 0.04], [0.68, 0.05], [0.66, 0.06], [0.64, 0.07], [0.62, 0.09], [0.61, 0.10], [0.59, 0.12], [0.57, 0.13], [0.56, 0.15], [0.53, 0.17], [0.50, 0.18], [0.47, 0.17], [0.44, 0.15], [0.43, 0.13], [0.41, 0.12], [0.39, 0.10], [0.38, 0.09], [0.36, 0.07], [0.34, 0.06], [0.32, 0.05], [0.31, 0.04], [0.29, 0.03], [0.27, 0.02], [0.24, 0.01], [0.20, 0.01], [0.13, 0.03], [0.07, 0.08], [0.04, 0.14], [0.02, 0.22], [0.03, 0.35], [0.10, 0.48], [0.22, 0.60], [0.35, 0.75]];
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
