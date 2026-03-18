import { useRef, useMemo } from "react";
import { useDrop } from "react-dnd";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useCollage } from "../../../contexts";
import { FrameZone } from "../../../types/frame";
import { DEFAULT_TRANSFORM } from "../../../types/collage";
import { useImagePlacement } from "../../../hooks/canvas/useImagePlacement";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("ImageZone");

interface ImageZoneProps {
  zone: FrameZone;
}

function getBorderRadiusForImageZone(zone: FrameZone): string {
  switch (zone.shape) {
    case "circle":
      return "50%";
    case "ellipse":
      return "50% / 40%";
    case "rounded_rect":
      return `${zone.borderRadius || 12}px`;
    case "pill":
      return "999px";
    default:
      return "2px";
  }
}

function getClipPathForImageZone(zone: FrameZone): string | undefined {
  switch (zone.shape) {
    case "triangle":
      return "polygon(50% 0%, 0% 100%, 100% 100%)";
    case "pentagon":
      return "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)";
    case "hexagon":
      return "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";
    case "octagon":
      return "polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)";
    case "star":
      return "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)";
    case "diamond":
      return "polygon(50% 0%, 78% 50%, 50% 100%, 22% 50%)";
    case "heart":
      return "polygon(50% 15%, 65% 0%, 85% 0%, 100% 15%, 100% 35%, 85% 50%, 50% 100%, 15% 50%, 0% 35%, 0% 15%, 15% 0%, 35% 0%)";
    case "cross":
      return "polygon(20% 0%, 80% 0%, 80% 20%, 100% 20%, 100% 80%, 80% 80%, 80% 100%, 20% 100%, 20% 80%, 0% 80%, 0% 20%, 20% 20%)";
    default:
      return undefined;
  }
}

