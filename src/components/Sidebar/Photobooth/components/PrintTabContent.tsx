import { Printer, RefreshCw, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { usePrintSettings } from '../../../../contexts/PrintSettingsContext';

interface PrintTabContentProps {
  isPrinting: boolean;
  onPrint: () => void;
}

export function PrintTabContent({ isPrinting, onPrint }: PrintTabContentProps) {
  const { showRegeneratePrompt, confirmRegenerate, cancelRegenerate, doublePageMode, setDoublePageMode } = usePrintSettings();

  return (
    <div className="finalize-tab-content">
      <div className="print-settings-container">
        {/* Info Section */}
        <div className="print-section">
          <div className="print-section-header">
            <Printer size={16} />
            <span className="print-section-title">Print</span>
          </div>
          <div className="print-info-content">
            <p>Click the print button below to open the Windows Photo Printing Wizard.</p>
            <p className="print-hint">You can select copies, borderless options, and layout in the system dialog.</p>
          </div>
        </div>

        {/* Double Page Option */}
        <div className={`print-section double-page-section${doublePageMode ? ' is-on' : ''}`}>
          <label className="double-page-toggle">
            <div className="double-page-label">
              <span className="double-page-title">Double Page</span>
              <span className="double-page-desc">Places 2 copies side-by-side · Fuji 4×6 half-cut</span>
            </div>
            <div className="double-page-status">
              <span className="double-page-switch">
                <input
                  type="checkbox"
                  checked={doublePageMode}
                  onChange={(e) => setDoublePageMode(e.target.checked)}
                />
                <span className="double-page-slider" />
              </span>
            </div>
          </label>
          {doublePageMode && (
            <div className="double-page-warning">
              Double page is active — prints will be 2× side-by-side
            </div>
          )}
        </div>

        {/* Print Action Section */}
        <div className="print-section print-action-section">
          <button
            className="print-now-btn"
            onClick={onPrint}
            disabled={isPrinting}
          >
            {isPrinting ? (
              <>
                <RefreshCw size={16} className="spinning" />
                Opening Print Dialog...
              </>
            ) : (
              <>
                <Printer size={16} />
                Open Print Dialog
              </>
            )}
          </button>
        </div>
      </div>

      {/* Regenerate Collage Prompt Modal */}
      {showRegeneratePrompt && (
        <div className="regenerate-modal-overlay" onClick={cancelRegenerate}>
          <div className="regenerate-modal" onClick={(e) => e.stopPropagation()}>
            <div className="regenerate-modal-header">
              <AlertCircle size={18} className="regenerate-modal-icon" />
              <h3>Collage Modified</h3>
            </div>
            <div className="regenerate-modal-content">
              <p>The collage has been modified since it was last exported.</p>
              <p>Would you like to generate a new image with your changes?</p>
            </div>
            <div className="regenerate-modal-actions">
              <button className="regenerate-modal-btn secondary" onClick={cancelRegenerate}>
                <span>Use Old Version</span>
              </button>
              <button className="regenerate-modal-btn primary" onClick={confirmRegenerate}>
                <ImageIcon size={14} />
                <span>Generate New</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
