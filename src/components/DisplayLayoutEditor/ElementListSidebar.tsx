import { useState, useEffect, useRef } from 'react';
import { Icon } from '@mdi/react';
import { mdiSwapHorizontal, mdiSwapVertical } from '@mdi/js';
import { ChevronDown } from 'lucide-react';
import { useDisplayLayout } from '../../contexts/display/DisplayLayoutContext';
import { DisplayElement } from '../../types/displayLayout';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resizeLayoutImageIfNeeded } from '../../utils/imageUtils';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { BlendMode } from '../../types/overlay';
import { ColorPicker } from '../ColorPicker/ColorPicker';
import { useToast } from '../../contexts/system/ToastContext';
import { isFontAvailable } from '../../utils/fontUtils';
import SaveDefaultModal from './SaveDefaultModal';
import { ElementListItem } from './ElementListItem';
import { EmojiPickerButton } from './EmojiPickerButton';
import './ElementListSidebar.css';
import './display-common.css';

const COLLAGE_SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '4×6 Portrait (1200×1800)', w: 480, h: 720 },
  { label: '4×6 Landscape (1800×1200)', w: 720, h: 480 },
  { label: '2×6 Strip Portrait (600×1800)', w: 240, h: 720 },
  { label: '2×6 Strip Landscape (1800×600)', w: 720, h: 240 },
  { label: '4×12 Strip Portrait (1200×3600)', w: 240, h: 960 },
  { label: '5×7 Portrait (1500×2100)', w: 480, h: 672 },
  { label: 'Square (600×600)', w: 480, h: 480 },
];

const SYSTEM_FONT_FAMILIES = [
  { label: 'System Sans', value: 'var(--font-sans)' },
  { label: 'System Mono', value: 'var(--font-mono)' },
];

const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
];

/**
 * A numeric input that allows the user to clear the field and type intermediate
 * states (like "0." or "-") without the parent state immediately forcing it back to a number.
 */
