import { useState, useEffect, useRef, useCallback } from 'react';
import { SnapGuides, EMPTY_SNAP_GUIDES, calculateOverlayDragSnap } from '../../utils/canvas/snapUtils';
import { OverlayLayer as OverlayLayerType } from '../../types/overlay';

interface UseOverlayEditingProps {
  layer: OverlayLayerType;
  canvasWidth: number;
  canvasHeight: number;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<OverlayLayerType>) => void;
  scale?: number;
  snapEnabled?: boolean;
  onSnapGuidesChange?: (guides: SnapGuides) => void;
  canvasSelector?: string;
}

interface UseOverlayEditingReturn {
  isDragging: boolean;
  isResizing: string | null;
  isRotating: boolean;
  snapGuides: SnapGuides;
  handleMouseDown: (e: React.MouseEvent, action: string, handle?: string) => void;
  overlayRef: React.RefObject<HTMLDivElement | null>;
}

const SNAP_THRESHOLD = 8;

export function useOverlayEditing({
  layer,
  canvasWidth,
  canvasHeight,
  isSelected,
  onSelect,
  onUpdate,
  scale,
  snapEnabled,
  onSnapGuidesChange,
  canvasSelector = '.collage-canvas',
}: UseOverlayEditingProps): UseOverlayEditingReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [isRotating, setIsRotating] = useState(false);
  const [snapGuides, setSnapGuides] = useState<SnapGuides>(EMPTY_SNAP_GUIDES);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const transformStartRef = useRef(layer.transform);
  const overlayRef = useRef<HTMLDivElement>(null);
  const displayScale = useRef(1);

  useEffect(() => {
    const canvasEl = document.querySelector(canvasSelector) as HTMLElement;
    if (canvasEl && canvasWidth) {
      const rect = canvasEl.getBoundingClientRect();
      displayScale.current = rect.width / canvasWidth;
    }
  }, [canvasWidth, scale]);

  const handleMouseDown = useCallback((e: React.MouseEvent, action: string, handle?: string) => {
    e.stopPropagation();
    e.preventDefault();

    if (!isSelected) {
      onSelect();
    }

    if (action === 'drag') {
      setIsDragging(true);
    } else if (action === 'resize') {
      setIsResizing(handle || 'se');
    } else if (action === 'rotate') {
      setIsRotating(true);
    }

    dragStartRef.current = { x: e.clientX, y: e.clientY };
    transformStartRef.current = { ...layer.transform };
  }, [layer, isSelected, onSelect]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging && !isResizing && !isRotating) return;

      const deltaX = (e.clientX - dragStartRef.current.x) / displayScale.current;
      const deltaY = (e.clientY - dragStartRef.current.y) / displayScale.current;

      if (isDragging) {
        const rawX = transformStartRef.current.x + deltaX;
        const rawY = transformStartRef.current.y + deltaY;

        if (snapEnabled !== false) {
          const adjustedSnapThreshold = SNAP_THRESHOLD / displayScale.current;
          const overlayEl = overlayRef.current;
          const overlayWidth = overlayEl ? overlayEl.offsetWidth / displayScale.current : 0;
          const overlayHeight = overlayEl ? overlayEl.offsetHeight / displayScale.current : 0;

          const result = calculateOverlayDragSnap(
            rawX,
            rawY,
            overlayWidth,
            overlayHeight,
            canvasWidth,
            canvasHeight,
            adjustedSnapThreshold,
          );

          setSnapGuides(result.guides);
          onSnapGuidesChange?.(result.guides);
          onUpdate({
            transform: {
              ...layer.transform,
              x: result.finalX,
              y: result.finalY,
            },
          });
        } else {
          setSnapGuides(EMPTY_SNAP_GUIDES);
          onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);
          onUpdate({
            transform: {
              ...layer.transform,
              x: rawX,
              y: rawY,
            },
          });
        }
      } else if (isResizing) {
        setSnapGuides(EMPTY_SNAP_GUIDES);
        onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);

        let scaleDelta = 0;
        const handle = isResizing;

        switch (handle) {
          case 'nw':
            scaleDelta = -(deltaX + deltaY) / 800;
            break;
          case 'ne':
            scaleDelta = -(deltaY - deltaX) / 800;
            break;
          case 'sw':
            scaleDelta = (deltaY - deltaX) / 800;
            break;
          case 'se':
            scaleDelta = (deltaX + deltaY) / 800;
            break;
        }

        const scaleFactor = transformStartRef.current.scale + scaleDelta;

        onUpdate({
          transform: {
            ...layer.transform,
            scale: Math.max(0.1, Math.min(5, scaleFactor)),
          },
        });
      } else if (isRotating) {
        setSnapGuides(EMPTY_SNAP_GUIDES);
        onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);

        const angleDelta = (deltaX + deltaY) * 0.5;

        onUpdate({
          transform: {
            ...layer.transform,
            rotation: transformStartRef.current.rotation + angleDelta,
          },
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(null);
      setIsRotating(false);
      setSnapGuides(EMPTY_SNAP_GUIDES);
      onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    if (isDragging || isResizing || isRotating) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, isRotating, layer, scale, snapEnabled, canvasWidth, canvasHeight, onUpdate, onSnapGuidesChange]);

  useEffect(() => {
    if (!isSelected) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!ARROW_KEYS.includes(e.key)) return;

      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;

      const delta = {
        ArrowUp:    { x: 0, y: -step },
        ArrowDown:  { x: 0, y:  step },
        ArrowLeft:  { x: -step, y: 0 },
        ArrowRight: { x:  step, y: 0 },
      }[e.key]!;

      const newX = layer.transform.x + delta.x;
      const newY = layer.transform.y + delta.y;

      onUpdate({
        transform: {
          ...layer.transform,
          x: newX,
          y: newY,
        },
      });

      const overlayEl = overlayRef.current;
      const overlayWidth = overlayEl ? overlayEl.offsetWidth / displayScale.current : 0;
      const overlayHeight = overlayEl ? overlayEl.offsetHeight / displayScale.current : 0;

      const centerH = Math.abs((newX + overlayWidth / 2) - canvasWidth / 2) <= 1;
      const centerV = Math.abs((newY + overlayHeight / 2) - canvasHeight / 2) <= 1;
      setSnapGuides({ ...EMPTY_SNAP_GUIDES, centerH, centerV });
      onSnapGuidesChange?.({ ...EMPTY_SNAP_GUIDES, centerH, centerV });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (ARROW_KEYS.includes(e.key)) {
        setSnapGuides(EMPTY_SNAP_GUIDES);
        onSnapGuidesChange?.(EMPTY_SNAP_GUIDES);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSelected, layer.transform.x, layer.transform.y, canvasWidth, canvasHeight, onUpdate, onSnapGuidesChange]);

  return { isDragging, isResizing, isRotating, snapGuides, handleMouseDown, overlayRef };
}
