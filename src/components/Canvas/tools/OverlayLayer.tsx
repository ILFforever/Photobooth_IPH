import { convertFileSrc } from '@tauri-apps/api/core';
import { OverlayLayer as OverlayLayerType } from '../../../types/overlay';
import { SnapGuides } from '../../../utils/canvas/snapUtils';
import { useOverlayEditing } from '../../../hooks/canvas/useOverlayEditing';
import './OverlayLayer.css';

interface OverlayLayerProps {
  layer: OverlayLayerType;
  isSelected: boolean;
  canvasWidth: number;
  canvasHeight: number;
  zIndex: number;
  interactive?: boolean;
  onSnapGuidesChange?: (guides: SnapGuides) => void;
  onSelect?: () => void;
  onUpdate?: (updates: Partial<OverlayLayerType>) => void;
  scale?: number;
  visible?: boolean;
  canvasSelector?: string;
}

export function OverlayLayer({
  layer,
  isSelected,
  canvasWidth,
  canvasHeight,
  zIndex,
  interactive = true,
  onSnapGuidesChange,
  onSelect,
  onUpdate,
  scale,
  visible = true,
  canvasSelector = '.collage-canvas',
}: OverlayLayerProps) {
  const { isDragging, isResizing, isRotating, snapGuides, handleMouseDown, overlayRef } = useOverlayEditing({
    layer,
    canvasWidth,
    canvasHeight,
    isSelected,
    onSelect: onSelect || (() => {}),
    onUpdate: onUpdate || (() => {}),
    scale,
    snapEnabled: true,
    onSnapGuidesChange,
    canvasSelector,
  });

  const transformStyle = `
    translate(${layer.transform.x}px, ${layer.transform.y}px)
    rotate(${layer.transform.rotation}deg)
    scale(${layer.transform.scale})
    scaleX(${layer.transform.flipHorizontal ? -1 : 1})
    scaleY(${layer.transform.flipVertical ? -1 : 1})
  `;

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: 'center center',
    transform: transformStyle,
    opacity: layer.transform.opacity,
    mixBlendMode: layer.blendMode as any,
    pointerEvents: interactive ? 'auto' : 'none',
    zIndex: zIndex,
    display: visible ? 'block' : 'none',
    willChange: 'transform',
  };

  return (
    <div
      ref={overlayRef}
      className={`overlay-layer ${isSelected ? 'selected' : ''} ${!interactive ? 'non-interactive' : ''}`}
      style={overlayStyle}
      onMouseDown={interactive ? (e) => handleMouseDown(e, 'drag') : undefined}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onSelect?.();
      }}
    >
      <img
        src={
          layer.sourcePath.startsWith('asset://')
            ? convertFileSrc(layer.sourcePath.replace('asset://', ''))
            : layer.sourcePath
        }
        alt={layer.name}
        draggable={false}
        style={{
          display: 'block',
          maxWidth: 'none',
          pointerEvents: 'none',
        }}
      />

      {isSelected && (
        <>
          <div className="overlay-selection-border" />
          <div className="resize-handle nw" onMouseDown={(e) => handleMouseDown(e, 'resize', 'nw')} />
          <div className="resize-handle ne" onMouseDown={(e) => handleMouseDown(e, 'resize', 'ne')} />
          <div className="resize-handle sw" onMouseDown={(e) => handleMouseDown(e, 'resize', 'sw')} />
          <div className="resize-handle se" onMouseDown={(e) => handleMouseDown(e, 'resize', 'se')} />
          <div className="rotation-handle" onMouseDown={(e) => handleMouseDown(e, 'rotate')} />
        </>
      )}
    </div>
  );
}
