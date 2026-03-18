import { FrameZone } from "../../../types/frame";
import { useZoneEditing } from "../../../hooks/canvas/useZoneEditing";

export interface EditableZoneProps {
  zone: FrameZone;
  zIndex: number;
  frameWidth: number;
  frameHeight: number;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<FrameZone>) => void;
  scale?: number;
  snapEnabled?: boolean;
}

// Generate consistent color based on zone ID
function getZoneColor(id: string): string {
  const colors = [
    "rgba(239, 68, 68, 0.3)",
    "rgba(249, 115, 22, 0.3)",
    "rgba(234, 179, 8, 0.3)",
    "rgba(132, 204, 22, 0.3)",
    "rgba(6, 182, 212, 0.3)",
    "rgba(59, 130, 246, 0.3)",
    "rgba(139, 92, 246, 0.3)",
    "rgba(236, 72, 153, 0.3)",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getBorderRadius(zone: FrameZone): string {
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

function getClipPath(zone: FrameZone): string | undefined {
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

function getZoneLabel(zone: FrameZone): string {
  const match = zone.id.match(/zone-(\d+)/);
  if (match) {
    return `Zone ${match[1]}`;
  }
  return zone.id;
}

export function EditableZone({
  zone,
  zIndex,
  frameWidth,
  frameHeight,
  isSelected,
  onSelect,
  onUpdate,
  scale,
  snapEnabled,
}: EditableZoneProps) {
  const zoomScale = scale ?? 1;
  const isLocked = zone.locked || false;

  const { isDragging, isResizing, snapGuides, handleMouseDown } = useZoneEditing({
    zone,
    frameWidth,
    frameHeight,
    isSelected,
    onSelect,
    onUpdate,
    scale,
    snapEnabled,
  });

  const minBorderWidth = 1.5;
  const borderWidthPx = Math.min(Math.max(minBorderWidth / zoomScale, 0.5), 2);
  const clipPath = getClipPath(zone);

  const zoneStyle = {
    position: "absolute" as const,
    left: `${zone.x}px`,
    top: `${zone.y}px`,
    width: `${zone.width}px`,
    height: `${zone.height}px`,
    border: isSelected
      ? `${borderWidthPx}px solid var(--accent-blue)`
      : `${borderWidthPx}px dashed ${isLocked ? "rgba(255, 100, 100, 0.4)" : "rgba(0, 0, 0, 0.3)"}`,
    borderRadius: getBorderRadius(zone),
    clipPath: clipPath,
    cursor: isLocked ? "not-allowed" : "move",
    backgroundColor: getZoneColor(zone.id),
    pointerEvents: "auto" as const,
    display: "flex",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    zIndex: zIndex as number,
  };

  const cornerHandleSize = Math.min(12 / zoomScale, 12);
  const edgeHandleLength = Math.min(24 / zoomScale, 24);
  const handleBorderWidth = Math.min(2 / zoomScale, 2);
  const handleOffset = Math.min(6 / zoomScale, 6);

  const handleStyle = {
    position: "absolute" as const,
    width: `${cornerHandleSize}px`,
    height: `${cornerHandleSize}px`,
    backgroundColor: "var(--accent-blue)",
    border: `${handleBorderWidth}px solid white`,
    borderRadius: "2px",
    zIndex: 1000,
  };

  const edgeHandleStyle = {
    position: "absolute" as const,
    width: `${edgeHandleLength}px`,
    height: `${cornerHandleSize}px`,
    backgroundColor: "var(--accent-blue)",
    border: `${handleBorderWidth}px solid white`,
    borderRadius: "2px",
    zIndex: 1000,
  };

  return (
    <div
      style={zoneStyle}
      onMouseDown={(e) => handleMouseDown(e)}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!isLocked) onSelect();
      }}
    >
      {/* Zone label in center - counter-scaled to maintain readable size */}
      <span
        style={{
          color: "white",
          fontWeight: "600",
          fontSize: `${Math.min(32 / zoomScale, 48)}px`,
          textShadow: "0 1px 3px rgba(0,0,0,0.5)",
          pointerEvents: "none",
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        {getZoneLabel(zone)}
      </span>

      {/* Lock indicator overlay when locked */}
      {isLocked && (
        <div
          style={{
            position: "absolute",
            top: "4px",
            right: "4px",
            fontSize: `${Math.min(14 / zoomScale, 16)}px`,
            fontWeight: "600",
            color: "rgba(255, 100, 100, 0.9)",
            textShadow: "0 1px 2px rgba(0,0,0,0.5)",
            opacity: 0.8,
            pointerEvents: "none",
          }}
        >
          LOCKED
        </div>
      )}

      {/* Snap guides - shown when selected and dragging */}
      {isSelected &&
        (snapGuides.centerH ||
          snapGuides.centerV ||
          snapGuides.left ||
          snapGuides.right ||
          snapGuides.top ||
          snapGuides.bottom) && (
          <>
            {/* Center vertical guide (canvas center X) */}
            {snapGuides.centerH && (
              <div
                style={{
                  position: "absolute",
                  left: `${frameWidth / 2 - zone.x}px`,
                  top: `${-zone.y}px`,
                  height: `${frameHeight}px`,
                  width: "1px",
                  backgroundColor: "rgba(59, 130, 246, 0.8)",
                  pointerEvents: "none",
                  zIndex: 2000,
                }}
              />
            )}
            {/* Center horizontal guide (canvas center Y) */}
            {snapGuides.centerV && (
              <div
                style={{
                  position: "absolute",
                  top: `${frameHeight / 2 - zone.y}px`,
                  left: `${-zone.x}px`,
                  width: `${frameWidth}px`,
                  height: "1px",
                  backgroundColor: "rgba(59, 130, 246, 0.8)",
                  pointerEvents: "none",
                  zIndex: 2000,
                }}
              />
            )}
            {/* Left edge guide (canvas x=0) */}
            {snapGuides.left && (
              <div
                style={{
                  position: "absolute",
                  left: `${-zone.x}px`,
                  top: `${-zone.y}px`,
                  height: `${frameHeight}px`,
                  width: "1px",
                  backgroundColor: "rgba(59, 130, 246, 0.8)",
                  pointerEvents: "none",
                  zIndex: 2000,
                }}
              />
            )}
            {/* Right edge guide (canvas x=frameWidth) */}
            {snapGuides.right && (
              <div
                style={{
                  position: "absolute",
                  left: `${frameWidth - zone.x}px`,
                  top: `${-zone.y}px`,
                  height: `${frameHeight}px`,
                  width: "1px",
                  backgroundColor: "rgba(59, 130, 246, 0.8)",
                  pointerEvents: "none",
                  zIndex: 2000,
                }}
              />
            )}
            {/* Top edge guide (canvas y=0) */}
            {snapGuides.top && (
              <div
                style={{
                  position: "absolute",
                  top: `${-zone.y}px`,
                  left: `${-zone.x}px`,
                  width: `${frameWidth}px`,
                  height: "1px",
                  backgroundColor: "rgba(59, 130, 246, 0.8)",
                  pointerEvents: "none",
                  zIndex: 2000,
                }}
              />
            )}
            {/* Bottom edge guide (canvas y=frameHeight) */}
            {snapGuides.bottom && (
              <div
                style={{
                  position: "absolute",
                  top: `${frameHeight - zone.y}px`,
                  left: `${-zone.x}px`,
                  width: `${frameWidth}px`,
                  height: "1px",
                  backgroundColor: "rgba(59, 130, 246, 0.8)",
                  pointerEvents: "none",
                  zIndex: 2000,
                }}
              />
            )}
          </>
        )}

      {isSelected && !isLocked && (
        <>
          {/* Corner handles */}
          <div
            style={{
              ...handleStyle,
              top: `${-handleOffset}px`,
              left: `${-handleOffset}px`,
              cursor: "nw-resize",
            }}
            onMouseDown={(e) => handleMouseDown(e, "resize-nw")}
          />
          <div
            style={{
              ...handleStyle,
              top: `${-handleOffset}px`,
              right: `${-handleOffset}px`,
              cursor: "ne-resize",
            }}
            onMouseDown={(e) => handleMouseDown(e, "resize-ne")}
          />
          <div
            style={{
              ...handleStyle,
              bottom: `${-handleOffset}px`,
              left: `${-handleOffset}px`,
              cursor: "sw-resize",
            }}
            onMouseDown={(e) => handleMouseDown(e, "resize-sw")}
          />
          <div
            style={{
              ...handleStyle,
              bottom: `${-handleOffset}px`,
              right: `${-handleOffset}px`,
              cursor: "se-resize",
            }}
            onMouseDown={(e) => handleMouseDown(e, "resize-se")}
          />

          {/* Edge handles */}
          <div
            style={{
              ...edgeHandleStyle,
              top: `${-handleOffset}px`,
              left: "50%",
              transform: "translateX(-50%)",
              cursor: "n-resize",
            }}
            onMouseDown={(e) => handleMouseDown(e, "resize-n")}
          />
          <div
            style={{
              ...edgeHandleStyle,
              bottom: `${-handleOffset}px`,
              left: "50%",
              transform: "translateX(-50%)",
              cursor: "s-resize",
            }}
            onMouseDown={(e) => handleMouseDown(e, "resize-s")}
          />
          <div
            style={{
              ...edgeHandleStyle,
              left: `${-handleOffset}px`,
              top: "50%",
              transform: "translateY(-50%)",
              width: `${cornerHandleSize}px`,
              height: `${edgeHandleLength}px`,
              cursor: "w-resize",
            }}
            onMouseDown={(e) => handleMouseDown(e, "resize-w")}
          />
          <div
            style={{
              ...edgeHandleStyle,
              right: `${-handleOffset}px`,
              top: "50%",
              transform: "translateY(-50%)",
              width: `${cornerHandleSize}px`,
              height: `${edgeHandleLength}px`,
              cursor: "e-resize",
            }}
            onMouseDown={(e) => handleMouseDown(e, "resize-e")}
          />
        </>
      )}
    </div>
  );
}
