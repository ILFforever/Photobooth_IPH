import { useState, useEffect, useCallback } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Upload, Play, Trash2, X, CheckCircle, AlertCircle } from 'lucide-react';
import { useCollage } from '../../../contexts';
import { CustomSet, CustomSetPreview } from '../../../types/customSet';
import { Background } from '../../../types/background';
import './CustomSetsSidebar.css';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('CustomSetsSidebar');

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}
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
  const [importing, setImporting] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

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
    setBackgroundDimensions,
    captureCanvasThumbnail,
    overlays,
    setOverlays,
    setSelectedCustomSetName,
    setBackgrounds,
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
            logger.error('Failed to load full set data for preview:', error);
            return set;
          }
        })
      );

      setCustomSets(enrichedSets);
    } catch (error) {
      logger.error('Failed to load custom sets:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSet = async () => {
    if (!newSetName.trim()) {
      showToast('Please enter a name for the custom set', 'error');
      return;
    }

    if (!currentFrame || !canvasSize || !background) {
      showToast('Please select a frame, canvas size, and background first', 'error');
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
      logger.error('Background not found in backgrounds array');
      logger.error('Looking for background value:', background);
      logger.error('Normalized background value:', normalizedBackground);
      logger.error('Available backgrounds:', backgrounds.map(bg => ({ id: bg.id, value: bg.value })));

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

      logger.debug('Using temporary background object:', tempBackground);

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
        logger.error('Failed to save custom set:', error);
        showToast('Failed to save custom set: ' + error, 'error');
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
      logger.error('Failed to save custom set:', error);
      showToast('Failed to save custom set: ' + error, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadSet = async (setId: string) => {
    try {
      logger.debug('[CustomSetsSidebar] Loading set with ID:', setId);
      const set = await invoke<CustomSet>('get_custom_set', { setId });
      logger.debug('[CustomSetsSidebar] Set loaded:', set.name);

      // Apply the set configuration
      setCanvasSize({
        width: set.canvasSize.width,
        height: set.canvasSize.height,
        name: set.canvasSize.name,
        isCustom: set.canvasSize.isCustom,
        createdAt: set.canvasSize.createdAt,
      });

      setCurrentFrame(set.frame);

      // Persist the background into the backgrounds system if it's an image
      // This ensures it appears in load_backgrounds and survives page refreshes
      if (set.background.background_type === 'image') {
        const bgFilePath = set.background.value.replace('asset://', '');

        // Check if this background already exists in the persisted backgrounds
        const existingBgs = await invoke<Background[]>('load_backgrounds');
        const alreadyPersisted = existingBgs.some(bg => {
          // Check by id first (set after first import)
          if (bg.id === set.background.id) return true;
          // Fallback: compare by normalized path
          const normalize = (p: string) => {
            try {
              return decodeURIComponent(p)
                .replace('asset://', '')
                .replace(/\\/g, '/')
                .toLowerCase();
            } catch { return p.replace('asset://', '').replace(/\\/g, '/').toLowerCase(); }
          };
          return normalize(bg.value) === normalize(set.background.value);
        });

        if (alreadyPersisted) {
          // Already in backgrounds system, just reload and set
          setBackgrounds(existingBgs);
          const matchedBg = existingBgs.find(bg => {
            const normalize = (p: string) => {
              try {
                return decodeURIComponent(p)
                  .replace('asset://', '')
                  .replace(/\\/g, '/')
                  .toLowerCase();
              } catch { return p.replace('asset://', '').replace(/\\/g, '/').toLowerCase(); }
            };
            return normalize(bg.value) === normalize(set.background.value);
          });
          const bgValue = (matchedBg || set.background).value.startsWith('asset://')
            ? convertFileSrc((matchedBg || set.background).value.replace('asset://', ''))
            : (matchedBg || set.background).value;
          setBackground(bgValue);
        } else {
          // Import into backgrounds system for persistence
          try {
            const importedBg = await invoke<Background>('import_background', {
              filePath: bgFilePath,
              name: set.background.name || set.name,
            });
            const updatedBgs = await invoke<Background[]>('load_backgrounds');
            setBackgrounds(updatedBgs);
            const bgValue = importedBg.value.startsWith('asset://')
              ? convertFileSrc(importedBg.value.replace('asset://', ''))
              : importedBg.value;
            setBackground(bgValue);
            // Update only the background id in the set (keep original value/path as resilient fallback).
            // The id check in alreadyPersisted will find the bg in the library on next load.
            // If the user deletes the bg from the library, the original custom_sets/ copy still
            // exists and will be re-imported successfully.
            invoke('update_custom_set_background', { setId, background: { ...set.background, id: importedBg.id } })
              .catch(e => logger.warn('Failed to update set background ref:', e));
          } catch (importErr) {
            logger.warn('Failed to persist background, using temporary:', importErr);
            // Fallback: add to array without persistence
            const bgValue = set.background.value.startsWith('asset://')
              ? convertFileSrc(set.background.value.replace('asset://', ''))
              : set.background.value;
            setBackground(bgValue);
            const bgAlreadyExists = backgrounds.some(bg => bg.id === set.background.id);
            if (!bgAlreadyExists) {
              setBackgrounds([...backgrounds, set.background]);
            }
          }
        }
      } else {
        // Non-image background (color/gradient) - just set directly
        const bgValue = set.background.value;
        setBackground(bgValue);
      }

      setBackgroundTransform({
        scale: set.backgroundTransform.scale,
        offsetX: set.backgroundTransform.offsetX,
        offsetY: set.backgroundTransform.offsetY,
      });

      // Restore auto-match background state
      setAutoMatchBackground(set.autoMatchBackground);

      // If auto-match is enabled and the background is an image, load its dimensions
      if (set.autoMatchBackground && set.background.background_type === 'image') {
        const bgValue = set.background.value.startsWith('asset://')
          ? convertFileSrc(set.background.value.replace('asset://', ''))
          : set.background.value;

        const img = new Image();
        img.src = bgValue;
        img.onload = () => {
          logger.debug('[CustomSetsSidebar] Background image loaded, dimensions:', img.width, 'x', img.height);
          setBackgroundDimensions({ width: img.width, height: img.height });
        };
        img.onerror = () => {
          logger.error('[CustomSetsSidebar] Failed to load background image for dimensions');
        };
      } else if (!set.autoMatchBackground) {
        // Clear background dimensions if auto-match is disabled
        setBackgroundDimensions(null);
      }

      // Restore overlays
      setOverlays(set.overlays || []);

      // Track the loaded custom set name
      logger.debug('[CustomSetsSidebar] Setting selectedCustomSetName to:', set.name);
      setSelectedCustomSetName(set.name);

      logger.debug('Custom set loaded successfully');
    } catch (error) {
      logger.error('Failed to load custom set:', error);
      showToast('Failed to load custom set: ' + error, 'error');
    }
  };

  const handleDeleteSet = async (setId: string) => {
    try {
      await invoke('delete_custom_set', { setId });
      setDeletingSetId(null);
      await loadCustomSets();
    } catch (error) {
      logger.error('Failed to delete custom set:', error);
      showToast('Failed to delete custom set: ' + error, 'error');
    }
  };

  const confirmDelete = (setId: string) => {
    setDeletingSetId(setId);
  };

  const cancelDelete = () => {
    setDeletingSetId(null);
  };

  const handleExportSet = async (set: SetPreviewData) => {
    try {
      setExportingId(set.id);

      // Get the set name for the default filename
      const sanitizedName = set.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const defaultFilename = `${sanitizedName}.ptbs`;

      // Open save dialog
      const filePath = await save({
        title: 'Export Custom Set',
        defaultPath: defaultFilename,
        filters: [
          {
            name: 'Photobooth Set',
            extensions: ['ptbs']
          }
        ]
      });

      if (!filePath) {
        // User cancelled
        setExportingId(null);
        return;
      }

      // Call the export command
      await invoke('export_custom_set', {
        setId: set.id,
        filePath: filePath
      });

      logger.info(`Exported custom set "${set.name}" to ${filePath}`);
      showToast(`"${set.name}" exported`, 'success');
    } catch (error) {
      logger.error('Failed to export custom set:', error);
      showToast('Failed to export: ' + error, 'error');
    } finally {
      setExportingId(null);
    }
  };

  const handleImportSet = async () => {
    try {
      setImporting(true);

      // Open file dialog
      const selected = await open({
        title: 'Import Custom Set',
        multiple: false,
        filters: [
          {
            name: 'Photobooth Set',
            extensions: ['ptbs']
          }
        ]
      });

      if (!selected || typeof selected !== 'string') {
        // User cancelled or invalid selection
        setImporting(false);
        return;
      }

      // Call the import command
      const importedSet = await invoke<CustomSet>('import_custom_set', {
        filePath: selected
      });

      logger.info(`Imported custom set "${importedSet.name}"`);
      showToast(`"${importedSet.name}" imported`, 'success');

      // Reload the sets list
      await loadCustomSets();

      // Automatically load/apply the imported set
      await handleLoadSet(importedSet.id);
    } catch (error) {
      logger.error('Failed to import custom set:', error);
      showToast('Failed to import: ' + error, 'error');
    } finally {
      setImporting(false);
    }
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
          Save Current Setup
        </button>

        <div className="custom-sets-actions-row">
          <button
            className="import-set-button"
            onClick={handleImportSet}
            disabled={importing}
            title="Import a set from a .ptbs file"
          >
            <Download size={15} />
            {importing ? 'Importing...' : 'Import Set'}
          </button>
        </div>

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
                        title="Cancel"
                      >
                        <X size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="load-set-button"
                        onClick={() => handleLoadSet(set.id)}
                        title="Load this set"
                      >
                        <Play size={13} />
                        Load
                      </button>
                      <button
                        className="export-set-button"
                        onClick={() => handleExportSet(set)}
                        disabled={exportingId === set.id}
                        title="Export as .ptbs file"
                      >
                        <Upload size={13} />
                        Export
                      </button>
                      <button
                        className="delete-set-button"
                        onClick={() => confirmDelete(set.id)}
                        title="Delete this set"
                      >
                        <Trash2 size={13} />
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

      {/* Toast notifications */}
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            className={`custom-sets-toast custom-sets-toast--${toast.type}`}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
          >
            {toast.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            <span>{toast.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>

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
                  <p>Background: {(() => {
                    const normalizedBg = background?.startsWith('http://asset.localhost/')
                      ? `asset://${decodeURIComponent(background.replace('http://asset.localhost/', ''))}`
                      : background;
                    return backgrounds.find(bg => bg.value === background || bg.value === normalizedBg)?.name || 'Unknown';
                  })()}</p>
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
