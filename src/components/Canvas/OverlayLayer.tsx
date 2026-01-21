import { useState, useRef, useEffect, useCallback } from 'react';
import { useCollage } from '../../contexts/CollageContext';
import { OverlayLayer as OverlayLayerType } from '../../types/overlay';
import './OverlayLayer.css';

interface OverlayLayerProps {
  layer: OverlayLayerType;
  isSelected: boolean;
  canvasWidth: number;
  canvasHeight: number;
  zIndex: number;
  interactive?: boolean;
  onSnapGuidesChange?: (guides: { centerH: boolean; centerV: boolean }) => void;
  onSelect?: () => void;
}

export function OverlayLayer({ layer, isSelected, canvasWidth, canvasHeight, zIndex, interactive = true, onSnapGuidesChange, onSelect }: OverlayLayerProps) {
  const { updateOverlay, canvasZoom, setSelectedOverlayId, setSelectedZone, setIsBackgroundSelected, setActiveSidebarTab, showAllOverlays } = useCollage();

  const isDraggingRef = useRef(false);
  const isResizingRef = useRef<string | null>(null);
  const isRotatingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const transformStartRef = useRef(layer.transform);
  const overlayRef = useRef<HTMLDivElement>(null);

  const SNAP_THRESHOLD = 10;

  // Calculate display scale for mouse events
  const [displayScale, setDisplayScale] = useState(1);
  useEffect(() => {
    const canvasEl = document.querySelector('.collage-canvas') as HTMLElement;
    if (canvasEl && canvasWidth) {
      const rect = canvasEl.getBoundingClientRect();
      setDisplayScale(rect.width / canvasWidth);
    }
  }, [canvasWidth, canvasZoom]);

  const handleMouseDown = useCallback((e: React.MouseEvent, action: string, handle?: string) => {
    e.stopPropagation();
    e.preventDefault();

    // Select this overlay and deselect others
    setSelectedOverlayId(layer.id);
    setSelectedZone(null);
    setIsBackgroundSelected(false);
    setActiveSidebarTab('layers');
    onSelect?.();

    if (action === 'drag') {
      isDraggingRef.current = true;
    } else if (action === 'resize') {
      isResizingRef.current = handle || 'se';
    } else if (action === 'rotate') {
      isRotatingRef.current = true;
    }

    dragStartRef.current = { x: e.clientX, y: e.clientY };
    transformStartRef.current = { ...layer.transform };

    const handleMouseMove = (evt: MouseEvent) => {
      const deltaX = (evt.clientX - dragStartRef.current.x) / displayScale;
      const deltaY = (evt.clientY - dragStartRef.current.y) / displayScale;

      if (isDraggingRef.current) {
        // Calculate new position
        let newX = transformStartRef.current.x + deltaX;
        let newY = transformStartRef.current.y + deltaY;

        // Snap to center horizontally (assuming overlay's visual center is at its position + canvas/2)
        const overlayCenterX = newX + canvasWidth / 2;
        const canvasCenterX = canvasWidth / 2;
        const snapToCenterH = Math.abs(overlayCenterX - canvasCenterX) < SNAP_THRESHOLD;
        if (snapToCenterH) {
          newX = 0; // Center overlay horizontally
        }

        // Snap to center vertically
        const overlayCenterY = newY + canvasHeight / 2;
        const canvasCenterY = canvasHeight / 2;
        const snapToCenterV = Math.abs(overlayCenterY - canvasCenterY) < SNAP_THRESHOLD;
        if (snapToCenterV) {
          newY = 0; // Center overlay vertically
        }

        // Update snap guides
        onSnapGuidesChange?.({ centerH: snapToCenterH, centerV: snapToCenterV });

        updateOverlay(layer.id, {
          transform: {
            ...layer.transform,
            x: newX,
            y: newY,
          },
        });
      } else if (isResizingRef.current) {
        // Calculate scale based on drag distance
        const scaleFactor = transformStartRef.current.scale + (deltaX + deltaY) / 200;

        updateOverlay(layer.id, {
          transform: {
            ...layer.transform,
            scale: Math.max(0.1, Math.min(5, scaleFactor)),
          },
        });
      } else if (isRotatingRef.current) {
        // Calculate rotation angle based on mouse movement
        const angleDelta = (deltaX + deltaY) * 0.5;
        updateOverlay(layer.id, {
          transform: {
            ...layer.transform,
            rotation: transformStartRef.current.rotation + angleDelta,
          },
        });
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      isResizingRef.current = null;
      isRotatingRef.current = false;
      onSnapGuidesChange?.({ centerH: false, centerV: false });
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [layer, displayScale, canvasWidth, canvasHeight, updateOverlay, setSelectedOverlayId, setSelectedZone, setIsBackgroundSelected, setActiveSidebarTab, onSelect, onSnapGuidesChange]);

  // Generate transform CSS
  const transformStyle = `
    translate(${layer.transform.x}px, ${layer.transform.y}px)
    rotate(${layer.transform.rotation}deg)
    scale(${layer.transform.scale})
    scaleX(${layer.transform.flipHorizontal ? -1 : 1})
    scaleY(${layer.transform.flipVertical ? -1 : 1})
  `;

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: 'center center',
    transform: transformStyle,
    opacity: layer.transform.opacity,
    mixBlendMode: layer.blendMode as any,
    pointerEvents: interactive ? 'auto' : 'none',
    zIndex: zIndex,
    display: (layer.visible && showAllOverlays) ? 'block' : 'none',
    willChange: 'transform',
  };

  return (
    <div
      ref={overlayRef}
      className={`overlay-layer ${isSelected ? 'selected' : ''} ${!interactive ? 'non-interactive' : ''}`}
      style={overlayStyle}
      onMouseDown={interactive ? (e) => handleMouseDown(e, 'drag') : undefined}
    >
      <img
        src={layer.sourcePath}
        alt={layer.name}
        draggable={false}
        style={{
          display: 'block',
          maxWidth: 'none',
          pointerEvents: 'none',
        }}
      />

      {/* Transform handles when selected */}
      {isSelected && (
        <>
          {/* Selection border */}
          <div className="overlay-selection-border" />

          {/* Resize handles */}
          <div
            className="resize-handle nw"
            onMouseDown={(e) => handleMouseDown(e, 'resize', 'nw')}
          />
          <div
            className="resize-handle ne"
            onMouseDown={(e) => handleMouseDown(e, 'resize', 'ne')}
          />
          <div
            className="resize-handle sw"
            onMouseDown={(e) => handleMouseDown(e, 'resize', 'sw')}
          />
          <div
            className="resize-handle se"
            onMouseDown={(e) => handleMouseDown(e, 'resize', 'se')}
          />

          {/* Rotation handle */}
          <div
            className="rotation-handle"
            onMouseDown={(e) => handleMouseDown(e, 'rotate')}
          />
        </>
      )}
    </div>
  );
}
