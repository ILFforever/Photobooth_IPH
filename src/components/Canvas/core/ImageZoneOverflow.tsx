import { useRef, useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useCollage } from "../../../contexts";
import { FrameZone } from "../../../types/frame";
import { PlacedImage } from "../../../types/collage";

interface ImageZoneOverflowProps {
  zone: FrameZone;
  placedImage: PlacedImage;
}

export function ImageZoneOverflow({ zone, placedImage }: ImageZoneOverflowProps) {
  const imageSrc = convertFileSrc(placedImage.sourceFile.replace("asset://", ""));
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
    corner: "" as "tl" | "tr" | "bl" | "br",
  });

  const handleZoomStart = (e: React.MouseEvent, corner: "tl" | "tr" | "bl" | "br") => {
    e.stopPropagation();
    setIsZooming(true);
    setZoomStart({
      x: e.clientX,
      y: e.clientY,
      scale: placedImage.transform.scale,
      offsetX: placedImage.transform.offsetX,
      offsetY: placedImage.transform.offsetY,
      corner,
    });
  };

  useEffect(() => {
    if (isZooming) {
      const handleMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - zoomStart.x;
        const deltaY = e.clientY - zoomStart.y;

        let scaleDelta: number;
        if (zoomStart.corner === "br") {
          scaleDelta = (deltaX + deltaY) * 0.005;
        } else if (zoomStart.corner === "bl") {
          scaleDelta = (-deltaX + deltaY) * 0.005;
        } else if (zoomStart.corner === "tr") {
          scaleDelta = (deltaX - deltaY) * 0.005;
        } else {
          scaleDelta = (-deltaX - deltaY) * 0.005;
        }

        const newScale = Math.max(0.5, Math.min(3, zoomStart.scale + scaleDelta));

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

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);

      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
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

        const containerAspect = containerWidth / containerHeight;
        const imgAspect = imgNaturalWidth / imgNaturalHeight;

        let renderWidth: number, renderHeight: number, offsetX: number, offsetY: number;

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
      window.addEventListener("resize", updateImageSize);
      return () => window.removeEventListener("resize", updateImageSize);
    }
  }, [imageSrc]);

  return (
    <div
      ref={overflowRef}
      style={{
        position: "absolute",
        left: `${zone.x}px`,
        top: `${zone.y}px`,
        width: `${zone.width}px`,
        height: `${zone.height}px`,
        transform: `rotate(${zone.rotation}deg)`,
        pointerEvents: "auto",
        zIndex: 1,
      }}
    >
      <div
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
          ref={imgRef}
          src={imageSrc}
          alt="Overflow"
          draggable={false}
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            objectFit: "contain",
            opacity: 0.25,
            filter: "brightness(0.7)",
            display: "block",
          }}
        />
        {/* 3x3 grid overlay - positioned to match actual image bounds */}
        {imageSize.width > 0 && (
          <div
            className="grid-overlay grid-overlay-overflow overflow-overlay-frame"
            style={{
              position: "absolute",
              left: imageSize.left,
              top: imageSize.top,
              width: imageSize.width,
              height: imageSize.height,
            }}
          >
            <div className="grid-line grid-line-vertical" style={{ left: "33.33%" }} />
            <div className="grid-line grid-line-vertical" style={{ left: "66.67%" }} />
            <div className="grid-line grid-line-horizontal" style={{ top: "33.33%" }} />
            <div className="grid-line grid-line-horizontal" style={{ top: "66.67%" }} />
          </div>
        )}

        {/* Zoom handles at corners of the actual image */}
        {imageSize.width > 0 && (
          <>
            {/* Top-left corner */}
            <div
              onMouseDown={(e) => handleZoomStart(e, "tl")}
              className="zoom-handle zoom-handle-corner"
              style={{
                position: "absolute",
                left: imageSize.left - 2,
                top: imageSize.top - 2,
                width: 16,
                height: 16,
                cursor: "nwse-resize",
                zIndex: 100,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M1 1V8H2V2H8V1H1Z"
                  fill="white"
                  stroke="var(--accent-blue)"
                  strokeWidth="1.5"
                />
              </svg>
            </div>

            {/* Top-right corner */}
            <div
              onMouseDown={(e) => handleZoomStart(e, "tr")}
              className="zoom-handle zoom-handle-corner"
              style={{
                position: "absolute",
                left: imageSize.left + imageSize.width - 14,
                top: imageSize.top - 2,
                width: 16,
                height: 16,
                cursor: "nesw-resize",
                zIndex: 100,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M15 1V8H14V2H8V1H15Z"
                  fill="white"
                  stroke="var(--accent-blue)"
                  strokeWidth="1.5"
                />
              </svg>
            </div>

            {/* Bottom-left corner */}
            <div
              onMouseDown={(e) => handleZoomStart(e, "bl")}
              className="zoom-handle zoom-handle-corner"
              style={{
                position: "absolute",
                left: imageSize.left - 2,
                top: imageSize.top + imageSize.height - 14,
                width: 16,
                height: 16,
                cursor: "nesw-resize",
                zIndex: 100,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M1 15V8H2V14H8V15H1Z"
                  fill="white"
                  stroke="var(--accent-blue)"
                  strokeWidth="1.5"
                />
              </svg>
            </div>

            {/* Bottom-right corner */}
            <div
              onMouseDown={(e) => handleZoomStart(e, "br")}
              className="zoom-handle zoom-handle-corner"
              style={{
                position: "absolute",
                left: imageSize.left + imageSize.width - 14,
                top: imageSize.top + imageSize.height - 14,
                width: 16,
                height: 16,
                cursor: "nwse-resize",
                zIndex: 100,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M15 15V8H14V14H8V15H15Z"
                  fill="white"
                  stroke="var(--accent-blue)"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
