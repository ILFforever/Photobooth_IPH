import { useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useCollage } from '../../../contexts/CollageContext';
import { useToast } from '../../../contexts/ToastContext';
import Icon from '@mdi/react';
import { mdiFileExportOutline } from '@mdi/js';
import './ExportSidebar.css';

export function ExportSidebar() {
  const { exportCanvasAsPNG, currentFrame, canvasSize } = useCollage();
  const { showToast } = useToast();
  const [isExporting, setIsExporting] = useState(false);

  const canExport = !!currentFrame && !!canvasSize;

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
              <div className="export-info-row">
                <span className="export-info-label">Canvas</span>
                <span className="export-info-value">{canvasSize!.width} × {canvasSize!.height}</span>
              </div>
              {currentFrame?.name && (
                <div className="export-info-row">
                  <span className="export-info-label">Frame</span>
                  <span className="export-info-value">{currentFrame.name}</span>
                </div>
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
