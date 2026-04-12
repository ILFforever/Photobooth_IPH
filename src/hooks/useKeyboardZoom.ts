import { MutableRefObject, useEffect } from "react";

/**
 * Handles Ctrl+Plus / Ctrl+Minus / Ctrl+0 keyboard zoom.
 * Uses refs for stable callbacks — no stale closures.
 *
 * @param localZoomRef       Ref to current zoom value
 * @param setLocalZoomRef    Ref to local zoom setter
 * @param setZoomCenterRef   Ref to zoom center setter
 * @param setCanvasZoomRef   Optional ref to context zoom setter (CollageCanvas only)
 */
export function useKeyboardZoom(
  localZoomRef: MutableRefObject<number>,
  setLocalZoomRef: MutableRefObject<(v: number) => void>,
  setZoomCenterRef: MutableRefObject<(p: { x: number; y: number }) => void>,
  setCanvasZoomRef?: MutableRefObject<(v: number) => void>,
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "=" || e.key === "+" || e.key === "NumpadAdd") {
        e.preventDefault();
        const newZoom = Math.max(0.5, Math.min(3, localZoomRef.current + 0.1));
        setZoomCenterRef.current({ x: 0, y: 0 });
        setLocalZoomRef.current(newZoom);
        setCanvasZoomRef?.current(newZoom);
      } else if (e.key === "-" || e.key === "NumpadSubtract") {
        e.preventDefault();
        const newZoom = Math.max(0.5, Math.min(3, localZoomRef.current - 0.1));
        setZoomCenterRef.current({ x: 0, y: 0 });
        setLocalZoomRef.current(newZoom);
        setCanvasZoomRef?.current(newZoom);
      } else if (e.key === "0") {
        e.preventDefault();
        setZoomCenterRef.current({ x: 0, y: 0 });
        setLocalZoomRef.current(1);
        setCanvasZoomRef?.current(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // Stable — uses refs only
}
