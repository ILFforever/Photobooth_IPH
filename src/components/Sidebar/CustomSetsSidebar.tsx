import { useState, useEffect } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { motion, AnimatePresence } from 'framer-motion';
import { useCollage } from '../../contexts/CollageContext';
import { CustomSet, CustomSetPreview } from '../../types/customSet';
import { Background } from '../../types/background';
import './CustomSetsSidebar.css';

interface SetPreviewData extends CustomSetPreview {
  previewInfo?: {
    canvasSize: string;
    frameName: string;
    backgroundName: string;
  };
}

export function CustomSetsSidebar() {
  const [customSets, setCustomSets] = useState<SetPreviewData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newSetName, setNewSetName] = useState('');
  const [newSetDescription, setNewSetDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingSetId, setDeletingSetId] = useState<string | null>(null);

  const {
    currentFrame,
    canvasSize,
    background,
    backgroundTransform,
    backgrounds,
    autoMatchBackground,
    setCurrentFrame,
    setCanvasSize,
    setBackground,
    setBackgroundTransform,
    setAutoMatchBackground,
    captureCanvasThumbnail,
    overlays,
    setOverlays,
  } = useCollage();

  useEffect(() => {
    loadCustomSets();
  }, []);

  const loadCustomSets = async () => {
    try {
      setLoading(true);
      const sets = await invoke<CustomSetPreview[]>('load_custom_sets');

      // Enrich preview data by loading full set info
      const enrichedSets = await Promise.all(
        sets.map(async (set) => {
          try {
            const fullSet = await invoke<CustomSet>('get_custom_set', { setId: set.id });
            return {
              ...set,
              previewInfo: {
                canvasSize: `${fullSet.canvasSize.width}x${fullSet.canvasSize.height}`,
                frameName: fullSet.frame.name,
                backgroundName: fullSet.background.name,
              }
            };
          } catch (error) {
            console.error('Failed to load full set data for preview:', error);
            return set;
          }
        })
      );

      setCustomSets(enrichedSets);
    } catch (error) {
      console.error('Failed to load custom sets:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSet = async () => {
    if (!newSetName.trim()) {
      alert('Please enter a name for the custom set');
      return;
    }

    if (!currentFrame || !canvasSize || !background) {
      alert('Please select a frame, canvas size, and background before creating a set');
      return;
    }

    // Normalize background value for comparison (handle both asset:// and http://asset.localhost/)
    const normalizeBackgroundValue = (value: string) => {
      if (value.startsWith('http://asset.localhost/')) {
        // Remove the protocol and decode the URL
        const path = value.replace('http://asset.localhost/', '');
        const decoded = decodeURIComponent(path);
        return `asset://${decoded}`;
      }
      return value;
    };

    const normalizedBackground = normalizeBackgroundValue(background);

    // Find the background object
    let backgroundObj = backgrounds.find(bg =>
      bg.value === background ||
      normalizeBackgroundValue(bg.value) === normalizedBackground
    );

    if (!backgroundObj) {
      console.error('Background not found in backgrounds array');
      console.error('Looking for background value:', background);
      console.error('Normalized background value:', normalizedBackground);
      console.error('Available backgrounds:', backgrounds.map(bg => ({ id: bg.id, value: bg.value })));

      // Create a temporary background object if not found (for solid colors or gradients)
      const tempBackground: Background = {
        id: `temp-${Date.now()}`,
        name: 'Custom Background',
        description: '',
        background_type: background.startsWith('#') || background.startsWith('rgb') ? 'color' :
                         background.startsWith('linear-gradient') ? 'gradient' : 'image',
        value: normalizedBackground,
        is_default: false,
        created_at: new Date().toISOString(),
      };

      console.log('Using temporary background object:', tempBackground);

      try {
        setSaving(true);

        // Capture thumbnail
        const thumbnailDataUrl = await captureCanvasThumbnail();

        const now = new Date().toISOString();
        const customSet: CustomSet = {
          id: '',
          name: newSetName.trim(),
          description: newSetDescription.trim(),
          canvasSize: {
            width: canvasSize.width,
            height: canvasSize.height,
            name: canvasSize.name,
            isCustom: canvasSize.isCustom || false,
            createdAt: canvasSize.createdAt || now,
          },
          autoMatchBackground: autoMatchBackground,
          background: tempBackground,
          backgroundTransform: {
            scale: backgroundTransform.scale,
            offsetX: backgroundTransform.offsetX,
            offsetY: backgroundTransform.offsetY,
          },
          frame: currentFrame,
          overlays: overlays,
          thumbnail: thumbnailDataUrl || undefined,
          createdAt: now,
          modifiedAt: now,
          isDefault: false,
        };

        await invoke('save_custom_set', { customSet });

        setNewSetName('');
        setNewSetDescription('');
        setShowCreateDialog(false);
        await loadCustomSets();
      } catch (error) {
        console.error('Failed to save custom set:', error);
        alert('Failed to save custom set: ' + error);
      } finally {
        setSaving(false);
      }

      return;
    }

    try {
      setSaving(true);

      // Capture thumbnail
      const thumbnailDataUrl = await captureCanvasThumbnail();

      const now = new Date().toISOString();
      const customSet: CustomSet = {
        id: '',
        name: newSetName.trim(),
        description: newSetDescription.trim(),
        canvasSize: {
          width: canvasSize.width,
          height: canvasSize.height,
          name: canvasSize.name,
          isCustom: canvasSize.isCustom || false,
          createdAt: canvasSize.createdAt || now,
        },
        autoMatchBackground: autoMatchBackground,
        background: backgroundObj,
        backgroundTransform: {
          scale: backgroundTransform.scale,
          offsetX: backgroundTransform.offsetX,
          offsetY: backgroundTransform.offsetY,
        },
        frame: currentFrame,
        overlays: overlays,
        thumbnail: thumbnailDataUrl || undefined,
        createdAt: now,
        modifiedAt: now,
        isDefault: false,
      };

      await invoke('save_custom_set', { customSet });

      setNewSetName('');
      setNewSetDescription('');
      setShowCreateDialog(false);
      await loadCustomSets();
    } catch (error) {
      console.error('Failed to save custom set:', error);
      alert('Failed to save custom set: ' + error);
    } finally {
      setSaving(false);
    }
  };

  const handleLoadSet = async (setId: string) => {
    try {
      const set = await invoke<CustomSet>('get_custom_set', { setId });

      // Apply the set configuration
      setCanvasSize({
        width: set.canvasSize.width,
        height: set.canvasSize.height,
        name: set.canvasSize.name,
        isCustom: set.canvasSize.isCustom,
        createdAt: set.canvasSize.createdAt,
      });

      setCurrentFrame(set.frame);
      setBackground(set.background.value);

      setBackgroundTransform({
        scale: set.backgroundTransform.scale,
        offsetX: set.backgroundTransform.offsetX,
        offsetY: set.backgroundTransform.offsetY,
      });

      // Restore auto-match background state
      setAutoMatchBackground(set.autoMatchBackground);

      // Restore overlays
      setOverlays(set.overlays || []);

      console.log('Custom set loaded successfully');
    } catch (error) {
      console.error('Failed to load custom set:', error);
      alert('Failed to load custom set: ' + error);
    }
  };

  const handleDeleteSet = async (setId: string) => {
    try {
      await invoke('delete_custom_set', { setId });
      setDeletingSetId(null);
      await loadCustomSets();
    } catch (error) {
      console.error('Failed to delete custom set:', error);
      alert('Failed to delete custom set: ' + error);
    }
  };

  const confirmDelete = (setId: string) => {
    setDeletingSetId(setId);
  };

  const cancelDelete = () => {
    setDeletingSetId(null);
  };

  return (
    <div className="custom-sets-sidebar">
      {/* Header */}
      <div className="custom-sets-header">
        <h3>Custom Sets</h3>
      </div>

      <div className="custom-sets-content">
        <div className="custom-sets-help">
          <p>Save combinations of canvas, background, and frame as reusable presets.</p>
        </div>

        <button
          className="create-set-button"
          onClick={() => setShowCreateDialog(true)}
          disabled={!currentFrame || !canvasSize || !background}
        >
          + Save Current Setup
        </button>

        {loading ? (
          <div className="custom-sets-loading">Loading sets...</div>
        ) : customSets.length === 0 ? (
          <div className="custom-sets-empty">
            <p>No custom sets yet.</p>
            <p>Create your first set to get started!</p>
          </div>
        ) : (
          <div className="saved-sets-section">
            <h4 data-count={customSets.length}>Saved Sets</h4>
            <div className="custom-sets-list">
              {customSets.map((set) => (
              <motion.div
                key={set.id}
                className="custom-set-card"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <div className="custom-set-thumbnail">
                  {set.thumbnail ? (
                    <img src={convertFileSrc(set.thumbnail.replace('asset://', ''))} alt={set.name} />
                  ) : (
                    <div className="custom-set-preview-placeholder">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {set.previewInfo && (
                        <div style={{ fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.4)', lineHeight: 1.3 }}>
                          <div>{set.previewInfo.canvasSize}</div>
                          <div>{set.previewInfo.frameName}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="custom-set-info">
                  <h3>{set.name}</h3>
                  {set.description && <p>{set.description}</p>}
                  {set.previewInfo && (
                    <p style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.4)', margin: '0.25rem 0' }}>
                      {set.previewInfo.backgroundName}
                    </p>
                  )}
                  <span className="custom-set-date">
                    {new Date(set.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="custom-set-actions">
                  {deletingSetId === set.id ? (
                    <>
                      <button
                        className="confirm-delete-button"
                        onClick={() => handleDeleteSet(set.id)}
                        title="Confirm delete"
                      >
                        Confirm
                      </button>
                      <button
                        className="cancel-delete-button"
                        onClick={cancelDelete}
                        title="Cancel delete"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="load-set-button"
                        onClick={() => handleLoadSet(set.id)}
                        title="Load this set"
                      >
                        Load
                      </button>
                      <button
                        className="delete-set-button"
                        onClick={() => confirmDelete(set.id)}
                        title="Delete this set"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showCreateDialog && (
          <motion.div
            className="custom-set-dialog-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !saving && setShowCreateDialog(false)}
          >
            <motion.div
              className="custom-set-dialog"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>Create Custom Set</h2>
              <div className="custom-set-form">
                <div className="form-group">
                  <label>Name *</label>
                  <input
                    type="text"
                    value={newSetName}
                    onChange={(e) => setNewSetName(e.target.value)}
                    placeholder="My Custom Set"
                    maxLength={50}
                    disabled={saving}
                  />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={newSetDescription}
                    onChange={(e) => setNewSetDescription(e.target.value)}
                    placeholder="Optional description"
                    rows={3}
                    maxLength={200}
                    disabled={saving}
                  />
                </div>
                <div className="form-preview">
                  <p><strong>Current Configuration:</strong></p>
                  <p>Canvas: {canvasSize?.name} ({canvasSize?.width}x{canvasSize?.height})</p>
                  <p>Frame: {currentFrame?.name}</p>
                  <p>Background: {backgrounds.find(bg => bg.value === background)?.name || 'Unknown'}</p>
                </div>
                <div className="form-actions">
                  <button
                    className="cancel-button"
                    onClick={() => setShowCreateDialog(false)}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    className="save-button"
                    onClick={handleCreateSet}
                    disabled={saving || !newSetName.trim()}
                  >
                    {saving ? 'Saving...' : 'Save Set'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
