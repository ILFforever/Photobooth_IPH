import { useRef } from 'react';
import { useDrag } from 'react-dnd';
import { convertFileSrc } from '@tauri-apps/api/core';
import { OverlayLayer as OverlayLayerType } from '../../../types/overlay';
import Icon from '@mdi/react';
import { mdiEyeOutline, mdiEyeOffOutline, mdiContentCopy, mdiDelete, mdiDragVertical } from '@mdi/js';

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
      <div className="layer-drag-handle">
        <Icon path={mdiDragVertical} size={0.55} />
      </div>

      <div className="layer-thumbnail">
        <img
          src={
            (layer.thumbnail || layer.sourcePath).startsWith('asset://')
              ? convertFileSrc((layer.thumbnail || layer.sourcePath).replace('asset://', ''))
              : (layer.thumbnail || layer.sourcePath)
          }
          alt={layer.name}
        />
      </div>

      <div className="layer-info">
        <span className="layer-name" title={layer.name}>{layer.name}</span>
        <span className="layer-meta">
          {Math.round(layer.transform.opacity * 100)}%
          {layer.blendMode !== 'normal' && ` · ${layer.blendMode}`}
        </span>
      </div>

      <div className="layer-actions">
        <button
          className="layer-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          title="Duplicate (Ctrl+D)"
        >
          <Icon path={mdiContentCopy} size={0.55} />
        </button>
        <button
          className="layer-action-btn delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
        >
          <Icon path={mdiDelete} size={0.55} />
        </button>
        <button
          className={`layer-action-btn layer-vis-btn ${layer.visible ? '' : 'off'}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility();
          }}
          title={layer.visible ? 'Hide' : 'Show'}
        >
          <Icon path={layer.visible ? mdiEyeOutline : mdiEyeOffOutline} size={0.55} />
        </button>
      </div>
    </div>
  );
}
