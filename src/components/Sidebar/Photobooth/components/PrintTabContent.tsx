import { Printer, RefreshCw } from 'lucide-react';

interface PrintTabContentProps {
  isPrinting: boolean;
  onPrint: () => void;
}

export function PrintTabContent({ isPrinting, onPrint }: PrintTabContentProps) {
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
    </div>
  );
}
