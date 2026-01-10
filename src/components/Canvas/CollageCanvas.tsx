import { useRef, useMemo, useState, useCallback, useEffect } from "react";
import { useDrop } from "react-dnd";
import { motion } from "framer-motion";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useCollage } from "../../contexts/CollageContext";
import { FrameZone } from "../../types/frame";
import { DEFAULT_TRANSFORM } from "../../types/collage";
import FloatingFrameSelector from "./FloatingFrameSelector";
import "./CollageCanvas.css";

interface CollageCanvasProps {
  width?: number;
  height?: number;
}

interface ImageZoneProps {
  zone: FrameZone;
}

// Individual image zone with drop target
function ImageZone({ zone }: ImageZoneProps) {
  const { placedImages, addPlacedImage, selectedZone, setSelectedZone, updatePlacedImage, canvasSize } = useCollage();
  const placedImage = placedImages.get(zone.id);
  const dropRef = useRef<HTMLDivElement>(null);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [transformStart, setTransformStart] = useState({ x: 0, y: 0 });

  // Convert file paths to Tauri-compatible URLs (use full sourceFile, not thumbnail)
  const imageSrc = useMemo(() => {
    if (!placedImage) return null;
    const src = placedImage.sourceFile;
    return convertFileSrc(src.replace('asset://', ''));
  }, [placedImage]);

  const [{ isOver, canDrop }, drop] = useDrop({
    accept: 'IMAGE',
    drop: (item: { path: string; thumbnail: string; dimensions?: { width: number; height: number } }) => {
      // Calculate scale to fill the zone
      let scale = 1.0;
      if (item.dimensions) {
        const imgAspectRatio = item.dimensions.width / item.dimensions.height;

        // Calculate actual zone dimensions in pixels for correct aspect ratio
        const zoneWidthPx = (zone.width / 100) * canvasSize.width;
        const zoneHeightPx = (zone.height / 100) * canvasSize.height;
        const zoneAspectRatio = zoneWidthPx / zoneHeightPx;

        // Debug logging
        console.log('=== DROP DEBUG ===');
        console.log('Image dimensions:', item.dimensions.width, 'x', item.dimensions.height);
        console.log('Image aspect ratio:', imgAspectRatio.toFixed(4));
        console.log('Zone dimensions (%):', zone.width, 'x', zone.height);
        console.log('Zone dimensions (px):', zoneWidthPx.toFixed(0), 'x', zoneHeightPx.toFixed(0));
        console.log('Zone aspect ratio:', zoneAspectRatio.toFixed(4));

        // With objectFit: 'contain':
        // - If img > zone (aspect ratio wise): img height fills zone height, we scale by img.aspect/zone.aspect
        // - If zone > img (aspect ratio wise): img width fills zone width, we scale by zone.aspect/img.aspect
        scale = imgAspectRatio > zoneAspectRatio
          ? imgAspectRatio / zoneAspectRatio
          : zoneAspectRatio / imgAspectRatio;

        console.log('Calculated scale:', scale.toFixed(4));
        console.log('==================');
      }

      addPlacedImage(zone.id, {
        sourceFile: item.path,
        thumbnail: item.thumbnail,
        zoneId: zone.id,
        transform: { ...DEFAULT_TRANSFORM, scale },
      });
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
        updatePlacedImage(zone.id, {
          transform: {
            ...placedImage.transform,
            offsetX: transformStart.x + deltaX,
            offsetY: transformStart.y + deltaY,
          },
        });
      };

      const handleGlobalMouseUp = () => {
        setIsDraggingImage(false);
      };

      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [isDraggingImage, dragStart, transformStart, placedImage, zone.id, updatePlacedImage]);

  const zoneStyle = {
    position: 'absolute' as const,
    left: `${zone.x}%`,
    top: `${zone.y}%`,
    width: `${zone.width}%`,
    height: `${zone.height}%`,
    transform: `rotate(${zone.rotation}deg)`,
    border: selectedZone === zone.id ? '3px solid var(--accent-blue)' : '2px dashed rgba(255, 255, 255, 0.3)',
    borderRadius: '8px',
    backgroundColor: isOver ? 'rgba(59, 130, 246, 0.2)' : 'rgba(0, 0, 0, 0.1)',
    cursor: 'pointer',
    overflow: 'hidden',
    transition: 'all 0.2s ease',
  };

  return (
    <div
      ref={dropRef}
      style={zoneStyle}
      onClick={() => setSelectedZone(zone.id)}
      className="image-zone"
    >
      {placedImage && imageSrc ? (
        <img
          src={imageSrc}
          alt="Placed"
          draggable={false}
          onMouseDown={handleImageMouseDown}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            cursor: isDraggingImage ? 'grabbing' : 'grab',
            transform: `
              scale(${placedImage.transform.scale})
              translate(${placedImage.transform.offsetX}px, ${placedImage.transform.offsetY}px)
              rotate(${placedImage.transform.rotation}deg)
              scaleX(${placedImage.transform.flipHorizontal ? -1 : 1})
              scaleY(${placedImage.transform.flipVertical ? -1 : 1})
            `,
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: '14px',
            pointerEvents: 'none',
          }}
        >
          {canDrop ? 'Drop here' : 'Drag image here'}
        </div>
      )}
    </div>
  );
}

export default function CollageCanvas({ width: propWidth, height: propHeight }: CollageCanvasProps) {
  const { currentFrame, background, canvasSize } = useCollage();
  const canvasRef = useRef<HTMLDivElement>(null);

  // Use canvas size from context, falling back to props
  const width = propWidth ?? canvasSize.width;
  const height = propHeight ?? canvasSize.height;

  // Calculate scale to fit canvas in viewport
  const maxContainerWidth = 600;
  const maxContainerHeight = 900;

  const scaleX = maxContainerWidth / width;
  const scaleY = maxContainerHeight / height;
  const scale = Math.min(scaleX, scaleY, 1);

  const containerStyle = {
    width: `${width * scale}px`,
    height: `${height * scale}px`,
    position: 'relative' as const,
    margin: '0 auto',
  };

  const canvasStyle = {
    width: `${width}px`,
    height: `${height}px`,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    position: 'relative' as const,
    backgroundColor: background || '#ffffff',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    borderRadius: '4px',
    overflow: 'hidden',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="collage-canvas-container"
    >
      {!currentFrame ? (
        <div className="canvas-placeholder">
          <div className="placeholder-content">
            <span className="placeholder-icon">🖼️</span>
            <h3>No Frame Selected</h3>
            <p>Choose a frame template to start creating your collage</p>
          </div>
        </div>
      ) : (
        <div style={containerStyle}>
          <div ref={canvasRef} style={canvasStyle} className="collage-canvas">
            {/* Background Layer */}
            <div className="canvas-background" style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: background || '#ffffff',
            }} />

            {/* Image Zones */}
            {currentFrame.zones.map((zone) => (
              <ImageZone key={zone.id} zone={zone} />
            ))}

            {/* Frame Info Overlay */}
            <div className="canvas-info">
              <span className="canvas-frame-name">{currentFrame.name}</span>
              <span className="canvas-dimensions">{width} × {height}px</span>
            </div>
          </div>
        </div>
      )}

      {/* Floating Frame Selector - Always render */}
      <FloatingFrameSelector />
    </motion.div>
  );
}
