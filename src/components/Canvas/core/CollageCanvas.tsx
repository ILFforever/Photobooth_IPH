import { useRef, useMemo, useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { useCollage } from "../../../contexts";
import { FrameZone } from "../../../types/frame";
import { FloatingFrameSelector } from "../frames";
import { OverlayLayer as OverlayLayerComponent } from "../tools/OverlayLayer";
import { createLogger } from "../../../utils/logger";
import { BackgroundLayer } from "./BackgroundLayer";
import { EditableZone } from "./EditableZone";
import { ImageZone } from "./ImageZone";
import { ImageZoneOverflow } from "./ImageZoneOverflow";
import "./CollageCanvas.css";

const logger = createLogger("CollageCanvas");

interface CollageCanvasProps {
  width?: number;
  height?: number;
}

export default function CollageCanvas({ width: propWidth, height: propHeight }: CollageCanvasProps) {
  const {
    currentFrame,
    setCurrentFrame,
    background,
    canvasSize,
    backgroundTransform,
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
    snapEnabled,
  } = useCollage();

  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [localZoom, setLocalZoom] = useState(canvasZoom);
  const [zoomCenter, setZoomCenter] = useState({ x: 0, y: 0 });

  // Overlay snap guides state
  const [overlaySnapGuides, setOverlaySnapGuides] = useState({ centerH: false, centerV: false });

  const prevZoomRef = useRef(canvasZoom);
  // Use refs to store latest values for completely stable callbacks
  // (breaks stale-closure cycles in event listeners — do not extract to a separate hook)
  const localZoomRef = useRef(localZoom);
  const setCanvasZoomRef = useRef(setCanvasZoom);
  const setLocalZoomRef = useRef(setLocalZoom);
  const setZoomCenterRef = useRef(setZoomCenter);

  // Use canvas size from context, falling back to props or auto-match background dimensions
  const width = propWidth ?? (autoMatchBackground && backgroundDimensions ? backgroundDimensions.width : canvasSize?.width);
  const height = propHeight ?? (autoMatchBackground && backgroundDimensions ? backgroundDimensions.height : canvasSize?.height);

  // Handle drop for frame creation zones
  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      if (activeSidebarTab !== "frames") return;

      const zoneData = e.dataTransfer.getData("zone");
      if (!zoneData) return;

      const zoneConfig = JSON.parse(zoneData);

      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;

      const dropX = e.clientX - canvasRect.left;
      const dropY = e.clientY - canvasRect.top;

      const internalWidth = width;
      const internalHeight = height;

      if (!internalWidth || !internalHeight) return;

      const scaleX = internalWidth / canvasRect.width;
      const scaleY = internalHeight / canvasRect.height;

      const canvasX = dropX * scaleX;
      const canvasY = dropY * scaleY;

      const newZone: FrameZone = {
        id: `zone-${Date.now()}`,
        x: Math.round(Math.max(0, canvasX - 150)),
        y: Math.round(Math.max(0, canvasY - 150)),
        width: 300,
        height: 300,
        rotation: 0,
        shape: zoneConfig.shape || "rectangle",
      };

      if (currentFrame) {
        setCurrentFrame({
          ...currentFrame,
          zones: [...currentFrame.zones, newZone],
        });
      }
    },
    [activeSidebarTab, width, height, currentFrame, setCurrentFrame],
  );

  const handleCanvasDragOver = useCallback(
    (e: React.DragEvent) => {
      if (activeSidebarTab === "frames") {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    },
    [activeSidebarTab],
  );

  // Keep zoom refs in sync with latest functions and values
  useEffect(() => {
    setLocalZoom(canvasZoom);
    localZoomRef.current = canvasZoom;
    setCanvasZoomRef.current = setCanvasZoom;
    setLocalZoomRef.current = setLocalZoom;
    setZoomCenterRef.current = setZoomCenter;
  }, [canvasZoom, setCanvasZoom, setLocalZoom, setZoomCenter]);

  // Handle Ctrl+Scroll to zoom from mouse position
  // NOTE: Uses ref pattern for stability — do not extract to a separate hook
  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const relativeX = (mouseX - centerX) / centerX;
      const relativeY = (mouseY - centerY) / centerY;

      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const currentZoom = localZoomRef.current;
      const newZoom = Math.max(0.5, Math.min(3, currentZoom + delta));

      setZoomCenterRef.current({ x: relativeX, y: relativeY });
      setLocalZoomRef.current(newZoom);
      setCanvasZoomRef.current(newZoom);
    }
  }, []); // No dependencies — completely stable

  // Handle touch pad pinch gesture
  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY,
      );
      (e.currentTarget as HTMLElement).dataset.pinchDistance = distance.toString();
    }
  }, []); // No dependencies — completely stable

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY,
      );
      const initialDistance = parseFloat(
        (e.currentTarget as HTMLElement).dataset.pinchDistance || "0",
      );

      if (initialDistance > 0) {
        const delta = (distance - initialDistance) * 0.01;
        const currentZoom = localZoomRef.current;
        const newZoom = Math.max(0.5, Math.min(3, currentZoom + delta));
        setLocalZoomRef.current(newZoom);
        setCanvasZoomRef.current(newZoom);
        (e.currentTarget as HTMLElement).dataset.pinchDistance = distance.toString();
      }
    }
  }, []); // No dependencies — completely stable

  // Register wheel/touch listeners on the canvas element
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener("wheel", handleWheel, { passive: false });
      canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
      canvas.addEventListener("touchmove", handleTouchMove, { passive: false });

      return () => {
        canvas.removeEventListener("wheel", handleWheel);
        canvas.removeEventListener("touchstart", handleTouchStart);
        canvas.removeEventListener("touchmove", handleTouchMove);
      };
    }
  }, [currentFrame, handleWheel, handleTouchStart, handleTouchMove]);

  // Handle keyboard shortcuts for copy/paste/delete zones (frame creator mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeSidebarTab !== "frames") return;

      if ((e.ctrlKey || e.metaKey) && e.key === "c" && selectedZone && currentFrame) {
        const zone = currentFrame.zones.find((z) => z.id === selectedZone);
        if (zone) {
          setCopiedZone(zone);
          logger.debug("Zone copied:", zone);
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "v" && copiedZone && currentFrame) {
        const existingNumbers = currentFrame.zones
          .map((zone) => {
            const match = zone.id.match(/zone-(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter((num) => num > 0);
        const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
        const nextZoneId = `zone-${maxNumber + 1}`;

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
        setSelectedZone(newZone.id);
        logger.debug("Zone pasted:", newZone);
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedZone && currentFrame) {
        e.preventDefault();
        const updatedZones = currentFrame.zones.filter((z) => z.id !== selectedZone);
        setCurrentFrame({ ...currentFrame, zones: updatedZones });
        setSelectedZone(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSidebarTab, selectedZone, copiedZone, currentFrame, setCopiedZone, setCurrentFrame, setSelectedZone]);

  // Auto-scroll to zoom center when zooming
  // Ensures the point under the mouse stays stable during zoom
  useEffect(() => {
    if (prevZoomRef.current !== localZoom) {
      prevZoomRef.current = localZoom;

      const canvas = canvasRef.current;
      if (canvas) {
        setTimeout(() => {
          const scrollableParent = canvas?.closest(".tab-content") as HTMLElement;

          if (scrollableParent) {
            const canvasRect = canvas.getBoundingClientRect();
            const viewportRect = scrollableParent.getBoundingClientRect();

            const currentScrollTop = scrollableParent.scrollTop;
            const currentScrollLeft = scrollableParent.scrollLeft;

            const canvasMiddleY =
              canvasRect.top - viewportRect.top + currentScrollTop + canvasRect.height / 2;
            const viewportMiddleY = viewportRect.height / 2;

            const targetOffsetY = zoomCenter.y * (canvasRect.height / 2);
            const targetPointY = canvasMiddleY + targetOffsetY;
            const newScrollTop = targetPointY - viewportMiddleY;

            logger.debug("=== Zoom-to-Point ===");
            logger.debug("zoomCenter:", zoomCenter);
            logger.debug("canvasMiddleY:", canvasMiddleY, "targetOffsetY:", targetOffsetY);
            logger.debug("currentScrollTop:", currentScrollTop, "newScrollTop:", newScrollTop);
            logger.debug("====================");

            scrollableParent.scrollTo({
              left: currentScrollLeft,
              top: newScrollTop,
              behavior: "instant",
            });
          }
        }, 0);
      }
    }
  }, [localZoom, zoomCenter]);

  // Zoom button handlers
  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(3, localZoom + 0.25);
    setLocalZoom(newZoom);
    localZoomRef.current = newZoom;
    setCanvasZoomRef.current(newZoom);
  }, [localZoom]);

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(0.5, localZoom - 0.25);
    setLocalZoom(newZoom);
    localZoomRef.current = newZoom;
    setCanvasZoomRef.current(newZoom);
  }, [localZoom]);

  const handleResetZoom = useCallback(() => {
    setLocalZoom(1);
    localZoomRef.current = 1;
    setCanvasZoomRef.current(1);
  }, []);

  // If no dimensions available, don't render canvas
  if (!width || !height) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="collage-canvas-container"
        style={{ flex: "1", display: "flex", flexDirection: "column" }}
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

  const zoomGrowth = Math.max(0, localZoom - 0.5);
  const spacing = zoomGrowth * scaledHeight * 0.5;

  const containerStyle = {
    width: "100%",
    display: "flex" as const,
    flexDirection: "column" as const,
    justifyContent: "flex-start" as const,
    alignItems: "center" as const,
    padding: "24px",
    flex: "1" as const,
    boxSizing: "border-box" as const,
    overflow: "visible" as const,
  };

  const canvasStyle = {
    width: `${scaledWidth}px`,
    height: `${scaledHeight}px`,
    position: "relative" as const,
    background: "#ffffff",
    boxShadow:
      "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
    borderRadius: "4px",
    overflow: "hidden",
    flexShrink: 0 as const,
  };

  const innerCanvasStyle = {
    width: `${width}px`,
    height: `${height}px`,
    position: "relative" as const,
    overflow: "hidden",
    borderRadius: "4px",
    transform: `scale(${finalScale})`,
    transformOrigin: "top left",
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="collage-canvas-container"
      style={{ flex: "1", display: "flex", flexDirection: "column" }}
    >
      {/* Floating zoom controls */}
      {background && (
        <div className="collage-zoom-controls" onClick={(e) => e.stopPropagation()}>
          <button
            className="finalize-zoom-btn"
            onClick={handleZoomOut}
            disabled={localZoom <= 0.5}
            title="Zoom out (Ctrl + Scroll down)"
          >
            <ZoomOut size={14} />
          </button>
          <span className="finalize-zoom-level">{Math.round(localZoom * 100)}%</span>
          <button
            className="finalize-zoom-btn"
            onClick={handleZoomIn}
            disabled={localZoom >= 3}
            title="Zoom in (Ctrl + Scroll up)"
          >
            <ZoomIn size={14} />
          </button>
          <button
            className="finalize-zoom-btn"
            onClick={handleResetZoom}
            disabled={localZoom === 1}
            title="Reset zoom"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      )}

      {!background ? (
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
            setSelectedZone(null);
            setIsBackgroundSelected(false);
            setSelectedOverlayId(null);
          }}
        >
          {/* Invisible spacer to allow scrolling when zoomed */}
          {spacing > 0 && <div style={{ height: `${spacing}px`, flexShrink: 0 }} />}

          <div
            ref={canvasRef}
            style={canvasStyle}
            className="collage-canvas"
            onDrop={handleCanvasDrop}
            onDragOver={handleCanvasDragOver}
          >
            <div style={innerCanvasStyle}>
              {/* Background Layer */}
              <BackgroundLayer />

              {/* Overlay Layers — Below Frames (z-index: 10-39) */}
              {overlays
                .filter((o) => o.position === "below-frames" && o.visible)
                .sort((a, b) => a.layerOrder - b.layerOrder)
                .map((layer) => (
                  <OverlayLayerComponent
                    key={layer.id}
                    layer={layer}
                    isSelected={selectedOverlayId === layer.id}
                    canvasWidth={width}
                    canvasHeight={height}
                    zIndex={10 + layer.layerOrder}
                    interactive={activeSidebarTab === "layers"}
                    onSnapGuidesChange={setOverlaySnapGuides}
                    onSelect={() => {
                      setSelectedOverlayId(layer.id);
                      setSelectedZone(null);
                      setIsBackgroundSelected(false);
                      setActiveSidebarTab("layers");
                    }}
                  />
                ))}

              {/* Interaction blocker when save dialog is open in frame creator */}
              {activeSidebarTab === "frames" && isFrameCreatorSaving && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 9999,
                    cursor: "not-allowed",
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              )}

              {/* Frame creator mode: render editable zones */}
              {activeSidebarTab === "frames" && currentFrame ? (
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
                      const updated = currentFrame.zones.map((z) =>
                        z.id === zone.id ? { ...z, ...updates } : z,
                      );
                      setCurrentFrame({ ...currentFrame, zones: updated });
                    }}
                    scale={finalScale}
                    snapEnabled={snapEnabled}
                  />
                ))
              ) : activeSidebarTab !== "frames" && currentFrame ? (
                <>
                  {/* Image Zones — render non-selected zones first */}
                  {currentFrame.zones
                    .filter((zone) => zone.id !== selectedZone)
                    .map((zone) => (
                      <ImageZone key={zone.id} zone={zone} />
                    ))}
                </>
              ) : null}

              {/* Selected zone overflow — renders on top of non-selected zones */}
              {activeSidebarTab !== "frames" &&
                selectedZone &&
                currentFrame &&
                (() => {
                  const zone = currentFrame.zones.find((z) => z.id === selectedZone);
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

              {/* Selected zone — renders on top of everything */}
              {activeSidebarTab !== "frames" &&
                selectedZone &&
                currentFrame &&
                (() => {
                  const zone = currentFrame.zones.find((z) => z.id === selectedZone);
                  if (!zone) return null;
                  return <ImageZone key={`${zone.id}-selected`} zone={zone} />;
                })()}

              {/* Overlay Layers — Above Frames (z-index: 61-99) */}
              {overlays
                .filter((o) => o.position === "above-frames" && o.visible)
                .sort((a, b) => a.layerOrder - b.layerOrder)
                .map((layer) => (
                  <OverlayLayerComponent
                    key={layer.id}
                    layer={layer}
                    isSelected={selectedOverlayId === layer.id}
                    canvasWidth={width}
                    canvasHeight={height}
                    zIndex={61 + layer.layerOrder}
                    interactive={activeSidebarTab === "layers"}
                    onSnapGuidesChange={setOverlaySnapGuides}
                    onSelect={() => {
                      setSelectedOverlayId(layer.id);
                      setSelectedZone(null);
                      setIsBackgroundSelected(false);
                      setActiveSidebarTab("layers");
                    }}
                  />
                ))}
            </div>

            {/* Overlay Snap Guides — shown when dragging overlay near center */}
            {(overlaySnapGuides.centerH || overlaySnapGuides.centerV) && selectedOverlayId && (
              <>
                {overlaySnapGuides.centerH && (
                  <div
                    className="snap-guide snap-guide-vertical"
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: 0,
                      height: "100%",
                      transform: "translateX(-50%)",
                      pointerEvents: "none",
                      zIndex: 200,
                    }}
                  />
                )}
                {overlaySnapGuides.centerV && (
                  <div
                    className="snap-guide snap-guide-horizontal"
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: 0,
                      width: "100%",
                      transform: "translateY(-50%)",
                      pointerEvents: "none",
                      zIndex: 200,
                    }}
                  />
                )}
              </>
            )}

            {/* Canvas Info Box — rendered outside scaled inner canvas for consistent sizing */}
            <div className="canvas-info">
              <span className="canvas-frame-name">
                {autoMatchBackground && backgroundDimensions
                  ? "Automatic"
                  : canvasSize?.name || currentFrame?.name || "Custom"}
              </span>
              <span className="canvas-dimensions">
                {autoMatchBackground && backgroundDimensions
                  ? `${backgroundDimensions.width} × ${backgroundDimensions.height}px`
                  : `${width} × ${height}px`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Floating Frame Selector — Always render */}
      <FloatingFrameSelector />
    </motion.div>
  );
}
