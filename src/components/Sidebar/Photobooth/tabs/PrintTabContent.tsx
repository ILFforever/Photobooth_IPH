import "./PrintTabContent.css";
import { useState } from 'react';
import { Printer, RefreshCw, AlertCircle, Image as ImageIcon, ChevronUp, ChevronDown } from 'lucide-react';
import { usePrintSettings } from '../../../../contexts';
import { usePhotobooth } from '../../../../contexts';

interface PrintTabContentProps {
  isPrinting: boolean;
  onPrint: () => void;
}

export function PrintTabContent({ isPrinting, onPrint }: PrintTabContentProps) {
  const { confirmRegenerate, cancelRegenerate, doublePageMode, setDoublePageMode } = usePrintSettings();
  const { collageIsDirty } = usePhotobooth();
  const [showRegenerateOptions, setShowRegenerateOptions] = useState(false);

  const handlePrint = () => {
    if (collageIsDirty) {
      setShowRegenerateOptions(!showRegenerateOptions);
    } else {
      onPrint();
    }
  };

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
            className={`print-now-btn ${collageIsDirty && showRegenerateOptions ? 'expanded' : ''}`}
            onClick={handlePrint}
            disabled={isPrinting}
          >
            {isPrinting ? (
              <>
                <RefreshCw size={16} className="spinning" />
                Opening Print Dialog...
              </>
            ) : collageIsDirty ? (
              <>
                <AlertCircle size={14} className="dirty-icon" />
                Collage Modified
                {showRegenerateOptions ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </>
            ) : (
              <>
                <Printer size={16} />
                Open Print Dialog
              </>
            )}
          </button>

          {/* Inline regeneration options */}
          {collageIsDirty && showRegenerateOptions && (
            <div className="print-regenerate-options">
              <p className="print-regenerate-text">The collage has been modified since it was last exported. Would you like to generate a new image with your changes?</p>
              <div className="print-regenerate-actions">
                <button
                  className="print-regenerate-btn secondary"
                  onClick={cancelRegenerate}
                  disabled={isPrinting}
                >
                  Use Old Version
                </button>
                <button
                  className="print-regenerate-btn primary"
                  onClick={confirmRegenerate}
                  disabled={isPrinting}
                >
                  <ImageIcon size={12} />
                  Generate New
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
