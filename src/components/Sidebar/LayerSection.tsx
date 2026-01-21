import { useState, useRef } from 'react';
import { useDrop } from 'react-dnd';
import { OverlayLayer as OverlayLayerType, LayerPosition } from '../../types/overlay';
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
      if (monitor.didDrop()) return;

      const sourceId = item.id;
      // If dropping within same section, use dragOverIndex
      // If dropping from another section, place at end (dragOverIndex would be -1)
      const targetIndex = dragOverIndex === -1 ? layers.length : dragOverIndex;

      // Don't move if it's the same layer
      if (layers.find(l => l.id === sourceId)) {
        // Find current index of source layer
        const currentIndex = layers.findIndex(l => l.id === sourceId);
        if (currentIndex === targetIndex) return;

        // Adjust target index if moving down (since we're removing the source first)
        const adjustedIndex = targetIndex > currentIndex ? targetIndex - 1 : targetIndex;
        onMoveLayer(sourceId, position, adjustedIndex);
      } else {
        // Moving from another position group
        onMoveLayer(sourceId, position, targetIndex);
      }

      setDragOverIndex(-1);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  // Apply the drop ref to the section
  drop(sectionRef);

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(index);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear if leaving the entire section
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
      <h4 className="layer-section-title">{title}</h4>
      <div className="layers-list">
        {layers.map((layer, index) => (
          <div
            key={layer.id}
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
            Drop layers here
          </div>
        )}
        {dragOverIndex === layers.length && layers.length > 0 && (
          <div className="drop-indicator" />
        )}
      </div>
    </div>
  );
}
