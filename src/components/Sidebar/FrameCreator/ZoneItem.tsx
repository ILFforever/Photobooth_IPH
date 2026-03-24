import { useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import Icon from '@mdi/react';
import {
  mdiSquareRoundedOutline,
  mdiCircleOutline,
  mdiTriangleOutline,
  mdiHexagonOutline,
  mdiOctagon,
  mdiStarOutline,
  mdiDiamondStone,
  mdiHeartOutline,
  mdiPlus,
  mdiSquareOutline,
  mdiLock,
  mdiLockOpenVariant,
} from '@mdi/js';
import { FrameZone } from '../../../types/frame';
import './ZoneItem.css';

export const DRAG_TYPE = 'zone';

interface ZoneItemProps {
  zone: FrameZone;
  index: number;
  isSelected: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onMove: (dragIndex: number, hoverIndex: number) => void;
  onSelect: (zoneId: string) => void;
  onToggleLock: () => void;
}

export function ZoneItem({
  zone,
  index,
  isSelected,
  onToggle,
  onDelete,
  onMove,
  onSelect,
  onToggleLock,
}: ZoneItemProps) {
  const [dragHandled, setDragHandled] = useState(false);

  const [{ isDragging }, drag] = useDrag({
    type: DRAG_TYPE,
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [{ isOver, canDrop }, drop] = useDrop({
    accept: DRAG_TYPE,
    hover(item: { index: number }) {
      if (item.index === index) return;
      onMove(item.index, index);
      item.index = index;
    },
    collect: (monitor) => ({
      isOver: monitor.isOver({ shallow: true }),
      canDrop: monitor.canDrop(),
    }),
  });

  const isLocked = zone.locked || false;

  return (
    <div
      ref={(node) => { drag(drop(node)); }}
      className={`zone-item-wrapper ${isSelected ? 'expanded' : ''} ${isOver && canDrop && !isDragging ? 'drag-over' : ''} ${isLocked ? 'locked' : ''}`}
      style={{ opacity: isDragging ? 0.3 : 1 }}
    >
      {/* Zone Header — always visible */}
      <div
        className={`zone-item ${isSelected ? 'selected' : ''}`}
        onClick={() => {
          if (!dragHandled) {
            onSelect(zone.id);
            onToggle();
          }
          setDragHandled(false);
        }}
      >
        <div className="zone-item-left">
          <div
            className="zone-drag-handle"
            onMouseDown={() => setDragHandled(true)}
            onMouseUp={() => setDragHandled(true)}
            onClick={(e) => {
              e.stopPropagation();
              setDragHandled(false);
            }}
          >
            <span /><span /><span />
          </div>
          <div className="zone-item-info">
            <span className="zone-item-number">
              {(() => {
                const match = zone.id.match(/zone-(\d+)/);
                return match ? match[1] : index + 1;
              })()}
            </span>
            <span className="zone-item-shape">
              {zone.shape === 'rounded_rect' ? <Icon path={mdiSquareRoundedOutline} size={0.8} /> :
               zone.shape === 'circle'       ? <Icon path={mdiCircleOutline} size={0.8} /> :
               zone.shape === 'ellipse'      ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="12" rx="10" ry="6"/></svg> :
               zone.shape === 'pill'         ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="2" width="12" height="20" rx="6"/></svg> :
               zone.shape === 'triangle'     ? <Icon path={mdiTriangleOutline} size={0.8} /> :
               zone.shape === 'pentagon'     ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L22 9L18 21H6L2 9L12 2Z"/></svg> :
               zone.shape === 'hexagon'      ? <Icon path={mdiHexagonOutline} size={0.8} /> :
               zone.shape === 'octagon'      ? <Icon path={mdiOctagon} size={0.8} /> :
               zone.shape === 'star'         ? <Icon path={mdiStarOutline} size={0.8} /> :
               zone.shape === 'diamond'      ? <Icon path={mdiDiamondStone} size={0.8} /> :
               zone.shape === 'heart'        ? <Icon path={mdiHeartOutline} size={0.8} /> :
               zone.shape === 'cross'        ? <Icon path={mdiPlus} size={0.8} /> :
                                               <Icon path={mdiSquareOutline} size={0.8} />}
            </span>
            <span className="zone-item-size">
              {Math.round(zone.width)}×{Math.round(zone.height)}
            </span>
          </div>
        </div>
        <div className="zone-item-actions">
          <button
            className={`zone-item-lock ${isLocked ? 'locked' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
            title={isLocked ? 'Unlock zone' : 'Lock zone'}
          >
            <Icon path={isLocked ? mdiLock : mdiLockOpenVariant} size={0.6} />
          </button>
          <button
            className="zone-item-delete"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete zone"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Zone Properties Panel — visible when selected */}
      {isSelected && (
        <div className="zone-props-panel">
          <div className="zone-props-grid">
            {(['x', 'y', 'width', 'height'] as const).map((field) => (
              <div key={field} className="zone-prop-field">
                <label>{field === 'x' ? 'X' : field === 'y' ? 'Y' : field === 'width' ? 'Width' : 'Height'}</label>
                <input
                  type="number"
                  value={zone[field]}
                  onChange={(e) => {
                    window.dispatchEvent(new CustomEvent('zoneUpdate', {
                      detail: { index, updates: { [field]: Number(e.target.value) } }
                    }));
                  }}
                />
              </div>
            ))}
          </div>
          {zone.shape === 'rounded_rect' && (
            <div className="zone-prop-roundness">
              <label>Radius</label>
              <input
                type="range"
                min="0"
                max="50"
                step="1"
                value={zone.borderRadius || 12}
                onChange={(e) => {
                  window.dispatchEvent(new CustomEvent('zoneUpdate', {
                    detail: { index, updates: { borderRadius: Number(e.target.value) } }
                  }));
                }}
              />
              <span className="zone-prop-roundness-value">{zone.borderRadius || 12}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
