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
  onToggleLock,
}: {
  zone: FrameZone;
  index: number;
  isSelected: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onMove: (dragIndex: number, hoverIndex: number) => void;
  onSelect: (zoneId: string) => void;
  onToggleLock: () => void;
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

  const isLocked = zone.locked || false;

  return (
    <div
      ref={(node) => {
        drag(drop(node));
      }}
      className={`zone-item-wrapper ${isSelected ? 'expanded' : ''} ${isOver && canDrop && !isDragging ? 'drag-over' : ''} ${isLocked ? 'locked' : ''}`}
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
               zone.shape === 'pill' ? '💊' :
               zone.shape === 'triangle' ? '🔺' :
               zone.shape === 'pentagon' ? '⬠' :
               zone.shape === 'hexagon' ? '⬡' :
               zone.shape === 'octagon' ? '⯃' :
               zone.shape === 'star' ? '⭐' :
               zone.shape === 'diamond' ? '💎' :
               zone.shape === 'heart' ? '❤️' :
               zone.shape === 'cross' ? '✚' : '⬜'}
            </span>
            <span className="zone-item-size">
              {Math.round(zone.width)}×{Math.round(zone.height)}
            </span>
          </div>
        </div>
        <div className="zone-item-actions">
          <button
            className={`zone-item-lock ${isLocked ? 'locked' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleLock();
            }}
            title={isLocked ? 'Unlock zone' : 'Lock zone'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isLocked ? (
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              ) : (
                <>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </>
              )}
            </svg>
          </button>
          <button
            className="zone-item-delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete zone"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
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
  const { reloadFrames, currentFrame, setCurrentFrame, placedImages, setPlacedImages, activeSidebarTab, setActiveSidebarTab, copiedZone, setCopiedZone, setSelectedZone, showAllOverlays, setShowAllOverlays, customFrames, isFrameCreatorSaving, setIsFrameCreatorSaving } = useCollage();
  const [newFrameName, setNewFrameName] = useState('');
  const [zones, setZones] = useState<FrameZone[]>([]);
  const [selectedZoneIndex, setSelectedZoneIndex] = useState<number | null>(null);
  const [selectedShape, setSelectedShape] = useState<FrameShape>('rectangle');
  const [previousFrame, setPreviousFrame] = useState<Frame | null>(null);
  const [previousImages, setPreviousImages] = useState<Map<string, any> | null>(null);
  const [showCopyNotification, setShowCopyNotification] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [showNewConfirm, setShowNewConfirm] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [existingFrameToReplace, setExistingFrameToReplace] = useState<Frame | null>(null);
  const [pendingApplyAfterSave, setPendingApplyAfterSave] = useState(false);

  // Use context state for save dialog (so canvas can check it)
  const showSaveDialog = isFrameCreatorSaving;
  const setShowSaveDialog = setIsFrameCreatorSaving;

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

        // Auto-load the current frame's zones into the editor
        const frameName = currentFrame.is_default ? '' : currentFrame.name;
        setZones(currentFrame.zones);
        setNewFrameName(frameName);
        setSelectedZoneIndex(null);

        // Switch to blank frame but keep the zones from the selected frame
        const blankFrame = {
          id: 'system-blank',
          name: 'Blank',
          description: 'Blank canvas with no zones',
          width: currentFrame.width,
          height: currentFrame.height,
          zones: currentFrame.zones,
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
      // Ignore if event originated from the name input in save dialog (it has its own handler)
      const target = e.target as HTMLElement;
      const isNameInput = target.classList.contains('frame-name-input');

      // Handle replace confirm dialog shortcuts
      if (showReplaceConfirm) {
        if (!isNameInput) {
          if (e.key === 'Enter') {
            e.preventDefault();
            confirmReplace();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelReplace();
          }
        }
        return;
      }

      // Handle save dialog shortcuts (but not if replace confirm is showing)
      if (showSaveDialog && !showReplaceConfirm && !isNameInput) {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveFrame(newFrameName, false, true); // Enter triggers Save & Apply (primary action)
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setShowSaveDialog(false);
          setSaveError('');
          setSaveSuccess(false);
        }
        return;
      }

      // Only handle copy/paste in frame creator mode
      if (activeSidebarTab !== 'frames') return;

      // Don't handle if user is typing in an input
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
  }, [activeSidebarTab, selectedZoneIndex, zones, copiedZone, currentFrame, setCopiedZone, setCurrentFrame, showSaveDialog, showReplaceConfirm]);

  // Add a new zone
  const addZone = () => {
    // Pill shape should be taller (portrait orientation)
    const isPill = selectedShape === 'pill';
    const zoneWidth = isPill ? 200 : 300;
    const zoneHeight = isPill ? 400 : 300;
    const padding = 20;

    // Calculate grid position
    let gridX = 100 + (zones.length % 3) * 350;
    let gridY = 100 + Math.floor(zones.length / 3) * 400;

    // Get canvas dimensions from current frame or use defaults
    const canvasWidth = currentFrame?.width || CANVAS_SIZE.width;
    const canvasHeight = currentFrame?.height || CANVAS_SIZE.height;

    // Calculate center of the zone
    const centerX = gridX + zoneWidth / 2;
    const centerY = gridY + zoneHeight / 2;

    // Check if center is within canvas bounds, if not adjust position
    let x = gridX;
    let y = gridY;

    if (centerX > canvasWidth - padding) {
      x = canvasWidth - zoneWidth - padding;
    }
    if (centerY > canvasHeight - padding) {
      y = canvasHeight - zoneHeight - padding;
    }

    // Ensure zone doesn't go off the left/top edges
    x = Math.max(padding, x);
    y = Math.max(padding, y);

    const newZone: FrameZone = {
      id: getNextZoneId(),
      x,
      y,
      width: zoneWidth,
      height: zoneHeight,
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

  // Show save dialog
  const openSaveDialog = () => {
    setShowSaveDialog(true);
  };

  // Save frame
  const saveFrame = async (frameName: string, forceReplace = false, shouldApply = false) => {
    console.log('[saveFrame] Called with:', { frameName, forceReplace, shouldApply });
    console.log('[saveFrame] Current state:', { newFrameName, showReplaceConfirm, pendingApplyAfterSave });

    const trimmedName = frameName.trim();
    console.log('[saveFrame] trimmedName:', trimmedName);

    if (!trimmedName) {
      console.log('[saveFrame] Error: empty name');
      setSaveError('Please enter a frame name');
      return;
    }

    if (zones.length === 0) {
      console.log('[saveFrame] Error: no zones');
      setSaveError('Please add at least one zone');
      return;
    }

    // Check if a frame with the same name already exists
    const existingFrame = customFrames.find(
      f => f.name.toLowerCase() === trimmedName.toLowerCase()
    );
    console.log('[saveFrame] existingFrame:', existingFrame?.name || 'none');

    if (existingFrame && !forceReplace) {
      console.log('[saveFrame] Showing replace confirm dialog');
      setExistingFrameToReplace(existingFrame);
      setPendingApplyAfterSave(shouldApply);
      setShowReplaceConfirm(true);
      return;
    }

    console.log('[saveFrame] Proceeding to save frame:', trimmedName);

    // Calculate canvas dimensions based on zone positions
    const maxX = Math.max(...zones.map(z => z.x + z.width));
    const maxY = Math.max(...zones.map(z => z.y + z.height));

    // Add some padding (10px) around the edges
    const padding = 10;
    const width = Math.max(maxX + padding, 100); // Minimum 100px width
    const height = Math.max(maxY + padding, 100); // Minimum 100px height

    // Round all zone coordinates to integers before saving (unlocked)
    const roundedZones = zones.map(zone => ({
      ...zone,
      x: Math.round(zone.x),
      y: Math.round(zone.y),
      width: Math.round(zone.width),
      height: Math.round(zone.height),
      rotation: Math.round(zone.rotation),
      borderRadius: zone.borderRadius !== undefined ? Math.round(zone.borderRadius) : undefined,
      locked: false, // Save as unlocked
    }));

    const frame: Frame = {
      // Use existing frame's ID if replacing, otherwise generate new one
      id: existingFrame ? existingFrame.id : generateFrameId(),
      name: trimmedName,
      description: `Custom frame with ${zones.length} zone${zones.length > 1 ? 's' : ''}`,
      width: Math.round(width),
      height: Math.round(height),
      zones: roundedZones,
      is_default: false,
      created_at: existingFrame ? existingFrame.created_at : new Date().toISOString(),
    };

    try {
      await invoke('save_frame', { frame });
      await reloadFrames();
      // Keep the zones on canvas, just clear the replace state
      setExistingFrameToReplace(null);
      setSaveSuccess(true);

      // If apply after save, apply the saved frame but stay in frame creator
      if (shouldApply) {
        setTimeout(() => {
          setShowSaveDialog(false);
          setSaveSuccess(false);
          setSaveError('');
          // Update the blank frame with the saved frame's data so it shows in the pill
          if (currentFrame?.id === 'system-blank') {
            setCurrentFrame({
              ...currentFrame,
              name: frame.name,
              width: frame.width,
              height: frame.height,
              zones: frame.zones,
            });
          }
        }, 800);
      } else {
        setTimeout(() => {
          setShowSaveDialog(false);
          setSaveSuccess(false);
          setSaveError('');
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to save frame:', error);
      setSaveError('Failed to save frame');
    }
  };

  // Handle replace confirmation
  const confirmReplace = () => {
    console.log('[confirmReplace] Called with:', { newFrameName, pendingApplyAfterSave });
    setShowReplaceConfirm(false);
    saveFrame(newFrameName, true, pendingApplyAfterSave);
  };

  const cancelReplace = () => {
    setShowReplaceConfirm(false);
    setExistingFrameToReplace(null);
    setPendingApplyAfterSave(false);
  };

  // Start new frame (clear current work)
  const startNew = () => {
    if (zones.length > 0) {
      setShowNewConfirm(true);
    } else {
      setZones([]);
      setSelectedZoneIndex(null);
      setNewFrameName('');
      if (currentFrame?.id === 'system-blank') {
        setCurrentFrame({ ...currentFrame, zones: [] });
      }
    }
  };

  const confirmNew = () => {
    setZones([]);
    setSelectedZoneIndex(null);
    setNewFrameName('');
    setShowNewConfirm(false);
    if (currentFrame?.id === 'system-blank') {
      setCurrentFrame({ ...currentFrame, zones: [] });
    }
  };

  // Load frame into editor
  const loadFrame = (frame: Frame) => {
    setZones(frame.zones);
    setNewFrameName(frame.name);
    setSelectedZoneIndex(null);
    setShowLoadDialog(false);
    if (currentFrame?.id === 'system-blank') {
      setCurrentFrame({ ...currentFrame, zones: frame.zones });
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
        <h3>Frame Creator</h3>
        <button
          className={`overlay-toggle-btn ${showAllOverlays ? 'active' : ''}`}
          onClick={() => setShowAllOverlays(!showAllOverlays)}
          title={showAllOverlays ? 'Hide overlays' : 'Show overlays'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            {showAllOverlays ? (
              <>
                <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="8" cy="8" r="2" strokeLinecap="round" strokeLinejoin="round"/>
              </>
            ) : (
              <>
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M1 1l22 22" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" strokeLinecap="round" strokeLinejoin="round"/>
              </>
            )}
          </svg>
        </button>
      </div>

      <div className="frame-creator-content">
        {/* Shape Selection */}
        <div className="shape-selector">
          <h4>Zone Shape</h4>
          <div className="shape-buttons">
            {(['rectangle', 'rounded_rect', 'circle', 'ellipse', 'pill', 'triangle', 'pentagon', 'hexagon', 'octagon', 'star', 'diamond', 'heart', 'cross'] as FrameShape[]).map((shape) => {
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

              const getClipPath = () => {
                switch (shape) {
                  case 'triangle':
                    return 'polygon(50% 0%, 0% 100%, 100% 100%)';
                  case 'pentagon':
                    return 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)';
                  case 'hexagon':
                    return 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
                  case 'octagon':
                    return 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)';
                  case 'star':
                    return 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
                  case 'diamond':
                    return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
                  case 'heart':
                    return 'polygon(50% 15%, 65% 0%, 85% 0%, 100% 15%, 100% 35%, 85% 50%, 50% 100%, 15% 50%, 0% 35%, 0% 15%, 15% 0%, 35% 0%)';
                  case 'cross':
                    return 'polygon(20% 0%, 80% 0%, 80% 20%, 100% 20%, 100% 80%, 80% 80%, 80% 100%, 20% 100%, 20% 80%, 0% 80%, 0% 20%, 20% 20%)';
                  default:
                    return 'none';
                }
              };

              const getShapeIcon = () => {
                switch (shape) {
                  case 'triangle': return '▲';
                  case 'pentagon': return '⬠';
                  case 'hexagon': return '⬡';
                  case 'octagon': return '⯃';
                  case 'star': return '★';
                  case 'diamond': return '◆';
                  case 'heart': return '♥';
                  case 'cross': return '✚';
                  case 'rounded_rect': return '▢';
                  default: return '';
                }
              };

              const getShapeName = () => {
                switch (shape) {
                  case 'rounded_rect': return 'Rounded';
                  case 'circle': return 'Circle';
                  case 'ellipse': return 'Oval';
                  case 'pill': return 'Pill';
                  case 'triangle': return 'Triangle';
                  case 'pentagon': return 'Pentagon';
                  case 'hexagon': return 'Hexagon';
                  case 'octagon': return 'Octagon';
                  case 'star': return 'Star';
                  case 'diamond': return 'Diamond';
                  case 'heart': return 'Heart';
                  case 'cross': return 'Cross';
                  default: return 'Rectangle';
                }
              };

              const clipPath = getClipPath();
              const shapeIcon = getShapeIcon();
              const isPolygonShape = clipPath !== 'none' || shape === 'rounded_rect';
              const isPill = shape === 'pill';

              return (
                <button
                  key={shape}
                  className={`shape-btn ${selectedShape === shape ? 'active' : ''}`}
                  onClick={() => setSelectedShape(shape)}
                >
                  {isPill ? (
                    <div
                      className="shape-icon"
                      style={{
                        borderRadius: '50% / 40%',
                        transform: 'rotate(-90deg)',
                      }}
                    />
                  ) : isPolygonShape ? (
                    <span className="shape-icon-text">{shapeIcon}</span>
                  ) : (
                    <div
                      className="shape-icon"
                      style={{
                        borderRadius: getShapeStyle(),
                      }}
                    />
                  )}
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
              case 'ellipse': return '+ Add Oval Zone';
              case 'pill': return '+ Add Pill Zone';
              case 'triangle': return '+ Add Triangle Zone';
              case 'pentagon': return '+ Add Pentagon Zone';
              case 'hexagon': return '+ Add Hexagon Zone';
              case 'octagon': return '+ Add Octagon Zone';
              case 'star': return '+ Add Star Zone';
              case 'diamond': return '+ Add Diamond Zone';
              case 'heart': return '+ Add Heart Zone';
              case 'cross': return '+ Add Cross Zone';
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
                    onToggleLock={() => {
                      const updated = zones.map((z, i) =>
                        i === index ? { ...z, locked: !z.locked } : z
                      );
                      setZones(updated);
                      if (currentFrame?.id === 'system-blank') {
                        setCurrentFrame({
                          ...currentFrame,
                          zones: updated,
                        });
                      }
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Save & Clear Buttons - Bottom */}
        <div className="frame-actions-footer">
          <div className="frame-actions">
            <button className="new-frame-btn" onClick={startNew} title="Start fresh">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
            <button className="load-frame-btn" onClick={() => setShowLoadDialog(true)} disabled={customFrames.length === 0} title="Load frame">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
            </button>
            <button className="save-frame-btn" onClick={openSaveDialog} title="Save frame">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
            </button>
          </div>

          {/* Keyboard Shortcuts Hint */}
          <div className="frame-shortcuts-hint">
            <p>Shortcuts:</p>
            <p>Ctrl+C - Copy zone</p>
            <p>Ctrl+V - Paste zone</p>
            <p>Del - Delete zone</p>
          </div>
        </div>
      </div>

      {/* Save Dialog Modal - Inline Overlay */}
      {showSaveDialog && (
        <div className="confirm-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon save-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
            </div>
            <h3>{saveSuccess ? 'Saved!' : 'Save Frame'}</h3>
            {!saveSuccess && (
              <input
                type="text"
                placeholder="Enter frame name..."
                value={newFrameName}
                onChange={(e) => {
                  setNewFrameName(e.target.value);
                  setSaveError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('[input onKeyDown] Enter pressed, calling saveFrame with:', newFrameName);
                    saveFrame(newFrameName, false, true);
                  }
                }}
                className="frame-name-input"
                autoFocus
              />
            )}
            {saveError && (
              <div className="save-error">{saveError}</div>
            )}
            {saveSuccess && (
              <p className="save-success-text">Frame saved successfully</p>
            )}
            {!saveSuccess && (
              <div className="save-dialog-actions">
                <button
                  className="confirm-btn primary full-width"
                  onClick={() => saveFrame(newFrameName, false, true)}
                  title="Save and apply this frame"
                >
                  Save & Apply
                </button>
                <div className="confirm-actions">
                  <button
                    className="confirm-btn cancel"
                    onClick={() => {
                      setShowSaveDialog(false);
                      setSaveError('');
                      setSaveSuccess(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="confirm-btn secondary"
                    onClick={() => saveFrame(newFrameName, false, false)}
                  >
                    Save Only
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Replace Confirmation Modal */}
      {showReplaceConfirm && (
        <div className="confirm-overlay" onClick={cancelReplace}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v4M12 17h.01"/>
                <path d="M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0z"/>
              </svg>
            </div>
            <h3>Replace Frame?</h3>
            <p>A frame named "<strong>{existingFrameToReplace?.name}</strong>" already exists. Do you want to replace it?</p>
            <div className="confirm-actions">
              <button className="confirm-btn cancel" onClick={cancelReplace}>
                Cancel
              </button>
              <button className="confirm-btn danger" onClick={confirmReplace}>
                Replace
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Dialog Modal */}
      {showLoadDialog && document.getElementById('modal-portal-root') && (
        createPortal(
          <div className="modal-overlay" onClick={() => setShowLoadDialog(false)}>
            <div className="modal-content load-dialog-content" onClick={(e) => e.stopPropagation()}>
              <h3>Load Frame</h3>
              <div className="frames-list">
                {customFrames.length === 0 ? (
                  <div className="empty-frames">No saved frames found</div>
                ) : (
                  customFrames.map((frame) => (
                    <div
                      key={frame.id}
                      className="saved-frame-item"
                      onClick={() => loadFrame(frame)}
                    >
                      <div className="frame-info">
                        <span className="frame-name">{frame.name}</span>
                        <span className="frame-zones-count">{frame.zones.length} zone{frame.zones.length !== 1 ? 's' : ''} · {frame.width}×{frame.height}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="modal-actions">
                <button
                  className="modal-btn cancel-btn"
                  onClick={() => setShowLoadDialog(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.getElementById('modal-portal-root')!
        )
      )}

      {/* New Confirm Modal - Inline Overlay */}
      {showNewConfirm && (
        <div className="confirm-overlay" onClick={() => setShowNewConfirm(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v4M12 17h.01"/>
                <path d="M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0z"/>
              </svg>
            </div>
            <h3>Clear All Zones?</h3>
            <p>Starting a new frame will clear your current work. This action cannot be undone.</p>
            <div className="confirm-actions">
              <button className="confirm-btn cancel" onClick={() => setShowNewConfirm(false)}>
                Cancel
              </button>
              <button className="confirm-btn danger" onClick={confirmNew}>
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
