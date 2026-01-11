import { useRef, useMemo, useState, useCallback, useEffect } from "react";
import { useDrop } from "react-dnd";
import { motion } from "framer-motion";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useCollage } from "../../contexts/CollageContext";
import { FrameZone } from "../../types/frame";
import { DEFAULT_TRANSFORM } from "../../types/collage";
import { Background } from "../../types/background";
import FloatingFrameSelector from "./FloatingFrameSelector";
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
  const { background, canvasSize, backgroundTransform, setBackgroundTransform, isBackgroundSelected, setIsBackgroundSelected } = useCollage();
  const bgRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [transformStart, setTransformStart] = useState({ x: 0, y: 0 });
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
    e.stopPropagation();
    setIsDragging(true);
    setIsBackgroundSelected(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setTransformStart({ x: backgroundTransform.offsetX, y: backgroundTransform.offsetY });
  }, [background, backgroundTransform, setIsBackgroundSelected]);

  // Set up global mouse event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      const handleGlobalMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        let newOffsetX = transformStart.x + deltaX;
        let newOffsetY = transformStart.y + deltaY;

        // Snap to center
        const containerWidth = bgRef.current?.offsetWidth || 0;
        const containerHeight = bgRef.current?.offsetHeight || 0;
        const containerCenterX = containerWidth / 2;
        const containerCenterY = containerHeight / 2;

        const snapToCenterX = Math.abs(newOffsetX) < SNAP_THRESHOLD;
        const snapToCenterY = Math.abs(newOffsetY) < SNAP_THRESHOLD;

        if (snapToCenterX) newOffsetX = 0;
        if (snapToCenterY) newOffsetY = 0;

        setBackgroundTransform({
          ...backgroundTransform,
          offsetX: newOffsetX,
          offsetY: newOffsetY,
        });
      };

      const handleGlobalMouseUp = () => {
        setIsDragging(false);
      };

      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [isDragging, dragStart, transformStart, backgroundTransform, setBackgroundTransform, SNAP_THRESHOLD]);

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
        setIsBackgroundSelected(true);
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
  const { placedImages, addPlacedImage, selectedZone, setSelectedZone, updatePlacedImage, canvasSize, setIsBackgroundSelected } = useCollage();
  const placedImage = placedImages.get(zone.id);
  const dropRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [transformStart, setTransformStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0, left: 0, top: 0 });
  const [snapGuides, setSnapGuides] = useState({ horizontal: false, vertical: false, centerH: false, centerV: false });
  const SNAP_THRESHOLD = 10; // pixels

  // Convert file paths to Tauri-compatible URLs (use full sourceFile, not thumbnail)
  const imageSrc = useMemo(() => {
    if (!placedImage) return null;
    const src = placedImage.sourceFile;
    const convertedSrc = convertFileSrc(src.replace('asset://', ''));
    console.log('=== IMAGE SOURCE CONVERSION ===');
    console.log('Zone ID:', zone.id);
    console.log('Original sourceFile:', src);
    console.log('Converted src:', convertedSrc);
    console.log('===============================');
    return convertedSrc;
  }, [placedImage, zone.id]);

  const [{ isOver, canDrop }, drop] = useDrop({
    accept: 'IMAGE',
    drop: (item: { path: string; thumbnail: string; dimensions?: { width: number; height: number } }) => {
      console.log('=== IMAGE DROP ===');
      console.log('Zone ID:', zone.id);
      console.log('Item path:', item.path);
      console.log('Item thumbnail:', item.thumbnail);
      console.log('Item dimensions:', item.dimensions);
      console.log('==================');

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

      // Round scale to nearest 0.1, round up for values like 1.21 -> 1.2, 1.25 -> 1.3, 1.45 -> 1.5
      const scaleRounded = Math.ceil(scale * 10) / 10;
      console.log('Final rounded scale:', scaleRounded.toFixed(1));

      const placedImageData = {
        sourceFile: item.path,
        thumbnail: item.thumbnail,
        zoneId: zone.id,
        transform: { ...DEFAULT_TRANSFORM, scale: scaleRounded },
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

        // Calculate snap points
        const containerWidth = dropRef.current?.offsetWidth || 0;
        const containerHeight = dropRef.current?.offsetHeight || 0;
        const imgWidth = imageSize.width;
        const imgHeight = imageSize.height;

        // Snap to center (when image center aligns with container center)
        // Image center is at: imgLeft + imgWidth/2 + newOffsetX
        // Container center is at: containerWidth/2
        const imageCenterX = imageSize.left + imgWidth / 2 + newOffsetX;
        const imageCenterY = imageSize.top + imgHeight / 2 + newOffsetY;
        const containerCenterX = containerWidth / 2;
        const containerCenterY = containerHeight / 2;

        const snapToCenterH = Math.abs(imageCenterX - containerCenterX) < SNAP_THRESHOLD;
        const snapToCenterV = Math.abs(imageCenterY - containerCenterY) < SNAP_THRESHOLD;

        if (snapToCenterH) {
          newOffsetX = containerCenterX - imageSize.left - imgWidth / 2;
        }
        if (snapToCenterV) {
          newOffsetY = containerCenterY - imageSize.top - imgHeight / 2;
        }

        // Snap to edges (when image edges align with container edges)
        // Left edge: imgLeft + newOffsetX = 0
        // Right edge: imgLeft + imgWidth + newOffsetX = containerWidth
        const snapToLeft = Math.abs(imageSize.left + newOffsetX) < SNAP_THRESHOLD;
        const snapToRight = Math.abs(imageSize.left + imgWidth + newOffsetX - containerWidth) < SNAP_THRESHOLD;
        const snapToTop = Math.abs(imageSize.top + newOffsetY) < SNAP_THRESHOLD;
        const snapToBottom = Math.abs(imageSize.top + imgHeight + newOffsetY - containerHeight) < SNAP_THRESHOLD;

        if (snapToLeft) newOffsetX = -imageSize.left;
        if (snapToRight) newOffsetX = containerWidth - imageSize.left - imgWidth;
        if (snapToTop) newOffsetY = -imageSize.top;
        if (snapToBottom) newOffsetY = containerHeight - imageSize.top - imgHeight;

        // Update snap guides for visual feedback
        setSnapGuides({
          horizontal: snapToLeft || snapToRight, // Horizontal line when left/right edges snap
          vertical: snapToTop || snapToBottom,     // Vertical line when top/bottom edges snap
          centerH: snapToCenterH,                  // Vertical line through center when horizontally centered
          centerV: snapToCenterV,                  // Horizontal line through center when vertically centered
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

        setImageSize({ width: renderWidth, height: renderHeight, left: offsetX, top: offsetY });
      };

      updateImageSize();
      window.addEventListener('resize', updateImageSize);
      return () => window.removeEventListener('resize', updateImageSize);
    }
  }, [placedImage, imageSrc]);

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
      onClick={() => {
        setSelectedZone(zone.id);
        setIsBackgroundSelected(false);
      }}
      className="image-zone"
    >
      {placedImage && imageSrc ? (
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
  const { currentFrame, background, canvasSize, backgroundTransform, setBackgroundTransform, isBackgroundSelected, setIsBackgroundSelected, canvasZoom, setCanvasZoom } = useCollage();
  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [localZoom, setLocalZoom] = useState(canvasZoom);

  // Sync local zoom with context
  useEffect(() => {
    setLocalZoom(canvasZoom);
  }, [canvasZoom]);

  // Handle Ctrl+Scroll to zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newZoom = Math.max(0.5, Math.min(3, localZoom + delta));
      setLocalZoom(newZoom);
      setCanvasZoom(newZoom);
    }
  }, [localZoom, setCanvasZoom]);

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
  }, []);

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
        const newZoom = Math.max(0.5, Math.min(3, localZoom + delta));
        setLocalZoom(newZoom);
        setCanvasZoom(newZoom);
        (e.currentTarget as HTMLElement).dataset.pinchDistance = distance.toString();
      }
    }
  }, [localZoom, setCanvasZoom]);

  // Add event listeners for zoom
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
  }, [handleWheel, handleTouchStart, handleTouchMove]);

  // Debug: Log background changes
  useEffect(() => {
    console.log('=== CollageCanvas Background Changed ===');
    console.log('Background value:', background);
    console.log('Background type:', typeof background);
    console.log('=============================');
  }, [background]);

  // Use canvas size from context, falling back to props
  const width = propWidth ?? canvasSize.width;
  const height = propHeight ?? canvasSize.height;

  // Calculate scale to fit canvas in viewport
  const maxContainerWidth = 600;
  const maxContainerHeight = 900;

  const scaleX = maxContainerWidth / width;
  const scaleY = maxContainerHeight / height;
  const baseScale = Math.min(scaleX, scaleY, 1);

  const finalScale = baseScale * localZoom;

  const scaledWidth = width * finalScale;
  const scaledHeight = height * finalScale;

  const containerStyle = {
    width: '100%',
    display: 'flex' as const,
    justifyContent: 'center' as const,
    alignItems: 'flex-start' as const,
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
    overflow: 'hidden',
    flexShrink: 0 as const,
  };

  const innerCanvasStyle = {
    width: '100%',
    height: '100%',
    position: 'relative' as const,
  };

  // Auto-scroll to center when zoom changes
  useEffect(() => {
    if (containerRef.current && localZoom > 1) {
      setTimeout(() => {
        const container = containerRef.current;
        const scrollableParent = container?.closest('.tab-content') as HTMLElement;

        if (scrollableParent && container) {
          const containerRect = container.getBoundingClientRect();
          const parentRect = scrollableParent.getBoundingClientRect();

          // Calculate the center of the canvas
          const canvasCenterY = containerRect.top - parentRect.top + (scaledHeight / 2);

          // Get the parent's center
          const parentCenterY = parentRect.height / 2;

          // Calculate scroll position to center the canvas
          const targetScrollTop = Math.max(0, canvasCenterY - parentCenterY);

          scrollableParent.scrollTo({
            top: targetScrollTop,
            behavior: 'instant'
          });
        }
      }, 0);
    }
  }, [localZoom, scaledHeight]);

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
      ) : (
        <div ref={containerRef} style={containerStyle}>
          <div ref={canvasRef} style={canvasStyle} className="collage-canvas">
            <div style={innerCanvasStyle}>
              {/* Background Layer - rendered as transformable image */}
              <BackgroundLayer />

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
        </div>
      )}

      {/* Floating Frame Selector - Always render */}
      <FloatingFrameSelector />
    </motion.div>
  );
}