function SmartNumericInput({ 
  value, 
  onChange, 
  placeholder, 
  step = 1, 
  min, 
  max,
  className 
}: { 
  value: number, 
  onChange: (val: number) => void, 
  placeholder?: string,
  step?: number,
  min?: number,
  max?: number,
  className?: string
}) {
  const [localValue, setLocalValue] = useState(value.toString());
  const [isFocused, setIsFocused] = useState(false);

  // Sync with prop only when not focused
  useEffect(() => {
    if (!isFocused) {
      // Ensure we round the incoming value for display (max 2 decimals for scale/step < 1)
      const rounded = step < 1 ? Math.round(value * 100) / 100 : Math.round(value);
      setLocalValue(rounded.toString());
    }
  }, [value, isFocused, step]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    
    // Allow only numeric-related characters
    val = val.replace(/[^0-9.\-]/g, '');
    
    // Prevent multiple dots
    if ((val.match(/\./g) || []).length > 1) return;

    setLocalValue(val);
    
    // Only update parent if it's a valid, complete number and not just '0'
    // Delaying sync on '0' and '-' allows typing '0.25' or '-10' without immediate jump/clamping.
    if (val !== '' && val !== '-' && val !== '0' && !val.endsWith('.')) {
      let num = parseFloat(val);
      if (!isNaN(num)) {
        // Rounding fractional values (scale) to 2 decimal places to keep layout clean
        if (step < 1) num = Math.round(num * 100) / 100;
        onChange(num);
      }
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (localValue === '' || localValue === '-') {
      // Restore to actual value on blur if empty
      setLocalValue(value.toString());
    } else {
      let num = parseFloat(localValue);
      if (isNaN(num)) {
        num = value;
      } else {
        if (min !== undefined) num = Math.max(min, num);
        if (max !== undefined) num = Math.min(max, num);
      }
      
      // Clean rounding: 2 decimals max, but strip trailing zeros (1.00 -> 1)
      const rounded = Math.round(num * 100) / 100;
      setLocalValue(rounded.toString());
      onChange(rounded);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={localValue}
      onChange={handleChange}
      onFocus={() => setIsFocused(true)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      className={className || 'display-sidebar-input'}
    />
  );
}

export function ElementListSidebar() {
  const { activeLayout, selectedElementId, setSelectedElementId, updateElement, removeElement, updateActiveLayout, saveLayout, applyLayout } = useDisplayLayout();
  const { showToast } = useToast();

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [systemFonts, setSystemFonts] = useState<{ label: string; value: string }[]>(SYSTEM_FONT_FAMILIES);
  const [loadingFonts, setLoadingFonts] = useState(true);

  // Modal state for save default layout
  const [saveDefaultModalOpen, setSaveDefaultModalOpen] = useState(false);
  const [creatingCopy, setCreatingCopy] = useState(false);
  const [frameOpen, setFrameOpen] = useState(false);

  // Direct pass-through - allow editing on default layout
  const handleUpdateElement = updateElement;
  const handleRemoveElement = removeElement;
  const handleUpdateActiveLayout = updateActiveLayout;

  // Handle creating a copy from the default layout modal
  const handleCreateCopyFromDefault = async () => {
    if (!activeLayout) return;

    setCreatingCopy(true);
    try {
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

  // Load system fonts on mount
  useEffect(() => {
    invoke<string[]>('get_system_fonts')
      .then((fonts) => {
        // Convert font names to font family options
        // Store just the font name - don't add quotes or fallbacks in the value
        const fontOptions = fonts
          .filter(font => !font.startsWith('.') && !font.includes('LastResort'))
          .map(font => ({
            label: font,
            value: font
          }));

        setSystemFonts([...SYSTEM_FONT_FAMILIES, ...fontOptions]);
      })
      .catch((err) => {
        console.error('Failed to load system fonts:', err);
      })
      .finally(() => {
        setLoadingFonts(false);
      });
   }, []);

   if (!activeLayout) {
    return (
      <div className="element-list-sidebar">
        <div className="display-panel-header">
          <span className="display-panel-title">Elements</span>
        </div>
        <div className="element-list-empty">
          <span>No layout selected</span>
        </div>
      </div>
    );
  }

  const sortedElements = [...activeLayout.elements].sort((a, b) => b.layerOrder - a.layerOrder);

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      collage: 'Collage',
      qr: 'QR Code',
      text: 'Text',
      logo: 'Image',
      gif: 'GIF',
      emoji: 'Emoji',
      shape: 'Shape',
    };
    return labels[role] || role;
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (draggedId !== id) {
      setDragOverId(id);
    }
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId || !activeLayout) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const elements = [...activeLayout.elements].sort((a, b) => a.layerOrder - b.layerOrder);
    const fromIndex = elements.findIndex(el => el.id === draggedId);
    const toIndex = elements.findIndex(el => el.id === targetId);

    if (fromIndex !== -1 && toIndex !== -1) {
      const [draggedEl] = elements.splice(fromIndex, 1);
      elements.splice(toIndex, 0, draggedEl);

      const newElements = elements.map((el, i) => ({ ...el, layerOrder: i }));
      updateActiveLayout({ elements: newElements });
    }

    setDraggedId(null);
    setDragOverId(null);
  };

  return (
    <div className="element-list-sidebar">
      <div className="display-panel-header">
        <span className="display-panel-title">Elements</span>
        <span className="text-muted-small">
          {sortedElements.length}
        </span>
      </div>

      <div className="element-list">
        {sortedElements.map((element) => (
          <ElementListItem
            key={element.id}
            element={element}
            isSelected={selectedElementId === element.id}
            draggedId={draggedId}
            dragOverId={dragOverId}
            onUpdateElement={handleUpdateElement}
            onRemoveElement={handleRemoveElement}
            onSelectElement={setSelectedElementId}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
          />
        ))}
      </div>

      {/* Properties panel for selected element */}
      {selectedElementId && (
        <div className="element-properties-section">
          {(() => {
            const element = activeLayout.elements.find(el => el.id === selectedElementId);
            if (!element) return null;

            const updateTransform = (key: string, value: number | boolean) => {
              handleUpdateElement(element.id, { transform: { ...element.transform, [key]: value } });
            };

            return (
              <>
                <div className="display-panel-header panel-header-custom">
                  <span className="display-panel-title panel-title-small">
                    {getRoleLabel(element.role)} Properties
                  </span>
                </div>

                <div className="element-props-body">

                  {/* X / Y */}
                  <div className="grid-2-col">
                    <div className="props-field">
                      <label>X</label>
                      <SmartNumericInput value={Math.round(element.transform.x)} onChange={(val) => updateTransform('x', val)} placeholder="0" />
                    </div>
                    <div className="props-field">
                      <label>Y</label>
                      <SmartNumericInput value={Math.round(element.transform.y)} onChange={(val) => updateTransform('y', val)} placeholder="0" />
                    </div>
                  </div>

                  {/* Scale / Rotation */}
                  <div className="grid-2-col">
                    <div className="props-field">
                      <label>Scale</label>
                      <SmartNumericInput value={element.transform.scale} step={0.01} min={0.01} max={10} onChange={(val) => updateTransform('scale', val)} placeholder="1.0" />
                    </div>
                    <div className="props-field">
                      <label>Rotation</label>
                      <SmartNumericInput value={Math.round(element.transform.rotation)} onChange={(val) => updateTransform('rotation', val)} placeholder="0" />
                    </div>
                  </div>

                  {/* Opacity */}
                  <div className="props-opacity-row">
                    <span className="props-opacity-label">Opacity</span>
                    <input type="range" min={0} max={1} step={0.01} value={element.transform.opacity} onChange={(e) => updateTransform('opacity', Number(e.target.value))} />
                    <span className="props-opacity-value">{Math.round(element.transform.opacity * 100)}%</span>
                  </div>

                  {/* Flip / Blend Mode — same row */}
                  {element.role !== 'qr' && (
                    <div className="grid-3-col">
                      <div className="props-field">
                        <label>Flip H</label>
                        <button
                          className={`props-tool-btn${element.transform.flipHorizontal ? ' active' : ''}`}
                          onClick={() => updateTransform('flipHorizontal', !element.transform.flipHorizontal)}
                          title="Flip horizontal"
                        >
                          <Icon path={mdiSwapHorizontal} size={0.75} />
                        </button>
                      </div>
                      <div className="props-field">
                        <label>Flip V</label>
                        <button
                          className={`props-tool-btn${element.transform.flipVertical ? ' active' : ''}`}
                          onClick={() => updateTransform('flipVertical', !element.transform.flipVertical)}
                          title="Flip vertical"
                        >
                          <Icon path={mdiSwapVertical} size={0.75} />
                        </button>
                      </div>
                      <div className="props-field">
                        <label>Blend Mode</label>
                        <select className="props-weight-select" value={element.blendMode} onChange={(e) => handleUpdateElement(element.id, { blendMode: e.target.value as BlendMode })}>
                          {BLEND_MODES.map(bm => <option key={bm.value} value={bm.value}>{bm.label}</option>)}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Text */}
                  {element.role === 'text' && (
                    <>
                      <div className="props-role-divider" />
                      <div className="props-field">
                        <label>Content</label>
                        <input
                          type="text"
                          value={element.textContent || ''}
                          onChange={(e) => handleUpdateElement(element.id, { textContent: e.target.value })}
                          style={{
                            fontFamily: (() => {
                              const font = element.fontFamily;
                              if (!font) return 'inherit';
                              if (font.startsWith('var(')) return font;
                              const quotedFont = font.includes(' ') ? `"${font}"` : font;
                              return `${quotedFont}, var(--font-sans), sans-serif`;
                            })()
                          }}
                        />
                      </div>
                      <div className="grid-2-col-wide-first">
                        <div className="props-field">
                          <label>Font Family</label>
                          {loadingFonts ? (
                            <div className="props-weight-select text-muted-small">Loading fonts...</div>
                          ) : (
                            <select
                              className="props-weight-select"
                              value={element.fontFamily || 'var(--font-sans)'}
                              onChange={(e) => {
                                const newFont = e.target.value;
                                handleUpdateElement(element.id, { fontFamily: newFont });

                                // Check if font is available (skip CSS variables)
                                if (!newFont.startsWith('var(') && !isFontAvailable(newFont)) {
                                  showToast(
                                    `Font "${newFont}" may not be available`,
                                    'warning',
                                    6000,
                                    'Selected font will fall back to default system font'
                                  );
                                }
                              }}
                              style={{
                                fontFamily: (() => {
                                  const font = element.fontFamily || 'var(--font-sans)';
                                  if (font.startsWith('var(')) return font;
                                  return font.includes(' ') ? `"${font}"` : font;
                                })()
                              }}
                              disabled={loadingFonts}
                            >
                              {systemFonts.map(f => {
                                // Format font family for preview - wrap multi-word names in quotes
                                const formatFontForPreview = (fontVal: string) => {
                                  if (fontVal.startsWith('var(')) return fontVal;
                                  return fontVal.includes(' ') ? `"${fontVal}"` : fontVal;
                                };
                                return (
                                  <option
                                    key={f.value}
                                    value={f.value}
                                    style={{ fontFamily: formatFontForPreview(f.value) }}
                                  >
                                    {f.label}
                                  </option>
                                );
                              })}
                            </select>
                          )}
                        </div>
                        <div className="props-field">
                          <label>Size</label>
                          <SmartNumericInput value={element.fontSize || 24} min={8} max={200} onChange={(val) => handleUpdateElement(element.id, { fontSize: val })} placeholder="24" />
                        </div>
                      </div>
                      <div className="grid-2-col">
                        <div className="props-field">
                          <label>Weight</label>
                          <select className="props-weight-select" value={element.fontWeight || '400'} onChange={(e) => handleUpdateElement(element.id, { fontWeight: e.target.value })}>
                            <option value="300">Light</option>
                            <option value="400">Regular</option>
                            <option value="500">Medium</option>
                            <option value="600">Semibold</option>
                            <option value="700">Bold</option>
                          </select>
                        </div>
                        <div className="props-field">
                          <label>Color</label>
                          <div className="props-color-row">
                            <ColorPicker value={element.fontColor || '#ffffff'} onChange={(hex) => handleUpdateElement(element.id, { fontColor: hex })} />
                            <span className="props-color-hex">{element.fontColor || '#ffffff'}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Emoji */}
                  {element.role === 'emoji' && (
                    <>
                      <div className="props-role-divider" />
                      <div className="props-field">
                        <label>Emoji</label>
                        <EmojiPickerButton
                          currentEmoji={element.textContent || ''}
                          placeholder="😊"
                          placeholderText="Change emoji"
                          onSelect={(emoji) => handleUpdateElement(element.id, { textContent: emoji })}
                          spawnPosition="top-left"
                          offsetX={-20}
                          offsetY={120}
                        />
                      </div>
                      <div className="props-field">
                        <label>Size</label>
                        <SmartNumericInput value={element.fontSize || 80} min={16} max={400} onChange={(val) => handleUpdateElement(element.id, { fontSize: val })} placeholder="80" />
                      </div>
                    </>
                  )}

                  {/* Collage size */}
                  {element.role === 'collage' && (() => {
                    const cw = element.collageWidth ?? 480;
                    const ch = element.collageHeight ?? 540;
                    const matched = COLLAGE_SIZE_PRESETS.find(p => p.w === cw && p.h === ch);
                    return (
                      <>
                        <div className="props-role-divider" />
                        <div className="props-field">
                          <label>Collage Size</label>
                          <select
                            className="props-weight-select"
                            value={matched ? matched.label : 'custom'}
                            onChange={(e) => {
                              const preset = COLLAGE_SIZE_PRESETS.find(p => p.label === e.target.value);
                              if (preset) handleUpdateElement(element.id, { collageWidth: preset.w, collageHeight: preset.h });
                            }}
                          >
                            {!matched && <option value="custom">Custom ({cw}×{ch})</option>}
                            {COLLAGE_SIZE_PRESETS.map(p => (
                              <option key={p.label} value={p.label}>{p.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="grid-2-col">
                          <div className="props-field">
                            <label>Width</label>
                            <SmartNumericInput value={cw} min={10} onChange={(val) => handleUpdateElement(element.id, { collageWidth: val })} placeholder="480" />
                          </div>
                          <div className="props-field">
                            <label>Height</label>
                            <SmartNumericInput value={ch} min={10} onChange={(val) => handleUpdateElement(element.id, { collageHeight: val })} placeholder="540" />
                          </div>
                        </div>
                      </>
                    );
                  })()}

                  {/* Logo / GIF */}
                  {(element.role === 'logo' || element.role === 'gif') && (
                    <>
                      {/* Frame controls */}
                      <div className="props-role-divider" />
                      <div className="props-group-header" onClick={() => setFrameOpen(o => !o)}>
                        <ChevronDown size={12} className={`props-group-chevron${frameOpen ? ' open' : ''}`} />
                        <span>Frame</span>
                      </div>
                      {frameOpen && <div className="props-group-content">
                        <div className="props-field">
                          <label>Frame Shape</label>
                          <select
                            className="props-weight-select"
                            value={element.frameShape || 'none'}
                            onChange={(e) => handleUpdateElement(element.id, { frameShape: e.target.value as any })}
                          >
                            <option value="none">None</option>
                            <option value="rectangle">Rectangle</option>
                            <option value="circle">Circle</option>
                            <option value="rounded_rect">Rounded</option>
                            <option value="ellipse">Ellipse</option>
                            <option value="pill">Pill</option>
                            <option value="triangle">Triangle</option>
                            <option value="star">Star</option>
                            <option value="hexagon">Hexagon</option>
                            <option value="octagon">Octagon</option>
                            <option value="pentagon">Pentagon</option>
                            <option value="diamond">Diamond</option>
                            <option value="heart">Heart</option>
                            <option value="cross">Cross</option>
                          </select>
                        </div>

                        {element.frameShape && element.frameShape !== 'none' && (
                          <>
                            <div className="grid-2-col">
                              <div className="props-field">
                                <label>Frame Color</label>
                                <div className="display-sidebar-color-row">
                                  <input
                                    type="color"
                                    className="display-sidebar-color-input"
                                    value={element.frameColor || '#ffffff'}
                                    onChange={(e) => handleUpdateElement(element.id, { frameColor: e.target.value })}
                                  />
                                  <span className="display-sidebar-color-value">{element.frameColor || '#ffffff'}</span>
                                </div>
                              </div>
                              <div className="props-field">
                                <label>Frame Width</label>
                                <SmartNumericInput
                                  value={element.frameWidth || 8}
                                  min={0}
                                  max={100}
                                  onChange={(val) => handleUpdateElement(element.id, { frameWidth: val })}
                                  placeholder="8"
                                />
                              </div>
                            </div>
                            {element.frameShape === 'rounded_rect' && (
                              <div className="props-field">
                                <label>Corner Radius</label>
                                <SmartNumericInput
                                  value={element.frameBorderRadius || 100}
                                  min={0}
                                  max={200}
                                  onChange={(val) => handleUpdateElement(element.id, { frameBorderRadius: val })}
                                  placeholder="100"
                                />
                              </div>
                            )}
                          </>
                        )}
                      </div>}
                      <div className="props-role-divider" />
                      <button className="display-sidebar-btn full-width" onClick={async () => {
                        const filters = element.role === 'gif'
                          ? [{ name: 'GIF', extensions: ['gif'] }]
                          : [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }];
                        const result = await open({ multiple: false, filters: filters as any });
                        if (result) {
                          const path = typeof result === 'string' ? result : (result as any).path;
                          const autoResize = localStorage.getItem('dl.autoResize') === 'true';
                          const maxDim = parseInt(localStorage.getItem('dl.maxDim') ?? '2048', 10);
                          const resized = autoResize ? await resizeLayoutImageIfNeeded(path, maxDim) : null;
                          if (resized) showToast('Image Resized', 'success', 4000, `${resized.originalMB.toFixed(1)} MB → ${resized.resizedMB.toFixed(1)} MB`);
                          handleUpdateElement(element.id, { sourcePath: resized?.dataUrl ?? convertFileSrc(path) });
                        }
                      }}>
                        <span>{element.sourcePath ? 'Replace File' : 'Choose File'}</span>
                      </button>
                    </>
                  )}

                  {/* Shape */}
                  {element.role === 'shape' && (
                    <>
                      <div className="props-role-divider" />
                      <div className="grid-2-col">
                        <div className="props-field">
                          <label>Width</label>
                          <SmartNumericInput value={element.shapeWidth ?? 200} min={1} onChange={(val) => handleUpdateElement(element.id, { shapeWidth: val })} placeholder="200" />
                        </div>
                        <div className="props-field">
                          <label>Height</label>
                          <SmartNumericInput value={element.shapeHeight ?? 200} min={1} onChange={(val) => handleUpdateElement(element.id, { shapeHeight: val })} placeholder="200" />
                        </div>
                      </div>
                      <div className="grid-2-col">
                        <div className="props-field">
                          <label>Fill</label>
                          <div className="props-color-row">
                            <ColorPicker value={element.shapeFill ?? '#3b82f6'} onChange={(hex) => handleUpdateElement(element.id, { shapeFill: hex })} />
                            <span className="props-color-hex">{element.shapeFill ?? '#3b82f6'}</span>
                          </div>
                        </div>
                        <div className="props-field">
                          <label>Border</label>
                          <div className="props-color-row">
                            <ColorPicker value={element.shapeBorderColor ?? '#ffffff'} onChange={(hex) => handleUpdateElement(element.id, { shapeBorderColor: hex })} />
                            <SmartNumericInput value={element.shapeBorderWidth ?? 0} min={0} max={50} onChange={(val) => handleUpdateElement(element.id, { shapeBorderWidth: val })} placeholder="0" />
                          </div>
                        </div>
                      </div>
                      {element.shapeType === 'rounded-rectangle' && (
                        <div className="props-field">
                          <label>Corner Radius</label>
                          <SmartNumericInput value={element.shapeBorderRadius ?? 24} min={0} max={200} onChange={(val) => handleUpdateElement(element.id, { shapeBorderRadius: val })} placeholder="24" />
                        </div>
                      )}
                    </>
                  )}

                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Save Default Layout Modal */}
      <SaveDefaultModal
        show={saveDefaultModalOpen}
        layoutName={activeLayout?.name || 'Default'}
        onCreateCopy={handleCreateCopyFromDefault}
        onCancel={() => setSaveDefaultModalOpen(false)}
        isLoading={creatingCopy}
      />
    </div>
  );
}
