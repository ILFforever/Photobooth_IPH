import { useState, useRef, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useDisplayLayout } from '../../contexts/display/DisplayLayoutContext';
import { useToast } from '../../contexts/system/ToastContext';
import { DisplayElementRole, ASPECT_RATIO_PRESETS } from '../../types/displayLayout';
import { ColorPicker } from '../ColorPicker/ColorPicker';
import { EmojiPickerButton } from './EmojiPickerButton';
import Icon from '@mdi/react';
import SaveDefaultModal from './SaveDefaultModal';
import { DisplayLayoutHelpModal } from './DisplayLayoutHelpModal';
import {
  mdiPlus,
  mdiContentSave,
  mdiContentCopy,
  mdiDelete,
  mdiFormatText,
  mdiImage,
  mdiFileGifBox,
  mdiChevronDown,
  mdiViewQuilt,
  mdiQrcode,
  mdiRectangleOutline,
  mdiCircleOutline,
  mdiRectangle,
  mdiMinus,
  mdiStickerEmoji,
  mdiExport,
  mdiFileImport ,
} from '@mdi/js';
import { ShapeType } from '../../types/displayLayout';
import './DisplayLayoutSidebar.css';
import './display-common.css';

export function DisplayLayoutSidebar() {
  const {
    layouts, activeLayout, saving, hasUnsavedChanges,
    createNewLayout, applyLayout, saveLayout, deleteLayout, duplicateLayout,
    exportLayout, importLayout,
    addElement, setLayoutName, setBackgroundColor, setBackgroundImage, updateActiveLayout,
  } = useDisplayLayout();

  const { showToast } = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveDefaultModalOpen, setSaveDefaultModalOpen] = useState(false);
  const [creatingCopy, setCreatingCopy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  const handleImport = async () => {
    const filePath = await open({
      multiple: false,
      filters: [{ name: 'IPH Layout', extensions: ['iplayout'] }] as any,
    });
    if (filePath) {
      const path = typeof filePath === 'string' ? filePath : (filePath as any).path;
      try { await importLayout(path); setPickerOpen(false); } catch {}
    }
  };

  const handleExport = async (id: string, name: string) => {
    const filePath = await save({
      defaultPath: `${name}.iplayout`,
      filters: [{ name: 'IPH Layout', extensions: ['iplayout'] }] as any,
    });
    if (filePath) {
      try { await exportLayout(id, filePath as string); } catch {}
    }
  };

const handleSave = async () => {
    if (!activeLayout) return;

    // Prevent saving over the default layout - show modal instead
    if (activeLayout.isDefault) {
      setSaveDefaultModalOpen(true);
      return;
    }

    try { await saveLayout(activeLayout); } catch {}
  };

  const handleCreateCopyFromDefault = async () => {
    if (!activeLayout) return;

    setCreatingCopy(true);
    try {
      // Create a copy with a modified name
      const copy = {
        ...activeLayout,
        id: '',
        name: `${activeLayout.name} (Copy)`,
        isDefault: false,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      };

      const saved = await saveLayout(copy);
      await applyLayout(saved.id);
      setSaveDefaultModalOpen(false);
      showToast('Layout Copied', 'success', 3000, `"${saved.name}" has been created with your changes.`);
    } catch (e) {
      showToast('Failed to Create Copy', 'error', 5000, 'Could not create a copy of the default layout.');
    } finally {
      setCreatingCopy(false);
    }
  };

  const handleAddShape = (shapeType: ShapeType) => {
    const defaults: Record<ShapeType, object> = {
      rectangle:           { shapeWidth: 400, shapeHeight: 200, shapeFill: '#3b82f6', shapeBorderWidth: 0, shapeBorderRadius: 0 },
      circle:              { shapeWidth: 200, shapeHeight: 200, shapeFill: '#3b82f6', shapeBorderWidth: 0 },
      'rounded-rectangle': { shapeWidth: 400, shapeHeight: 200, shapeFill: '#3b82f6', shapeBorderWidth: 0, shapeBorderRadius: 24 },
      line:                { shapeWidth: 4,   shapeHeight: 400, shapeFill: '#ffffff', shapeBorderWidth: 0, shapeBorderRadius: 0 },
      triangle:            { shapeWidth: 200, shapeHeight: 200, shapeFill: '#3b82f6', shapeBorderWidth: 0 },
      diamond:             { shapeWidth: 200, shapeHeight: 200, shapeFill: '#3b82f6', shapeBorderWidth: 0 },
      star:                { shapeWidth: 200, shapeHeight: 200, shapeFill: '#f59e0b', shapeBorderWidth: 0 },
      hexagon:             { shapeWidth: 200, shapeHeight: 200, shapeFill: '#3b82f6', shapeBorderWidth: 0 },
      pentagon:            { shapeWidth: 200, shapeHeight: 200, shapeFill: '#3b82f6', shapeBorderWidth: 0 },
      cross:               { shapeWidth: 200, shapeHeight: 200, shapeFill: '#3b82f6', shapeBorderWidth: 0 },
      heart:               { shapeWidth: 200, shapeHeight: 200, shapeFill: '#e11d48', shapeBorderWidth: 0 },
    };
    addElement('shape', { shapeType, ...defaults[shapeType] });
  };

  const handleAddElement = async (role: DisplayElementRole) => {
    if (role === 'logo' || role === 'gif') {
      const filter = role === 'gif'
        ? { name: 'GIF', extensions: ['gif'] }
        : { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] };
      const result = await open({ multiple: false, filters: [filter] as any });
      if (result) {
        const path = typeof result === 'string' ? result : (result as any).path;
        addElement(role, { sourcePath: convertFileSrc(path) });
      }
    } else {
      addElement(role);
    }
  };

  const handleBackgroundImage = async () => {
    const result = await open({
      multiple: false,
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] as any,
    });
    if (result) {
      const path = typeof result === 'string' ? result : (result as any).path;
      setBackgroundImage(convertFileSrc(path));
    }
  };

  return (
    <div className="display-layout-sidebar">
      {/* Layout Picker */}
      <div className="display-sidebar-section display-layout-picker-section" ref={pickerRef}>
        <div className="display-layout-picker-row">
          <button
            className="display-layout-picker-trigger"
            onClick={() => setPickerOpen(o => !o)}
            title="Switch layout"
          >
            {activeLayout?.thumbnail && (
              <div className="display-layout-picker-thumb">
                <img
                  src={activeLayout.thumbnail.startsWith('asset://')
                    ? convertFileSrc(activeLayout.thumbnail.replace('asset://', ''))
                    : activeLayout.thumbnail}
                  alt={activeLayout.name}
                />
              </div>
            )}
            <span className="display-layout-picker-name">
              {activeLayout?.name ?? 'Select Layout'}
            </span>
            <Icon
              path={mdiChevronDown}
              size={0.75}
              className={`display-layout-picker-chevron ${pickerOpen ? 'open' : ''}`}
            />
          </button>

          <button
            className="display-layout-picker-action-btn"
            onClick={createNewLayout}
            title="New Layout"
          >
            <Icon path={mdiPlus} size={0.75} />
          </button>
         
          <button
            className="display-layout-picker-action-btn"
            onClick={handleImport}
            title="Import Layout"
          >
            <Icon path={mdiFileImport } size={0.75} />
          </button>
           <button
            className={`display-layout-picker-action-btn${hasUnsavedChanges ? ' unsaved' : ''}`}
            onClick={handleSave}
            disabled={!activeLayout || saving}
            title={saving ? 'Saving…' : 'Save'}
          >
            <Icon path={mdiContentSave} size={0.75} />
          </button>
        </div>

        {pickerOpen && (
          <div className="display-layout-picker-dropdown">
            {layouts.map(layout => (
              <div
                key={layout.id}
                className={`display-layout-card ${activeLayout?.id === layout.id ? 'active' : ''} ${deletingId === layout.id ? 'confirming' : ''}`}
                onClick={() => { if (deletingId !== layout.id) { applyLayout(layout.id); setPickerOpen(false); } }}
              >
                {deletingId === layout.id ? (
                  <>
                    <span className="display-layout-card-confirm-text">Delete "{layout.name}"?</span>
                    <div className="display-layout-card-actions">
                      <button
                        className="display-layout-picker-action-btn danger"
                        onClick={async (e) => { e.stopPropagation(); await deleteLayout(layout.id); setDeletingId(null); }}
                      >Delete</button>
                      <button
                        className="display-layout-picker-action-btn"
                        onClick={(e) => { e.stopPropagation(); setDeletingId(null); }}
                      >Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    {layout.thumbnail && (
                      <div className="display-layout-card-thumb">
                        <img
                          src={layout.thumbnail.startsWith('asset://')
                            ? convertFileSrc(layout.thumbnail.replace('asset://', ''))
                            : layout.thumbnail}
                          alt={layout.name}
                        />
                      </div>
                    )}
                    <div className="display-layout-card-info">
                      <span className="display-layout-card-name">{layout.name}</span>
                      {layout.isDefault ? (
                        <span className="display-layout-card-badge">Default</span>
                      ) : (
                        <span className="display-layout-card-badge muted">
                          {new Date(layout.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      )}
                    </div>
                    <div className="display-layout-card-actions">
                      <button
                        className="display-layout-picker-action-btn"
                        onClick={(e) => { e.stopPropagation(); duplicateLayout(layout.id); }}
                        title="Duplicate"
                      >
                        <Icon path={mdiContentCopy} size={0.55} />
                      </button>
                      <button
                        className="display-layout-picker-action-btn danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (layout.isDefault) {
                            showToast('Cannot Delete Default', 'warning', 3000, 'The default layout is protected and cannot be removed.');
                          } else {
                            setDeletingId(layout.id);
                          }
                        }}
                        title="Delete"
                      >
                        <Icon path={mdiDelete} size={0.55} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Background & Properties Section */}
      {activeLayout && (
        <div className="display-sidebar-section">
          <div className="display-sidebar-header">
            <span className="display-sidebar-title">Properties</span>
          </div>

          <div className="display-sidebar-field">
            <label>Layout Name</label>
            <input
              type="text"
              value={activeLayout.name}
              onChange={(e) => setLayoutName(e.target.value)}
              className="display-sidebar-input"
            />
            {activeLayout.isDefault && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                Default layout - save as a copy to keep your changes
              </span>
            )}
          </div>

          <div className="display-sidebar-two-col">
            <div className="display-sidebar-field">
              <label>Background</label>
              <div className="display-sidebar-color-row">
                <ColorPicker
                  value={activeLayout.backgroundColor}
                  onChange={setBackgroundColor}
                />
                <span className="display-sidebar-color-value">{activeLayout.backgroundColor}</span>
              </div>
            </div>
            <div className="display-sidebar-field">
              <label>Aspect Ratio</label>
              <select
                className="display-sidebar-select"
                value={`${activeLayout.canvasWidth ?? 1920}x${activeLayout.canvasHeight ?? 1080}`}
                onChange={e => {
                  const preset = ASPECT_RATIO_PRESETS.find(
                    p => `${p.width}x${p.height}` === e.target.value
                  );
                  if (preset) updateActiveLayout({ canvasWidth: preset.width, canvasHeight: preset.height });
                }}
              >
                {ASPECT_RATIO_PRESETS.map(preset => (
                  <option key={preset.label} value={`${preset.width}x${preset.height}`}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="display-sidebar-field">
            <label>Background Image</label>
            <button
              className="display-sidebar-btn"
              onClick={handleBackgroundImage}
              title="Add background image"
            >
              <Icon path={mdiImage} size={0.65} />
              <span>{activeLayout.backgroundImage ? 'Change Image' : 'Add Image'}</span>
            </button>
            {activeLayout.backgroundImage && (
              <button
                className="display-sidebar-btn secondary"
                onClick={() => setBackgroundImage(undefined)}
                style={{ marginTop: 4 }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      {/* Add Element Section */}
      {activeLayout && (
        <div className="display-sidebar-section">
          <div className="display-sidebar-header">
            <span className="display-sidebar-title">Add Element</span>
          </div>

          {(() => {
            const hasCollage = activeLayout.elements.some(e => e.role === 'collage');
            const hasQr = activeLayout.elements.some(e => e.role === 'qr');
            return (
              <div className="display-add-element-grid">
                <button
                  className={`display-sidebar-btn${hasCollage ? ' disabled' : ''}`}
                  onClick={() => hasCollage
                    ? showToast('Collage Already Added', 'warning', 2500, 'Only one collage element is allowed per layout.')
                    : handleAddElement('collage')}
                >
                  <Icon path={mdiViewQuilt} size={0.65} />
                  <span>Collage</span>
                </button>
                <button
                  className={`display-sidebar-btn${hasQr ? ' disabled' : ''}`}
                  onClick={() => hasQr
                    ? showToast('QR Already Added', 'warning', 2500, 'Only one QR code element is allowed per layout.')
                    : handleAddElement('qr')}
                >
                  <Icon path={mdiQrcode} size={0.65} />
                  <span>QR</span>
                </button>
                <button className="display-sidebar-btn" onClick={() => handleAddElement('text')}>
                  <Icon path={mdiFormatText} size={0.65} />
                  <span>Text</span>
                </button>
                <button className="display-sidebar-btn" onClick={() => handleAddElement('logo')}>
                  <Icon path={mdiImage} size={0.65} />
                  <span>Image</span>
                </button>
                <button className="display-sidebar-btn" onClick={() => handleAddElement('gif')}>
                  <Icon path={mdiFileGifBox} size={0.65} />
                  <span>GIF</span>
                </button>
                <EmojiPickerButton
                  currentEmoji=""
                  placeholder="😊"
                  placeholderText="Emoji"
                  emojiSize={30}
                  onSelect={(emoji) => addElement('emoji', { textContent: emoji, fontSize: 80 })}
                  className="display-sidebar-btn"
                  spawnPosition="right"
                  offsetX={20}
                >
                  <Icon path={mdiStickerEmoji} size={0.65} />
                  <span>Emoji</span>
                </EmojiPickerButton>
              </div>
            );
          })()}
        </div>
      )}

      {/* Add Shape Section */}
      {activeLayout && (
        <div className="display-sidebar-section">
          <div className="display-sidebar-header">
            <span className="display-sidebar-title">Add Shape</span>
          </div>
          <div className="display-add-shape-grid">
            <button className="display-sidebar-btn" onClick={() => handleAddShape('rectangle')}>
              <Icon path={mdiRectangleOutline} size={0.65} />
              <span>Rectangle</span>
            </button>
            <button className="display-sidebar-btn" onClick={() => handleAddShape('circle')}>
              <Icon path={mdiCircleOutline} size={0.65} />
              <span>Circle</span>
            </button>
            <button className="display-sidebar-btn" onClick={() => handleAddShape('rounded-rectangle')}>
              <Icon path={mdiRectangle} size={0.65} />
              <span>Rounded</span>
            </button>
            <button className="display-sidebar-btn" onClick={() => handleAddShape('line')}>
              <Icon path={mdiMinus} size={0.65} />
              <span>Line</span>
            </button>
            <button className="display-sidebar-btn" onClick={() => handleAddShape('triangle')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <polygon points="12,2 22,20 2,20" />
              </svg>
              <span>Triangle</span>
            </button>
            <button className="display-sidebar-btn" onClick={() => handleAddShape('diamond')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <polygon points="12,2 22,12 12,22 2,12" />
              </svg>
              <span>Diamond</span>
            </button>
            <button className="display-sidebar-btn" onClick={() => handleAddShape('star')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <polygon points="12,2 15,9 22,9 16,14 18,21 12,17 6,21 8,14 2,9 9,9" />
              </svg>
              <span>Star</span>
            </button>
            <button className="display-sidebar-btn" onClick={() => handleAddShape('hexagon')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" />
              </svg>
              <span>Hexagon</span>
            </button>
            <button className="display-sidebar-btn" onClick={() => handleAddShape('heart')}>
              <svg width="16" height="16" viewBox="0 0 100 100" fill="currentColor" style={{ flexShrink: 0 }}>
                <path d="M50 80 C20 62, 2 48, 2 30 A24 24 0 0 1 50 22 A24 24 0 0 1 98 30 C98 48, 80 62, 50 80 Z" />
              </svg>
              <span>Heart</span>
            </button>
          </div>
        </div>
      )}

      {/* Export / Import section */}
      {activeLayout && (
        <div className="display-sidebar-section">
          <div className="display-sidebar-header">
            <span className="display-sidebar-title">Layout File</span>
          </div>
          <button
            className="display-sidebar-btn"
            onClick={() => handleExport(activeLayout.id, activeLayout.name)}
            title="Export layout to a .iplayout file"
          >
            <Icon path={mdiExport} size={0.65} />
            <span>Export Layout</span>
          </button>
        </div>
      )}

      {/* Help button */}
      <div className="display-sidebar-help-footer">
        <button className="display-sidebar-help-btn" onClick={() => setHelpOpen(true)}>
          <span className="display-sidebar-help-icon">?</span>
          How to use the layout editor
        </button>
      </div>

      {/* Save Default Layout Modal */}
      <SaveDefaultModal
        show={saveDefaultModalOpen}
        layoutName={activeLayout?.name || 'Default'}
        onCreateCopy={handleCreateCopyFromDefault}
        onCancel={() => setSaveDefaultModalOpen(false)}
        isLoading={creatingCopy}
      />

      <DisplayLayoutHelpModal show={helpOpen} onClose={() => setHelpOpen(false)} />

    </div>
  );
}
