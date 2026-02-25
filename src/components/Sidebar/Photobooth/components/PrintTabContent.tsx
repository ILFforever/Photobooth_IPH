import { Printer, RefreshCw, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { usePrintSettings } from '../../../../contexts/PrintSettingsContext';

interface PrintTabContentProps {
  isPrinting: boolean;
  onPrint: () => void;
}

export function PrintTabContent({ isPrinting, onPrint }: PrintTabContentProps) {
  const { showRegeneratePrompt, confirmRegenerate, cancelRegenerate } = usePrintSettings();

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
