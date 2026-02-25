import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ChevronLeft, Monitor, MonitorOff, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { Frame, FrameZone } from "../../types/frame";
import { PlacedImage } from "../../types/collage";
import { usePhotobooth } from "../../contexts/PhotoboothContext";
import { autoPlacePhotos, PhotoForPlacement } from "../../utils/autoPlacement";
import { useToast } from "../../contexts/ToastContext";
import "./FinalizeView.css";

interface CurrentSetPhoto {
  id: string;
  thumbnailUrl: string;
  fullUrl?: string;
  timestamp: string;
}

interface FinalizeViewProps {
  frame: Frame;
  selectedPhotos: CurrentSetPhoto[];
  workingFolder: string;
  sessionFolderName: string;
  onBack: () => void;
  updateGuestDisplay: (data: {
    currentSetPhotos?: Array<{ id: string; thumbnailUrl: string; fullUrl?: string; timestamp: string }>;
    selectedPhotoIndex?: number | null;
    displayMode?: 'single' | 'center' | 'canvas' | 'finalize';
    liveViewStream?: boolean;
    hdmiStreamActive?: boolean;
    showCapturePreview?: boolean;
    capturedPhotoUrl?: string | null;
    finalizeImageUrl?: string | null;
    finalizeQrData?: string | null;
  }) => void;
  isSecondScreenOpen: boolean;
  openSecondScreen: () => void;
  /** Base64 PNG QR code data (optional, from upload result) */
  qrData?: string | null;
}

