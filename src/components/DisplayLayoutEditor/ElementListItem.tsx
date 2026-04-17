import { Icon } from '@mdi/react';
import { mdiEye, mdiEyeOff, mdiDelete, mdiDragVertical } from '@mdi/js';
import { DisplayElement } from '../../types/displayLayout';
import { convertFileSrc } from '@tauri-apps/api/core';

interface ElementListItemProps {
  element: DisplayElement;
  isSelected: boolean;
  draggedId: string | null;
  dragOverId: string | null;
  onUpdateElement: (id: string, updates: Partial<DisplayElement>) => void;
  onRemoveElement: (id: string) => void;
  onSelectElement: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent, id: string) => void;
}

const getRoleIconPath = (role: string) => {
  const icons: Record<string, string> = {
    collage: 'mdiViewQuilt',
    qr: 'mdiQrcode',
    text: 'mdiFormatText',
    logo: 'mdiImageOutline',
    gif: 'mdiFilmstrip',
  };
  return icons[role] || 'mdiImageOutline';
};

const getRoleLabel = (role: string) => {
  const labels: Record<string, string> = {
    collage: 'Collage',
    qr: 'QR Code',
    text: 'Text',
    logo: 'Image',
    gif: 'GIF',
    emoji: 'Emoji',
  };
  return labels[role] || role;
};

const getShapePreview = (element: DisplayElement) => {
  const fill = element.shapeFill ?? '#3b82f6';
  const clipPaths: Record<string, string> = {
    triangle:  'polygon(50% 0%, 0% 100%, 100% 100%)',
    diamond:   'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
    star:      'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
    hexagon:   'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
    pentagon:  'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)',
    cross:     'polygon(20% 0%, 80% 0%, 80% 20%, 100% 20%, 100% 80%, 80% 80%, 80% 100%, 20% 100%, 20% 80%, 0% 80%, 0% 20%, 20% 20%)',
  };
  const borderRadius =
    element.shapeType === 'circle' ? '50%' :
    element.shapeType === 'rounded-rectangle' ? '4px' :
    element.shapeType === 'line' ? '1px' : '2px';
  const clipPath = element.shapeType ? clipPaths[element.shapeType] : undefined;
  const isLine = element.shapeType === 'line';
  return (
    <div style={{
      width: isLine ? '80%' : '65%',
      height: isLine ? 3 : '65%',
      background: fill,
      borderRadius,
      clipPath,
      flexShrink: 0,
    }} />
  );
};

const getPreviewContent = (element: DisplayElement) => {
  if (element.role === 'shape') {
    return getShapePreview(element);
  }
  if (element.role === 'emoji' && element.textContent) {
    return (
      <div style={{ fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
        {element.textContent}
      </div>
    );
  }
  if ((element.role === 'logo' || element.role === 'gif') && element.sourcePath) {
    return (
      <img
        src={element.sourcePath.startsWith('asset://')
          ? convertFileSrc(element.sourcePath.replace('asset://', ''))
          : element.sourcePath}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
  }

  return (
    <div className="element-list-thumb-icon">
      <Icon path={getRoleIconPath(element.role)} size={0.7} />
    </div>
  );
};

export function ElementListItem({
  element,
  isSelected,
  draggedId,
  dragOverId,
  onUpdateElement,
  onRemoveElement,
  onSelectElement,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: ElementListItemProps) {
  return (
    <div
      className={`element-list-item ${isSelected ? 'selected' : ''}`}
      style={{
        opacity: draggedId === element.id ? 0.5 : 1,
        borderTop: dragOverId === element.id && draggedId !== element.id ? '2px solid var(--accent-color)' : '',
      }}
      onClick={() => onSelectElement(element.id)}
      draggable
      onDragStart={(e) => onDragStart(e, element.id)}
      onDragOver={(e) => onDragOver(e, element.id)}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDrop(e, element.id)}
    >
      <div className="element-list-drag">
        <Icon path={mdiDragVertical} size={0.75} />
      </div>

      <div className="element-list-item-inner">
        <div className="element-list-thumb">
          {getPreviewContent(element)}
        </div>

        <div className="element-list-info">
          <span className="element-list-name">{getRoleLabel(element.role)}</span>
          <span className="element-list-meta">
            {element.role === 'text' && element.textContent
              ? `"${element.textContent.slice(0, 20)}${element.textContent.length > 20 ? '...' : ''}"`
              : `Layer ${element.layerOrder}`}
          </span>
        </div>

        <div className="element-list-actions">
          <button
            className="element-list-action-btn"
            onClick={(e) => { e.stopPropagation(); onUpdateElement(element.id, { visible: !element.visible }); }}
            title={element.visible ? 'Hide' : 'Show'}
          >
            <Icon path={element.visible ? mdiEye : mdiEyeOff} size={0.55} />
          </button>
          <button
            className="element-list-action-btn danger"
            onClick={(e) => { e.stopPropagation(); onRemoveElement(element.id); }}
            title="Delete"
          >
            <Icon path={mdiDelete} size={0.55} />
          </button>
        </div>
      </div>
    </div>
  );
}
