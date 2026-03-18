import { useState, useEffect } from "react";
import { FrameZone } from "../../types/frame";
import {
  SnapGuides,
  EMPTY_SNAP_GUIDES,
  applySnap,
  calculateZoneDragSnap,
} from "../../utils/canvas/snapUtils";

interface UseZoneEditingProps {
  zone: FrameZone;
  frameWidth: number;
  frameHeight: number;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<FrameZone>) => void;
  scale?: number;
  snapEnabled?: boolean;
}

interface UseZoneEditingReturn {
  isDragging: boolean;
  isResizing: string | null;
  snapGuides: SnapGuides;
  handleMouseDown: (e: React.MouseEvent, action?: string) => void;
}

const SNAP_THRESHOLD = 8; // screen pixels

export function useZoneEditing({
  zone,
  frameWidth,
  frameHeight,
  isSelected,
  onSelect,
  onUpdate,
  scale,
  snapEnabled,
}: UseZoneEditingProps): UseZoneEditingReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [zoneStart, setZoneStart] = useState({
    x: zone.x,
    y: zone.y,
    width: zone.width,
    height: zone.height,
  });
  const [snapGuides, setSnapGuides] = useState<SnapGuides>(EMPTY_SNAP_GUIDES);

  const isLocked = zone.locked || false;
  const zoomScale = scale ?? 1;

  const handleMouseDown = (e: React.MouseEvent, action?: string) => {
    if (isLocked) {
      e.stopPropagation();
      return;
    }

    e.stopPropagation();
    e.preventDefault();

    if (
      action === "resize-nw" ||
      action === "resize-ne" ||
      action === "resize-sw" ||
      action === "resize-se" ||
      action === "resize-n" ||
      action === "resize-s" ||
      action === "resize-e" ||
      action === "resize-w"
    ) {
      setIsResizing(action);
    } else {
      setIsDragging(true);
      onSelect();
    }

    setDragStart({ x: e.clientX, y: e.clientY });
    setZoneStart({
      x: zone.x,
      y: zone.y,
      width: zone.width,
      height: zone.height,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging && !isResizing) return;

      const currentZoomScale = scale ?? 1;
      const deltaX = (e.clientX - dragStart.x) / currentZoomScale;
      const deltaY = (e.clientY - dragStart.y) / currentZoomScale;

      if (isDragging) {
        const rawX = zoneStart.x + deltaX;
        const rawY = zoneStart.y + deltaY;

        if (snapEnabled !== false) {
          const adjustedSnapThreshold = SNAP_THRESHOLD / currentZoomScale;
          const result = calculateZoneDragSnap(
            rawX,
            rawY,
            zoneStart.width,
            zoneStart.height,
            frameWidth,
            frameHeight,
            adjustedSnapThreshold,
          );
          setSnapGuides(result.guides);
          onUpdate({ x: Math.round(result.finalX), y: Math.round(result.finalY) });
        } else {
          setSnapGuides(EMPTY_SNAP_GUIDES);
          onUpdate({ x: Math.round(rawX), y: Math.round(rawY) });
        }
      } else if (isResizing) {
        let updates: Partial<FrameZone> = {};
        const minSize = 50;

        setSnapGuides(EMPTY_SNAP_GUIDES);

        // Scale snap threshold by zoom level to keep snap distance consistent in screen pixels
        const adjustedSnapThreshold = SNAP_THRESHOLD * currentZoomScale;

        switch (isResizing) {
          case "resize-e": {
            const rawWidthE = Math.max(minSize, zoneStart.width + deltaX);
            const rightEdgeE = rawWidthE + zoneStart.x;
            const snappedRightE =
              snapEnabled !== false
                ? applySnap(rightEdgeE, frameWidth, adjustedSnapThreshold)
                : rightEdgeE;
            updates.width = Math.round(
              snappedRightE === frameWidth
                ? frameWidth - zoneStart.x
                : rawWidthE,
            );
            break;
          }
          case "resize-s": {
            const rawHeightS = Math.max(minSize, zoneStart.height + deltaY);
            const bottomEdgeS = rawHeightS + zoneStart.y;
            const snappedBottomS =
              snapEnabled !== false
                ? applySnap(bottomEdgeS, frameHeight, adjustedSnapThreshold)
                : bottomEdgeS;
            updates.height = Math.round(
              snappedBottomS === frameHeight
                ? frameHeight - zoneStart.y
                : rawHeightS,
            );
            break;
          }
          case "resize-w": {
            const rawWidthW = Math.max(minSize, zoneStart.width - deltaX);
            const leftEdgeW = zoneStart.x + zoneStart.width - rawWidthW;
            const snappedLeftW =
              snapEnabled !== false
                ? applySnap(leftEdgeW, 0, adjustedSnapThreshold)
                : leftEdgeW;
            updates.width = Math.round(
              snappedLeftW === 0 ? zoneStart.x + zoneStart.width : rawWidthW,
            );
            updates.x = Math.round(
              snappedLeftW === 0
                ? 0
                : zoneStart.x + zoneStart.width - rawWidthW,
            );
            break;
          }
          case "resize-n": {
            const rawHeightN = Math.max(minSize, zoneStart.height - deltaY);
            const topEdgeN = zoneStart.y + zoneStart.height - rawHeightN;
            const snappedTopN =
              snapEnabled !== false
                ? applySnap(topEdgeN, 0, adjustedSnapThreshold)
                : topEdgeN;
            updates.height = Math.round(
              snappedTopN === 0 ? zoneStart.y + zoneStart.height : rawHeightN,
            );
            updates.y = Math.round(
              snappedTopN === 0
                ? 0
                : zoneStart.y + zoneStart.height - rawHeightN,
            );
            break;
          }
          case "resize-ne": {
            updates.width = Math.max(minSize, zoneStart.width + deltaX);
            const newHeightNE = Math.max(minSize, zoneStart.height - deltaY);
            const newYNE = zoneStart.y + zoneStart.height - newHeightNE;
            updates.height = Math.round(newHeightNE);
            updates.y = Math.round(newYNE);
            break;
          }
          case "resize-nw": {
            const newWidthNW = Math.max(minSize, zoneStart.width - deltaX);
            const newXMW = zoneStart.x + zoneStart.width - newWidthNW;
            const newHeightNW = Math.max(minSize, zoneStart.height - deltaY);
            const newYNW = zoneStart.y + zoneStart.height - newHeightNW;
            updates.width = Math.round(newWidthNW);
            updates.x = Math.round(newXMW);
            updates.height = Math.round(newHeightNW);
            updates.y = Math.round(newYNW);
            break;
          }
          case "resize-se": {
            updates.width = Math.max(minSize, zoneStart.width + deltaX);
            updates.height = Math.max(minSize, zoneStart.height + deltaY);
            break;
          }
          case "resize-sw": {
            const newWidthSW = Math.max(minSize, zoneStart.width - deltaX);
            const newXSW = zoneStart.x + zoneStart.width - newWidthSW;
            updates.width = Math.round(newWidthSW);
            updates.x = Math.round(newXSW);
            updates.height = Math.max(minSize, zoneStart.height + deltaY);
            break;
          }
        }

        if (Object.keys(updates).length > 0) {
          onUpdate(updates);
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(null);
      setSnapGuides(EMPTY_SNAP_GUIDES);
    };

    if (isDragging || isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragStart, zoneStart, zone, scale, snapEnabled, frameWidth, frameHeight, onUpdate]);

  return { isDragging, isResizing, snapGuides, handleMouseDown };
}