export default function FinalizeView({
  frame,
  selectedPhotos,
  workingFolder,
  sessionFolderName,
  onBack,
  updateGuestDisplay,
  isSecondScreenOpen,
  openSecondScreen,
  qrData = null,
}: FinalizeViewProps) {
  const {
    photoboothBackground: background,
    photoboothBackgroundTransform: backgroundTransform,
    photoboothCanvasSize: canvasSize,
    photoboothOverlays: overlays,
    photoboothAutoMatchBackground: autoMatchBackground,
    photoboothBackgroundDimensions: backgroundDimensions,
    placedImages,
    setPlacedImages,
    updatePlacedImage,
    // Finalize mode state from photobooth context
    finalizeEditingZoneId: editingZoneId,
    setFinalizeEditingZoneId: setEditingZoneId,
    currentCollageFilename,
    setCurrentCollageFilename,
    exportPhotoboothCanvasAsPNG,
    isGeneratingCollage,
    setIsGeneratingCollage,
    setCollageIsDirty,
  } = usePhotobooth();
  const { showToast } = useToast();

  const [isDisplayingOnGuest, setIsDisplayingOnGuest] = useState(false);
  const [isCompositing, setIsCompositing] = useState(false);
  const [hasEverZoomed, setHasEverZoomed] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Zoom state — local to FinalizeView (same pattern as CollageCanvas)
  const [localZoom, setLocalZoom] = useState(1);
  const [zoomCenter, setZoomCenter] = useState({ x: 0, y: 0 });
  const prevZoomRef = useRef(1);
  const localZoomRef = useRef(localZoom);
  const setLocalZoomRef = useRef(setLocalZoom);
  const setZoomCenterRef = useRef(setZoomCenter);

  // Zoom control handlers
  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(3, localZoom + 0.25);
    setLocalZoom(newZoom);
    setZoomCenter({ x: 0, y: 0 });
    if (!hasEverZoomed && newZoom !== 1) {
      setHasEverZoomed(true);
    }
  }, [localZoom, hasEverZoomed]);

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(0.5, localZoom - 0.25);
    setLocalZoom(newZoom);
    setZoomCenter({ x: 0, y: 0 });
    if (!hasEverZoomed && newZoom !== 1) {
      setHasEverZoomed(true);
    }
  }, [localZoom, hasEverZoomed]);

  const handleResetZoom = useCallback(() => {
    setLocalZoom(1);
    setZoomCenter({ x: 0, y: 0 });
  }, []);

  // Canvas dimensions — same logic as CollageCanvas
  const canvasWidth = autoMatchBackground && backgroundDimensions ? backgroundDimensions.width : canvasSize?.width ?? frame.width;
  const canvasHeight = autoMatchBackground && backgroundDimensions ? backgroundDimensions.height : canvasSize?.height ?? frame.height;

  // Check if background is a solid color
  const isSolidColor = useMemo(() => {
    if (!background) return false;
    return /^#([0-9A-F]{3}){1,2}$/i.test(background);
  }, [background]);

  // Convert background path to displayable URL
  const bgSrc = useMemo(() => {
    if (!background || isSolidColor) return null;
    if (background.startsWith('http') || background.startsWith('data:')) {
      return background;
    }
    return convertFileSrc(background.replace('asset://', ''));
  }, [background, isSolidColor]);

  // Keep refs in sync
  useEffect(() => {
    localZoomRef.current = localZoom;
    setLocalZoomRef.current = setLocalZoom;
    setZoomCenterRef.current = setZoomCenter;
  }, [localZoom, setLocalZoom, setZoomCenter]);

  // Handle Ctrl+Scroll to zoom from mouse position
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
        const currentZoom = localZoomRef.current;
        const newZoom = Math.max(0.5, Math.min(3, currentZoom + delta));
        setLocalZoomRef.current(newZoom);
        (e.currentTarget as HTMLElement).dataset.pinchDistance = distance.toString();
      }
    }
  }, []);

  // Attach zoom event listeners to canvas
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

  // Handle clicks on background to deselect
  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    // Only clear selection if clicking directly on the background (not on canvas or zones)
    if (e.target === e.currentTarget) {
      setEditingZoneId(null);
    }
  }, [setEditingZoneId]);

  // Handle clicks on canvas background (between zones) to deselect
  const handleCanvasClick = useCallback(() => {
    // Clear selection when clicking on canvas background (zones will stop propagation)
    setEditingZoneId(null);
  }, [setEditingZoneId]);

  // Auto-scroll to zoom center when zooming
  useEffect(() => {
    if (prevZoomRef.current !== localZoom) {
      prevZoomRef.current = localZoom;

      // Track that user has used zoom (hide the hint)
      if (!hasEverZoomed && localZoom !== 1) {
        setHasEverZoomed(true);
      }

      const canvas = canvasRef.current;
      if (canvas) {
        setTimeout(() => {
          const scrollableParent = canvas.closest('.finalize-content') as HTMLElement;
          if (scrollableParent) {
            const canvasRect = canvas.getBoundingClientRect();
            const viewportRect = scrollableParent.getBoundingClientRect();

            const currentScrollTop = scrollableParent.scrollTop;
            const currentScrollLeft = scrollableParent.scrollLeft;

            const canvasMiddleY = canvasRect.top - viewportRect.top + currentScrollTop + (canvasRect.height / 2);
            const viewportMiddleY = viewportRect.height / 2;

            const targetOffsetY = zoomCenter.y * (canvasRect.height / 2);
            const targetPointY = canvasMiddleY + targetOffsetY;
            const newScrollTop = targetPointY - viewportMiddleY;

            scrollableParent.scrollTo({
              left: currentScrollLeft,
              top: newScrollTop,
              behavior: 'instant'
            });
          }
        }, 0);
      }
    }
  }, [localZoom, zoomCenter, hasEverZoomed]);

  // Calculate scale to fit canvas in viewport — same approach as CollageCanvas
  const maxContainerWidth = 600;
  const maxContainerHeight = 900;

  const scaleX = maxContainerWidth / canvasWidth;
  const scaleY = maxContainerHeight / canvasHeight;
  const baseScale = Math.min(scaleX, scaleY, 1);

  const finalScale = baseScale * localZoom;

  // Track previous photo IDs to prevent redundant placement
  const prevPhotoIdsRef = useRef<string>('');

  // Auto-place photos into zones on mount or when photos actually change
  useEffect(() => {
    let aborted = false;

    // Create a stable ID string from selectedPhotos to detect actual changes
    const currentPhotoIds = selectedPhotos.map(p => p.id).sort().join(',');

    // Skip if photos haven't actually changed (prevent infinite loop)
    if (currentPhotoIds === prevPhotoIdsRef.current) {
      return;
    }

    const loadAndPlace = async () => {
      const dimsMap = new Map<string, { width: number; height: number }>();

      await Promise.all(
        selectedPhotos.map(
          (photo) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              const filePath = `${workingFolder}/${sessionFolderName}/${photo.id}`;
              img.onload = () => {
                if (!aborted) {
                  dimsMap.set(photo.id, { width: img.naturalWidth, height: img.naturalHeight });
                }
                resolve();
              };
              img.onerror = () => resolve();
              img.src = convertFileSrc(filePath);
            })
        )
      );

      if (aborted) return;

      const photos: PhotoForPlacement[] = selectedPhotos.map((p) => ({
        id: p.id,
        filePath: `${workingFolder}/${sessionFolderName}/${p.id}`,
        thumbnail: p.thumbnailUrl,
      }));

      const placed = autoPlacePhotos(frame.zones, photos, dimsMap);
      if (!aborted) {
        setPlacedImages(placed);
        // Reset dirty state after auto-placement completes (fresh state, not user-modified yet)
        setCollageIsDirty(false);
        // Only update ref after successfully placing images
        prevPhotoIdsRef.current = currentPhotoIds;
      }
    };

    loadAndPlace();
    return () => { aborted = true; };
  }, [frame, selectedPhotos, workingFolder, sessionFolderName, setPlacedImages]);

  // Toggle display on guest screen
  const handleToggleDisplay = useCallback(async () => {
    if (isDisplayingOnGuest) {
      updateGuestDisplay({
        displayMode: 'center',
        finalizeImageUrl: null,
        finalizeQrData: null,
      });
      setIsDisplayingOnGuest(false);
      return;
    }

    // Check if another operation is already generating
    if (isGeneratingCollage) {
      showToast('Please wait', 'warning', 2000, 'Collage is being generated...');
      return;
    }

    // Start opening second screen early so it loads in parallel with compositing
    const justOpened = !isSecondScreenOpen;
    if (justOpened) {
      openSecondScreen();
    }

    setIsCompositing(true);
    try {
      let imageUrl: string;

      if (currentCollageFilename) {
        // Collage already saved to disk by print/QR — load directly
        const filePath = `${workingFolder}/${sessionFolderName}/${currentCollageFilename}`;
        imageUrl = convertFileSrc(filePath);
        showToast('Using cached collage', 'success', 2000, currentCollageFilename);
      } else {
        // First time: composite, save to disk, then use file URL
        setIsGeneratingCollage(true);
        const exportResult = await exportPhotoboothCanvasAsPNG();
        if (!exportResult) throw new Error('Export returned null');

        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const randomStr = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        const filename = `Collage_${randomStr}.png`;

        await invoke('save_file_to_session_folder', {
          folderPath: workingFolder,
          sessionId: sessionFolderName,
          filename,
          fileData: Array.from(exportResult.bytes),
        });

        setCurrentCollageFilename(filename);
        setIsGeneratingCollage(false);
        const filePath = `${workingFolder}/${sessionFolderName}/${filename}`;
        imageUrl = convertFileSrc(filePath);
      }

      const displayData = {
        displayMode: 'finalize' as const,
        finalizeImageUrl: imageUrl,
        finalizeQrData: qrData || null,
      };

      if (justOpened) {
        // updateGuestDisplay won't work here — isSecondScreenOpen is stale in its closure.
        // Send multiple times to ensure the guest window receives it once its listeners are ready.
        for (const delay of [500, 1000, 2000]) {
          await new Promise(resolve => setTimeout(resolve, delay));
          emitTo('guest-display', 'guest-display:update', displayData);
        }
      } else {
        updateGuestDisplay(displayData);
      }
      setIsDisplayingOnGuest(true);
    } catch (err) {
      console.error('[FinalizeView] Failed to composite frame:', err);
      setIsGeneratingCollage(false);
    } finally {
      setIsCompositing(false);
    }
  }, [isDisplayingOnGuest, isSecondScreenOpen, updateGuestDisplay, openSecondScreen, qrData, currentCollageFilename, workingFolder, sessionFolderName, exportPhotoboothCanvasAsPNG, setCurrentCollageFilename, isGeneratingCollage, showToast]);

  // Sorted overlay layers for rendering
  const belowFrameOverlays = useMemo(() =>
    overlays.filter(o => o.position === 'below-frames' && o.visible).sort((a, b) => a.layerOrder - b.layerOrder),
    [overlays]
  );
  const aboveFrameOverlays = useMemo(() =>
    overlays.filter(o => o.position === 'above-frames' && o.visible).sort((a, b) => a.layerOrder - b.layerOrder),
    [overlays]
  );

  // Scaled dimensions for the outer wrapper (visual size on screen)
  const scaledWidth = canvasWidth * finalScale;
  const scaledHeight = canvasHeight * finalScale;

  // Extra spacing around canvas for scrolling when zoomed in
  const zoomGrowth = Math.max(0, localZoom - 0.5);
  const spacing = zoomGrowth * scaledHeight * 0.5;

  return (
    <div className="finalize-view">
      {/* Header */}
      <div className="finalize-header">
        <button className="finalize-back-btn" onClick={onBack}>
          <ChevronLeft size={18} />
          <span>Back</span>
        </button>
        <h2 className="finalize-title">Finalize</h2>
        <div className="finalize-actions">
          {/* Zoom controls */}
          <div className="finalize-zoom-controls">
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
          <button
            className={`finalize-display-btn ${isDisplayingOnGuest ? 'active' : ''}`}
            onClick={handleToggleDisplay}
            disabled={isCompositing || isGeneratingCollage || placedImages.size === 0}
            title={
              isDisplayingOnGuest
                ? 'Clear from display'
                : 'Send to guest display'
            }
          >
            {isCompositing || isGeneratingCollage ? (
              <>
                <span className="finalize-spinner" />
                <span>Compositing...</span>
              </>
            ) : isDisplayingOnGuest ? (
              <>
                <MonitorOff size={16} />
                <span>Clear Display</span>
              </>
            ) : (
              <>
                <Monitor size={16} />
                <span>Send to Display</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Full collage preview */}
      <div className="finalize-content" onClick={handleBackgroundClick}>
        {placedImages.size === 0 ? (
          <div className="finalize-loading">Loading photos...</div>
        ) : (
          <>
            {/* Invisible spacers to allow scrolling in all directions when zoomed */}
            {spacing > 0 && <div style={{ height: `${spacing}px`, flexShrink: 0 }} />}
            {/* Outer wrapper: visual size on screen (scaled down) */}
            <div
              ref={canvasRef}
              className="finalize-frame-canvas"
              onClick={handleCanvasClick}
              style={{
                width: `${scaledWidth}px`,
                height: `${scaledHeight}px`,
                position: 'relative',
                background: '#ffffff',
                overflow: 'visible',
              }}
            >
              {/* Inner canvas: full pixel dimensions, CSS-scaled down via transform */}
              <div
                style={{
                  width: `${canvasWidth}px`,
                  height: `${canvasHeight}px`,
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: '8px',
                  transform: `scale(${finalScale})`,
                  transformOrigin: 'top left',
                }}
              >
                {/* Background layer */}
                {background && (
                  <div
                    className="finalize-background"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      overflow: 'hidden',
                      zIndex: 0,
                    }}
                  >
                    {isSolidColor ? (
                      <div style={{ width: '100%', height: '100%', backgroundColor: background }} />
                    ) : bgSrc ? (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          position: 'relative',
                          transform: `
                            scale(${backgroundTransform.scale})
                            translate(${backgroundTransform.offsetX}px, ${backgroundTransform.offsetY}px)
                          `,
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
                    ) : null}
                  </div>
                )}

                {/* Below-frames overlay layers */}
                {belowFrameOverlays.map((layer) => (
                  <FinalizeOverlay key={layer.id} layer={layer} zIndex={10 + layer.layerOrder} />
                ))}

                {/* Image zones — all in pixel coordinates, scaled by parent transform */}
                {frame.zones.map((zone, index) => (
                  <FinalizeZone
                    key={zone.id}
                    zone={zone}
                    index={index}
                    placedImage={placedImages.get(zone.id) ?? null}
                    isSelected={editingZoneId === zone.id}
                    updatePlacedImage={updatePlacedImage}
                    finalScale={finalScale}
                    onClick={(e) => {
                      // Stop propagation to prevent canvas click from clearing selection
                      e.stopPropagation();
                      // Just set the editing zone - Edit tab in sidebar will show controls
                      setEditingZoneId(zone.id);
                    }}
                  />
                ))}

                {/* Above-frames overlay layers */}
                {aboveFrameOverlays.map((layer) => (
                  <FinalizeOverlay key={layer.id} layer={layer} zIndex={61 + layer.layerOrder} />
                ))}
              </div>

              {/* Selected zone overflow - rendered outside clipped canvas to show overflow */}
              {editingZoneId && (() => {
                const selectedZone = frame.zones.find(z => z.id === editingZoneId);
                const selectedPlacedImage = selectedZone ? placedImages.get(selectedZone.id) : null;
                if (!selectedZone || !selectedPlacedImage) return null;
                return (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: `${canvasWidth}px`,
                      height: `${canvasHeight}px`,
                      transform: `scale(${finalScale})`,
                      transformOrigin: 'top left',
                      pointerEvents: 'none',
                    }}
                  >
                    <FinalizeZoneOverflow
                      key={`${selectedZone.id}-overflow`}
                      zone={selectedZone}
                      placedImage={selectedPlacedImage}
                      updatePlacedImage={updatePlacedImage}
                    />
                  </div>
                );
              })()}

              {/* Canvas Info Box - rendered outside scaled inner canvas for consistent sizing */}
              <div className="finalize-canvas-info">
                <span className="canvas-frame-name">{frame.name || 'Custom'}</span>
                <span className="canvas-dimensions">{canvasWidth} × {canvasHeight}px</span>
              </div>

              {/* Zoom hint overlay - shows when user hasn't zoomed yet */}
              {!hasEverZoomed && localZoom === 1 && (
                <div className="finalize-zoom-hint">
                  <span>Hold Ctrl + Scroll to zoom</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Overlay layer renderer (read-only, no interaction)
function FinalizeOverlay({
  layer,
  zIndex,
}: {
  layer: any;
  zIndex: number;
}) {
  const src = useMemo(() => {
    if (!layer.sourcePath) return null;
    return convertFileSrc(layer.sourcePath.replace('asset://', ''));
  }, [layer.sourcePath]);

  if (!src) return null;

  const t = layer.transform ?? {};

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transformOrigin: 'center center',
        transform: `
          translate(${t.x ?? 0}px, ${t.y ?? 0}px)
          rotate(${t.rotation ?? 0}deg)
          scale(${t.scale ?? 1})
          scaleX(${t.flipHorizontal ? -1 : 1})
          scaleY(${t.flipVertical ? -1 : 1})
        `,
        opacity: t.opacity ?? 1,
        zIndex,
        pointerEvents: 'none',
      }}
    >
      <img src={src} alt={layer.name || 'Overlay'} draggable={false} style={{ display: 'block', maxWidth: 'none' }} />
    </div>
  );
}