export function ImageZone({ zone }: ImageZoneProps) {
  const {
    placedImages,
    addPlacedImage,
    selectedZone,
    setSelectedZone,
    updatePlacedImage,
    canvasSize,
    setIsBackgroundSelected,
    setActiveSidebarTab,
    activeSidebarTab,
    canvasZoom,
  } = useCollage();

  const placedImage = placedImages.get(zone.id);
  const dropRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const transformContainerRef = useRef<HTMLDivElement>(null);

  const { isDraggingImage, imageSize, displayScale, snapGuides, handleImageMouseDown } =
    useImagePlacement({
      zone,
      placedImage,
      updatePlacedImage,
      imageRef,
      transformContainerRef,
      canvasZoom,
      canvasWidth: canvasSize?.width,
    });

  // Convert file paths to Tauri-compatible URLs
  const imageSrc = useMemo(() => {
    if (!placedImage) return null;
    const src = placedImage.sourceFile;
    return convertFileSrc(src.replace("asset://", ""));
  }, [placedImage, zone.id]);

  // useDrop stays inline — do NOT move to a hook
  const [{ isOver, canDrop }, drop] = useDrop({
    accept: "IMAGE",
    drop: (item: {
      path: string;
      thumbnail: string;
      dimensions?: { width: number; height: number };
    }) => {
      let scale = 1.0;
      if (item.dimensions) {
        const zoneWidthPx = zone.width;
        const zoneHeightPx = zone.height;

        let imgWidth = item.dimensions.width;
        let imgHeight = item.dimensions.height;

        const rawImgAspect = imgWidth / imgHeight;
        const zoneAspect = zoneWidthPx / zoneHeightPx;

        logger.debug("Raw image aspect ratio (width/height):", rawImgAspect.toFixed(4));
        logger.debug("Zone aspect ratio (width/height):", zoneAspect.toFixed(4));

        const aspectRatioDiff = Math.abs(rawImgAspect - zoneAspect);
        const mightBeSwapped =
          rawImgAspect > 1.0 && zoneAspect < 1.0 && aspectRatioDiff > 0.3;

        if (mightBeSwapped) {
          logger.debug("⚠️ Dimensions might be swapped due to EXIF orientation");
          logger.debug("   Image looks landscape but zone is portrait");
          logger.debug("   Aspect ratio difference:", aspectRatioDiff.toFixed(4));
        }

        const imgAspect = imgWidth / imgHeight;
        const imgIsWider = imgAspect > zoneAspect;

        logger.debug("Image is wider than zone?", imgIsWider);

        if (imgIsWider) {
          const renderedHeight = zoneWidthPx / imgAspect;
          logger.debug(
            "objectFit:contain will render image at:",
            zoneWidthPx.toFixed(0),
            "x",
            renderedHeight.toFixed(0),
          );
          logger.debug(
            "Empty space top/bottom:",
            (zoneHeightPx - renderedHeight).toFixed(0),
            "px",
          );
          scale = imgAspect / zoneAspect;
          logger.debug("Scale needed to fill height:", scale.toFixed(4));
          logger.debug("Image is width-constrained, scaling to fill height");
        } else {
          const renderedWidth = zoneHeightPx * imgAspect;
          logger.debug(
            "objectFit:contain will render image at:",
            renderedWidth.toFixed(0),
            "x",
            zoneHeightPx.toFixed(0),
          );
          logger.debug(
            "Empty space left/right:",
            (zoneWidthPx - renderedWidth).toFixed(0),
            "px",
          );
          scale = zoneAspect / imgAspect;
          logger.debug("Scale needed to fill width:", scale.toFixed(4));
          logger.debug("Image is height-constrained, scaling to fill width");
        }

        logger.debug("Calculated scale:", scale.toFixed(4));
        logger.debug("==================");
      }

      const scaleRounded =
        scale > 0.99 && scale < 1.01 ? 1.0 : Math.ceil(scale * 10 - 1e-9) / 10;
      logger.debug("Final rounded scale:", scaleRounded.toFixed(2));

      const placedImageData = {
        sourceFile: item.path,
        thumbnail: item.thumbnail,
        zoneId: zone.id,
        transform: { ...DEFAULT_TRANSFORM, scale: scaleRounded },
        originalScale: scaleRounded,
      };

      logger.debug("=== ADDING PLACED IMAGE ===");
      logger.debug("Zone ID:", zone.id);
      logger.debug("Placed image data:", placedImageData);
      logger.debug("===========================");

      addPlacedImage(zone.id, placedImageData);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  });

  drop(dropRef);

  const clipPath = getClipPathForImageZone(zone);
  const zoneStyle = {
    position: "absolute" as const,
    left: `${zone.x}px`,
    top: `${zone.y}px`,
    width: `${zone.width}px`,
    height: `${zone.height}px`,
    transform: `rotate(${zone.rotation}deg)`,
    border:
      selectedZone === zone.id
        ? "3px solid var(--accent-blue)"
        : "2px dashed rgba(255, 255, 255, 0.3)",
    borderRadius: getBorderRadiusForImageZone(zone),
    clipPath: clipPath,
    backgroundColor: isOver ? "rgba(59, 130, 246, 0.2)" : "rgba(0, 0, 0, 0.1)",
    cursor: "pointer",
    overflow: "hidden",
    zIndex: selectedZone === zone.id ? 50 : 40,
    transition: "border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease",
  };

  return (
    <div
      ref={dropRef}
      style={zoneStyle}
      onClick={(e) => {
        e.stopPropagation();
        setSelectedZone(zone.id);
        setIsBackgroundSelected(false);
        if (activeSidebarTab !== "frames") {
          setActiveSidebarTab("edit");
        }
      }}
      className="image-zone"
    >
      {placedImage && imageSrc ? (
        <div
          ref={transformContainerRef}
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
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
              logger.debug("=== IMAGE LOADED ===");
              logger.debug("Zone ID:", zone.id);
              logger.debug("Image src:", imageSrc);
              logger.debug("====================");
            }}
            onError={(e) => {
              logger.error("=== IMAGE LOAD ERROR ===");
              logger.error("Zone ID:", zone.id);
              logger.error("Image src:", imageSrc);
              logger.error("Error:", e);
              logger.error("========================");
            }}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              cursor: isDraggingImage ? "grabbing" : "grab",
              display: "block",
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
              <div className="grid-line grid-line-vertical" style={{ left: "33.33%" }} />
              <div className="grid-line grid-line-vertical" style={{ left: "66.67%" }} />
              <div className="grid-line grid-line-horizontal" style={{ top: "33.33%" }} />
              <div className="grid-line grid-line-horizontal" style={{ top: "66.67%" }} />
            </div>
          )}
          {/* Snap Guides - shown during dragging */}
          {snapGuides.centerH && (
            <div
              className="snap-guide snap-guide-vertical"
              style={{ left: "50%", top: 0, height: "100%", transform: "translateX(-50%)" }}
            />
          )}
          {snapGuides.centerV && (
            <div
              className="snap-guide snap-guide-horizontal"
              style={{ top: "50%", left: 0, width: "100%", transform: "translateY(-50%)" }}
            />
          )}
          {snapGuides.horizontal && (
            <>
              <div
                className="snap-guide snap-guide-horizontal"
                style={{ top: 0, left: 0, width: "100%" }}
              />
              <div
                className="snap-guide snap-guide-horizontal"
                style={{ bottom: 0, left: 0, width: "100%" }}
              />
            </>
          )}
          {snapGuides.vertical && (
            <>
              <div
                className="snap-guide snap-guide-vertical"
                style={{ left: 0, top: 0, height: "100%" }}
              />
              <div
                className="snap-guide snap-guide-vertical"
                style={{ right: 0, top: 0, height: "100%" }}
              />
            </>
          )}
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255, 255, 255, 0.5)",
            fontSize: `${20 / displayScale}px`,
            pointerEvents: "none",
          }}
        >
          {canDrop ? "Drop here" : "Drag image here"}
        </div>
      )}
    </div>
  );
}
