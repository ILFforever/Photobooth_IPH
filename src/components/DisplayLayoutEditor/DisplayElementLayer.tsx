import { useRef, useState, useEffect, useCallback } from 'react';
import Moveable from 'react-moveable';
import { convertFileSrc } from '@tauri-apps/api/core';
import { DisplayElement, FrameShape } from '../../types/displayLayout';
import { SnapGuides, EMPTY_SNAP_GUIDES, calculateOverlayDragSnap } from '../../utils/canvas/snapUtils';

const SNAP_THRESHOLD = 4;

function getFrameBorderRadius(shape: FrameShape, borderRadius?: number): string {
  switch (shape) {
    case 'circle':
    case 'ellipse':
      return '50%';
    case 'rounded_rect':
      return `${borderRadius || 12}px`;
    case 'pill':
      return '999px';
    default:
      return '2px';
  }
}

function getFrameClipPath(shape: FrameShape): string | undefined {
  switch (shape) {
    case 'triangle':
      return 'polygon(50% 0%, 0% 100%, 100% 100%)';
    case 'pentagon':
      return 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)';
    case 'hexagon':
      return 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
    case 'octagon':
      return 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)';
    case 'star':
      return 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
    case 'diamond':
      return 'polygon(50% 0%, 78% 50%, 50% 100%, 22% 50%)';
    case 'heart':
      return 'polygon(50% 95%, 65% 75%, 78% 60%, 90% 48%, 97% 35%, 98% 22%, 96% 14%, 93% 8%, 87% 3%, 80% 1%, 76% 1%, 73% 2%, 71% 3%, 69% 4%, 68% 5%, 66% 6%, 64% 7%, 62% 9%, 61% 10%, 59% 12%, 57% 13%, 56% 15%, 53% 17%, 50% 18%, 47% 17%, 44% 15%, 43% 13%, 41% 12%, 39% 10%, 38% 9%, 36% 7%, 34% 6%, 32% 5%, 31% 4%, 29% 3%, 27% 2%, 24% 1%, 20% 1%, 13% 3%, 7% 8%, 4% 14%, 2% 22%, 3% 35%, 10% 48%, 22% 60%, 35% 75%)';
    case 'cross':
      return 'polygon(20% 0%, 80% 0%, 80% 20%, 100% 20%, 100% 80%, 80% 80%, 80% 100%, 20% 100%, 20% 80%, 0% 80%, 0% 20%, 20% 20%)';
    default:
      return undefined;
  }
}

interface DisplayElementLayerProps {
  element: DisplayElement;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<DisplayElement>) => void;
  canvasScale: number;
  canvasWidth?: number;
  canvasHeight?: number;
  onSnapGuidesChange?: (guides: SnapGuides) => void;
}

// Get base dimensions for an element (before scale is applied)
function getElementBaseWidth(element: DisplayElement): number {
  switch (element.role) {
    case 'collage':
      return element.collageWidth ?? 480;
    case 'qr':
      return 300;
    case 'shape':
      return element.shapeWidth ?? 200;
    case 'logo':
    case 'gif':
      return 200;
    case 'text':
      return 100;
    case 'emoji':
      return 100;
    default:
      return 100;
  }
}

function getElementBaseHeight(element: DisplayElement): number {
  switch (element.role) {
    case 'collage':
      return element.collageHeight ?? 540;
    case 'qr':
      return 300;
    case 'shape':
      return element.shapeHeight ?? 200;
    case 'logo':
    case 'gif':
      return 200;
    case 'text':
      return (element.fontSize || 24) * 1.2;
    case 'emoji':
      return element.fontSize || 80;
    default:
      return 100;
  }
}

