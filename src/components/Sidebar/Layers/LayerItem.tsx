import { useRef } from 'react';
import { useDrag } from 'react-dnd';
import { OverlayLayer as OverlayLayerType } from '../../../types/overlay';
import { useAssetLibrary } from '../../../contexts/system/AssetLibraryContext';
import Icon from '@mdi/react';
import { mdiEyeOutline, mdiEyeOffOutline, mdiContentCopy, mdiDelete } from '@mdi/js';

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
  const { resolveAssetUrl } = useAssetLibrary();
  const thumbnailSrc = layer.thumbnail || resolveAssetUrl(layer.assetId);

  return (
    <div
      ref={(node) => {
        dragRef.current = node;
        drag(node);
      }}
      className={`layer-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={onSelect}
    >
      <div className="layer-thumbnail">
        {thumbnailSrc && <img src={thumbnailSrc} alt={layer.name} />}
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
