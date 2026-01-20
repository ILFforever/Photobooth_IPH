import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { useCollage } from '../../contexts/CollageContext';
import { Frame, FrameZone, FrameShape } from '../../types/frame';
import { generateFrameId } from '../../utils/frameTemplates';
import './FrameCreator.css';

// Drag and drop imports
import { useDrag, useDrop } from 'react-dnd';

const DRAG_TYPE = 'zone';

const CANVAS_SIZE = { width: 1200, height: 1800 };

// Draggable Zone Item Component
function ZoneItem({
  zone,
  index,
  isSelected,
  onToggle,
  onDelete,
  onMove,
  onSelect,
}: {
  zone: FrameZone;
  index: number;
  isSelected: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onMove: (dragIndex: number, hoverIndex: number) => void;
  onSelect: (zoneId: string) => void;
}) {
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

  return (
    <div
      ref={(node) => {
        drag(drop(node));
      }}
      className={`zone-item-wrapper ${isSelected ? 'expanded' : ''} ${isOver && canDrop && !isDragging ? 'drag-over' : ''}`}
      style={{ opacity: isDragging ? 0.3 : 1 }}
    >
      {/* Zone Item Header - Always Visible */}
      <div
        className={`zone-item ${isSelected ? 'selected' : ''}`}
        onClick={() => {
          onSelect(zone.id);
          onToggle();
        }}
      >
        <div className="zone-item-left">
          <div className="zone-drag-handle">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div className="zone-item-info">
            <span className="zone-item-number">
              {(() => {
                const match = zone.id.match(/zone-(\d+)/);
                return match ? match[1] : index + 1;
              })()}
            </span>
            <span className="zone-item-shape">
              {zone.shape === 'rounded_rect' ? '🔲' :
               zone.shape === 'circle' ? '⚪' :
               zone.shape === 'ellipse' ? '⬭' :
               zone.shape === 'pill' ? '💊' : '⬜'}
            </span>
            <span className="zone-item-size">
              {Math.round(zone.width)}×{Math.round(zone.height)}
            </span>
          </div>
        </div>
        <div className="zone-item-actions">
          <button
            className="zone-item-delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            ×
          </button>
          <span className="zone-item-chevron">
            {isSelected ? '▼' : '▶'}
          </span>
        </div>
      </div>

      {/* Zone Settings Dropdown - Only visible when selected */}
      {isSelected && (
        <div className="zone-settings-dropdown">
          <div className="control-row">
            <label>X:</label>
            <input
              type="number"
              value={zone.x}
              onChange={(e) => {
                const event = new CustomEvent('zoneUpdate', {
                  detail: { index, updates: { x: Number(e.target.value) } }
                });
                window.dispatchEvent(event);
              }}
            />
            <label>Y:</label>
            <input
              type="number"
              value={zone.y}
              onChange={(e) => {
                const event = new CustomEvent('zoneUpdate', {
                  detail: { index, updates: { y: Number(e.target.value) } }
                });
                window.dispatchEvent(event);
              }}
            />
          </div>
          <div className="control-row">
            <label>Width:</label>
            <input
              type="number"
              value={zone.width}
              onChange={(e) => {
                const event = new CustomEvent('zoneUpdate', {
                  detail: { index, updates: { width: Number(e.target.value) } }
                });
                window.dispatchEvent(event);
              }}
            />
            <label>Height:</label>
            <input
              type="number"
              value={zone.height}
              onChange={(e) => {
                const event = new CustomEvent('zoneUpdate', {
                  detail: { index, updates: { height: Number(e.target.value) } }
                });
                window.dispatchEvent(event);
              }}
            />
          </div>
          {zone.shape === 'rounded_rect' && (
            <div className="control-row control-row-full">
              <label>Roundness:</label>
              <input
                type="range"
                min="0"
                max="50"
                step="1"
                value={zone.borderRadius || 12}
                onChange={(e) => {
                  const event = new CustomEvent('zoneUpdate', {
                    detail: { index, updates: { borderRadius: Number(e.target.value) } }
                  });
                  window.dispatchEvent(event);
                }}
                style={{ flex: 1 }}
              />
              <span style={{ minWidth: '40px', textAlign: 'right' }}>
                {zone.borderRadius || 12}px
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FrameCreator() {
  const { reloadFrames, currentFrame, setCurrentFrame, placedImages, setPlacedImages, activeSidebarTab, copiedZone, setCopiedZone, selectedZone, setSelectedZone } = useCollage();
  const [newFrameName, setNewFrameName] = useState('');
  const [zones, setZones] = useState<FrameZone[]>([]);
  const [selectedZoneIndex, setSelectedZoneIndex] = useState<number | null>(null);
  const [selectedShape, setSelectedShape] = useState<FrameShape>('rectangle');
  const [previousFrame, setPreviousFrame] = useState<Frame | null>(null);
  const [previousImages, setPreviousImages] = useState<Map<string, any> | null>(null);
  const [showCopyNotification, setShowCopyNotification] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Create portal root for modals on mount
  useEffect(() => {
    const portalRoot = document.createElement('div');
    portalRoot.id = 'modal-portal-root';
    portalRoot.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 9999;';
    document.body.appendChild(portalRoot);

    return () => {
      document.body.removeChild(portalRoot);
    };
  }, []);

  // Handle zone reordering
  const moveZone = (dragIndex: number, hoverIndex: number) => {
    const updatedZones = [...zones];
    const [draggedZone] = updatedZones.splice(dragIndex, 1);
    updatedZones.splice(hoverIndex, 0, draggedZone);
    setZones(updatedZones);

    console.log('Zones reordered:', updatedZones.map(z => z.id));

    // Update selected zone index if needed
    if (selectedZoneIndex === dragIndex) {
      setSelectedZoneIndex(hoverIndex);
    } else if (selectedZoneIndex !== null) {
      if (dragIndex < selectedZoneIndex && hoverIndex >= selectedZoneIndex) {
        setSelectedZoneIndex(selectedZoneIndex - 1);
      } else if (dragIndex > selectedZoneIndex && hoverIndex <= selectedZoneIndex) {
        setSelectedZoneIndex(selectedZoneIndex + 1);
      }
    }

    // Update the blank frame to show zones on the canvas
    if (currentFrame?.id === 'system-blank') {
      setCurrentFrame({ ...currentFrame, zones: updatedZones });
    }
  };

  // Handle zone updates from dropdown inputs
  useEffect(() => {
    const handleZoneUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ index: number; updates: Partial<FrameZone> }>;
      const { index, updates } = customEvent.detail;
      const updated = [...zones];
      updated[index] = { ...updated[index], ...updates };
      setZones(updated);

      // Update the blank frame to show zones on the canvas
      if (currentFrame?.id === 'system-blank') {
        setCurrentFrame({ ...currentFrame, zones: updated });
      }
    };

    window.addEventListener('zoneUpdate', handleZoneUpdate);
    return () => window.removeEventListener('zoneUpdate', handleZoneUpdate);
  }, [zones, currentFrame, setCurrentFrame]);

  // Helper function to get the next zone ID
  const getNextZoneId = () => {
    // Extract all existing zone numbers
    const existingNumbers = zones
      .map(zone => {
        const match = zone.id.match(/zone-(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(num => num > 0);

    // Find the highest number and add 1
    const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
    return `zone-${maxNumber + 1}`;
  };

  // Sync zones with currentFrame when in frame creator mode
  useEffect(() => {
    if (activeSidebarTab === 'frames' && currentFrame?.id === 'system-blank') {
      setZones(currentFrame.zones);
      setSelectedZoneIndex(null);
    }
  }, [currentFrame?.zones, activeSidebarTab, currentFrame?.id]);

  // Trigger when activeSidebarTab changes to 'frames'
  useEffect(() => {
    if (activeSidebarTab === 'frames') {
      // Entering frame creator mode
      if (currentFrame && currentFrame.id !== 'system-blank') {
        setPreviousFrame(currentFrame);
        setPreviousImages(placedImages);

        // Switch to blank frame
        const blankFrame = {
          id: 'system-blank',
          name: 'Blank',
          description: 'Blank canvas with no zones',
          width: 1200,
          height: 1800,
          zones: [],
          is_default: true,
          created_at: new Date().toISOString(),
        };

        setCurrentFrame(blankFrame);
        setPlacedImages(new Map());
      }
    } else if (previousFrame && currentFrame?.id === 'system-blank') {
      // Leaving frame creator mode - restore
      setCurrentFrame(previousFrame);
      if (previousImages) {
        setPlacedImages(previousImages);
      }
      setPreviousFrame(null);
      setPreviousImages(null);
    }
  }, [activeSidebarTab, currentFrame, placedImages, setCurrentFrame, setPlacedImages]);

  // Handle keyboard shortcuts for copy/paste zones and save dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle save dialog shortcuts
      if (showSaveDialog) {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveFrame();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setShowSaveDialog(false);
        }
        return;
      }

      // Only handle copy/paste in frame creator mode
      if (activeSidebarTab !== 'frames') return;

      // Don't handle if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Ctrl+C or Cmd+C to copy zone
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedZoneIndex !== null && zones.length > 0) {
        const zone = zones[selectedZoneIndex];
        if (zone) {
          setCopiedZone(zone);
          setShowCopyNotification(true);
          setTimeout(() => setShowCopyNotification(false), 2000);
          console.log('Zone copied:', zone);
        }
      }

      // Ctrl+V or Cmd+V to paste zone
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && copiedZone) {
        // Create new zone with slight offset and sequential ID
        const newZone: FrameZone = {
          ...copiedZone,
          id: getNextZoneId(),
          x: Math.min(copiedZone.x + 20, CANVAS_SIZE.width - copiedZone.width - 10),
          y: Math.min(copiedZone.y + 20, CANVAS_SIZE.height - copiedZone.height - 10),
        };

        const updatedZones = [...zones, newZone];
        setZones(updatedZones);
        setSelectedZoneIndex(updatedZones.length - 1);

        // Update the blank frame to show zones on the canvas
        if (currentFrame?.id === 'system-blank') {
          setCurrentFrame({
            ...currentFrame,
            zones: updatedZones,
          });
        }

        console.log('Zone pasted:', newZone);
      }

      // Delete or Backspace to delete selected zone
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedZoneIndex !== null && zones.length > 0) {
        e.preventDefault();
        const updated = zones.filter((_, i) => i !== selectedZoneIndex);
        setZones(updated);
        setSelectedZoneIndex(null);

        // Update the blank frame to show zones on the canvas
        if (currentFrame?.id === 'system-blank') {
          setCurrentFrame({
            ...currentFrame,
            zones: updated,
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSidebarTab, selectedZoneIndex, zones, copiedZone, currentFrame, setCopiedZone, setCurrentFrame]);

  // Add a new zone
  const addZone = () => {
    const newZone: FrameZone = {
      id: getNextZoneId(),
      x: 100 + (zones.length % 3) * 350,
      y: 100 + Math.floor(zones.length / 3) * 400,
      width: 300,
      height: 300,
      rotation: 0,
      shape: selectedShape,
      ...(selectedShape === 'rounded_rect' ? { borderRadius: 12 } : {}),
    };
    const updatedZones = [...zones, newZone];
    setZones(updatedZones);
    setSelectedZoneIndex(zones.length);

    // Update the blank frame to show zones on the canvas
    if (currentFrame?.id === 'system-blank') {
      setCurrentFrame({
        ...currentFrame,
        zones: updatedZones,
      });
    }
  };

  // Save frame
  const saveFrame = async () => {
    if (!newFrameName.trim()) {
      alert('Please enter a frame name');
      return;
    }

    if (zones.length === 0) {
      alert('Please add at least one zone');
      return;
    }

    // Calculate canvas dimensions based on zone positions
    const maxX = Math.max(...zones.map(z => z.x + z.width));
    const maxY = Math.max(...zones.map(z => z.y + z.height));

    // Add some padding (10px) around the edges
    const padding = 10;
    const width = Math.max(maxX + padding, 100); // Minimum 100px width
    const height = Math.max(maxY + padding, 100); // Minimum 100px height

    // Round all zone coordinates to integers before saving
    const roundedZones = zones.map(zone => ({
      ...zone,
      x: Math.round(zone.x),
      y: Math.round(zone.y),
      width: Math.round(zone.width),
      height: Math.round(zone.height),
      rotation: Math.round(zone.rotation),
    }));

    const frame: Frame = {
      id: generateFrameId(),
      name: newFrameName.trim(),
      description: `Custom frame with ${zones.length} zone${zones.length > 1 ? 's' : ''}`,
      width: Math.round(width),
      height: Math.round(height),
      zones: roundedZones,
      is_default: false,
      created_at: new Date().toISOString(),
    };

    try {
      await invoke('save_frame', { frame });
      await reloadFrames();
      setNewFrameName('');
      setZones([]);
      setSelectedZoneIndex(null);
      setShowSaveDialog(false);
      alert('Frame saved successfully!');
    } catch (error) {
      console.error('Failed to save frame:', error);
      alert('Failed to save frame');
    }
  };

  // Clear all zones
  const clearZones = () => {
    if (zones.length === 0) return;
    if (confirm('Are you sure you want to clear all zones?')) {
      setZones([]);
      setSelectedZoneIndex(null);
      if (currentFrame?.id === 'system-blank') {
        setCurrentFrame({ ...currentFrame, zones: [] });
      }
    }
  };

  return (
    <div className="frame-creator">
      {/* Copy Notification */}
      {showCopyNotification && (
        <div className="copy-notification">
          Zone copied! Press Ctrl+V to paste
        </div>
      )}

      {/* Header */}
      <div className="working-folder-header">
        <h3>Layout Creator</h3>
      </div>

      {/* Shape Selection */}
      <div className="shape-selector">
        <h4>Zone Shape</h4>
        <div className="shape-buttons">
          {(['rectangle', 'circle', 'ellipse', 'rounded_rect', 'pill'] as FrameShape[]).map((shape) => {
            const getShapeStyle = () => {
              switch (shape) {
                case 'circle':
                  return '50%';
                case 'ellipse':
                  return '50% / 40%';
                case 'rounded_rect':
                  return '12px';
                case 'pill':
                  return '999px';
                default:
                  return '2px';
              }
            };

            const getShapeName = () => {
              switch (shape) {
                case 'rounded_rect': return 'Rounded';
                case 'circle': return 'Circle';
                case 'ellipse': return 'Ellipse';
                case 'pill': return 'Pill';
                default: return 'Rectangle';
              }
            };

            return (
              <button
                key={shape}
                className={`shape-btn ${selectedShape === shape ? 'active' : ''}`}
                onClick={() => setSelectedShape(shape)}
              >
                <div
                  className="shape-icon"
                  style={{
                    borderRadius: getShapeStyle(),
                  }}
                />
                <span>{getShapeName()}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Add Zone Button */}
      <button className="add-zone-btn" onClick={addZone}>
        {(() => {
          switch (selectedShape) {
            case 'rounded_rect': return '+ Add Rounded Zone';
            case 'circle': return '+ Add Circle Zone';
            case 'ellipse': return '+ Add Ellipse Zone';
            case 'pill': return '+ Add Pill Zone';
            default: return '+ Add Rectangle Zone';
          }
        })()}
      </button>

      {/* Zones List */}
      {zones.length > 0 && (
        <div className="zones-list">
          <h4 data-count={zones.length}>Zones</h4>
          <div className="zones-grid">
            {zones.map((zone, index) => {
              const isSelected = selectedZoneIndex === index;
              return (
                <ZoneItem
                  key={zone.id}
                  zone={zone}
                  index={index}
                  isSelected={isSelected}
                  onToggle={() => setSelectedZoneIndex(isSelected ? null : index)}
                  onDelete={() => {
                    const updated = zones.filter((_, i) => i !== index);
                    setZones(updated);
                    if (selectedZoneIndex === index) {
                      setSelectedZoneIndex(null);
                    } else if (selectedZoneIndex !== null && selectedZoneIndex > index) {
                      setSelectedZoneIndex(selectedZoneIndex - 1);
                    }
                    // Update the blank frame to show zones on the canvas
                    if (currentFrame?.id === 'system-blank') {
                      setCurrentFrame({
                        ...currentFrame,
                        zones: updated,
                      });
                    }
                  }}
                  onMove={moveZone}
                  onSelect={setSelectedZone}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Save & Clear Buttons - Bottom */}
      <div className="frame-actions">
        <button className="clear-zones-btn" onClick={clearZones}>
          Clear All
        </button>
        <button className="save-frame-btn" onClick={() => setShowSaveDialog(true)}>
          Save Layout
        </button>
      </div>

      {/* Save Dialog Modal */}
      {showSaveDialog && document.getElementById('modal-portal-root') && (
        createPortal(
          <div className="modal-overlay" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <h3>Save Layout</h3>
              <input
                type="text"
                placeholder="Enter layout name..."
                value={newFrameName}
                onChange={(e) => setNewFrameName(e.target.value)}
                className="frame-name-input"
                autoFocus
              />
              <div className="modal-actions">
                <button
                  className="modal-btn cancel-btn"
                  onClick={() => setShowSaveDialog(false)}
                >
                  Cancel
                </button>
                <button
                  className="modal-btn save-btn"
                  onClick={saveFrame}
                >
                  Save
                </button>
              </div>
            </div>
          </div>,
          document.getElementById('modal-portal-root')!
        )
      )}
    </div>
  );
}
