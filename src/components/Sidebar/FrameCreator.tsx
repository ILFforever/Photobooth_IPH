import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useCollage } from '../../contexts/CollageContext';
import { Frame, FrameZone, FrameShape } from '../../types/frame';
import { generateFrameId } from '../../utils/frameTemplates';
import './FrameCreator.css';

export default function FrameCreator() {
  const { reloadFrames, currentFrame, setCurrentFrame, placedImages, setPlacedImages, activeSidebarTab } = useCollage();
  const [newFrameName, setNewFrameName] = useState('');
  const [zones, setZones] = useState<FrameZone[]>([]);
  const [selectedZoneIndex, setSelectedZoneIndex] = useState<number | null>(null);
  const [selectedShape, setSelectedShape] = useState<FrameShape>('rectangle');
  const [previousFrame, setPreviousFrame] = useState<Frame | null>(null);
  const [previousImages, setPreviousImages] = useState<Map<string, any> | null>(null);

  const selectedZone = selectedZoneIndex !== null ? zones[selectedZoneIndex] : null;

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

  // Add a new zone
  const addZone = () => {
    const newZone: FrameZone = {
      id: `zone-${zones.length + 1}`,
      x: 100 + (zones.length % 3) * 350,
      y: 100 + Math.floor(zones.length / 3) * 400,
      width: 300,
      height: 300,
      rotation: 0,
      shape: selectedShape,
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

  // Update selected zone
  const updateZone = (updates: Partial<FrameZone>) => {
    if (selectedZoneIndex === null) return;
    const updated = [...zones];
    updated[selectedZoneIndex] = { ...updated[selectedZoneIndex], ...updates };
    setZones(updated);

    // Update the blank frame to show zones on the canvas
    if (currentFrame?.id === 'system-blank') {
      setCurrentFrame({
        ...currentFrame,
        zones: updated,
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

    const frame: Frame = {
      id: generateFrameId(),
      name: newFrameName.trim(),
      description: `Custom frame with ${zones.length} zone${zones.length > 1 ? 's' : ''}`,
      width: 1200,
      height: 1800,
      zones,
      is_default: false,
      created_at: new Date().toISOString(),
    };

    try {
      await invoke('save_frame', { frame });
      await reloadFrames();
      setNewFrameName('');
      setZones([]);
      setSelectedZoneIndex(null);
      alert('Frame saved successfully!');
    } catch (error) {
      console.error('Failed to save frame:', error);
      alert('Failed to save frame');
    }
  };

  return (
    <div className="frame-creator">
      {/* Header */}
      <div className="working-folder-header">
        <h3>Layout Creator</h3>
      </div>

      {/* Frame Name & Save */}
      <div className="frame-save-section">
        <input
          type="text"
          placeholder="Frame name..."
          value={newFrameName}
          onChange={(e) => setNewFrameName(e.target.value)}
          className="frame-name-input"
        />
        <button className="save-frame-btn" onClick={saveFrame}>
          Save Frame
        </button>
      </div>

      {/* Shape Selection */}
      <div className="shape-selector">
        <h4>Zone Shape</h4>
        <div className="shape-buttons">
          {(['rectangle', 'square', 'circle', 'ellipse', 'rounded_rect', 'rounded_rect_large', 'pill'] as FrameShape[]).map((shape) => {
            const getShapeStyle = () => {
              switch (shape) {
                case 'circle':
                  return '50%';
                case 'ellipse':
                  return '50% / 40%';
                case 'rounded_rect':
                  return '8px';
                case 'rounded_rect_large':
                  return '16px';
                case 'pill':
                  return '999px';
                case 'square':
                  return '2px';
                default:
                  return '2px';
              }
            };

            const getShapeName = () => {
              switch (shape) {
                case 'rounded_rect': return 'Rounded';
                case 'circle': return 'Circle';
                case 'ellipse': return 'Ellipse';
                case 'rounded_rect_large': return 'Rounded LG';
                case 'square': return 'Square';
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
            case 'rounded_rect_large': return '+ Add Rounded LG Zone';
            case 'square': return '+ Add Square Zone';
            case 'pill': return '+ Add Pill Zone';
            default: return '+ Add Rectangle Zone';
          }
        })()}
      </button>

      {/* Zones List */}
      {zones.length > 0 && (
        <div className="zones-list">
          <h4>Zones ({zones.length})</h4>
          <div className="zones-grid">
            {zones.map((zone, index) => (
              <div
                key={zone.id}
                className={`zone-item ${selectedZoneIndex === index ? 'selected' : ''}`}
                onClick={() => setSelectedZoneIndex(index)}
              >
                <div className="zone-item-info">
                  <span className="zone-item-number">{index + 1}</span>
                  <span className="zone-item-shape">
                    {zone.shape === 'rounded_rect' ? '🔲' :
                     zone.shape === 'circle' ? '⚪' :
                     zone.shape === 'ellipse' ? '⬭' :
                     zone.shape === 'rounded_rect_large' ? '▭' :
                     zone.shape === 'square' ? '⬛' :
                     zone.shape === 'pill' ? '💊' : '⬜'}
                  </span>
                  <span className="zone-item-size">
                    {zone.width}×{zone.height}
                  </span>
                </div>
                <button
                  className="zone-item-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    const updated = zones.filter((_, i) => i !== index);
                    setZones(updated);
                    if (selectedZoneIndex === index) {
                      setSelectedZoneIndex(null);
                    } else if (selectedZoneIndex !== null && selectedZoneIndex > index) {
                      setSelectedZoneIndex(selectedZoneIndex - 1);
                    }
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selected Zone Controls */}
      {selectedZone && (
        <div className="zone-controls">
          <h4>Zone {selectedZoneIndex! + 1} Settings</h4>
          <div className="control-row">
            <label>X:</label>
            <input
              type="number"
              value={selectedZone.x}
              onChange={(e) => updateZone({ x: Number(e.target.value) })}
            />
            <label>Y:</label>
            <input
              type="number"
              value={selectedZone.y}
              onChange={(e) => updateZone({ y: Number(e.target.value) })}
            />
          </div>
          <div className="control-row">
            <label>Width:</label>
            <input
              type="number"
              value={selectedZone.width}
              onChange={(e) => updateZone({ width: Number(e.target.value) })}
            />
            <label>Height:</label>
            <input
              type="number"
              value={selectedZone.height}
              onChange={(e) => updateZone({ height: Number(e.target.value) })}
            />
          </div>
          <div className="control-row">
            <label>Shape:</label>
            <select
              value={selectedZone.shape}
              onChange={(e) => updateZone({ shape: e.target.value as FrameShape })}
            >
              <option value="rectangle">Rectangle</option>
              <option value="square">Square</option>
              <option value="circle">Circle</option>
              <option value="ellipse">Ellipse</option>
              <option value="rounded_rect">Rounded</option>
              <option value="rounded_rect_large">Rounded LG</option>
              <option value="pill">Pill</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
