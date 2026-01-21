import { useRef, useMemo, useState, useCallback, useEffect } from "react";
import { useDrop } from "react-dnd";
import { motion } from "framer-motion";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useCollage } from "../../contexts/CollageContext";
import { Frame, FrameZone, FrameShape } from "../../types/frame";
import { PlacedImage } from "../../types/collage";
import { DEFAULT_TRANSFORM } from "../../types/collage";
import { Background } from "../../types/background";
import FloatingFrameSelector from "./FloatingFrameSelector";
import { OverlayLayer as OverlayLayerComponent } from "./OverlayLayer";

interface EditableZoneProps {
  zone: FrameZone;
  zIndex: number;
  frameWidth: number;
  frameHeight: number;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<FrameZone>) => void;
}

function EditableZone({ zone, zIndex, frameWidth, frameHeight, isSelected, onSelect, onUpdate }: EditableZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [zoneStart, setZoneStart] = useState({ x: zone.x, y: zone.y, width: zone.width, height: zone.height });
  const canvasSize = { width: frameWidth, height: frameHeight };
  const { canvasZoom } = useCollage();

  // Calculate the actual display scale factor by comparing canvas element size to internal size
  const [displayScale, setDisplayScale] = useState(1);

  useEffect(() => {
    const canvas = document.querySelector('.collage-canvas') as HTMLElement;
    if (canvas && frameWidth) {
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / frameWidth;
      setDisplayScale(scale);
    }
  }, [frameWidth, canvasZoom]);

  // Generate consistent color based on zone ID
  const getZoneColor = (id: string) => {
    const colors = [
      'rgba(239, 68, 68, 0.3)',   // red
      'rgba(249, 115, 22, 0.3)',  // orange
      'rgba(234, 179, 8, 0.3)',   // yellow
      'rgba(132, 204, 22, 0.3)',  // green
      'rgba(6, 182, 212, 0.3)',   // cyan
      'rgba(59, 130, 246, 0.3)',  // blue
      'rgba(139, 92, 246, 0.3)',  // purple
      'rgba(236, 72, 153, 0.3)',  // pink
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const getBorderRadius = () => {
    switch (zone.shape) {
      case 'circle': return '50%';
      case 'ellipse': return '50% / 40%';
      case 'rounded_rect': return `${zone.borderRadius || 12}px`;
      case 'pill': return '999px';
      default: return '2px';
    }
  };

  const getClipPath = () => {
    switch (zone.shape) {
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
        return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
      case 'heart':
        return 'polygon(50% 15%, 65% 0%, 85% 0%, 100% 15%, 100% 35%, 85% 50%, 50% 100%, 15% 50%, 0% 35%, 0% 15%, 15% 0%, 35% 0%)';
      case 'cross':
        return 'polygon(20% 0%, 80% 0%, 80% 20%, 100% 20%, 100% 80%, 80% 80%, 80% 100%, 20% 100%, 20% 80%, 0% 80%, 0% 20%, 20% 20%)';
      default:
        return undefined;
    }
  };

  // Extract zone number from ID (e.g., "zone-1" -> "Zone 1")
  const getZoneLabel = () => {
    const match = zone.id.match(/zone-(\d+)/);
    if (match) {
      return `Zone ${match[1]}`;
    }
    return zone.id;
  };

  // Use a minimum border width in screen pixels (1.5px on screen for subtler look)
  // Clamp to reasonable range for both large and small frames
  const minBorderWidth = 1.5;
  const borderWidthPx = Math.min(Math.max(minBorderWidth / displayScale, 0.5), 2);

  const isLocked = zone.locked || false;

  const clipPath = getClipPath();
  const zoneStyle = {
    position: 'absolute' as const,
    left: `${zone.x}px`,
    top: `${zone.y}px`,
    width: `${zone.width}px`,
    height: `${zone.height}px`,
    border: isSelected ? `${borderWidthPx}px solid var(--accent-blue)` : `${borderWidthPx}px dashed ${isLocked ? 'rgba(255, 100, 100, 0.4)' : 'rgba(0, 0, 0, 0.3)'}`,
    borderRadius: getBorderRadius(),
    clipPath: clipPath,
    cursor: isLocked ? 'not-allowed' : 'move',
    backgroundColor: getZoneColor(zone.id),
    pointerEvents: 'auto' as const,
    display: 'flex',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: zIndex as number,
  };

  const handleMouseDown = (e: React.MouseEvent, action?: string) => {
    // Prevent all interaction if locked
    if (isLocked) {
      e.stopPropagation();
      return;
    }

    e.stopPropagation();
    e.preventDefault();

    if (action === 'resize-nw' || action === 'resize-ne' || action === 'resize-sw' || action === 'resize-se' ||
        action === 'resize-n' || action === 'resize-s' || action === 'resize-e' || action === 'resize-w') {
      setIsResizing(action);
    } else {
      setIsDragging(true);
      onSelect(); // Only select when dragging the zone itself, not when resizing
    }

    setDragStart({ x: e.clientX, y: e.clientY });
    setZoneStart({ x: zone.x, y: zone.y, width: zone.width, height: zone.height });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging && !isResizing) return;

      const canvas = document.querySelector('.collage-canvas') as HTMLElement;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvasSize.width / rect.width;
      const scaleY = canvasSize.height / rect.height;

      const deltaX = (e.clientX - dragStart.x) * scaleX;
      const deltaY = (e.clientY - dragStart.y) * scaleY;

      if (isDragging) {
        // No boundary constraints - allow zones to move freely
        const newX = zoneStart.x + deltaX;
        const newY = zoneStart.y + deltaY;
        onUpdate({ x: Math.round(newX), y: Math.round(newY) });
      } else if (isResizing) {
        let updates: Partial<FrameZone> = {};
        const minSize = 50;

        // Use exact match for each resize direction - removed boundary constraints
        switch (isResizing) {
          case 'resize-e':
            updates.width = Math.max(minSize, zoneStart.width + deltaX);
            break;
          case 'resize-s':
            updates.height = Math.max(minSize, zoneStart.height + deltaY);
            break;
          case 'resize-w':
            const newWidthW = Math.max(minSize, zoneStart.width - deltaX);
            const newXW = zoneStart.x + zoneStart.width - newWidthW;
            updates.width = Math.round(newWidthW);
            updates.x = Math.round(newXW);
            break;
          case 'resize-n':
            const newHeightN = Math.max(minSize, zoneStart.height - deltaY);
            const newYN = zoneStart.y + zoneStart.height - newHeightN;
            updates.height = Math.round(newHeightN);
            updates.y = Math.round(newYN);
            break;
          case 'resize-ne':
            updates.width = Math.max(minSize, zoneStart.width + deltaX);
            const newHeightNE = Math.max(minSize, zoneStart.height - deltaY);
            const newYNE = zoneStart.y + zoneStart.height - newHeightNE;
            updates.height = Math.round(newHeightNE);
            updates.y = Math.round(newYNE);
            break;
          case 'resize-nw':
            const newWidthNW = Math.max(minSize, zoneStart.width - deltaX);
            const newXMW = zoneStart.x + zoneStart.width - newWidthNW;
            const newHeightNW = Math.max(minSize, zoneStart.height - deltaY);
            const newYNW = zoneStart.y + zoneStart.height - newHeightNW;
            updates.width = Math.round(newWidthNW);
            updates.x = Math.round(newXMW);
            updates.height = Math.round(newHeightNW);
            updates.y = Math.round(newYNW);
            break;
          case 'resize-se':
            updates.width = Math.max(minSize, zoneStart.width + deltaX);
            updates.height = Math.max(minSize, zoneStart.height + deltaY);
            break;
          case 'resize-sw':
            const newWidthSW = Math.max(minSize, zoneStart.width - deltaX);
            const newXSW = zoneStart.x + zoneStart.width - newWidthSW;
            updates.width = Math.round(newWidthSW);
            updates.x = Math.round(newXSW);
            updates.height = Math.max(minSize, zoneStart.height + deltaY);
            break;
        }

        if (Object.keys(updates).length > 0) {
          onUpdate(updates);
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(null);
    };

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragStart, zoneStart, zone, canvasSize]);

  // Use fixed screen-space sizes for handles (e.g., 12px on screen, regardless of canvas zoom)
  // Clamp to reasonable range for both large and small frames
  const cornerHandleSize = Math.min(12 / displayScale, 12);
  const edgeHandleLength = Math.min(24 / displayScale, 24);
  const handleBorderWidth = Math.min(2 / displayScale, 2);
  const handleOffset = Math.min(6 / displayScale, 6); // Half of handle size for centering

  const handleStyle = {
    position: 'absolute' as const,
    width: `${cornerHandleSize}px`,
    height: `${cornerHandleSize}px`,
    backgroundColor: 'var(--accent-blue)',
    border: `${handleBorderWidth}px solid white`,
    borderRadius: '2px',
    zIndex: 1000,
  };

  const edgeHandleStyle = {
    position: 'absolute' as const,
    width: `${edgeHandleLength}px`,
    height: `${cornerHandleSize}px`,
    backgroundColor: 'var(--accent-blue)',
    border: `${handleBorderWidth}px solid white`,
    borderRadius: '2px',
    zIndex: 1000,
  };

  const inverseScale = 1 / displayScale;

  return (
    <div
      style={zoneStyle}
      onMouseDown={(e) => handleMouseDown(e)}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!isLocked) onSelect();
      }}
    >
      {/* Zone label in center - counter-scaled to maintain readable size */}
      <span style={{
        color: 'white',
        fontWeight: '600',
        fontSize: `${Math.min(32 / displayScale, 48)}px`, // Clamp max size for small frames
        textShadow: '0 1px 3px rgba(0,0,0,0.5)',
        pointerEvents: 'none',
        textAlign: 'center',
        whiteSpace: 'nowrap',
      }}>
        {getZoneLabel()}
      </span>

      {/* Lock indicator overlay when locked */}
      {isLocked && (
        <div style={{
          position: 'absolute',
          top: '4px',
          right: '4px',
          fontSize: `${Math.min(14 / displayScale, 16)}px`,
          fontWeight: '600',
          color: 'rgba(255, 100, 100, 0.9)',
          textShadow: '0 1px 2px rgba(0,0,0,0.5)',
          opacity: 0.8,
          pointerEvents: 'none',
        }}>
          LOCKED
        </div>
      )}

      {isSelected && !isLocked && (
        <>
          {/* Corner handles */}
          <div style={{ ...handleStyle, top: `${-handleOffset}px`, left: `${-handleOffset}px`, cursor: 'nw-resize' }}
               onMouseDown={(e) => handleMouseDown(e, 'resize-nw')} />
          <div style={{ ...handleStyle, top: `${-handleOffset}px`, right: `${-handleOffset}px`, cursor: 'ne-resize' }}
               onMouseDown={(e) => handleMouseDown(e, 'resize-ne')} />
          <div style={{ ...handleStyle, bottom: `${-handleOffset}px`, left: `${-handleOffset}px`, cursor: 'sw-resize' }}
               onMouseDown={(e) => handleMouseDown(e, 'resize-sw')} />
          <div style={{ ...handleStyle, bottom: `${-handleOffset}px`, right: `${-handleOffset}px`, cursor: 'se-resize' }}
               onMouseDown={(e) => handleMouseDown(e, 'resize-se')} />

          {/* Edge handles */}
          <div style={{ ...edgeHandleStyle, top: `${-handleOffset}px`, left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' }}
               onMouseDown={(e) => handleMouseDown(e, 'resize-n')} />
          <div style={{ ...edgeHandleStyle, bottom: `${-handleOffset}px`, left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' }}
               onMouseDown={(e) => handleMouseDown(e, 'resize-s')} />
          <div style={{ ...edgeHandleStyle, left: `${-handleOffset}px`, top: '50%', transform: 'translateY(-50%)', width: `${cornerHandleSize}px`, height: `${edgeHandleLength}px`, cursor: 'w-resize' }}
               onMouseDown={(e) => handleMouseDown(e, 'resize-w')} />
          <div style={{ ...edgeHandleStyle, right: `${-handleOffset}px`, top: '50%', transform: 'translateY(-50%)', width: `${cornerHandleSize}px`, height: `${edgeHandleLength}px`, cursor: 'e-resize' }}
               onMouseDown={(e) => handleMouseDown(e, 'resize-e')} />
        </>
      )}
    </div>
  );
}
import "./CollageCanvas.css";

interface CollageCanvasProps {
  width?: number;
  height?: number;
}

interface ImageZoneProps {
  zone: FrameZone;
}

// Background image layer - treated as a large frame that covers the entire canvas
function BackgroundLayer() {
  const { background, canvasSize, backgroundTransform, setBackgroundTransform, isBackgroundSelected, setIsBackgroundSelected, selectedZone, setSelectedZone, setActiveSidebarTab, activeSidebarTab, currentFrame, setAutoMatchBackground } = useCollage();
  const bgRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [transformStart, setTransformStart] = useState({ x: 0, y: 0 });
  const [snapGuides, setSnapGuides] = useState({ horizontal: false, vertical: false, centerH: false, centerV: false });
  const SNAP_THRESHOLD = 10;

  // Convert background path to Tauri-compatible URL
  const bgSrc = useMemo(() => {
    if (!background) return null;
    if (background.startsWith('http') || background.startsWith('data:')) {
      return background;
    }
    return convertFileSrc(background.replace('asset://', ''));
  }, [background]);

  // Handle mouse down on background for panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!background) return;
    // Lock background when in frame creator mode
    if (activeSidebarTab === 'frames') return;
    e.stopPropagation();
    setIsDragging(true);
    setIsBackgroundSelected(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setTransformStart({ x: backgroundTransform.offsetX, y: backgroundTransform.offsetY });
  }, [background, backgroundTransform, setIsBackgroundSelected, activeSidebarTab]);

  // Set up global mouse event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      const handleGlobalMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        let newOffsetX = transformStart.x + deltaX;
        let newOffsetY = transformStart.y + deltaY;

        // Get container dimensions
        const containerWidth = bgRef.current?.offsetWidth || 0;
        const containerHeight = bgRef.current?.offsetHeight || 0;

        // With scale() and translate(), the transform origin is center (default)
        // At scale=1 and offset=0, image exactly covers container
        // When scaled, the image grows/shrinks from center
        // The translate offset moves the already-scaled image

        const scale = backgroundTransform.scale;

        // Calculate how much the image extends beyond the container on each side (before translate)
        // With scale > 1: image is larger, so negative overflow
        // With scale < 1: image is smaller, so positive "underflow"
        const overflowX = (containerWidth * scale - containerWidth) / 2;
        const overflowY = (containerHeight * scale - containerHeight) / 2;

        // Snap to center - when offset is 0, image is centered
        const snapToCenterX = Math.abs(newOffsetX) < SNAP_THRESHOLD;
        const snapToCenterY = Math.abs(newOffsetY) < SNAP_THRESHOLD;

        if (snapToCenterX) newOffsetX = 0;
        if (snapToCenterY) newOffsetY = 0;

        // Snap edges to container edges
        // When image left edge aligns with container left edge:
        // The image center is at (containerWidth/2) + newOffsetX
        // The image left edge is at: (containerWidth/2) + newOffsetX - (scaledWidth/2)
        // We want: (containerWidth/2) + newOffsetX - (containerWidth * scale / 2) = 0
        // So: newOffsetX = (containerWidth * scale / 2) - (containerWidth / 2) = overflowX

        const leftEdgeSnap = Math.abs(newOffsetX - overflowX) < SNAP_THRESHOLD;
        const rightEdgeSnap = Math.abs(newOffsetX + overflowX) < SNAP_THRESHOLD;
        const topEdgeSnap = Math.abs(newOffsetY - overflowY) < SNAP_THRESHOLD;
        const bottomEdgeSnap = Math.abs(newOffsetY + overflowY) < SNAP_THRESHOLD;

        if (leftEdgeSnap) newOffsetX = overflowX;
        if (rightEdgeSnap) newOffsetX = -overflowX;
        if (topEdgeSnap) newOffsetY = overflowY;
        if (bottomEdgeSnap) newOffsetY = -overflowY;

        // Update snap guides for visual feedback
        setSnapGuides({
          horizontal: leftEdgeSnap || rightEdgeSnap, // Horizontal guides when left/right edges snap
          vertical: topEdgeSnap || bottomEdgeSnap,   // Vertical guides when top/bottom edges snap
          centerH: snapToCenterX,                    // Vertical guide when horizontally centered
          centerV: snapToCenterY,                    // Horizontal guide when vertically centered
        });

        setBackgroundTransform({
          ...backgroundTransform,
          offsetX: newOffsetX,
          offsetY: newOffsetY,
        });
      };

      const handleGlobalMouseUp = () => {
        setIsDragging(false);
        setSnapGuides({ horizontal: false, vertical: false, centerH: false, centerV: false });
      };

      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [isDragging, dragStart, transformStart, backgroundTransform, setBackgroundTransform, setSnapGuides, SNAP_THRESHOLD]);

  if (!bgSrc) return null;

  return (
    <div
      ref={bgRef}
      className={`canvas-background-layer ${isBackgroundSelected ? 'selected' : ''}`}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'grab',
        zIndex: 0,
      }}
      onMouseDown={handleMouseDown}
      onClick={(e) => {
        e.stopPropagation();

        // Lock background selection when in frame creator mode
        if (activeSidebarTab === 'frames') return;

        // If clicking on the background area, deselect zones and select background
        setSelectedZone(null); // Deselect any frame zone
        setIsBackgroundSelected(true); // Select background
        setActiveSidebarTab('file'); // Switch to file folder tab
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          transform: `
            scale(${backgroundTransform.scale})
            translate(${backgroundTransform.offsetX}px, ${backgroundTransform.offsetY}px)
          `,
          transition: isDragging ? 'none' : 'transform 0.2s ease',
        }}
      >
        <img
          src={bgSrc}
          alt="Background"
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
        {/* 3x3 Grid Overlay - shown when background is selected */}
        {isBackgroundSelected && (
          <div className="grid-overlay" style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
          }}>
            <div className="grid-line grid-line-vertical" style={{ left: '33.33%' }} />
            <div className="grid-line grid-line-vertical" style={{ left: '66.67%' }} />
            <div className="grid-line grid-line-horizontal" style={{ top: '33.33%' }} />
            <div className="grid-line grid-line-horizontal" style={{ top: '66.67%' }} />
          </div>
        )}
        {/* Overflow visualization - shows parts of bg extending beyond canvas with transparency and grid */}
        {isBackgroundSelected && backgroundTransform.scale > 1 && (
          <div className="background-overflow-mask" style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'hidden',
          }}>
            <img
              src={bgSrc}
              alt="Background Overflow"
              draggable={false}
              style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: 0.2,
                // Counteract parent transform to show overflow
                transform: `
                  translate(${-backgroundTransform.offsetX}px, ${-backgroundTransform.offsetY}px)
                  scale(${1 / backgroundTransform.scale})
                `,
                transformOrigin: 'center center',
              }}
            />
            {/* 3x3 grid on the overflow area */}
            <div className="grid-overlay grid-overlay-overflow" style={{
              position: 'absolute',
              inset: 0,
            }}>
              <div className="grid-line grid-line-vertical" style={{ left: '33.33%' }} />
              <div className="grid-line grid-line-vertical" style={{ left: '66.67%' }} />
              <div className="grid-line grid-line-horizontal" style={{ top: '33.33%' }} />
              <div className="grid-line grid-line-horizontal" style={{ top: '66.67%' }} />
            </div>
          </div>
        )}
        {/* Snap Guides - shown during dragging */}
        {snapGuides.centerH && (
          <div className="snap-guide snap-guide-vertical" style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            height: '100%',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
          }} />
        )}
        {snapGuides.centerV && (
          <div className="snap-guide snap-guide-horizontal" style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            width: '100%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
          }} />
        )}
        {snapGuides.horizontal && (
          <>
            <div className="snap-guide snap-guide-horizontal" style={{ position: 'absolute', top: 0, left: 0, width: '100%', pointerEvents: 'none' }} />
            <div className="snap-guide snap-guide-horizontal" style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', pointerEvents: 'none' }} />
          </>
        )}
        {snapGuides.vertical && (
          <>
            <div className="snap-guide snap-guide-vertical" style={{ position: 'absolute', left: 0, top: 0, height: '100%', pointerEvents: 'none' }} />
            <div className="snap-guide snap-guide-vertical" style={{ position: 'absolute', right: 0, top: 0, height: '100%', pointerEvents: 'none' }} />
          </>
        )}
      </div>
      {/* Selection border */}
      {isBackgroundSelected && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            border: '3px solid var(--accent-blue)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
}

