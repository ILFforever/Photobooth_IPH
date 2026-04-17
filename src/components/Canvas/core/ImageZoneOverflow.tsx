import { useRef, useState, useEffect, useCallback } from "react";
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
  const { updatePlacedImage, canvasZoom, canvasSize } = useCollage();
  const [isZooming, setIsZooming] = useState(false);
  const [displayScale, setDisplayScale] = useState(1);
  const [zoomStart, setZoomStart] = useState({
    x: 0,
    y: 0,
    scale: placedImage.transform.scale,
    offsetX: placedImage.transform.offsetX,
    offsetY: placedImage.transform.offsetY,
    corner: "" as "tl" | "tr" | "bl" | "br",
  });

  // Calculate the scale of the canvas on screen
  useEffect(() => {
    const canvas = document.querySelector(".collage-canvas") as HTMLElement;
    if (canvas && canvasSize?.width) {
      const rect = canvas.getBoundingClientRect();
      setDisplayScale(rect.width / canvasSize.width);
    }
  }, [canvasZoom, canvasSize]);

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
        if (!isZooming) return;
        
        // 1. Calculate delta in zone space
        const deltaX = (e.clientX - zoomStart.x) / displayScale;
        const deltaY = (e.clientY - zoomStart.y) / displayScale;

        const t0 = zoomStart;
        const rad = (placedImage.transform.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // Define relative positions of handles and anchors (-0.5 to 0.5)
        // Note: these are relative to the image container (the 100% div)
        const containerWidth = overflowRef.current?.offsetWidth || zone.width;
        const containerHeight = overflowRef.current?.offsetHeight || zone.height;

        const handleRelPos: Record<string, { x: number, y: number }> = {
          'tl': { x: imageSize.left - containerWidth/2, y: imageSize.top - containerHeight/2 },
          'tr': { x: imageSize.left + imageSize.width - containerWidth/2, y: imageSize.top - containerHeight/2 },
          'bl': { x: imageSize.left - containerWidth/2, y: imageSize.top + imageSize.height - containerHeight/2 },
          'br': { x: imageSize.left + imageSize.width - containerWidth/2, y: imageSize.top + imageSize.height - containerHeight/2 }
        };

        const anchorRelPos: Record<string, { x: number, y: number }> = {
          'tl': handleRelPos['br'],
          'tr': handleRelPos['bl'],
          'bl': handleRelPos['tr'],
          'br': handleRelPos['tl']
        };

        const hp = handleRelPos[zoomStart.corner];
        const ap = anchorRelPos[zoomStart.corner];

        // 2. Calculate new scale based on drag projection along diagonal
        // Vector from anchor to handle at scale 1, rotated and flipped
        const fh = placedImage.transform.flipHorizontal ? -1 : 1;
        const fv = placedImage.transform.flipVertical ? -1 : 1;

        const rotateAndFlip = (p: {x: number, y: number}) => {
          const rx = p.x * fh;
          const ry = p.y * fv;
          return {
            x: rx * cos - ry * sin,
            y: rx * sin + ry * cos
          };
        };

        const vDiagRel = { x: hp.x - ap.x, y: hp.y - ap.y };
        const vDiagZone = rotateAndFlip(vDiagRel);
        
        // Project (deltaX, deltaY) onto the diagonal in screen-aligned zone space
        // Wait, the delta is already in screen-aligned zone space.
        // But the scale is global for the image, so we divide by the base scale s.
        // Actually, the easiest way is projection / diagLength.
        const diagLenSq = vDiagZone.x * vDiagZone.x + vDiagZone.y * vDiagZone.y;
        if (diagLenSq < 1) return;

        // The diagonal is scaled by s. So diagLength_screen = s * diagLength_zone_at_s1.
        // delta / (s * diagLength) is the % change in scale.
        const projection = (deltaX * vDiagZone.x + deltaY * vDiagZone.y) / diagLenSq;
        const newScale = Math.max(0.1, Math.min(10, t0.scale * (1 + projection / t0.scale)));
        // Simplified: newScale = t0.scale + projection

        // 3. Calculate new offsets to keep anchor stationary
        // K = Rotate(r) * Flip(fh, fv) * A
        const K = rotateAndFlip(ap);
        
        // [x', y'] = (s/s') * [x, y] + (s/s' - 1) * K
        const newOffsetX = (t0.scale / newScale) * t0.offsetX + (t0.scale / newScale - 1) * K.x;
        const newOffsetY = (t0.scale / newScale) * t0.offsetY + (t0.scale / newScale - 1) * K.y;

        updatePlacedImage(zone.id, {
          transform: {
            ...placedImage.transform,
            scale: newScale,
            offsetX: newOffsetX,
            offsetY: newOffsetY,
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
  }, [isZooming, zoomStart, zone.id, placedImage, updatePlacedImage, imageSize, displayScale]);

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

  // Constant size handles
  const totalScale = displayScale * placedImage.transform.scale;
  const invScale = 1 / totalScale;
  const handleSize = 16 * invScale;
  const handleSvgSize = 16; // The SVG internal units
  const strokeWidth = 1.5 * invScale;

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
              borderWidth: invScale,
            }}
          >
            <div className="grid-line grid-line-vertical" style={{ left: "33.33%", width: invScale }} />
            <div className="grid-line grid-line-vertical" style={{ left: "66.67%", width: invScale }} />
            <div className="grid-line grid-line-horizontal" style={{ top: "33.33%", height: invScale }} />
            <div className="grid-line grid-line-horizontal" style={{ top: "66.67%", height: invScale }} />
          </div>
        )}

        {/* Zoom handles at corners of the actual image */}
        {imageSize.width > 0 && (
          <>
            {/* Top-left corner */}
            <div
              onMouseDown={(e) => handleZoomStart(e, "tl")}
              style={{
                position: "absolute",
                left: imageSize.left - 2 * invScale,
                top: imageSize.top - 2 * invScale,
                width: handleSize,
                height: handleSize,
                cursor: "nwse-resize",
                zIndex: 100,
                pointerEvents: "auto",
              }}
            >
              <svg width="100%" height="100%" viewBox="0 0 16 16" fill="none">
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
              style={{
                position: "absolute",
                left: imageSize.left + imageSize.width - 14 * invScale,
                top: imageSize.top - 2 * invScale,
                width: handleSize,
                height: handleSize,
                cursor: "nesw-resize",
                zIndex: 100,
                pointerEvents: "auto",
              }}
            >
              <svg width="100%" height="100%" viewBox="0 0 16 16" fill="none">
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
              style={{
                position: "absolute",
                left: imageSize.left - 2 * invScale,
                top: imageSize.top + imageSize.height - 14 * invScale,
                width: handleSize,
                height: handleSize,
                cursor: "nesw-resize",
                zIndex: 100,
                pointerEvents: "auto",
              }}
            >
              <svg width="100%" height="100%" viewBox="0 0 16 16" fill="none">
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
              style={{
                position: "absolute",
                left: imageSize.left + imageSize.width - 14 * invScale,
                top: imageSize.top + imageSize.height - 14 * invScale,
                width: handleSize,
                height: handleSize,
                cursor: "nwse-resize",
                zIndex: 100,
                pointerEvents: "auto",
              }}
            >
              <svg width="100%" height="100%" viewBox="0 0 16 16" fill="none">
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
