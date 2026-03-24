import { useState, useEffect, useCallback, RefObject } from "react";
import { BackgroundTransform } from "../../contexts/collage/CollageContext";
import {
  EdgeSnapGuides,
  EMPTY_EDGE_SNAP_GUIDES,
  calculateBackgroundDragSnap,
} from "../../utils/canvas/snapUtils";

interface UseBackgroundLayerProps {
  background: string | null;
  backgroundTransform: BackgroundTransform;
  setBackgroundTransform: (transform: BackgroundTransform) => void;
  setIsBackgroundSelected: (selected: boolean) => void;
  activeSidebarTab: string;
  bgRef: RefObject<HTMLDivElement | null>;
}

interface UseBackgroundLayerReturn {
  isDragging: boolean;
  snapGuides: EdgeSnapGuides;
  handleMouseDown: (e: React.MouseEvent) => void;
}

const SNAP_THRESHOLD = 10;

export function useBackgroundLayer({
  background,
  backgroundTransform,
  setBackgroundTransform,
  setIsBackgroundSelected,
  activeSidebarTab,
  bgRef,
}: UseBackgroundLayerProps): UseBackgroundLayerReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [transformStart, setTransformStart] = useState({ x: 0, y: 0 });
  const [snapGuides, setSnapGuides] = useState<EdgeSnapGuides>(EMPTY_EDGE_SNAP_GUIDES);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!background) return;
      if (activeSidebarTab === "frames") return;
      e.stopPropagation();
      setIsDragging(true);
      setIsBackgroundSelected(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setTransformStart({
        x: backgroundTransform.offsetX,
        y: backgroundTransform.offsetY,
      });
    },
    [background, backgroundTransform, setIsBackgroundSelected, activeSidebarTab],
  );

  useEffect(() => {
    if (isDragging) {
      const handleGlobalMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        const rawOffsetX = transformStart.x + deltaX;
        const rawOffsetY = transformStart.y + deltaY;

        // Read container dimensions from the ref at move time (matches original behaviour)
        const containerWidth = bgRef.current?.offsetWidth || 0;
        const containerHeight = bgRef.current?.offsetHeight || 0;

        const scale = backgroundTransform.scale;
        const overflowX = (containerWidth * scale - containerWidth) / 2;
        const overflowY = (containerHeight * scale - containerHeight) / 2;

        const result = calculateBackgroundDragSnap(
          rawOffsetX,
          rawOffsetY,
          overflowX,
          overflowY,
          SNAP_THRESHOLD,
        );

        setSnapGuides(result.guides);
        setBackgroundTransform({
          ...backgroundTransform,
          offsetX: result.newOffsetX,
          offsetY: result.newOffsetY,
        });
      };

      const handleGlobalMouseUp = () => {
        setIsDragging(false);
        setSnapGuides(EMPTY_EDGE_SNAP_GUIDES);
      };

      window.addEventListener("mousemove", handleGlobalMouseMove);
      window.addEventListener("mouseup", handleGlobalMouseUp);

      return () => {
        window.removeEventListener("mousemove", handleGlobalMouseMove);
        window.removeEventListener("mouseup", handleGlobalMouseUp);
      };
    }
  }, [isDragging, dragStart, transformStart, backgroundTransform, setBackgroundTransform, bgRef]);

  return { isDragging, snapGuides, handleMouseDown };
}
