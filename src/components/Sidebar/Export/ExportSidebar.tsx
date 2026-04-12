import { useState, useMemo, useCallback, useRef } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import * as fs from '@tauri-apps/plugin-fs';
import { useCollage } from '../../../contexts';
import { useToast } from '../../../contexts';
import Icon from '@mdi/react';
import { mdiFileExportOutline, mdiChevronDown, mdiChevronUp } from '@mdi/js';
import './ExportSidebar.css';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('ExportSidebar');

const RESOLUTION_PRESETS = [
  { label: '8 MP', value: 8 },
  { label: '15 MP', value: 15 },
  { label: '24 MP', value: 24 },
];

export function ExportSidebar() {
  const {
    exportCanvasAsPNG,
    currentFrame,
    canvasSize,
    background,
    backgrounds,
    overlays,
    placedImages,
  } = useCollage();
  const { showToast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Resolution
  const [resolutionMp, setResolutionMp] = useState(15);
  const [customResolution, setCustomResolution] = useState(false);
  const [customMpInput, setCustomMpInput] = useState('15');

  // Double page
  const [doublePageMode, setDoublePageMode] = useState(false);

  // Border fit
  const [borderFit, setBorderFit] = useState(false);
  const [borderTopBottom, setBorderTopBottom] = useState(0.08);
  const [borderSides, setBorderSides] = useState(0.05);

  // Refs so export callback always reads live values
  const borderFitRef = useRef(false);
  const borderTopBottomRef = useRef(0.08);
  const borderSidesRef = useRef(0.05);
  borderFitRef.current = borderFit;
  borderTopBottomRef.current = borderTopBottom;
  borderSidesRef.current = borderSides;

  const canExport = !!currentFrame && !!canvasSize;
const exportInfo = useMemo(() => {
    const backgroundObj = backgrounds.find(bg => bg.value === background);
    const bgName = backgroundObj?.name || (background?.startsWith('#') ? background : 'Custom');
    const visibleOverlays = overlays.filter(o => o.visible).length;
    const filledZones = placedImages.size;
    const totalZones = currentFrame?.zones.length || 0;

    const canvasWidth = canvasSize?.width || 0;
    const canvasHeight = canvasSize?.height || 0;
    const currentPixels = canvasWidth * canvasHeight;
    const TARGET_PIXELS = resolutionMp * 1_000_000;
    const printScale = currentPixels >= TARGET_PIXELS ? 1 : Math.min(Math.sqrt(TARGET_PIXELS / currentPixels), 5);
    const scaledWidth = Math.round(canvasWidth * printScale);
    const scaledHeight = Math.round(canvasHeight * printScale);
    const pixels = scaledWidth * scaledHeight;
    const rawSizeMB = pixels * 4 / (1024 * 1024);
    const estimatedSizeMB = rawSizeMB * 0.4;

    return {
      bgName,
      visibleOverlays,
      filledZones,
      totalZones,
      estimatedSizeMB: estimatedSizeMB.toFixed(1),
      outputDimensions: printScale > 1 ? `${scaledWidth} × ${scaledHeight}` : null,
    };
  }, [background, backgrounds, overlays, placedImages, currentFrame, canvasSize, resolutionMp]);

  const doubleImageSideBySide = useCallback(async (bytes: Uint8Array, withBorder: boolean): Promise<Uint8Array> => {
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);

    const effectiveDPI = bitmap.width / 4;
    const borderTB = withBorder ? Math.round(borderTopBottomRef.current * effectiveDPI) : 0;
    const borderLR = withBorder ? Math.round(borderSidesRef.current * effectiveDPI) : 0;

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width * 2 + borderLR * 2;
    canvas.height = bitmap.height + borderTB * 2;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas context unavailable');

    if (withBorder) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.drawImage(bitmap, borderLR, borderTB);
    ctx.drawImage(bitmap, borderLR + bitmap.width, borderTB);
    bitmap.close();

    const resultBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
    });

    return new Uint8Array(await resultBlob.arrayBuffer());
  }, []);

  const handleResolutionPreset = (mp: number) => {
    setResolutionMp(mp);
    setCustomResolution(false);
    setCustomMpInput(String(mp));
  };

  const handleCustomResolution = () => {
    setCustomResolution(true);
  };

  const handleCustomMpChange = (value: string) => {
    setCustomMpInput(value);
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 200) {
      setResolutionMp(parsed);
    }
  };

  const handleExport = async () => {
    if (!canExport || isExporting) return;

    setIsExporting(true);
    try {
      const exportResult = await exportCanvasAsPNG(resolutionMp);
      if (!exportResult) {
        showToast('Export failed', 'error', 3000, 'Could not generate image');
        return;
      }

      let finalBytes = exportResult.bytes;
      let defaultFilename = exportResult.filename;

      if (doublePageMode) {
        finalBytes = await doubleImageSideBySide(exportResult.bytes, borderFitRef.current);
        defaultFilename = defaultFilename.replace(/\.png$/i, '_2x.png');
      }

      const filePath = await save({
        defaultPath: defaultFilename,
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
      });

      if (!filePath) return;

      await fs.writeFile(filePath, finalBytes);
      showToast('Exported', 'success', 3000, `Saved to ${filePath}`);
    } catch (error) {
      logger.error('Export failed:', error);
      showToast('Export failed', 'error', 5000, String(error));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="export-sidebar">
      <div className="export-header">
        <h3>Export</h3>
      </div>
      <div className="export-content">
        {canExport ? (
          <>
            {/* Canvas info */}
            <div className="export-info">
              <div className="export-info-row">
                <span className="export-info-label">Canvas</span>
                <span className="export-info-value">{canvasSize!.width} × {canvasSize!.height}</span>
              </div>
              {exportInfo.outputDimensions && (
                <div className="export-info-row">
                  <span className="export-info-label">Output</span>
                  <span className="export-info-value">{exportInfo.outputDimensions}</span>
                </div>
              )}
              {currentFrame?.name && (
                <div className="export-info-row">
                  <span className="export-info-label">Frame</span>
                  <span className="export-info-value">{currentFrame.name}</span>
                </div>
              )}
              <div className="export-info-row">
                <span className="export-info-label">Background</span>
                <span className="export-info-value">{exportInfo.bgName}</span>
              </div>
              <div className="export-info-row">
                <span className="export-info-label">Images</span>
                <span className="export-info-value">
                  {exportInfo.filledZones} / {exportInfo.totalZones}
                </span>
              </div>
              {exportInfo.visibleOverlays > 0 && (
                <div className="export-info-row">
                  <span className="export-info-label">Overlays</span>
                  <span className="export-info-value">{exportInfo.visibleOverlays} layer{exportInfo.visibleOverlays !== 1 ? 's' : ''}</span>
                </div>
              )}
              <div className="export-info-row">
                <span className="export-info-label">Est. Size</span>
                <span className="export-info-value">~{exportInfo.estimatedSizeMB} MB</span>
              </div>
            </div>

            {/* Collapsible options */}
            <div className="export-options-group">
              <button
                className="export-options-header"
                onClick={() => setOptionsOpen(o => !o)}
              >
                <span className="export-options-header-title">Options</span>
<Icon
                  path={optionsOpen ? mdiChevronUp : mdiChevronDown}
                  size={0.75}
                  className="export-options-chevron"
                />
              </button>

              {optionsOpen && (
                <>
                  {/* Resolution */}
                  <div className="export-option-row">
                    <div className="export-option-section-label">Resolution</div>
                    <div className="export-resolution-presets">
                      {RESOLUTION_PRESETS.map(preset => (
                        <button
                          key={preset.value}
                          className={`export-resolution-btn${!customResolution && resolutionMp === preset.value ? ' active' : ''}`}
                          onClick={() => handleResolutionPreset(preset.value)}
                        >
                          {preset.label}
                        </button>
                      ))}
                      <button
                        className={`export-resolution-btn${customResolution ? ' active' : ''}`}
                        onClick={handleCustomResolution}
                      >
                        Custom
                      </button>
                    </div>
                    {customResolution && (
                      <div className="export-custom-resolution">
                        <div className="export-border-input-row">
                          <input
                            type="number"
                            className="export-border-input"
                            value={customMpInput}
                            min={1}
                            max={200}
                            step={1}
                            autoFocus
                            onChange={(e) => handleCustomMpChange(e.target.value)}
                          />
                          <span className="export-border-unit">MP</span>
                        </div>
                        <span className="export-custom-resolution-hint">1–200 megapixels</span>
                      </div>
                    )}
                  </div>

                  <div className="export-option-divider" />

                  {/* Double Page */}
                  <div className={`export-option-row${doublePageMode ? ' is-on' : ''}`}>
                    <label className="export-option-toggle">
                      <div className="export-option-info">
                        <span className="export-option-title">Double Page</span>
                        <span className="export-option-desc">2 copies side-by-side · Fuji 4×6 half-cut</span>
                      </div>
                      <span className="double-page-switch">
                        <input
                          type="checkbox"
                          checked={doublePageMode}
                          onChange={(e) => setDoublePageMode(e.target.checked)}
                        />
                        <span className="double-page-slider" />
                      </span>
                    </label>
                  </div>

                  <div className="export-option-divider" />

                  {/* Border Fit */}
                  <div className={`export-option-row${borderFit ? ' is-on' : ''}`}>
                    <label className="export-option-toggle">
                      <div className="export-option-info">
                        <span className="export-option-title">Border Fit</span>
                        <span className="export-option-desc">White margins around the image</span>
                      </div>
                      <span className="double-page-switch">
                        <input
                          type="checkbox"
                          checked={borderFit}
                          onChange={(e) => setBorderFit(e.target.checked)}
                        />
                        <span className="double-page-slider" />
                      </span>
                    </label>

                    {borderFit && (
                      <div className="export-border-inputs">
                        <div className="export-border-field">
                          <label className="export-border-label">Top / Bottom</label>
                          <div className="export-border-input-row">
                            <input
                              type="number"
                              className="export-border-input"
                              value={borderTopBottom}
                              min={0}
                              max={1}
                              step={0.01}
                              onChange={(e) => setBorderTopBottom(parseFloat(e.target.value) || 0)}
                            />
                            <span className="export-border-unit">in</span>
                          </div>
                        </div>
                        <div className="export-border-field">
                          <label className="export-border-label">Sides</label>
                          <div className="export-border-input-row">
                            <input
                              type="number"
                              className="export-border-input"
                              value={borderSides}
                              min={0}
                              max={1}
                              step={0.01}
                              onChange={(e) => setBorderSides(parseFloat(e.target.value) || 0)}
                            />
                            <span className="export-border-unit">in</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <button
              className="export-button"
              onClick={handleExport}
              disabled={isExporting}
            >
              <Icon path={mdiFileExportOutline} size={0.8} />
              {isExporting ? 'Exporting...' : 'Export as PNG'}
            </button>
          </>
        ) : (
          <div className="export-empty">
            <p>Select a frame and canvas size to enable export.</p>
          </div>
        )}
      </div>
    </div>
  );
}
