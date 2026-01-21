import { useRef } from 'react';
import { useDrag } from 'react-dnd';
import { OverlayLayer as OverlayLayerType } from '../../types/overlay';

interface LayerItemProps {
  layer: OverlayLayerType;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleVisibility: () => void;
}

export function LayerItem({
  layer,
  isSelected,
  onSelect,
  onDelete,
  onDuplicate,
  onToggleVisibility,
}: LayerItemProps) {
  const [{ isDragging }, drag] = useDrag({
    type: 'OVERLAY_LAYER',
    item: { id: layer.id },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const dragRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={(node) => {
        dragRef.current = node;
        drag(node);
      }}
      className={`layer-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={onSelect}
    >
      {/* Visibility toggle */}
      <button
        className={`visibility-toggle ${layer.visible ? 'visible' : 'hidden'}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisibility();
        }}
        title={layer.visible ? 'Hide' : 'Show'}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          {layer.visible ? (
            <path d="M8 3C4.5 3 1.73 5.61 1 9c.73 3.39 3.5 6 7 6s6.27-2.61 7-6c-.73-3.39-3.5-6-7-6zm0 10c-2.48 0-4.5-2.02-4.5-4.5S5.52 4 8 4s4.5 2.02 4.5 4.5S10.48 13 8 13zm0-7c-1.38 0-2.5 1.12-2.5 2.5S6.62 11 8 11s2.5-1.12 2.5-2.5S9.38 6 8 6z" />
          ) : (
            <path d="M8 3C4.5 3 1.73 5.61 1 9c.73 3.39 3.5 6 7 6s6.27-2.61 7-6c-.73-3.39-3.5-6-7-6zM4 9c.22-.99.71-1.88 1.4-2.6L8 8.5 10.6 6.4c.69.72 1.18 1.61 1.4 2.6-.22.99-.71 1.88-1.4 2.6L8 9.5 5.4 11.6c-.69-.72-1.18-1.61-1.4-2.6zm8.41-4.18L12 5.23l-.59-.59L10.82 6.23l.59.59L12 4.82zm-4.82 5.18L6.59 9.41l-.59.59L7.18 11.59l.59-.59L7.18 10zm5.18-2.59L12 6.41l-.59-.59L10.18 7.41l.59.59L12.36 7.41z" />
          )}
        </svg>
      </button>

      {/* Thumbnail */}
      <div className="layer-thumbnail">
        <img src={layer.thumbnail || layer.sourcePath} alt={layer.name} />
      </div>

      {/* Name */}
      <span className="layer-name" title={layer.name}>{layer.name}</span>

      {/* Blend mode badge */}
      <span className="blend-mode-badge" title={`Blend mode: ${layer.blendMode}`}>
        {layer.blendMode === 'normal' ? 'N' : layer.blendMode.slice(0, 2).toUpperCase()}
      </span>

      {/* Opacity value */}
      <span className="opacity-value" title={`Opacity: ${Math.round(layer.transform.opacity * 100)}%`}>
        {Math.round(layer.transform.opacity * 100)}%
      </span>

      {/* Actions */}
      <div className="layer-actions">
        <button
          className="layer-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          title="Duplicate (Ctrl+D)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M4 4H2V2h2v2zm0 8H2v-2h2v2zm4-4H6V6h2v2zm4 4h-2v-2h2v2zm0-8h-2V6h2v2z" />
          </svg>
        </button>
        <button
          className="layer-action-btn delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M6 6v4h2V6H6zm3-5v1H5V1H3v1H1v2h12V2h-2V1H9zm3 12H2V6h10v7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
