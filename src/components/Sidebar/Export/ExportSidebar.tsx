import { useState, useMemo } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useCollage } from '../../../contexts/CollageContext';
import { useToast } from '../../../contexts/ToastContext';
import Icon from '@mdi/react';
import { mdiFileExportOutline, mdiImageOutline, mdiLayers, mdiCheckCircle, mdiAlertCircle } from '@mdi/js';
import './ExportSidebar.css';

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

  const canExport = !!currentFrame && !!canvasSize;

  // Calculate additional export info
  const exportInfo = useMemo(() => {
    const backgroundObj = backgrounds.find(bg => bg.value === background);
    const bgName = backgroundObj?.name || (background?.startsWith('#') ? background : 'Custom');
    const visibleOverlays = overlays.filter(o => o.visible).length;
    const filledZones = placedImages.size;
    const totalZones = currentFrame?.zones.length || 0;

    // Estimate file size (PNG compression typically achieves ~35-45% of raw size)
    const pixels = (canvasSize?.width || 0) * (canvasSize?.height || 0);
    const rawSizeMB = pixels * 4 / (1024 * 1024); // 4 bytes per pixel (RGBA)
    const estimatedSizeMB = rawSizeMB * 0.4; // PNG compression factor (~40% of raw)

    return {
      bgName,
      visibleOverlays,
      filledZones,
      totalZones,
      estimatedSizeMB: estimatedSizeMB.toFixed(1)
    };
  }, [background, backgrounds, overlays, placedImages, currentFrame, canvasSize]);

  const handleExport = async () => {
    if (!canExport || isExporting) return;

    setIsExporting(true);
    try {
      const exportResult = await exportCanvasAsPNG();
      if (!exportResult) {
        showToast('Export failed', 'error', 3000, 'Could not generate image');
        return;
      }

      const filePath = await save({
        defaultPath: exportResult.filename,
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
      });

      if (!filePath) return; // User cancelled

      await invoke('save_file_to_path', {
        filePath,
        fileData: Array.from(exportResult.bytes),
      });

      showToast('Exported', 'success', 3000, `Saved to ${filePath}`);
    } catch (error) {
      console.error('Export failed:', error);
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
            <div className="export-info">
              {/* Canvas Dimensions */}
              <div className="export-info-row">
                <span className="export-info-label">Canvas</span>
                <span className="export-info-value">{canvasSize!.width} × {canvasSize!.height}</span>
              </div>

              {/* Frame Name */}
              {currentFrame?.name && (
                <div className="export-info-row">
                  <span className="export-info-label">Frame</span>
                  <span className="export-info-value">{currentFrame.name}</span>
                </div>
              )}

              {/* Background Info */}
              <div className="export-info-row">
                <span className="export-info-label">Background</span>
                <span className="export-info-value">{exportInfo.bgName}</span>
              </div>

              {/* Image Zones */}
              <div className="export-info-row">
                <span className="export-info-label">Images</span>
                <span className="export-info-value">
                  {exportInfo.filledZones} / {exportInfo.totalZones}
                  {exportInfo.filledZones === exportInfo.totalZones && exportInfo.totalZones > 0 && (
                    <Icon path={mdiCheckCircle} size={0.7} className="export-check-icon" />
                  )}
                </span>
              </div>

              {/* Overlays */}
              {exportInfo.visibleOverlays > 0 && (
                <div className="export-info-row">
                  <span className="export-info-label">Overlays</span>
                  <span className="export-info-value">{exportInfo.visibleOverlays} layer{exportInfo.visibleOverlays !== 1 ? 's' : ''}</span>
                </div>
              )}

              {/* Estimated File Size */}
              <div className="export-info-row">
                <span className="export-info-label">Est. Size</span>
                <span className="export-info-value">~{exportInfo.estimatedSizeMB} MB</span>
              </div>
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