// Individual image zone with drop target
function ImageZone({ zone }: ImageZoneProps) {
  const { placedImages, addPlacedImage, selectedZone, setSelectedZone, updatePlacedImage, canvasSize, setIsBackgroundSelected, setActiveSidebarTab, activeSidebarTab, canvasZoom } = useCollage();
  const placedImage = placedImages.get(zone.id);
  const dropRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const transformContainerRef = useRef<HTMLDivElement>(null); // Ref to the inner transform container
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [transformStart, setTransformStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0, left: 0, top: 0 });
  const [snapGuides, setSnapGuides] = useState({ horizontal: false, vertical: false, centerH: false, centerV: false });
  const SNAP_THRESHOLD = 10; // pixels

  // Calculate the actual display scale factor
  const [displayScale, setDisplayScale] = useState(1);

  useEffect(() => {
    const canvas = document.querySelector('.collage-canvas') as HTMLElement;
    if (canvas && canvasSize?.width) {
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / canvasSize.width;
      setDisplayScale(scale);
    }
  }, [canvasSize?.width, canvasZoom]);

  // Convert file paths to Tauri-compatible URLs (use full sourceFile, not thumbnail)
  const imageSrc = useMemo(() => {
    if (!placedImage) return null;
    const src = placedImage.sourceFile;
    return convertFileSrc(src.replace('asset://', ''));
  }, [placedImage, zone.id]);

  const [{ isOver, canDrop }, drop] = useDrop({
    accept: 'IMAGE',
    drop: (item: { path: string; thumbnail: string; dimensions?: { width: number; height: number } }) => {

      // Calculate scale to fill the zone vertically
      // With objectFit: 'contain', the image is fitted to show completely
      // We want to scale it up so it fills the zone better (like objectFit: 'cover' but allowing pan)
      let scale = 1.0;
      if (item.dimensions) {
        // FIXED POSITIONING: Zone dimensions are now in pixels directly
        const zoneWidthPx = zone.width;
        const zoneHeightPx = zone.height;

        // Debug logging

        // Work with the dimensions - may need to swap if EXIF orientation wasn't handled
        let imgWidth = item.dimensions.width;
        let imgHeight = item.dimensions.height;

        const rawImgAspect = imgWidth / imgHeight;
        const zoneAspect = zoneWidthPx / zoneHeightPx;

        console.log('Raw image aspect ratio (width/height):', rawImgAspect.toFixed(4));
        console.log('Zone aspect ratio (width/height):', zoneAspect.toFixed(4));

        // Detect if dimensions might be swapped due to EXIF orientation
        // If image is much wider than zone (aspect > 1.2x different), it might need swapping
        // This is a heuristic - for portrait photos stored as landscape
        const aspectRatioDiff = Math.abs(rawImgAspect - zoneAspect);
        const mightBeSwapped = rawImgAspect > 1.0 && zoneAspect < 1.0 && aspectRatioDiff > 0.3;

        if (mightBeSwapped) {
          console.log('⚠️ Dimensions might be swapped due to EXIF orientation');
          console.log('   Image looks landscape but zone is portrait');
          console.log('   Aspect ratio difference:', aspectRatioDiff.toFixed(4));
        }

        const imgAspect = imgWidth / imgHeight;
        const imgIsWider = imgAspect > zoneAspect;

        console.log('Image is wider than zone?', imgIsWider);

        if (imgIsWider) {
          // Image is wider - constrained by zone width, leaving gaps top/bottom
          // objectFit: 'contain' will scale image to fit zone width
          // Rendered height = zoneWidth / imgAspect
          const renderedHeight = zoneWidthPx / imgAspect;
          console.log('objectFit:contain will render image at:', zoneWidthPx.toFixed(0), 'x', renderedHeight.toFixed(0));
          console.log('Empty space top/bottom:', (zoneHeightPx - renderedHeight).toFixed(0), 'px');

          // We need to scale up so height fills the zone
          // Scale needed = zoneHeight / renderedHeight
          // Which simplifies to: (zoneHeight * imgAspect) / zoneWidth = imgAspect / zoneAspect
          scale = imgAspect / zoneAspect;
          console.log('Scale needed to fill height:', scale.toFixed(4));
          console.log('Image is width-constrained, scaling to fill height');
        } else {
          // Image is taller - constrained by zone height, leaving gaps left/right
          // objectFit: 'contain' will scale image to fit zone height
          // Rendered width = zoneHeight * imgAspect
          const renderedWidth = zoneHeightPx * imgAspect;
          console.log('objectFit:contain will render image at:', renderedWidth.toFixed(0), 'x', zoneHeightPx.toFixed(0));
          console.log('Empty space left/right:', (zoneWidthPx - renderedWidth).toFixed(0), 'px');

          // We need to scale up so width fills the zone
          // Scale needed = zoneWidth / renderedWidth
          // Which simplifies to: zoneWidth / (zoneHeight * imgAspect) = zoneAspect / imgAspect
          scale = zoneAspect / imgAspect;
          console.log('Scale needed to fill width:', scale.toFixed(4));
          console.log('Image is height-constrained, scaling to fill width');
        }

        console.log('Calculated scale:', scale.toFixed(4));
        console.log('==================');
      }

      // Round scale to nearest 0.1, round up for values like 1.21 -> 1.2, 1.25 -> 1.3, 1.45 -> 1.5
      const scaleRounded = Math.ceil(scale * 10) / 10;
      console.log('Final rounded scale:', scaleRounded.toFixed(1));

      const placedImageData = {
        sourceFile: item.path,
        thumbnail: item.thumbnail,
        zoneId: zone.id,
        transform: { ...DEFAULT_TRANSFORM, scale: scaleRounded },
        originalScale: scaleRounded, // Store the optimal scale for reset
      };

      console.log('=== ADDING PLACED IMAGE ===');
      console.log('Zone ID:', zone.id);
      console.log('Placed image data:', placedImageData);
      console.log('===========================');

      addPlacedImage(zone.id, placedImageData);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  });

  drop(dropRef);

  // Handle mouse down on image for panning
  const handleImageMouseDown = useCallback((e: React.MouseEvent) => {
    if (!placedImage) return;
    e.stopPropagation(); // Prevent zone selection
    setIsDraggingImage(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setTransformStart({ x: placedImage.transform.offsetX, y: placedImage.transform.offsetY });
  }, [placedImage]);

  // Set up global mouse event listeners for dragging
  useEffect(() => {
    if (isDraggingImage) {
      const handleGlobalMouseMove = (e: MouseEvent) => {
        if (!placedImage) return;
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        let newOffsetX = transformStart.x + deltaX;
        let newOffsetY = transformStart.y + deltaY;

        // Use the transform container's dimensions (parent of the image), not the outer zone container
        const containerWidth = transformContainerRef.current?.offsetWidth || 0;
        const containerHeight = transformContainerRef.current?.offsetHeight || 0;

        const scale = placedImage.transform.scale;
        const scaledWidth = imageSize.width * scale;
        const scaledHeight = imageSize.height * scale;
        const imageBaseCenterX = imageSize.left + imageSize.width / 2;
        const imageBaseCenterY = imageSize.top + imageSize.height / 2;
        const containerCenterX = containerWidth / 2;
        const containerCenterY = containerHeight / 2;

        // Current center position after all transforms
        const imageCenterX = imageBaseCenterX + newOffsetX;
        const imageCenterY = imageBaseCenterY + newOffsetY;

        // Snap to center
        const snapToCenterH = Math.abs(imageCenterX - containerCenterX) < SNAP_THRESHOLD;
        const snapToCenterV = Math.abs(imageCenterY - containerCenterY) < SNAP_THRESHOLD;

        if (snapToCenterH) {
          newOffsetX = containerCenterX - imageBaseCenterX;
        }
        if (snapToCenterV) {
          newOffsetY = containerCenterY - imageBaseCenterY;
        }

        // Snap to edges
        const imageLeft = imageBaseCenterX - scaledWidth / 2 + newOffsetX;
        const imageRight = imageBaseCenterX + scaledWidth / 2 + newOffsetX;
        const imageTop = imageBaseCenterY - scaledHeight / 2 + newOffsetY;
        const imageBottom = imageBaseCenterY + scaledHeight / 2 + newOffsetY;

        const snapToLeft = Math.abs(imageLeft) < SNAP_THRESHOLD;
        const snapToRight = Math.abs(imageRight - containerWidth) < SNAP_THRESHOLD;
        const snapToTop = Math.abs(imageTop) < SNAP_THRESHOLD;
        const snapToBottom = Math.abs(imageBottom - containerHeight) < SNAP_THRESHOLD;

        if (snapToLeft) newOffsetX = -imageBaseCenterX + scaledWidth / 2;
        if (snapToRight) newOffsetX = containerWidth - imageBaseCenterX - scaledWidth / 2;
        if (snapToTop) newOffsetY = -imageBaseCenterY + scaledHeight / 2;
        if (snapToBottom) newOffsetY = containerHeight - imageBaseCenterY - scaledHeight / 2;

        // Update snap guides for visual feedback
        setSnapGuides({
          horizontal: snapToLeft || snapToRight, // Horizontal guides when left/right edges snap
          vertical: snapToTop || snapToBottom,   // Vertical guides when top/bottom edges snap
          centerH: snapToCenterH,                // Vertical guide when horizontally centered
          centerV: snapToCenterV,                // Horizontal guide when vertically centered
        });

        updatePlacedImage(zone.id, {
          transform: {
            ...placedImage.transform,
            offsetX: newOffsetX,
            offsetY: newOffsetY,
          },
        });
      };

      const handleGlobalMouseUp = () => {
        setIsDraggingImage(false);
        setSnapGuides({ horizontal: false, vertical: false, centerH: false, centerV: false });
      };

      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [isDraggingImage, dragStart, transformStart, placedImage, zone.id, updatePlacedImage, imageSize, SNAP_THRESHOLD]);

  // Measure the actual rendered size of the image (with objectFit: contain)
  useEffect(() => {
    if (imageRef.current && placedImage) {
      const updateImageSize = () => {
        const img = imageRef.current;
        if (!img) return;

        const containerWidth = img.parentElement?.offsetWidth || 0;
        const containerHeight = img.parentElement?.offsetHeight || 0;
        const imgNaturalWidth = img.naturalWidth;
        const imgNaturalHeight = img.naturalHeight;

        if (!imgNaturalWidth || !imgNaturalHeight) return;

        // Calculate how the image is positioned with objectFit: contain
        const containerAspect = containerWidth / containerHeight;
        const imgAspect = imgNaturalWidth / imgNaturalHeight;

        let renderWidth, renderHeight, offsetX, offsetY;

        if (imgAspect > containerAspect) {
          // Image is wider than container - width is constrained
          renderWidth = containerWidth;
          renderHeight = containerWidth / imgAspect;
          offsetX = 0;
          offsetY = (containerHeight - renderHeight) / 2;
        } else {
          // Image is taller than container - height is constrained
          renderHeight = containerHeight;
          renderWidth = containerHeight * imgAspect;
          offsetX = (containerWidth - renderWidth) / 2;
          offsetY = 0;
        }

        console.log('=== IMAGE SIZE CALCULATION ===');
        console.log('Zone ID:', zone.id);
        console.log('containerSize:', { width: containerWidth, height: containerHeight });
        console.log('imageNaturalSize:', { width: imgNaturalWidth, height: imgNaturalHeight });
        console.log('aspects:', { container: containerAspect.toFixed(4), image: imgAspect.toFixed(4) });
        console.log('calculated:', { renderWidth, renderHeight, offsetX, offsetY });
        console.log('============================');

        setImageSize({ width: renderWidth, height: renderHeight, left: offsetX, top: offsetY });
      };

      updateImageSize();
      window.addEventListener('resize', updateImageSize);
      return () => window.removeEventListener('resize', updateImageSize);
    }
  }, [placedImage, imageSrc]);

  const getBorderRadiusForImageZone = () => {
    switch (zone.shape) {
      case 'circle': return '50%';
      case 'ellipse': return '50% / 40%';
      case 'rounded_rect': return `${zone.borderRadius || 12}px`;
      case 'pill': return '999px';
      default: return '2px';
    }
  };

  const getClipPathForImageZone = () => {
    switch (zone.shape) {
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
        return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
      case 'heart':
        return 'polygon(50% 15%, 65% 0%, 85% 0%, 100% 15%, 100% 35%, 85% 50%, 50% 100%, 15% 50%, 0% 35%, 0% 15%, 15% 0%, 35% 0%)';
      case 'cross':
        return 'polygon(20% 0%, 80% 0%, 80% 20%, 100% 20%, 100% 80%, 80% 80%, 80% 100%, 20% 100%, 20% 80%, 0% 80%, 0% 20%, 20% 20%)';
      default:
        return undefined;
    }
  };

  const clipPath = getClipPathForImageZone();
  const zoneStyle = {
    position: 'absolute' as const,
    left: `${zone.x}px`,
    top: `${zone.y}px`,
    width: `${zone.width}px`,
    height: `${zone.height}px`,
    transform: `rotate(${zone.rotation}deg)`,
    border: selectedZone === zone.id ? '3px solid var(--accent-blue)' : '2px dashed rgba(255, 255, 255, 0.3)',
    borderRadius: getBorderRadiusForImageZone(),
    clipPath: clipPath,
    backgroundColor: isOver ? 'rgba(59, 130, 246, 0.2)' : 'rgba(0, 0, 0, 0.1)',
    cursor: 'pointer',
    overflow: 'hidden',
    zIndex: selectedZone === zone.id ? 50 : 40,
    // Only animate border, background-color, and box-shadow - NOT transform
    transition: 'border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease',
  };

  return (
    <div
      ref={dropRef}
      style={zoneStyle}
      onClick={(e) => {
        e.stopPropagation(); // Prevent click from bubbling to container
        setSelectedZone(zone.id);
        setIsBackgroundSelected(false);
        // Only switch to edit tab if we're not in frame creation mode
        if (activeSidebarTab !== 'frames') {
          setActiveSidebarTab('edit'); // Switch to edit tab when frame is selected
        }
      }}
      className="image-zone"
    >
      {placedImage && imageSrc ? (
        <div
          ref={transformContainerRef}
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            transform: `
              scale(${placedImage.transform.scale})
              translate(${placedImage.transform.offsetX}px, ${placedImage.transform.offsetY}px)
              rotate(${placedImage.transform.rotation}deg)
              scaleX(${placedImage.transform.flipHorizontal ? -1 : 1})
              scaleY(${placedImage.transform.flipVertical ? -1 : 1})
            `,
          }}
        >
          <img
            ref={imageRef}
            src={imageSrc}
            alt="Placed"
            draggable={false}
            onMouseDown={handleImageMouseDown}
            onLoad={() => {
              console.log('=== IMAGE LOADED ===');
              console.log('Zone ID:', zone.id);
              console.log('Image src:', imageSrc);
              console.log('====================');
            }}
            onError={(e) => {
              console.error('=== IMAGE LOAD ERROR ===');
              console.error('Zone ID:', zone.id);
              console.error('Image src:', imageSrc);
              console.error('Error:', e);
              console.error('========================');
            }}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              cursor: isDraggingImage ? 'grabbing' : 'grab',
              display: 'block',
            }}
          />
          {/* 3x3 Grid Overlay - shown when zone is selected */}
          {/* Grid is positioned relative to the transformed container, so it scales and translates with the image */}
          {selectedZone === zone.id && imageSize.width > 0 && (
            <div
              className="grid-overlay"
              style={{
                width: imageSize.width,
                height: imageSize.height,
                left: imageSize.left,
                top: imageSize.top,
              }}
            >
              <div className="grid-line grid-line-vertical" style={{ left: '33.33%' }} />
              <div className="grid-line grid-line-vertical" style={{ left: '66.67%' }} />
              <div className="grid-line grid-line-horizontal" style={{ top: '33.33%' }} />
              <div className="grid-line grid-line-horizontal" style={{ top: '66.67%' }} />
            </div>
          )}
          {/* Snap Guides - shown during dragging */}
          {/* centerH: image horizontally centered -> show vertical line through center */}
          {/* centerV: image vertically centered -> show horizontal line through center */}
          {/* horizontal: left/right edges aligned -> show horizontal lines at top/bottom */}
          {/* vertical: top/bottom edges aligned -> show vertical lines at left/right */}
          {snapGuides.centerH && (
            <div className="snap-guide snap-guide-vertical" style={{
              left: '50%',
              top: 0,
              height: '100%',
              transform: 'translateX(-50%)',
            }} />
          )}
          {snapGuides.centerV && (
            <div className="snap-guide snap-guide-horizontal" style={{
              top: '50%',
              left: 0,
              width: '100%',
              transform: 'translateY(-50%)',
            }} />
          )}
          {snapGuides.horizontal && (
            <>
              <div className="snap-guide snap-guide-horizontal" style={{ top: 0, left: 0, width: '100%' }} />
              <div className="snap-guide snap-guide-horizontal" style={{ bottom: 0, left: 0, width: '100%' }} />
            </>
          )}
          {snapGuides.vertical && (
            <>
              <div className="snap-guide snap-guide-vertical" style={{ left: 0, top: 0, height: '100%' }} />
              <div className="snap-guide snap-guide-vertical" style={{ right: 0, top: 0, height: '100%' }} />
            </>
          )}
        </div>
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: `${20 / displayScale}px`,
            pointerEvents: 'none',
          }}
        >
          {canDrop ? 'Drop here' : 'Drag image here'}
        </div>
      )}
    </div>
  );
}

