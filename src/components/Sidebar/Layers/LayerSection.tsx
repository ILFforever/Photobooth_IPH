import { useState, useRef } from 'react';
import { useDrop } from 'react-dnd';
import { OverlayLayer as OverlayLayerType, LayerPosition } from '../../../types/overlay';
import { LayerItem } from './LayerItem';

interface LayerSectionProps {
  title: string;
  position: LayerPosition;
  layers: OverlayLayerType[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onMoveLayer: (id: string, newPosition: LayerPosition, newOrder: number) => void;
}

export function LayerSection({
  title,
  position,
  layers,
  selectedId,
  onSelect,
  onDelete,
  onDuplicate,
  onToggleVisibility,
  onMoveLayer,
}: LayerSectionProps) {
  const [dragOverIndex, setDragOverIndex] = useState<number>(-1);
  const sectionRef = useRef<HTMLDivElement>(null);

  const [{ isOver }, drop] = useDrop({
    accept: 'OVERLAY_LAYER',
    drop: (item: { id: string }, monitor) => {
      setDragOverIndex(-1);
      if (monitor.didDrop()) return;

      const sourceId = item.id;
      const targetIndex = dragOverIndex === -1 ? layers.length : dragOverIndex;

      if (layers.find(l => l.id === sourceId)) {
        const currentIndex = layers.findIndex(l => l.id === sourceId);
        if (currentIndex === targetIndex) return;

        const adjustedIndex = targetIndex > currentIndex ? targetIndex - 1 : targetIndex;
        onMoveLayer(sourceId, position, adjustedIndex);
      } else {
        onMoveLayer(sourceId, position, targetIndex);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  drop(sectionRef);

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(index);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!sectionRef.current?.contains(relatedTarget)) {
      setDragOverIndex(-1);
    }
  };

  return (
    <div
      ref={sectionRef}
      className={`layer-section ${isOver ? 'drag-over' : ''}`}
      onDragLeave={handleDragLeave}
    >
      <div className="layer-section-header">
        <span className="layer-section-title">{title}</span>
        {layers.length > 0 && (
          <span className="layer-section-count">{layers.length}</span>
        )}
      </div>
      <div className="layers-list">
        {layers.map((layer, index) => (
          <div
            key={layer.id}
            className="layer-item-wrapper"
            onDragOver={(e) => handleDragOver(e, index)}
          >
            <LayerItem
              layer={layer}
              isSelected={selectedId === layer.id}
              onSelect={() => onSelect(layer.id)}
              onDelete={() => onDelete(layer.id)}
              onDuplicate={() => onDuplicate(layer.id)}
              onToggleVisibility={() => onToggleVisibility(layer.id)}
            />
            {dragOverIndex === index && (
              <div className="drop-indicator" />
            )}
          </div>
        ))}
        {layers.length === 0 && (
          <div className="empty-layers-hint">
            No overlays · drag here or use Add Overlays
          </div>
        )}
        {dragOverIndex === layers.length && layers.length > 0 && (
          <div className="drop-indicator" />
        )}
      </div>
    </div>
  );
}
