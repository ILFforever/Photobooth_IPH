import { useRef, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useCollage } from "../../../contexts";
import { useBackgroundLayer } from "../../../hooks/canvas/useBackgroundLayer";

export function BackgroundLayer() {
  const {
    background,
    backgroundTransform,
    setBackgroundTransform,
    isBackgroundSelected,
    setIsBackgroundSelected,
    setSelectedZone,
    setActiveSidebarTab,
    activeSidebarTab,
  } = useCollage();

  const bgRef = useRef<HTMLDivElement>(null);

  const isSolidColor = useMemo(() => {
    if (!background) return false;
    return /^#([0-9A-F]{3}){1,2}$/i.test(background);
  }, [background]);

  const bgSrc = useMemo(() => {
    if (!background || isSolidColor) return null;
    if (background.startsWith("http") || background.startsWith("data:")) {
      return background;
    }
    return convertFileSrc(background.replace("asset://", ""));
  }, [background, isSolidColor]);

  const { isDragging, snapGuides, handleMouseDown } = useBackgroundLayer({
    background,
    backgroundTransform,
    setBackgroundTransform,
    setIsBackgroundSelected,
    activeSidebarTab,
    bgRef,
  });

  if (!background) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeSidebarTab === "frames") return;
    setSelectedZone(null);
    setIsBackgroundSelected(true);
    setActiveSidebarTab("edit");
  };

  // For solid colors, render a div with backgroundColor instead of an img
  if (isSolidColor) {
    return (
      <div
        ref={bgRef}
        className={`canvas-background-layer ${isBackgroundSelected ? "selected" : ""}`}
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          cursor: isDragging ? "grabbing" : "grab",
          zIndex: 0,
          backgroundColor: background,
        }}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
      >
        {/* 3x3 Grid Overlay - shown when background is selected */}
        {isBackgroundSelected && (
          <div
            className="grid-overlay"
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          >
            <div className="grid-line grid-line-vertical" style={{ left: "33.33%" }} />
            <div className="grid-line grid-line-vertical" style={{ left: "66.67%" }} />
            <div className="grid-line grid-line-horizontal" style={{ top: "33.33%" }} />
            <div className="grid-line grid-line-horizontal" style={{ top: "66.67%" }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={bgRef}
      className={`canvas-background-layer ${isBackgroundSelected ? "selected" : ""}`}
      style={{
        position: "absolute",
        inset: 0,
        cursor: isDragging ? "grabbing" : "grab",
        zIndex: 0,
        overflow: "hidden",
      }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          transform: `
            scale(${backgroundTransform.scale})
            translate(${backgroundTransform.offsetX}px, ${backgroundTransform.offsetY}px)
          `,
          transition: isDragging ? "none" : "transform 0.2s ease",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img
          src={bgSrc ?? undefined}
          alt="Background"
          draggable={false}
          style={{
            maxWidth: "none",
            maxHeight: "none",
            display: "block",
          }}
        />
        {/* 3x3 Grid Overlay - shown when background is selected */}
        {isBackgroundSelected && (
          <div
            className="grid-overlay"
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
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
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              height: "100%",
              transform: "translateX(-50%)",
              pointerEvents: "none",
            }}
          />
        )}
        {snapGuides.centerV && (
          <div
            className="snap-guide snap-guide-horizontal"
            style={{
              position: "absolute",
              top: "50%",
              left: 0,
              width: "100%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
            }}
          />
        )}
        {snapGuides.horizontal && (
          <>
            <div
              className="snap-guide snap-guide-horizontal"
              style={{ position: "absolute", top: 0, left: 0, width: "100%", pointerEvents: "none" }}
            />
            <div
              className="snap-guide snap-guide-horizontal"
              style={{ position: "absolute", bottom: 0, left: 0, width: "100%", pointerEvents: "none" }}
            />
          </>
        )}
        {snapGuides.vertical && (
          <>
            <div
              className="snap-guide snap-guide-vertical"
              style={{ position: "absolute", left: 0, top: 0, height: "100%", pointerEvents: "none" }}
            />
            <div
              className="snap-guide snap-guide-vertical"
              style={{ position: "absolute", right: 0, top: 0, height: "100%", pointerEvents: "none" }}
            />
          </>
        )}
      </div>
      {/* Selection border */}
      {isBackgroundSelected && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "3px solid var(--accent-blue)",
            pointerEvents: "none",
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
}