export function DisplayElementLayer({
  element,
  isSelected,
  onSelect,
  onUpdate,
  canvasScale,
  canvasWidth = 1920,
  canvasHeight = 1080,
  onSnapGuidesChange,
}: DisplayElementLayerProps) {
  const [isEditingText, setIsEditingText] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const moveableRef = useRef<any>(null);

  const t = element.transform;
  const baseWidth = getElementBaseWidth(element);
  const baseHeight = getElementBaseHeight(element);

  const currentWidth = baseWidth * t.scale;
  const currentHeight = baseHeight * t.scale;

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (element.role === 'text' || element.role === 'emoji') {
      e.stopPropagation();
      setIsEditingText(true);
    }
  }, [element.role]);

  const handleTextEditBlur = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setIsEditingText(false);
    if (newText !== element.textContent) {
      onUpdate({ textContent: newText });
    }
  }, [element.textContent, onUpdate]);

  const handleTextEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.currentTarget.value = element.textContent || '';
      e.currentTarget.blur();
    }
  }, [element.textContent]);

  const handleDrag = useCallback((e: any) => {
    // beforeTranslate is the absolute CSS translate in parent (canvas) space.
    // Using absolute avoids stale-closure accumulation errors from batched React renders.
    const [rawX, rawY] = e.beforeTranslate;
    const el = overlayRef.current;
    const w = el ? el.offsetWidth : 0;
    const h = el ? el.offsetHeight : 0;
    const result = calculateOverlayDragSnap(rawX, rawY, w, h, canvasWidth, canvasHeight, SNAP_THRESHOLD / canvasScale);
    onSnapGuidesChange?.(result.guides);
    onUpdate({ transform: { ...t, x: result.finalX, y: result.finalY } });
  }, [t, onUpdate, onSnapGuidesChange, canvasScale, canvasWidth, canvasHeight]);

  const handleDragEnd = useCallback(() => {
    onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);
  }, [onSnapGuidesChange]);

  const handleResize = useCallback((e: any) => {
    onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);

    const newWidth = Math.max(10, e.width);
    const newHeight = Math.max(10, e.height);

    if (element.role === 'shape') {
      // e.drag.beforeTranslate is the absolute new canvas-space position after the resize,
      // keeping the pinned handle stationary.
      const [newX, newY] = e.drag.beforeTranslate;
      onUpdate({
        shapeWidth: newWidth,
        shapeHeight: newHeight,
        transform: { ...t, scale: 1, x: newX, y: newY },
      });
    }
  }, [element.role, t, onUpdate, onSnapGuidesChange]);

  const handleScale = useCallback((e: any) => {
    onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);

    // e.scale[0] is the absolute new CSS scale Moveable computed (includes initial scale).
    // e.drag.beforeTranslate is the absolute new position that pins the opposite corner.
    const newScale = Math.max(0.1, Math.min(10, e.scale[0]));
    const [newX, newY] = e.drag.beforeTranslate;
    onUpdate({
      transform: { ...t, scale: newScale, x: newX, y: newY },
    });
  }, [t, onUpdate, onSnapGuidesChange]);

  const handleScaleStart = useCallback(() => {
    onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);
  }, [onSnapGuidesChange]);

  const handleScaleEnd = useCallback(() => {
    onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);
  }, [onSnapGuidesChange]);

  const handleRotate = useCallback((e: any) => {
    onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);
    // e.rotate is the absolute rotation; e.drag.beforeTranslate is the absolute position
    // adjusted for the pivot offset during rotation.
    const [newX, newY] = e.drag.beforeTranslate;
    onUpdate({ transform: { ...t, rotation: e.rotate, x: newX, y: newY } });
  }, [t, onUpdate, onSnapGuidesChange]);

  const handleRotateEnd = useCallback(() => {
    onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);
  }, [onSnapGuidesChange]);

  // Keep Moveable control box in sync when transform changes outside of Moveable
  // (keyboard nudge, undo, context updates, etc.)
  useEffect(() => {
    if (isSelected && moveableRef.current) {
      moveableRef.current.updateRect();
    }
  }, [element.transform, isSelected]);

  // Keyboard nudge logic
  useEffect(() => {
    if (!isSelected || isEditingText) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't nudge if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true') {
        return;
      }

      const isArrowKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
      if (!isArrowKey) return;

      e.preventDefault();
      const nudgeAmount = e.shiftKey ? 10 : 1;
      let newX = t.x;
      let newY = t.y;

      switch (e.key) {
        case 'ArrowUp':    newY -= nudgeAmount; break;
        case 'ArrowDown':  newY += nudgeAmount; break;
        case 'ArrowLeft':  newX -= nudgeAmount; break;
        case 'ArrowRight': newX += nudgeAmount; break;
      }

      onUpdate({
        transform: { ...t, x: newX, y: newY }
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelected, isEditingText, t, onUpdate]);

  // QR codes should never be flipped or use blend modes to ensure they are always scanable
  const isQR = element.role === 'qr';
  const flipH = isQR ? false : t.flipHorizontal;
  const flipV = isQR ? false : t.flipVertical;
  const blendMode = isQR ? 'normal' : element.blendMode;

  const transformStyle = `translate(${t.x}px, ${t.y}px) rotate(${t.rotation}deg) scale(${t.scale}) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: 'center center',
    transform: transformStyle,
    opacity: t.opacity,
    mixBlendMode: blendMode as any,
    pointerEvents: 'auto',
    zIndex: element.layerOrder,
    display: element.visible ? 'block' : 'none',
    willChange: 'transform',
  };


  const renderContent = () => {
    switch (element.role) {
      case 'collage': {
        const cw = element.collageWidth ?? 480;
        const ch = element.collageHeight ?? 540;
        return (
          <div style={{ width: cw, height: ch, background: 'rgba(59,130,246,0.15)', border: '2px dashed rgba(59,130,246,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'rgba(59,130,246,0.7)', fontSize: 14, pointerEvents: 'none', gap: 6 }}>
            <span style={{ fontSize: 18 }}>Collage</span>
            <span style={{ fontSize: 11, opacity: 0.7, fontFamily: 'var(--font-mono, monospace)' }}>{cw}×{ch}</span>
          </div>
        );
      }
      case 'qr':
        return <div style={{ width: 300, height: 300, background: 'rgba(255,255,255,0.1)', border: '2px dashed rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 18, pointerEvents: 'none' }}>QR Code</div>;
      case 'text': {
        const formatFontFamily = (font: string | undefined) => {
          if (!font) return 'inherit';
          if (font.startsWith('var(')) return font;
          const quotedFont = font.includes(' ') ? `"${font}"` : font;
          return `${quotedFont}, var(--font-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif`;
        };
        if (isEditingText) {
          return (
            <textarea
              autoFocus
              defaultValue={element.textContent || ''}
              onBlur={handleTextEditBlur}
              onKeyDown={handleTextEditKeyDown}
              style={{
                fontSize: element.fontSize || 24,
                color: element.fontColor || '#ffffff',
                fontWeight: element.fontWeight || '400',
                fontFamily: formatFontFamily(element.fontFamily),
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: '2px solid var(--accent-blue, #3b82f6)',
                padding: '4px 8px',
                outline: 'none',
                resize: 'none',
                overflow: 'hidden',
                whiteSpace: 'pre',
                pointerEvents: 'auto',
                userSelect: 'auto',
              }}
            />
          );
        }
        return <div style={{ fontSize: element.fontSize || 24, color: element.fontColor || '#ffffff', fontWeight: element.fontWeight || '400', fontFamily: formatFontFamily(element.fontFamily), whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none' }}>{element.textContent || 'Text'}</div>;
      }

      case 'emoji':
        if (isEditingText) {
          return (
            <textarea
              autoFocus
              defaultValue={element.textContent || '😊'}
              onBlur={handleTextEditBlur}
              onKeyDown={handleTextEditKeyDown}
              style={{
                fontSize: element.fontSize || 80,
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: '2px solid var(--accent-blue, #3b82f6)',
                padding: '4px 8px',
                outline: 'none',
                resize: 'none',
                overflow: 'hidden',
                whiteSpace: 'pre',
                pointerEvents: 'auto',
                userSelect: 'auto',
                lineHeight: 1,
                minWidth: '100px',
              }}
            />
          );
        }
        return <div style={{ fontSize: element.fontSize || 80, pointerEvents: 'none', userSelect: 'none', lineHeight: 1 }}>{element.textContent || '😊'}</div>;
      case 'logo':
      case 'gif':
        if (!element.sourcePath) return <div style={{ width: 200, height: 200, background: 'rgba(255,255,255,0.05)', border: '2px dashed rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 14, pointerEvents: 'none' }}>{element.role === 'gif' ? 'GIF' : 'Logo'}</div>;

        const imgElement = <img src={element.sourcePath.startsWith('asset://') ? convertFileSrc(element.sourcePath.replace('asset://', '')) : element.sourcePath} alt={element.role} draggable={false} style={{ display: 'block', maxWidth: 'none', pointerEvents: 'none' }} />;

        const frameShape = element.frameShape || 'none';
        const hasFrame = frameShape !== 'none';

        if (!hasFrame) return imgElement;

        const frameWidth = element.frameWidth || 8;
        const frameColor = element.frameColor || '#ffffff';
        const frameRadius = getFrameBorderRadius(frameShape, element.frameBorderRadius);
        const frameClipPath = getFrameClipPath(frameShape);

        return (
          <div style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{
              position: 'absolute',
              inset: 0,
              border: `${frameWidth}px solid ${frameColor}`,
              borderRadius: frameRadius,
              clipPath: frameClipPath,
              pointerEvents: 'none',
            }} />
            <div style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              overflow: 'hidden',
              borderRadius: frameRadius,
              clipPath: frameClipPath,
            }}>
              {imgElement}
            </div>
          </div>
        );
      case 'shape': {
        const w = element.shapeWidth ?? 200, h = element.shapeHeight ?? 200;
        if (element.shapeType === 'heart') {
          const sw = element.shapeBorderWidth ?? 0;
          return (
            <svg width={w} height={h} viewBox="0 0 100 100" style={{ display: 'block', pointerEvents: 'none' }}>
              <path
                d="M50 80 C20 62, 2 48, 2 30 A24 24 0 0 1 50 22 A24 24 0 0 1 98 30 C98 48, 80 62, 50 80 Z"
                fill={element.shapeFill ?? '#e11d48'}
                stroke={sw > 0 ? (element.shapeBorderColor ?? 'transparent') : 'none'}
                strokeWidth={sw}
              />
            </svg>
          );
        }
        const clipPaths: Record<string, string> = { triangle: 'polygon(50% 0%, 0% 100%, 100% 100%)', diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', star: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)', hexagon: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)', pentagon: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)', cross: 'polygon(20% 0%, 80% 0%, 80% 20%, 100% 20%, 100% 80%, 80% 80%, 80% 100%, 20% 100%, 20% 80%, 0% 80%, 0% 20%, 20% 20%)' };
        return <div style={{ width: w, height: h, background: element.shapeFill ?? '#3b82f6', border: (element.shapeBorderWidth ?? 0) > 0 ? `${element.shapeBorderWidth}px solid ${element.shapeBorderColor ?? 'transparent'}` : 'none', borderRadius: element.shapeType === 'circle' ? '50%' : element.shapeType === 'rounded-rectangle' ? `${element.shapeBorderRadius ?? 24}px` : '0px', clipPath: element.shapeType ? clipPaths[element.shapeType] : undefined, pointerEvents: 'none', boxSizing: 'border-box' }} />;
      }
      default: return null;
    }
  };

  return (
    <>
      <div
        ref={overlayRef}
        className={`overlay-layer ${isSelected ? 'selected' : ''}`}
        style={style}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onSelect(); }}
        onDoubleClick={handleDoubleClick}
      >
        {renderContent()}
      </div>

      {isSelected && overlayRef.current && (
        <Moveable
          ref={moveableRef}
          target={overlayRef.current}
          draggable={true}
          resizable={element.role === 'shape'}
          scalable={element.role !== 'shape'}
          rotatable={true}
          keepRatio={element.role !== 'shape'}
          snappable={false}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          onResize={handleResize}
          onScale={handleScale}
          onScaleStart={handleScaleStart}
          onScaleEnd={handleScaleEnd}
          onRotate={handleRotate}
          onRotateEnd={handleRotateEnd}
          renderDirections={['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w']}
          edge={true}
          zoom={canvasScale}
          origin={false}
          padding={{ left: 0, top: 0, right: 0, bottom: 0 }}
          className="display-element-moveable"
        />
      )}
    </>
  );
}
