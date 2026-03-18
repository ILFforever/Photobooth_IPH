import { useState, useEffect, useCallback, RefObject } from "react";
import { FrameZone } from "../../types/frame";
import { PlacedImage } from "../../types/collage";
import {
  EdgeSnapGuides,
  EMPTY_EDGE_SNAP_GUIDES,
  calculateImageDragSnap,
} from "../../utils/canvas/snapUtils";
import { createLogger } from "../../utils/logger";

const logger = createLogger("useImagePlacement");

const SNAP_THRESHOLD = 10; // pixels

interface UseImagePlacementProps {
  zone: FrameZone;
  placedImage: PlacedImage | undefined;
  updatePlacedImage: (zoneId: string, updates: Partial<PlacedImage>) => void;
  imageRef: RefObject<HTMLImageElement>;
  transformContainerRef: RefObject<HTMLDivElement>;
  canvasZoom: number;
  canvasWidth: number | undefined;
}

interface UseImagePlacementReturn {
  isDraggingImage: boolean;
  imageSize: { width: number; height: number; left: number; top: number };
  displayScale: number;
  snapGuides: EdgeSnapGuides;
  handleImageMouseDown: (e: React.MouseEvent) => void;
}

export function useImagePlacement({
  zone,
  placedImage,
  updatePlacedImage,
  imageRef,
  transformContainerRef,
  canvasZoom,
  canvasWidth,
}: UseImagePlacementProps): UseImagePlacementReturn {
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [transformStart, setTransformStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0, left: 0, top: 0 });
  const [snapGuides, setSnapGuides] = useState<EdgeSnapGuides>(EMPTY_EDGE_SNAP_GUIDES);
  const [displayScale, setDisplayScale] = useState(1);

  useEffect(() => {
    const canvas = document.querySelector(".collage-canvas") as HTMLElement;
    if (canvas && canvasWidth) {
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / canvasWidth;
      setDisplayScale(scale);
    }
  }, [canvasWidth, canvasZoom]);

  const handleImageMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!placedImage) return;
      e.stopPropagation();
      setIsDraggingImage(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setTransformStart({
        x: placedImage.transform.offsetX,
        y: placedImage.transform.offsetY,
      });
    },
    [placedImage],
  );

  // Set up global mouse event listeners for dragging
  useEffect(() => {
    if (isDraggingImage) {
      const handleGlobalMouseMove = (e: MouseEvent) => {
        if (!placedImage) return;
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        const rawOffsetX = transformStart.x + deltaX;
        const rawOffsetY = transformStart.y + deltaY;

        const containerWidth = transformContainerRef.current?.offsetWidth || 0;
        const containerHeight = transformContainerRef.current?.offsetHeight || 0;

        const scale = placedImage.transform.scale;
        const scaledWidth = imageSize.width * scale;
        const scaledHeight = imageSize.height * scale;
        const imageBaseCenterX = imageSize.left + imageSize.width / 2;
        const imageBaseCenterY = imageSize.top + imageSize.height / 2;

        const result = calculateImageDragSnap(
          rawOffsetX,
          rawOffsetY,
          imageBaseCenterX,
          imageBaseCenterY,
          scaledWidth,
          scaledHeight,
          containerWidth,
          containerHeight,
          SNAP_THRESHOLD,
        );

        setSnapGuides(result.guides);
        updatePlacedImage(zone.id, {
          transform: {
            ...placedImage.transform,
            offsetX: result.newOffsetX,
            offsetY: result.newOffsetY,
          },
        });
      };

      const handleGlobalMouseUp = () => {
        setIsDraggingImage(false);
        setSnapGuides(EMPTY_EDGE_SNAP_GUIDES);
      };

      window.addEventListener("mousemove", handleGlobalMouseMove);
      window.addEventListener("mouseup", handleGlobalMouseUp);

      return () => {
        window.removeEventListener("mousemove", handleGlobalMouseMove);
        window.removeEventListener("mouseup", handleGlobalMouseUp);
      };
    }
  }, [isDraggingImage, dragStart, transformStart, placedImage, zone.id, updatePlacedImage, imageSize, transformContainerRef]);

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

        logger.debug("=== IMAGE SIZE CALCULATION ===");
        logger.debug("Zone ID:", zone.id);
        logger.debug("containerSize:", { width: containerWidth, height: containerHeight });
        logger.debug("imageNaturalSize:", { width: imgNaturalWidth, height: imgNaturalHeight });
        logger.debug("aspects:", {
          container: containerAspect.toFixed(4),
          image: imgAspect.toFixed(4),
        });
        logger.debug("calculated:", { renderWidth, renderHeight, offsetX, offsetY });
        logger.debug("============================");

        setImageSize({ width: renderWidth, height: renderHeight, left: offsetX, top: offsetY });
      };

      updateImageSize();
      window.addEventListener("resize", updateImageSize);
      return () => window.removeEventListener("resize", updateImageSize);
    }
  }, [placedImage, imageRef, zone.id]);

  return { isDraggingImage, imageSize, displayScale, snapGuides, handleImageMouseDown };
}