// Shape helpers matching CollageCanvas ImageZone
function getBorderRadius(zone: FrameZone): string {
  switch (zone.shape) {
    case 'circle': return '50%';
    case 'ellipse': return '50% / 40%';
    case 'rounded_rect': return `${zone.borderRadius || 12}px`;
    case 'pill': return '999px';
    default: return '2px';
  }
}

function getClipPath(zone: FrameZone): string | undefined {
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
      return 'polygon(50% 0%, 78% 50%, 50% 100%, 22% 50%)';
    case 'heart':
      return 'polygon(50% 15%, 65% 0%, 85% 0%, 100% 15%, 100% 35%, 85% 50%, 50% 100%, 15% 50%, 0% 35%, 0% 15%, 15% 0%, 35% 0%)';
    case 'cross':
      return 'polygon(20% 0%, 80% 0%, 80% 20%, 100% 20%, 100% 80%, 80% 80%, 80% 100%, 20% 100%, 20% 80%, 0% 80%, 0% 20%, 20% 20%)';
    default:
      return undefined;
  }
}

// Overflow layer for selected zone - shows dimmed/transparent image extending beyond frame
function FinalizeZoneOverflow({
  zone,
  placedImage,
  updatePlacedImage,
}: {
  zone: FrameZone;
  placedImage: PlacedImage;
  updatePlacedImage: (zoneId: string, updates: Partial<PlacedImage>) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0, left: 0, top: 0 });
  const [isZooming, setIsZooming] = useState(false);
  const [zoomStart, setZoomStart] = useState({
    x: 0,
    y: 0,
    scale: placedImage.transform.scale,
    offsetX: placedImage.transform.offsetX,
    offsetY: placedImage.transform.offsetY,
    corner: '' as 'tl' | 'tr' | 'bl' | 'br'
  });

  const imgSrc = convertFileSrc(placedImage.sourceFile.replace('asset://', ''));
  const t = placedImage.transform;

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

  // Handle zoom dragging
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
  }, [isZooming, zoomStart, zone.id, placedImage, updatePlacedImage]);

  // Measure actual rendered size of image
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

        // Calculate how image is positioned with objectFit: contain
        const containerAspect = containerWidth / containerHeight;
        const imgAspect = imgNaturalWidth / imgNaturalHeight;

        let renderWidth, renderHeight, offsetX, offsetY;

        if (imgAspect > containerAspect) {
          renderWidth = containerWidth;
          renderHeight = containerWidth / imgAspect;
          offsetX = 0;
          offsetY = (containerHeight - renderHeight) / 2;
        } else {
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
  }, [imgSrc]);

  return (
    <div
      style={{
        position: 'absolute',
        left: `${zone.x}px`,
        top: `${zone.y}px`,
        width: `${zone.width}px`,
        height: `${zone.height}px`,
        transform: `rotate(${zone.rotation}deg)`,
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          transform: `
            scale(${t.scale})
            translate(${t.offsetX}px, ${t.offsetY}px)
            rotate(${t.rotation}deg)
            scaleX(${t.flipHorizontal ? -1 : 1})
            scaleY(${t.flipVertical ? -1 : 1})
          `,
        }}
      >
        <img
          ref={imgRef}
          src={imgSrc}
          alt="Overflow"
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            opacity: 0.5,
            filter: 'brightness(0.85)',
            display: 'block',
          }}
        />

        {/* Image overflow frame - shows actual image bounds */}
        {imageSize.width > 0 && (
          <div
            className="finalize-overflow-frame"
            style={{
              position: 'absolute',
              left: imageSize.left,
              top: imageSize.top,
              width: imageSize.width,
              height: imageSize.height,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Grab Handles */}
        {imageSize.width > 0 && (
          <>
            <div
              className="finalize-zoom-handle"
              style={{
                left: imageSize.left - 8,
                top: imageSize.top - 8,
                cursor: 'nwse-resize',
                pointerEvents: 'auto',
              }}
              onMouseDown={(e) => handleZoomStart(e, 'tl')}
            />
            <div
              className="finalize-zoom-handle"
              style={{
                left: imageSize.left + imageSize.width - 8,
                top: imageSize.top - 8,
                cursor: 'nesw-resize',
                pointerEvents: 'auto',
              }}
              onMouseDown={(e) => handleZoomStart(e, 'tr')}
            />
            <div
              className="finalize-zoom-handle"
              style={{
                left: imageSize.left - 8,
                top: imageSize.top + imageSize.height - 8,
                cursor: 'nesw-resize',
                pointerEvents: 'auto',
              }}
              onMouseDown={(e) => handleZoomStart(e, 'bl')}
            />
            <div
              className="finalize-zoom-handle"
              style={{
                left: imageSize.left + imageSize.width - 8,
                top: imageSize.top + imageSize.height - 8,
                cursor: 'nwse-resize',
                pointerEvents: 'auto',
              }}
              onMouseDown={(e) => handleZoomStart(e, 'br')}
            />
          </>
        )}
      </div>
    </div>
  );
}

// Individual zone renderer — uses pixel coordinates (parent handles scaling)
function FinalizeZone({
  zone,
  index,
  placedImage,
  onClick,
  isSelected,
  updatePlacedImage,
  finalScale,
}: {
  zone: FrameZone;
  index: number;
  placedImage: PlacedImage | null;
  onClick: (e: React.MouseEvent) => void;
  isSelected?: boolean;
  updatePlacedImage: (zoneId: string, updates: Partial<PlacedImage>) => void;
  finalScale: number;
}) {
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [transformStart, setTransformStart] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);
  const transformContainerRef = useRef<HTMLDivElement>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0, left: 0, top: 0 });
  const [snapGuides, setSnapGuides] = useState({ horizontal: false, vertical: false, centerH: false, centerV: false });
  const SNAP_THRESHOLD = 10;

  const imgSrc = placedImage
    ? convertFileSrc(placedImage.sourceFile.replace('asset://', ''))
    : null;

  const t = placedImage?.transform;
  const clipPath = getClipPath(zone);

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
    if (isDraggingImage && placedImage) {
      const handleGlobalMouseMove = (e: MouseEvent) => {
        // Convert screen pixel deltas to canvas coordinate space by dividing by finalScale
        const deltaX = (e.clientX - dragStart.x) / finalScale;
        const deltaY = (e.clientY - dragStart.y) / finalScale;

        let newOffsetX = transformStart.x + deltaX;
        let newOffsetY = transformStart.y + deltaY;

        // Use transform container's dimensions
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
          horizontal: snapToLeft || snapToRight,
          vertical: snapToTop || snapToBottom,
          centerH: snapToCenterH,
          centerV: snapToCenterV,
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
  }, [isDraggingImage, dragStart, transformStart, placedImage, zone.id, updatePlacedImage, imageSize, SNAP_THRESHOLD, finalScale]);

  // Measure actual rendered size of image
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

        // Calculate how image is positioned with objectFit: contain
        const containerAspect = containerWidth / containerHeight;
        const imgAspect = imgNaturalWidth / imgNaturalHeight;

        let renderWidth, renderHeight, offsetX, offsetY;

        if (imgAspect > containerAspect) {
          // Image is wider - width is constrained
          renderWidth = containerWidth;
          renderHeight = containerWidth / imgAspect;
          offsetX = 0;
          offsetY = (containerHeight - renderHeight) / 2;
        } else {
          // Image is taller - height is constrained
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
  }, [placedImage, imgSrc]);

  return (
    <div
      className={`finalize-zone ${isSelected ? 'selected' : ''}`}
      onClick={placedImage ? onClick : undefined}
      style={{
        position: 'absolute',
        left: `${zone.x}px`,
        top: `${zone.y}px`,
        width: `${zone.width}px`,
        height: `${zone.height}px`,
        transform: `rotate(${zone.rotation}deg)`,
        borderRadius: getBorderRadius(zone),
        clipPath,
        overflow: 'hidden',
        cursor: placedImage ? 'pointer' : 'default',
        zIndex: 40,
        border: isSelected ? '3px solid var(--accent-blue)' : 'none',
      }}
    >
      {placedImage && t && imgSrc ? (
        <div
          ref={transformContainerRef}
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            transform: `
              scale(${t.scale})
              translate(${t.offsetX}px, ${t.offsetY}px)
              rotate(${t.rotation}deg)
              scaleX(${t.flipHorizontal ? -1 : 1})
              scaleY(${t.flipVertical ? -1 : 1})
            `,
          }}
          onMouseDown={handleImageMouseDown}
        >
          <img
            ref={imageRef}
            src={imgSrc}
            alt={`Photo ${index + 1}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
            }}
            draggable={false}
          />
        </div>
      ) : (
        <div className="finalize-zone-empty">
          <span>{index + 1}</span>
        </div>
      )}
      <div className="finalize-zone-hover-overlay" />

      {/* 3x3 Grid Overlay - shown when selected, centered on zone */}
      {isSelected && placedImage && (
        <div
          className="finalize-grid-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
          }}
        >
          {/* Vertical lines at 1/3 and 2/3 */}
          <div className="finalize-grid-line finalize-grid-line-vertical" style={{ left: '33.33%' }} />
          <div className="finalize-grid-line finalize-grid-line-vertical" style={{ left: '66.66%' }} />
          {/* Horizontal lines at 1/3 and 2/3 */}
          <div className="finalize-grid-line finalize-grid-line-horizontal" style={{ top: '33.33%' }} />
          <div className="finalize-grid-line finalize-grid-line-horizontal" style={{ top: '66.66%' }} />
        </div>
      )}

      {/* Snap Guides - shown during dragging */}
      {isSelected && snapGuides.centerH && (
        <div className="snap-guide snap-guide-vertical" style={{
          position: 'absolute',
          left: '50%',
          top: 0,
          height: '100%',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          zIndex: 100,
        }} />
      )}
      {isSelected && snapGuides.centerV && (
        <div className="snap-guide snap-guide-horizontal" style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          width: '100%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          zIndex: 100,
        }} />
      )}
      {isSelected && snapGuides.horizontal && (
        <>
          <div className="snap-guide snap-guide-horizontal" style={{ position: 'absolute', top: 0, left: 0, width: '100%', pointerEvents: 'none', zIndex: 100 }} />
          <div className="snap-guide snap-guide-horizontal" style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', pointerEvents: 'none', zIndex: 100 }} />
        </>
      )}
      {isSelected && snapGuides.vertical && (
        <>
          <div className="snap-guide snap-guide-vertical" style={{ position: 'absolute', left: 0, top: 0, height: '100%', pointerEvents: 'none', zIndex: 100 }} />
          <div className="snap-guide snap-guide-vertical" style={{ position: 'absolute', right: 0, top: 0, height: '100%', pointerEvents: 'none', zIndex: 100 }} />
        </>
      )}
    </div>
  );
}