// Image Zone Overflow Component - renders the overflow visualization at canvas level
interface ImageZoneOverflowProps {
  zone: FrameZone;
  placedImage: PlacedImage;
}

function ImageZoneOverflow({ zone, placedImage }: ImageZoneOverflowProps) {
  const imageSrc = convertFileSrc(placedImage.sourceFile.replace('asset://', ''));
  const overflowRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0, left: 0, top: 0 });
  const { updatePlacedImage } = useCollage();
  const [isZooming, setIsZooming] = useState(false);
  const [zoomStart, setZoomStart] = useState({
    x: 0,
    y: 0,
    scale: placedImage.transform.scale,
    offsetX: placedImage.transform.offsetX,
    offsetY: placedImage.transform.offsetY,
    corner: '' as 'tl' | 'tr' | 'bl' | 'br'
  });

  // Handle zoom by dragging from corners
  const handleZoomStart = (e: React.MouseEvent, corner: 'tl' | 'tr' | 'bl' | 'br') => {
    e.stopPropagation();
    setIsZooming(true);
    setZoomStart({
      x: e.clientX,
      y: e.clientY,
      scale: placedImage.transform.scale,
      offsetX: placedImage.transform.offsetX,
      offsetY: placedImage.transform.offsetY,
      corner
    });
  };

  useEffect(() => {
    if (isZooming) {
      const handleMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - zoomStart.x;
        const deltaY = e.clientY - zoomStart.y;

        // Use movement for zoom sensitivity - different corners use different directions
        // Dragging AWAY from center should INCREASE scale (zoom in)
        let scaleDelta: number;
        if (zoomStart.corner === 'br') {
          // Bottom-right: dragging down/right (away from center) increases scale
          scaleDelta = (deltaX + deltaY) * 0.005;
        } else if (zoomStart.corner === 'bl') {
          // Bottom-left: dragging down/left (away from center) increases scale
          scaleDelta = (-deltaX + deltaY) * 0.005;
        } else if (zoomStart.corner === 'tr') {
          // Top-right: dragging up/right (away from center) increases scale
          scaleDelta = (deltaX - deltaY) * 0.005;
        } else {
          // Top-left: dragging up/left (away from center) increases scale
          scaleDelta = (-deltaX - deltaY) * 0.005;
        }

        const newScale = Math.max(0.5, Math.min(3, zoomStart.scale + scaleDelta));

        // Zoom from center - keep the same offset, just change scale
        updatePlacedImage(zone.id, {
          transform: {
            ...placedImage.transform,
            scale: newScale,
          },
        });
      };

      const handleMouseUp = () => {
        setIsZooming(false);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isZooming, zoomStart, zone.id, placedImage, updatePlacedImage, imageSize]);

  // Measure the actual rendered size of the image (with objectFit: contain)
  useEffect(() => {
    if (imgRef.current) {
      const updateImageSize = () => {
        const img = imgRef.current;
        if (!img) return;

        const containerWidth = img.parentElement?.offsetWidth || 0;
        const containerHeight = img.parentElement?.offsetHeight || 0;
        const imgNaturalWidth = img.naturalWidth;
        const imgNaturalHeight = img.naturalHeight;

        if (!imgNaturalWidth || !imgNaturalHeight) return;

        // Calculate how the image is positioned with objectFit: contain
        const containerAspect = containerWidth / containerHeight;
        const imgAspect = imgNaturalWidth / imgNaturalHeight;

        let renderWidth, renderHeight, offsetX, offsetY;

        if (imgAspect > containerAspect) {
          // Image is wider than container - width is constrained
          renderWidth = containerWidth;
          renderHeight = containerWidth / imgAspect;
          offsetX = 0;
          offsetY = (containerHeight - renderHeight) / 2;
        } else {
          // Image is taller than container - height is constrained
          renderHeight = containerHeight;
          renderWidth = containerHeight * imgAspect;
          offsetX = (containerWidth - renderWidth) / 2;
          offsetY = 0;
        }

        setImageSize({ width: renderWidth, height: renderHeight, left: offsetX, top: offsetY });
      };

      updateImageSize();
      window.addEventListener('resize', updateImageSize);
      return () => window.removeEventListener('resize', updateImageSize);
    }
  }, [imageSrc]);

  return (
    <div
      ref={overflowRef}
      style={{
        position: 'absolute',
        left: `${zone.x}px`,
        top: `${zone.y}px`,
        width: `${zone.width}px`,
        height: `${zone.height}px`,
        transform: `rotate(${zone.rotation}deg)`,
        pointerEvents: 'auto',
        zIndex: 1,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          transform: `
            scale(${placedImage.transform.scale})
            translate(${placedImage.transform.offsetX}px, ${placedImage.transform.offsetY}px)
            rotate(${placedImage.transform.rotation}deg)
            scaleX(${placedImage.transform.flipHorizontal ? -1 : 1})
            scaleY(${placedImage.transform.flipVertical ? -1 : 1})
          `,
        }}
      >
        <img
          ref={imgRef}
          src={imageSrc}
          alt="Overflow"
          draggable={false}
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            opacity: 0.25,
            filter: 'brightness(0.7)',
            display: 'block',
          }}
        />
        {/* 3x3 grid overlay - positioned to match actual image bounds */}
        {imageSize.width > 0 && (
          <div
            className="grid-overlay grid-overlay-overflow overflow-overlay-frame"
            style={{
              position: 'absolute',
              left: imageSize.left,
              top: imageSize.top,
              width: imageSize.width,
              height: imageSize.height,
            }}
          >
            <div className="grid-line grid-line-vertical" style={{ left: '33.33%' }} />
            <div className="grid-line grid-line-vertical" style={{ left: '66.67%' }} />
            <div className="grid-line grid-line-horizontal" style={{ top: '33.33%' }} />
            <div className="grid-line grid-line-horizontal" style={{ top: '66.67%' }} />
          </div>
        )}

        {/* Zoom handles at corners of the actual image */}
        {imageSize.width > 0 && (
          <>
            {/* Top-left corner */}
            <div
              onMouseDown={(e) => handleZoomStart(e, 'tl')}
              className="zoom-handle zoom-handle-corner"
              style={{
                position: 'absolute',
                left: imageSize.left - 2,
                top: imageSize.top - 2,
                width: 16,
                height: 16,
                cursor: isZooming ? 'nwse-resize' : 'nwse-resize',
                zIndex: 100,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M1 1V8H2V2H8V1H1Z" fill="white" stroke="var(--accent-blue)" strokeWidth="1.5"/>
              </svg>
            </div>

            {/* Top-right corner */}
            <div
              onMouseDown={(e) => handleZoomStart(e, 'tr')}
              className="zoom-handle zoom-handle-corner"
              style={{
                position: 'absolute',
                left: imageSize.left + imageSize.width - 14,
                top: imageSize.top - 2,
                width: 16,
                height: 16,
                cursor: isZooming ? 'nesw-resize' : 'nesw-resize',
                zIndex: 100,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M15 1V8H14V2H8V1H15Z" fill="white" stroke="var(--accent-blue)" strokeWidth="1.5"/>
              </svg>
            </div>

            {/* Bottom-left corner */}
            <div
              onMouseDown={(e) => handleZoomStart(e, 'bl')}
              className="zoom-handle zoom-handle-corner"
              style={{
                position: 'absolute',
                left: imageSize.left - 2,
                top: imageSize.top + imageSize.height - 14,
                width: 16,
                height: 16,
                cursor: isZooming ? 'nesw-resize' : 'nesw-resize',
                zIndex: 100,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M1 15V8H2V14H8V15H1Z" fill="white" stroke="var(--accent-blue)" strokeWidth="1.5"/>
              </svg>
            </div>

            {/* Bottom-right corner */}
            <div
              onMouseDown={(e) => handleZoomStart(e, 'br')}
              className="zoom-handle zoom-handle-corner"
              style={{
                position: 'absolute',
                left: imageSize.left + imageSize.width - 14,
                top: imageSize.top + imageSize.height - 14,
                width: 16,
                height: 16,
                cursor: isZooming ? 'nwse-resize' : 'nwse-resize',
                zIndex: 100,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M15 15V8H14V14H8V15H15Z" fill="white" stroke="var(--accent-blue)" strokeWidth="1.5"/>
              </svg>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CollageCanvas({ width: propWidth, height: propHeight }: CollageCanvasProps) {
  const {
    currentFrame,
    setCurrentFrame,
    background,
    canvasSize,
    backgroundTransform,
    setBackgroundTransform,
    isBackgroundSelected,
    setIsBackgroundSelected,
    canvasZoom,
    setCanvasZoom,
    selectedZone,
    setSelectedZone,
    placedImages,
    setActiveSidebarTab,
    activeSidebarTab,
    autoMatchBackground,
    backgroundDimensions,
    copiedZone,
    setCopiedZone,
    overlays,
    selectedOverlayId,
    setSelectedOverlayId,
    updateOverlay,
    importOverlayFiles,
    isFrameCreatorSaving,
  } = useCollage();
  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [localZoom, setLocalZoom] = useState(canvasZoom);
  const [zoomCenter, setZoomCenter] = useState({ x: 0, y: 0 });

  // Overlay snap guides state
  const [overlaySnapGuides, setOverlaySnapGuides] = useState({ centerH: false, centerV: false });
  const SNAP_THRESHOLD = 10;
  const prevZoomRef = useRef(canvasZoom);
  // Use refs to store latest values for completely stable callbacks
  const localZoomRef = useRef(localZoom);
  const setCanvasZoomRef = useRef(setCanvasZoom);
  const setLocalZoomRef = useRef(setLocalZoom);
  const setZoomCenterRef = useRef(setZoomCenter);

  // Use canvas size from context, falling back to props or auto-match background dimensions
  const width = propWidth ?? (autoMatchBackground && backgroundDimensions ? backgroundDimensions.width : canvasSize?.width);
  const height = propHeight ?? (autoMatchBackground && backgroundDimensions ? backgroundDimensions.height : canvasSize?.height);

  // Handle drop for frame creation zones
  const handleCanvasDrop = useCallback((e: React.DragEvent) => {
    if (activeSidebarTab !== 'frames') return;

    const zoneData = e.dataTransfer.getData('zone');
    if (!zoneData) return;

    const zoneConfig = JSON.parse(zoneData);

    // Get canvas bounds
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;

    // Calculate drop position relative to canvas
    const dropX = e.clientX - canvasRect.left;
    const dropY = e.clientY - canvasRect.top;

    // Convert to canvas coordinates (internal size)
    // Use the actual canvas dimensions from the rendered canvas
    const internalWidth = width;
    const internalHeight = height;

    if (!internalWidth || !internalHeight) return;

    const scaleX = internalWidth / canvasRect.width;
    const scaleY = internalHeight / canvasRect.height;

    const canvasX = dropX * scaleX;
    const canvasY = dropY * scaleY;

    // Create zone with dropped position
    const newZone = {
      id: `zone-${Date.now()}`,
      x: Math.round(Math.max(0, canvasX - 150)), // Center on drop position
      y: Math.round(Math.max(0, canvasY - 150)),
      width: 300,
      height: 300,
      rotation: 0,
      shape: zoneConfig.shape || 'rectangle',
    };

    // Update current frame with new zone
    if (currentFrame) {
      setCurrentFrame({
        ...currentFrame,
        zones: [...currentFrame.zones, newZone],
      });
    }
  }, [activeSidebarTab, width, height, currentFrame, setCurrentFrame]);

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    if (activeSidebarTab === 'frames') {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, [activeSidebarTab]);

  // Keep refs in sync with latest functions and values
  useEffect(() => {
    setLocalZoom(canvasZoom);
    localZoomRef.current = canvasZoom;
    setCanvasZoomRef.current = setCanvasZoom;
    setLocalZoomRef.current = setLocalZoom;
    setZoomCenterRef.current = setZoomCenter;
  }, [canvasZoom, setCanvasZoom, setLocalZoom, setZoomCenter]);

  // Handle Ctrl+Scroll to zoom from mouse position
  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();

      const canvas = canvasRef.current;
      if (!canvas) return;

      // Get mouse position relative to the canvas
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Calculate position relative to canvas center (normalized -1 to 1)
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const relativeX = (mouseX - centerX) / centerX;
      const relativeY = (mouseY - centerY) / centerY;

      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const currentZoom = localZoomRef.current;
      const newZoom = Math.max(0.5, Math.min(3, currentZoom + delta));

      // Store zoom center for the scroll adjustment
      setZoomCenterRef.current({ x: relativeX, y: relativeY });

      setLocalZoomRef.current(newZoom);
      setCanvasZoomRef.current(newZoom);
    }
  }, []); // No dependencies - completely stable

  // Handle touch pad pinch gesture
  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      (e.currentTarget as HTMLElement).dataset.pinchDistance = distance.toString();
    }
  }, []); // No dependencies - completely stable

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      const initialDistance = parseFloat((e.currentTarget as HTMLElement).dataset.pinchDistance || '0');

      if (initialDistance > 0) {
        const delta = (distance - initialDistance) * 0.01;
        const currentZoom = localZoomRef.current;
        const newZoom = Math.max(0.5, Math.min(3, currentZoom + delta));
        setLocalZoomRef.current(newZoom);
        setCanvasZoomRef.current(newZoom);
        (e.currentTarget as HTMLElement).dataset.pinchDistance = distance.toString();
      }
    }
  }, []); // No dependencies - completely stable

  // Add event listeners for zoom - setup when canvas is available
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
      canvas.addEventListener('touchmove', handleTouchMove, { passive: false });

      return () => {
        canvas.removeEventListener('wheel', handleWheel);
        canvas.removeEventListener('touchstart', handleTouchStart);
        canvas.removeEventListener('touchmove', handleTouchMove);
      };
    }
  }, [currentFrame, handleWheel, handleTouchStart, handleTouchMove]);

  // Handle keyboard events for copy/paste zones
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle in frame creator mode
      if (activeSidebarTab !== 'frames') return;

      // Ctrl+C or Cmd+C to copy zone
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedZone && currentFrame) {
        const zone = currentFrame.zones.find(z => z.id === selectedZone);
        if (zone) {
          setCopiedZone(zone);
          console.log('Zone copied:', zone);
        }
      }

      // Ctrl+V or Cmd+V to paste zone
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && copiedZone && currentFrame) {
        // Get next sequential zone ID
        const existingNumbers = currentFrame.zones
          .map(zone => {
            const match = zone.id.match(/zone-(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter(num => num > 0);
        const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
        const nextZoneId = `zone-${maxNumber + 1}`;

        // Create new zone with slight offset
        const newZone: FrameZone = {
          ...copiedZone,
          id: nextZoneId,
          x: Math.min(copiedZone.x + 20, currentFrame.width - copiedZone.width - 10),
          y: Math.min(copiedZone.y + 20, currentFrame.height - copiedZone.height - 10),
        };

        setCurrentFrame({
          ...currentFrame,
          zones: [...currentFrame.zones, newZone],
        });

        // Select the newly pasted zone
        setSelectedZone(newZone.id);
        console.log('Zone pasted:', newZone);
      }

      // Delete or Backspace to delete selected zone
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedZone && currentFrame) {
        e.preventDefault();
        const updatedZones = currentFrame.zones.filter(z => z.id !== selectedZone);
        setCurrentFrame({
          ...currentFrame,
          zones: updatedZones,
        });
        setSelectedZone(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSidebarTab, selectedZone, copiedZone, currentFrame, canvasSize, setCopiedZone, setCurrentFrame, setSelectedZone]);

  // Convert background path to Tauri-compatible URL (must be before conditional return)
  const bgSrc = useMemo(() => {
    if (!background) return null;
    if (background.startsWith('http') || background.startsWith('data:')) {
      return background;
    }
    return convertFileSrc(background.replace('asset://', ''));
  }, [background]);

  // Auto-scroll to zoom center when zooming (must be before conditional return)
  // This ensures the point under the mouse stays stable during zoom
  useEffect(() => {
    // Only run if zoom actually changed
    if (prevZoomRef.current !== localZoom) {
      prevZoomRef.current = localZoom;

      const canvas = canvasRef.current;
      if (canvas) {
        setTimeout(() => {
          const scrollableParent = canvas?.closest('.tab-content') as HTMLElement;

          if (scrollableParent) {
            // Get canvas position relative to viewport
            const canvasRect = canvas.getBoundingClientRect();
            const viewportRect = scrollableParent.getBoundingClientRect();

            // Get current scroll position
            const currentScrollTop = scrollableParent.scrollTop;
            const currentScrollLeft = scrollableParent.scrollLeft;

            // Calculate where the canvas middle is currently
            const canvasMiddleY = canvasRect.top - viewportRect.top + currentScrollTop + (canvasRect.height / 2);
            const viewportMiddleY = viewportRect.height / 2;

            // Calculate the target point based on zoom center (normalized -1 to 1)
            const targetOffsetY = zoomCenter.y * (canvasRect.height / 2);
            const targetPointY = canvasMiddleY + targetOffsetY;

            // Calculate new scroll position to center the target point
            const newScrollTop = targetPointY - viewportMiddleY;

            console.log('=== Zoom-to-Point ===');
            console.log('zoomCenter:', zoomCenter);
            console.log('canvasMiddleY:', canvasMiddleY, 'targetOffsetY:', targetOffsetY);
            console.log('currentScrollTop:', currentScrollTop, 'newScrollTop:', newScrollTop);
            console.log('====================');

            scrollableParent.scrollTo({
              left: currentScrollLeft,
              top: newScrollTop,
              behavior: 'instant'
            });
          }
        }, 0);
      }
    }
  }, [localZoom, zoomCenter]);

  // If no dimensions available, don't render canvas
  if (!width || !height) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="collage-canvas-container"
        style={{ flex: '1', display: 'flex', flexDirection: 'column' }}
      >
        <div className="canvas-placeholder">
          <div className="placeholder-content">
            <span className="placeholder-icon">📐</span>
            <h3>No Canvas Size Selected</h3>
            <p>Select a canvas size or choose a background to auto-fit</p>
          </div>
        </div>
        <FloatingFrameSelector />
      </motion.div>
    );
  }

  // Calculate scale to fit canvas in viewport
  const maxContainerWidth = 600;
  const maxContainerHeight = 900;

  const scaleX = maxContainerWidth / width;
  const scaleY = maxContainerHeight / height;
  const baseScale = Math.min(scaleX, scaleY, 1);

  const finalScale = baseScale * localZoom;

  const scaledWidth = width * finalScale;
  const scaledHeight = height * finalScale;

  // Calculate extra spacing around canvas based on zoom level
  // This creates invisible space around the canvas so you can scroll when zoomed
  const zoomGrowth = Math.max(0, localZoom - 0.5);
  const spacing = zoomGrowth * scaledHeight * 0.5; // More conservative spacing

  const containerStyle = {
    width: '100%',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    justifyContent: 'flex-start' as const,
    alignItems: 'center' as const,
    padding: '24px',
    flex: '1' as const,
    boxSizing: 'border-box' as const,
    overflow: 'visible' as const,
  };

  const canvasStyle = {
    width: `${scaledWidth}px`,
    height: `${scaledHeight}px`,
    position: 'relative' as const,
    background: '#ffffff',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    borderRadius: '4px',
    overflow: 'hidden', // Clip content at canvas boundary
    flexShrink: 0 as const,
  };

  const innerCanvasStyle = {
    width: `${width}px`,
    height: `${height}px`,
    position: 'relative' as const,
    overflow: 'hidden', // Add clipping to inner canvas
    borderRadius: '4px', // Match the canvas border radius
    transform: `scale(${finalScale})`,
    transformOrigin: 'top left',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="collage-canvas-container"
      style={{ flex: '1', display: 'flex', flexDirection: 'column' }}
    >
      {!currentFrame ? (
        <div className="canvas-placeholder">
          <div className="placeholder-content">
            <span className="placeholder-icon">🖼️</span>
            <h3>No Frame Selected</h3>
            <p>Choose a frame template to start creating your collage</p>
          </div>
        </div>
      ) : !background ? (
        <div className="canvas-placeholder">
          <div className="placeholder-content">
            <span className="placeholder-icon">🎨</span>
            <h3>No Background Selected</h3>
            <p>Choose a background to start creating your collage</p>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          style={containerStyle}
          onClick={() => {
            // Clicking outside the canvas (in the container area) deselects everything
            setSelectedZone(null);
            setIsBackgroundSelected(false);
            setSelectedOverlayId(null);
            // Only switch to file tab if we're not in frame creation mode
            if (activeSidebarTab !== 'frames' && activeSidebarTab !== 'layers') {
              setActiveSidebarTab('file');
            }
          }}
        >
          {/* Invisible spacers to allow scrolling in all directions when zoomed */}
          {spacing > 0 && <div style={{ height: `${spacing}px`, flexShrink: 0 }} />}
          <div
            ref={canvasRef}
            style={canvasStyle}
            className="collage-canvas"
            onDrop={handleCanvasDrop}
            onDragOver={handleCanvasDragOver}
          >
            {/* Overflow visualizations - rendered OUTSIDE inner canvas so they can extend beyond */}
            {/* Background overflow */}
            {isBackgroundSelected && background && backgroundTransform.scale > 1 && bgSrc && (
              <div style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 0,
                overflow: 'hidden', // Clip grid to bounds
              }}>
                <img
                  src={bgSrc}
                  alt="Background Overflow"
                  draggable={false}
                  style={{
                    position: 'absolute',
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    opacity: 0.2,
                    transform: `
                      scale(${backgroundTransform.scale})
                      translate(${backgroundTransform.offsetX}px, ${backgroundTransform.offsetY}px)
                    `,
                  }}
                />
                <div className="grid-overlay grid-overlay-overflow overflow-overlay-frame" style={{
                  position: 'absolute',
                  inset: 0,
                }}>
                  <div className="grid-line grid-line-vertical" style={{ left: '33.33%' }} />
                  <div className="grid-line grid-line-vertical" style={{ left: '66.67%' }} />
                  <div className="grid-line grid-line-horizontal" style={{ top: '33.33%' }} />
                  <div className="grid-line grid-line-horizontal" style={{ top: '66.67%' }} />
                </div>
              </div>
            )}
            <div style={innerCanvasStyle}>
              {/* Background Layer - rendered as transformable image */}
              <BackgroundLayer />

              {/* Overlay Layers - Below Frames (z-index: 10-39) */}
              {overlays
                .filter(o => o.position === 'below-frames' && o.visible)
                .sort((a, b) => a.layerOrder - b.layerOrder)
                .map((layer) => (
                  <OverlayLayerComponent
                    key={layer.id}
                    layer={layer}
                    isSelected={selectedOverlayId === layer.id}
                    canvasWidth={width}
                    canvasHeight={height}
                    zIndex={10 + layer.layerOrder}
                    interactive={activeSidebarTab === 'layers'}
                    onSnapGuidesChange={setOverlaySnapGuides}
                    onSelect={() => {
                      setSelectedOverlayId(layer.id);
                      setSelectedZone(null);
                      setIsBackgroundSelected(false);
                      setActiveSidebarTab('layers');
                    }}
                  />
                ))
              }

              {/* Interaction blocker when save dialog is open in frame creator */}
              {activeSidebarTab === 'frames' && isFrameCreatorSaving && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 9999,
                    cursor: 'not-allowed',
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              )}

              {/* In frame creation mode, render editable zones */}
              {activeSidebarTab === 'frames' ? (
                currentFrame.zones.map((zone, index) => (
                  <EditableZone
                    key={zone.id}
                    zone={zone}
                    zIndex={40 + index}
                    frameWidth={currentFrame.width}
                    frameHeight={currentFrame.height}
                    isSelected={selectedZone === zone.id}
                    onSelect={() => setSelectedZone(zone.id)}
                    onUpdate={(updates) => {
                      const updated = currentFrame.zones.map(z =>
                        z.id === zone.id ? { ...z, ...updates } : z
                      );
                      setCurrentFrame({ ...currentFrame, zones: updated });
                    }}
                  />
                ))
              ) : (
                <>
                  {/* Image Zones - render non-selected first, then selected */}
                  {currentFrame.zones.map((zone) => {
                    if (selectedZone === zone.id) return null;
                    return <ImageZone key={zone.id} zone={zone} />;
                  })}
                </>
              )}

              {/* Selected zone overflow - renders on top of non-selected zones */}
              {activeSidebarTab !== 'frames' && selectedZone && (() => {
                const zone = currentFrame.zones.find(z => z.id === selectedZone);
                const placedImage = zone ? placedImages.get(zone.id) : null;
                if (!zone || !placedImage) return null;
                return (
                  <ImageZoneOverflow
                    key={`${zone.id}-overflow`}
                    zone={zone}
                    placedImage={placedImage}
                  />
                );
              })()}

              {/* Selected zone - renders on top of everything */}
              {activeSidebarTab !== 'frames' && selectedZone && (() => {
                const zone = currentFrame.zones.find(z => z.id === selectedZone);
                if (!zone) return null;
                return <ImageZone key={zone.id} zone={zone} />;
              })()}

              {/* Overlay Layers - Above Frames (z-index: 61-99) */}
              {overlays
                .filter(o => o.position === 'above-frames' && o.visible)
                .sort((a, b) => a.layerOrder - b.layerOrder)
                .map((layer) => (
                  <OverlayLayerComponent
                    key={layer.id}
                    layer={layer}
                    isSelected={selectedOverlayId === layer.id}
                    canvasWidth={width}
                    canvasHeight={height}
                    zIndex={61 + layer.layerOrder}
                    interactive={activeSidebarTab === 'layers'}
                    onSnapGuidesChange={setOverlaySnapGuides}
                    onSelect={() => {
                      setSelectedOverlayId(layer.id);
                      setSelectedZone(null);
                      setIsBackgroundSelected(false);
                      setActiveSidebarTab('layers');
                    }}
                  />
                ))
              }
            </div>

            {/* Overlay Snap Guides - shown when dragging overlay near center */}
            {(overlaySnapGuides.centerH || overlaySnapGuides.centerV) && selectedOverlayId && (
              <>
                {overlaySnapGuides.centerH && (
                  <div className="snap-guide snap-guide-vertical" style={{
                    position: 'absolute',
                    left: '50%',
                    top: 0,
                    height: '100%',
                    transform: 'translateX(-50%)',
                    pointerEvents: 'none',
                    zIndex: 200,
                  }} />
                )}
                {overlaySnapGuides.centerV && (
                  <div className="snap-guide snap-guide-horizontal" style={{
                    position: 'absolute',
                    top: '50%',
                    left: 0,
                    width: '100%',
                    transform: 'translateY(-50%)',
                    pointerEvents: 'none',
                    zIndex: 200,
                  }} />
                )}
              </>
            )}

            {/* Canvas Info Box - rendered outside scaled inner canvas for consistent sizing */}
            <div className="canvas-info">
              <span className="canvas-frame-name">
                {autoMatchBackground && backgroundDimensions
                  ? 'Automatic'
                  : canvasSize?.name || currentFrame?.name || 'Custom'}
              </span>
              <span className="canvas-dimensions">
                {autoMatchBackground && backgroundDimensions
                  ? `${backgroundDimensions.width} × ${backgroundDimensions.height}px`
                  : `${width} × ${height}px`
                }
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Floating Frame Selector - Always render */}
      <FloatingFrameSelector />
    </motion.div>
  );
}
