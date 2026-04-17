import { useRef, useState, useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { DisplayElement } from '../../types/displayLayout';
import { SnapGuides, EMPTY_SNAP_GUIDES, calculateOverlayDragSnap } from '../../utils/canvas/snapUtils';

const SNAP_THRESHOLD = 8;

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
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [isRotating, setIsRotating] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const transformStartRef = useRef(element.transform);
  const shapeStartRef = useRef({ width: element.shapeWidth ?? 200, height: element.shapeHeight ?? 200 });
  const overlayRef = useRef<HTMLDivElement>(null);
  const displayScaleRef = useRef(1);

  useEffect(() => {
    displayScaleRef.current = canvasScale;
  }, [canvasScale]);

  const handleMouseDown = useCallback((e: React.MouseEvent, action: string, handle?: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (!isSelected) onSelect();

    dragStartRef.current = { x: e.clientX, y: e.clientY };
    transformStartRef.current = { ...element.transform };
    shapeStartRef.current = { width: element.shapeWidth ?? 200, height: element.shapeHeight ?? 200 };

    if (action === 'drag') setIsDragging(true);
    else if (action === 'resize') setIsResizing(handle || 'se');
    else if (action === 'rotate') setIsRotating(true);
  }, [element.transform, element.shapeWidth, element.shapeHeight, isSelected, onSelect]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging && !isResizing && !isRotating) return;
      const ds = displayScaleRef.current;
      const deltaX = (e.clientX - dragStartRef.current.x) / ds;
      const deltaY = (e.clientY - dragStartRef.current.y) / ds;

      if (isDragging) {
        const rawX = transformStartRef.current.x + deltaX;
        const rawY = transformStartRef.current.y + deltaY;
        const el = overlayRef.current;
        const w = el ? el.offsetWidth : 0;
        const h = el ? el.offsetHeight : 0;
        const result = calculateOverlayDragSnap(rawX, rawY, w, h, canvasWidth, canvasHeight, SNAP_THRESHOLD / ds);
        onSnapGuidesChange?.(result.guides);
        onUpdate({ transform: { ...element.transform, x: result.finalX, y: result.finalY } });
      } else if (isResizing) {
        onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);
        const t0 = transformStartRef.current;
        const rad = (t0.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const fh = t0.flipHorizontal ? -1 : 1;
        const fv = t0.flipVertical ? -1 : 1;

        // Visual corners to relative local space (-0.5 to 0.5)
        const rels: Record<string, { x: number, y: number }> = {
          nw: { x: -0.5, y: -0.5 }, ne: { x: 0.5, y: -0.5 },
          sw: { x: -0.5, y: 0.5 }, se: { x: 0.5, y: 0.5 }
        };
        const hr = rels[isResizing];
        const ar = { x: -hr.x, y: -hr.y }; // Anchor is opposite corner

        // 1. Initial dimensions
        let W0 = 0, H0 = 0;
        if (element.role === 'shape') {
          W0 = shapeStartRef.current.width;
          H0 = shapeStartRef.current.height;
        } else {
          const el = overlayRef.current;
          W0 = el ? el.offsetWidth : 100;
          H0 = el ? el.offsetHeight : 100;
        }

        // 2. Identify fixed anchor point in World (Canvas) space
        const getPointWorld = (cx: number, cy: number, s: number, lx: number, ly: number) => {
          const rx = lx * fh;
          const ry = ly * fv;
          return {
            x: cx + (rx * cos - ry * sin) * s,
            y: cy + (rx * sin + ry * cos) * s
          };
        };

        const c0 = { x: t0.x + W0 / 2, y: t0.y + H0 / 2 };
        const pAnchor = getPointWorld(c0.x, c0.y, t0.scale, W0 * ar.x, H0 * ar.y);

        // 3. Project mouse delta into Local space
        const worldDX = deltaX / t0.scale;
        const worldDY = deltaY / t0.scale;
        const localDX = (worldDX * cos + worldDY * sin) * fh;
        const localDY = (-worldDX * sin + worldDY * cos) * fv;

        if (element.role === 'shape') {
          // Resize dimensions independently
          const newW = Math.max(10, W0 + localDX * (hr.x > 0 ? 1 : -1));
          const newH = Math.max(10, H0 + localDY * (hr.y > 0 ? 1 : -1));

          // Solve for new center so anchor point doesn't move
          const anchorLocalX = newW * ar.x * fh;
          const anchorLocalY = newH * ar.y * fv;
          const newCX = pAnchor.x - (anchorLocalX * cos - anchorLocalY * sin) * t0.scale;
          const newCY = pAnchor.y - (anchorLocalX * sin + anchorLocalY * cos) * t0.scale;

          onUpdate({
            shapeWidth: Math.round(newW),
            shapeHeight: Math.round(newH),
            transform: { ...t0, x: newCX - newW / 2, y: newCY - newH / 2 }
          });
        } else {
          // Uniform scale
          const vDiagRel = { x: W0 * (hr.x - ar.x), y: H0 * (hr.y - ar.y) };
          const vDiagWorld = {
            x: (vDiagRel.x * fh * cos - vDiagRel.y * fv * sin),
            y: (vDiagRel.x * fh * sin + vDiagRel.y * fv * cos)
          };
          const diagLenSq = vDiagWorld.x * vDiagWorld.x + vDiagWorld.y * vDiagWorld.y;
          const projection = (deltaX * vDiagWorld.x + deltaY * vDiagWorld.y) / diagLenSq;
          const newScale = Math.max(0.1, Math.min(10, t0.scale + projection));

          const anchorLocalX = W0 * ar.x * fh;
          const anchorLocalY = H0 * ar.y * fv;
          const newCX = pAnchor.x - (anchorLocalX * cos - anchorLocalY * sin) * newScale;
          const newCY = pAnchor.y - (anchorLocalX * sin + anchorLocalY * cos) * newScale;

          onUpdate({
            transform: { ...t0, scale: newScale, x: newCX - W0 / 2, y: newCY - H0 / 2 }
          });
        }
      } else if (isRotating) {
        onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);
        const angleDelta = (deltaX + deltaY) * 0.5;
        onUpdate({ transform: { ...element.transform, rotation: transformStartRef.current.rotation + angleDelta } });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(null);
      setIsRotating(false);
      onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    if (isDragging || isResizing || isRotating) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, isRotating, element.transform, element.role, onUpdate, onSnapGuidesChange]);

  // Keyboard nudge logic
  useEffect(() => {
    if (!isSelected) return;

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
      const t = element.transform;
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
  }, [isSelected, element.transform, onUpdate]);

  const t = element.transform;
  const invScale = 1 / (canvasScale * t.scale);

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
    outline: isSelected ? `${2 * invScale}px solid var(--accent-blue, #3b82f6)` : 'none',
    outlineOffset: -invScale,
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
        // Properly format font family - wrap in quotes if it contains spaces and is not a CSS variable
        const formatFontFamily = (font: string | undefined) => {
          if (!font) return 'inherit';
          if (font.startsWith('var(')) return font;
          // If font name contains spaces, wrap in quotes and add fallbacks
          const quotedFont = font.includes(' ') ? `"${font}"` : font;
          // Add fallback chain: selected font → system sans → sans-serif
          return `${quotedFont}, var(--font-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif`;
        };
        return <div style={{ fontSize: element.fontSize || 24, color: element.fontColor || '#ffffff', fontWeight: element.fontWeight || '400', fontFamily: formatFontFamily(element.fontFamily), whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none' }}>{element.textContent || 'Text'}</div>;
      }

      case 'emoji':
        return <div style={{ fontSize: element.fontSize || 80, pointerEvents: 'none', userSelect: 'none', lineHeight: 1 }}>{element.textContent || '😊'}</div>;
      case 'logo':
      case 'gif':
        if (!element.sourcePath) return <div style={{ width: 200, height: 200, background: 'rgba(255,255,255,0.05)', border: '2px dashed rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 14, pointerEvents: 'none' }}>{element.role === 'gif' ? 'GIF' : 'Logo'}</div>;
        return <img src={element.sourcePath.startsWith('asset://') ? convertFileSrc(element.sourcePath.replace('asset://', '')) : element.sourcePath} alt={element.role} draggable={false} style={{ display: 'block', maxWidth: 'none', pointerEvents: 'none' }} />;
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
    <div ref={overlayRef} className={`overlay-layer ${isSelected ? 'selected' : ''}`} style={style} onMouseDown={(e) => handleMouseDown(e, 'drag')} onClick={(e) => { e.stopPropagation(); e.preventDefault(); onSelect(); }}>
      {renderContent()}
      {isSelected && (
        <>
          <div className="resize-handle nw" style={{ transform: `scale(${invScale})`, top: -5 * invScale, left: -5 * invScale }} onMouseDown={(e) => handleMouseDown(e, 'resize', 'nw')} />
          <div className="resize-handle ne" style={{ transform: `scale(${invScale})`, top: -5 * invScale, right: -5 * invScale }} onMouseDown={(e) => handleMouseDown(e, 'resize', 'ne')} />
          <div className="resize-handle sw" style={{ transform: `scale(${invScale})`, bottom: -5 * invScale, left: -5 * invScale }} onMouseDown={(e) => handleMouseDown(e, 'resize', 'sw')} />
          <div className="resize-handle se" style={{ transform: `scale(${invScale})`, bottom: -5 * invScale, right: -5 * invScale }} onMouseDown={(e) => handleMouseDown(e, 'resize', 'se')} />
          <div className="rotation-handle" style={{ top: -30 * invScale, transform: `translateX(-50%) scale(${invScale})`, transformOrigin: 'center center' }} onMouseDown={(e) => handleMouseDown(e, 'rotate')} />
        </>
      )}
    </div>
  );
}
