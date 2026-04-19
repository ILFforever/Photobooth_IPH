import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useCollage } from '../../../contexts';
import { Frame, FrameZone, FrameShape } from '../../../types/frame';
import { generateFrameId } from '../../../utils/frameTemplates';
import { createLogger } from '../../../utils/logger';
import Icon from '@mdi/react';
import {
  mdiMagnet,
  mdiMagnetOn,
  mdiEyeOutline,
  mdiEyeClosed,
} from '@mdi/js';

import { ZoneItem } from './ZoneItem';
import { ShapeSelector } from './ShapeSelector';
import { FrameModals } from './FrameModals';

import './FrameCreator.css';

const logger = createLogger('FrameCreator');

const CANVAS_SIZE = { width: 1200, height: 1800 };

function FrameCreator() {
  const {
    reloadFrames,
    currentFrame,
    setCurrentFrame,
    placedImages,
    setPlacedImages,
    activeSidebarTab,
    copiedZone,
    setCopiedZone,
    setSelectedZone,
    showAllOverlays,
    setShowAllOverlays,
    snapEnabled,
    setSnapEnabled,
    customFrames,
    isFrameCreatorSaving,
    setIsFrameCreatorSaving,
  } = useCollage();

  // State
  const [newFrameName, setNewFrameName] = useState('');
  const [zones, setZones] = useState<FrameZone[]>([]);
  const [selectedZoneIndex, setSelectedZoneIndex] = useState<number | null>(null);
  const [draggedZoneIndex, setDraggedZoneIndex] = useState<number | null>(null);
  const [dragOverZoneIndex, setDragOverZoneIndex] = useState<number | null>(null);
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

  // Refs for stable event listeners
  const zonesRef = useRef<FrameZone[]>(zones);
  const currentFrameRef = useRef(currentFrame);
  const selectedZoneIndexRef = useRef(selectedZoneIndex);
  const copiedZoneRef = useRef(copiedZone);
  const showSaveDialogRef = useRef(showSaveDialog);
  const showReplaceConfirmRef = useRef(showReplaceConfirm);
  const activeSidebarTabRef = useRef(activeSidebarTab);
  const setZonesRef = useRef(setZones);
  const setSelectedZoneIndexRef = useRef(setSelectedZoneIndex);
  const setCopiedZoneRef = useRef(setCopiedZone);
  const setShowCopyNotificationRef = useRef(setShowCopyNotification);
  const setShowSaveDialogRef = useRef(setShowSaveDialog);
  const setSaveErrorRef = useRef(setSaveError);
  const setSaveSuccessRef = useRef(setSaveSuccess);
  const setCurrentFrameRef = useRef(setCurrentFrame);
  const newFrameNameRef = useRef(newFrameName);
  const isUpdatingFromEditorRef = useRef(false);

  // Update refs when state changes
  useEffect(() => {
    zonesRef.current = zones;
    currentFrameRef.current = currentFrame;
    selectedZoneIndexRef.current = selectedZoneIndex;
    copiedZoneRef.current = copiedZone;
    showSaveDialogRef.current = showSaveDialog;
    showReplaceConfirmRef.current = showReplaceConfirm;
    activeSidebarTabRef.current = activeSidebarTab;
    setZonesRef.current = setZones;
    setSelectedZoneIndexRef.current = setSelectedZoneIndex;
    setCopiedZoneRef.current = setCopiedZone;
    setShowCopyNotificationRef.current = setShowCopyNotification;
    setShowSaveDialogRef.current = setShowSaveDialog;
    setSaveErrorRef.current = setSaveError;
    setSaveSuccessRef.current = setSaveSuccess;
    setCurrentFrameRef.current = setCurrentFrame;
    newFrameNameRef.current = newFrameName;
  }, [
    zones,
    currentFrame,
    selectedZoneIndex,
    copiedZone,
    showSaveDialog,
    showReplaceConfirm,
    activeSidebarTab,
    setZones,
    setSelectedZoneIndex,
    setCopiedZone,
    setShowCopyNotification,
    setShowSaveDialog,
    setSaveError,
    setSaveSuccess,
    setCurrentFrame,
    newFrameName,
  ]);

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

    logger.debug('Zones reordered:', updatedZones.map(z => z.id));

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
      const zones = zonesRef.current;
      const currentFrame = currentFrameRef.current;
      const setZones = setZonesRef.current;
      const setCurrentFrame = setCurrentFrameRef.current;
      const updated = [...zones];
      updated[index] = { ...updated[index], ...updates };

      // Mark that this update is from the editor (not a frame load)
      isUpdatingFromEditorRef.current = true;
      setZones(updated);

      // Update the blank frame to show zones on the canvas
      if (currentFrame?.id === 'system-blank') {
        setCurrentFrame({ ...currentFrame, zones: updated });
      }

      // Clear flag after both updates complete (next tick)
      setTimeout(() => {
        isUpdatingFromEditorRef.current = false;
      }, 0);
    };

    // Only register once - stable listener
    window.addEventListener('zoneUpdate', handleZoneUpdate);
    return () => window.removeEventListener('zoneUpdate', handleZoneUpdate);
  }, []);

  // Helper function to get the next zone ID
  const getNextZoneId = useCallback(() => {
    // Extract all existing zone numbers
    const existingNumbers = zonesRef.current
      .map(zone => {
        const match = zone.id.match(/zone-(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(num => num > 0);

    // Find the highest number and add 1
    const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
    return `zone-${maxNumber + 1}`;
  }, []);

  // Sync zones with currentFrame when in frame creator mode
  useEffect(() => {
    if (activeSidebarTab === 'frames' && currentFrame?.id === 'system-blank') {
      // Check if this update is coming from the editor (not a frame load)
      if (isUpdatingFromEditorRef.current) {
        // Don't reset selection - zones are already in sync
        return;
      }
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
      } else if (!currentFrame || currentFrame.id !== 'system-blank') {
        // No frame selected - create a fresh blank frame for editing
        const blankFrame = {
          id: 'system-blank',
          name: 'Blank',
          description: 'Blank canvas with no zones',
          width: CANVAS_SIZE.width,
          height: CANVAS_SIZE.height,
          zones: [],
          is_default: true,
          created_at: new Date().toISOString(),
        };

        setZones([]);
        setNewFrameName('');
        setSelectedZoneIndex(null);
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
      // Ignore if event originated from the name input in save dialog
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
          saveFrame(newFrameName, false, true); // Enter triggers Save & Apply
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
          logger.debug('Zone copied:', zone);
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

        logger.debug('Zone pasted:', newZone);
      }

      // S to toggle snapping
      if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setSnapEnabled(!snapEnabled);
      }

      // H to toggle overlay visibility
      if (e.key === 'h' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowAllOverlays(!showAllOverlays);
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
  }, [
    activeSidebarTab,
    selectedZoneIndex,
    zones,
    copiedZone,
    currentFrame,
    setCopiedZone,
    setCurrentFrame,
    showSaveDialog,
    showReplaceConfirm,
    getNextZoneId,
    newFrameName,
    setShowSaveDialog,
    snapEnabled,
    setSnapEnabled,
    showAllOverlays,
    setShowAllOverlays,
  ]);

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
    const newZoneIndex = zones.length;

    // Update the blank frame to show zones on the canvas
    if (currentFrame?.id === 'system-blank') {
      setCurrentFrame({
        ...currentFrame,
        zones: updatedZones,
      });
    }

    // Set selected zone after frame update to prevent useEffect from resetting it
    setTimeout(() => {
      setSelectedZoneIndex(newZoneIndex);
    }, 0);
  };

  // Show save dialog
  const openSaveDialog = () => {
    setShowSaveDialog(true);
  };

  // Save frame
  const saveFrame = async (frameName: string, forceReplace = false, shouldApply = false) => {
    logger.debug('[saveFrame] Called with:', { frameName, forceReplace, shouldApply });

    const trimmedName = frameName.trim();

    if (!trimmedName) {
      setSaveError('Please enter a frame name');
      return;
    }

    if (zones.length === 0) {
      setSaveError('Please add at least one zone');
      return;
    }

    // Check if a frame with the same name already exists
    const existingFrame = customFrames.find(f => f.name.toLowerCase() === trimmedName.toLowerCase());

    if (existingFrame && !forceReplace) {
      setExistingFrameToReplace(existingFrame);
      setPendingApplyAfterSave(shouldApply);
      setShowReplaceConfirm(true);
      return;
    }

    // Calculate canvas dimensions based on zone positions
    const maxX = Math.max(...zones.map(z => z.x + z.width));
    const maxY = Math.max(...zones.map(z => z.y + z.height));

    // Add some padding (10px) around the edges
    const padding = 10;
    const width = Math.max(maxX + padding, 100);
    const height = Math.max(maxY + padding, 100);

    // Round all zone coordinates to integers before saving (unlocked)
    const roundedZones = zones.map(zone => ({
      ...zone,
      x: Math.round(zone.x),
      y: Math.round(zone.y),
      width: Math.round(zone.width),
      height: Math.round(zone.height),
      rotation: Math.round(zone.rotation),
      borderRadius: zone.borderRadius !== undefined ? Math.round(zone.borderRadius) : undefined,
      locked: false,
    }));

    const frame: Frame = {
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
      setExistingFrameToReplace(null);
      setSaveSuccess(true);

      // If apply after save, switch to the saved frame and exit frame creator
      if (shouldApply) {
        setTimeout(async () => {
          setShowSaveDialog(false);
          setSaveSuccess(false);
          setSaveError('');

          try {
            const loadedFrames = await invoke<Frame[]>('load_frames');
            const savedFrame = loadedFrames.find(f => f.id === frame.id);

            if (savedFrame) {
              setCurrentFrame(savedFrame);
              setPlacedImages(new Map());
            }
          } catch (error) {
            logger.error('[saveFrame] Failed to load saved frame:', error);
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
      logger.error('Failed to save frame:', error);
      setSaveError('Failed to save frame');
    }
  };

  // Handle replace confirmation
  const confirmReplace = () => {
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

  // Handle delete zone from zones list
  const handleDeleteZone = (index: number) => {
    const updated = zones.filter((_, i) => i !== index);
    setZones(updated);
    if (selectedZoneIndex === index) {
      setSelectedZoneIndex(null);
    } else if (selectedZoneIndex !== null && selectedZoneIndex > index) {
      setSelectedZoneIndex(selectedZoneIndex - 1);
    }
    if (currentFrame?.id === 'system-blank') {
      setCurrentFrame({ ...currentFrame, zones: updated });
    }
  };

  // Handle toggle lock
  const handleToggleLock = (index: number) => {
    const updated = zones.map((z, i) => (i === index ? { ...z, locked: !z.locked } : z));
    setZones(updated);
    if (currentFrame?.id === 'system-blank') {
      setCurrentFrame({ ...currentFrame, zones: updated });
    }
  };

  // Get add button text based on selected shape
  const getAddButtonText = (): string => {
    const shapeNames: Record<FrameShape, string> = {
      rectangle: '+ Add Rectangle Zone',
      rounded_rect: '+ Add Rounded Zone',
      circle: '+ Add Circle Zone',
      ellipse: '+ Add Oval Zone',
      pill: '+ Add Pill Zone',
      triangle: '+ Add Triangle Zone',
      pentagon: '+ Add Pentagon Zone',
      hexagon: '+ Add Hexagon Zone',
      octagon: '+ Add Octagon Zone',
      star: '+ Add Star Zone',
      diamond: '+ Add Diamond Zone',
      heart: '+ Add Heart Zone',
      cross: '+ Add Cross Zone',
    };
    return shapeNames[selectedShape];
  };

  return (
    <div className="frame-creator">
      {/* Copy Notification */}
      {showCopyNotification && (
        <div className="copy-notification">Zone copied! Press Ctrl+V to paste</div>
      )}

      {/* Header */}
      <div className="working-folder-header">
        <h3>Frame Creator</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`overlay-toggle-btn ${snapEnabled ? 'active' : ''}`}
            onClick={() => setSnapEnabled(!snapEnabled)}
            title={snapEnabled ? 'Snapping enabled' : 'Snapping disabled'}
          >
            <Icon path={snapEnabled ? mdiMagnetOn : mdiMagnet} size={0.8} />
          </button>
          <button
            className={`overlay-toggle-btn ${showAllOverlays ? 'active' : ''}`}
            onClick={() => setShowAllOverlays(!showAllOverlays)}
            title={showAllOverlays ? 'Hide overlays' : 'Show overlays'}
          >
            <Icon path={showAllOverlays ? mdiEyeOutline : mdiEyeClosed} size={0.8} />
          </button>
        </div>
      </div>

      <div className="frame-creator-content">
        {/* Shape Selection */}
        <ShapeSelector selectedShape={selectedShape} onShapeChange={setSelectedShape} />

        {/* Add Zone Button */}
        <button className="add-zone-btn" onClick={addZone}>
          {getAddButtonText()}
        </button>

        {/* Zones List */}
        {zones.length > 0 && (
          <div className="zones-list">
            <h4 data-count={zones.length}>Zones</h4>
            <div className="zones-grid">
              {zones.map((zone, index) => (
                <ZoneItem
                  key={zone.id}
                  zone={zone}
                  index={index}
                  isSelected={selectedZoneIndex === index}
                  onToggle={() => setSelectedZoneIndex(selectedZoneIndex === index ? null : index)}
                  onDelete={() => handleDeleteZone(index)}
                  onMove={moveZone}
                  onSelect={setSelectedZone}
                  onToggleLock={() => handleToggleLock(index)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Frame Actions Footer */}
        <div className="frame-actions-footer">
          <div className="frame-actions">
            <button className="new-frame-btn" onClick={startNew} title="Start fresh">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
            <button
              className="load-frame-btn"
              onClick={() => setShowLoadDialog(true)}
              disabled={customFrames.length === 0}
              title="Load frame"
            >
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
            <p>Ctrl+C / Ctrl+V - Copy / Paste</p>
            <p>Del - Delete zone</p>
            <p>↑ ↓ ← → / Shift - Nudge 1px / 10px</p>
            <p>S / H - Snapping / Overlays</p>
          </div>
        </div>
      </div>

      {/* Modals */}
      <FrameModals
        showSaveDialog={showSaveDialog}
        setShowSaveDialog={setShowSaveDialog}
        saveError={saveError}
        setSaveError={setSaveError}
        saveSuccess={saveSuccess}
        setSaveSuccess={setSaveSuccess}
        newFrameName={newFrameName}
        setNewFrameName={setNewFrameName}
        showReplaceConfirm={showReplaceConfirm}
        setShowReplaceConfirm={setShowReplaceConfirm}
        existingFrameToReplace={existingFrameToReplace}
        pendingApplyAfterSave={pendingApplyAfterSave}
        showLoadDialog={showLoadDialog}
        setShowLoadDialog={setShowLoadDialog}
        customFrames={customFrames}
        showNewConfirm={showNewConfirm}
        setShowNewConfirm={setShowNewConfirm}
        saveFrame={saveFrame}
        confirmReplace={confirmReplace}
        cancelReplace={cancelReplace}
        loadFrame={loadFrame}
        confirmNew={confirmNew}
      />
    </div>
  );
}

export default FrameCreator;
export { FrameCreator };
