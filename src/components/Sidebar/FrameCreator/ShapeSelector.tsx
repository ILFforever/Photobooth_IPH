import Icon from '@mdi/react';
import {
  mdiSquareRoundedOutline,
  mdiCircleOutline,
  mdiTriangleOutline,
  mdiHexagonOutline,
  mdiOctagon,
  mdiStarOutline,
  mdiDiamondStone,
  mdiHeartOutline,
  mdiPlus,
  mdiSquareOutline,
} from '@mdi/js';
import { FrameShape } from '../../../types/frame';
import './ShapeSelector.css';

interface ShapeSelectorProps {
  selectedShape: FrameShape;
  onShapeChange: (shape: FrameShape) => void;
}

const SHAPES: FrameShape[] = [
  'rectangle', 'rounded_rect', 'circle', 'ellipse', 'pill',
  'triangle', 'pentagon', 'hexagon', 'octagon', 'star', 'diamond', 'heart', 'cross',
];

export function ShapeSelector({ selectedShape, onShapeChange }: ShapeSelectorProps) {
  const getShapeStyle = (shape: FrameShape): string => {
    switch (shape) {
      case 'circle':       return '50%';
      case 'ellipse':      return '50% / 40%';
      case 'rounded_rect': return '12px';
      case 'pill':         return '999px';
      default:             return '2px';
    }
  };

  const getClipPath = (shape: FrameShape): string => {
    switch (shape) {
      case 'triangle':  return 'polygon(50% 0%, 0% 100%, 100% 100%)';
      case 'pentagon':  return 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)';
      case 'hexagon':   return 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
      case 'octagon':   return 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)';
      case 'star':      return 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
      case 'diamond':   return 'polygon(50% 0%, 78% 50%, 50% 100%, 22% 50%)';
      case 'heart':     return 'polygon(50% 95%, 65% 75%, 78% 60%, 90% 48%, 97% 35%, 98% 22%, 96% 14%, 93% 8%, 87% 3%, 80% 1%, 76% 1%, 73% 2%, 71% 3%, 69% 4%, 68% 5%, 66% 6%, 64% 7%, 62% 9%, 61% 10%, 59% 12%, 57% 13%, 56% 15%, 53% 17%, 50% 18%, 47% 17%, 44% 15%, 43% 13%, 41% 12%, 39% 10%, 38% 9%, 36% 7%, 34% 6%, 32% 5%, 31% 4%, 29% 3%, 27% 2%, 24% 1%, 20% 1%, 13% 3%, 7% 8%, 4% 14%, 2% 22%, 3% 35%, 10% 48%, 22% 60%, 35% 75%)';
      case 'cross':     return 'polygon(20% 0%, 80% 0%, 80% 20%, 100% 20%, 100% 80%, 80% 80%, 80% 100%, 20% 100%, 20% 80%, 0% 80%, 0% 20%, 20% 20%)';
      default:          return 'none';
    }
  };

  const getShapeIcon = (shape: FrameShape) => {
    switch (shape) {
      case 'triangle':     return mdiTriangleOutline;
      case 'hexagon':      return mdiHexagonOutline;
      case 'octagon':      return mdiOctagon;
      case 'star':         return mdiStarOutline;
      case 'diamond':      return mdiDiamondStone;
      case 'heart':        return mdiHeartOutline;
      case 'cross':        return mdiPlus;
      case 'rounded_rect': return mdiSquareRoundedOutline;
      case 'rectangle':    return mdiSquareOutline;
      case 'circle':       return mdiCircleOutline;
      default:             return null;
    }
  };

  const getCustomSvg = (shape: FrameShape) => {
    switch (shape) {
      case 'ellipse':
        return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="12" rx="10" ry="6"/></svg>;
      case 'pill':
        return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="2" width="12" height="20" rx="6"/></svg>;
      case 'pentagon':
        return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L22 9L18 21H6L2 9L12 2Z"/></svg>;
      default: return null;
    }
  };

  const getShapeName = (shape: FrameShape): string => {
    switch (shape) {
      case 'rounded_rect': return 'Rounded';
      case 'circle':       return 'Circle';
      case 'ellipse':      return 'Oval';
      case 'pill':         return 'Pill';
      case 'triangle':     return 'Triangle';
      case 'pentagon':     return 'Pentagon';
      case 'hexagon':      return 'Hexagon';
      case 'octagon':      return 'Octagon';
      case 'star':         return 'Star';
      case 'diamond':      return 'Diamond';
      case 'heart':        return 'Heart';
      case 'cross':        return 'Cross';
      default:             return 'Rectangle';
    }
  };

  return (
    <div className="shape-selector">
      <h4>Zone Shape</h4>
      <div className="shape-buttons">
        {SHAPES.map((shape) => {
          const clipPath = getClipPath(shape);
          const shapeIcon = getShapeIcon(shape);
          const customSvg = getCustomSvg(shape);
          const isPolygonShape = clipPath !== 'none' || shape === 'rounded_rect';
          const hasCustomIcon = !!customSvg;

          return (
            <button
              key={shape}
              className={`shape-btn ${selectedShape === shape ? 'active' : ''}`}
              onClick={() => onShapeChange(shape)}
            >
              {hasCustomIcon ? (
                <span className="shape-icon-mdi">{customSvg}</span>
              ) : isPolygonShape ? (
                shapeIcon ? <Icon path={shapeIcon} size={1} className="shape-icon-mdi" /> : null
              ) : (
                <div className="shape-icon" style={{ borderRadius: getShapeStyle(shape) }} />
              )}
              <span>{getShapeName(shape)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
