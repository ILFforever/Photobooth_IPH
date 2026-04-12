import "./PrintSettingsSection.css";
import { useState } from 'react';
import { ChevronDown, ChevronRight, Info, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePrintSettings, useWorkspaceSettings } from '../../../../contexts';

interface PrintSettingsSectionProps {
  expanded: boolean;
  onToggle: () => void;
}

export function PrintSettingsSection({ expanded, onToggle }: PrintSettingsSectionProps) {
  const { borderFit, setBorderFit, borderTopBottom, setBorderTopBottom, borderSides, setBorderSides } = usePrintSettings();
  const { exportResolutionMp, setExportResolutionMp } = useWorkspaceSettings();
  const [showResolutionInfo, setShowResolutionInfo] = useState(false);

  const handleTopBottomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0) setBorderTopBottom(val);
  };

  const handleSidesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0) setBorderSides(val);
  };

  const handleResolutionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) setExportResolutionMp(val);
  };

  return (
    <>
    <div className="collapsible-section print-settings-section">
      <button className="collapsible-header" onClick={onToggle}>
        <div className="collapsible-header-left">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="collapsible-title">Print Settings</span>
        </div>
      </button>

      {expanded && (
        <div className="collapsible-content">
          {/* Border Fit Toggle */}
          <div className="qr-upload-toggle-row">
            <div>
              <div className="setting-label-full">Border Fit</div>
              <div className="setting-hint">
                Adds white margins to double-page prints for printer cutting
              </div>
            </div>
            <button
              className={`toggle-btn ${borderFit ? 'active' : ''}`}
              onClick={() => setBorderFit(!borderFit)}
            >
              <span className="toggle-slider" />
            </button>
          </div>

          <div className="sidebar-divider" style={{ marginBottom: '12px' }} />

          <div style={{ opacity: borderFit ? 1 : 0.4, pointerEvents: borderFit ? 'auto' : 'none', transition: 'opacity 0.2s ease' }}>

          <div className="setting-label-full" style={{ marginBottom: '8px' }}>Border Size (inches)</div>

          <div className="print-border-inputs">
            <div className="print-border-input-row">
              <label className="setting-hint">Top / Bottom</label>
              <input
                type="number"
                className="print-border-input"
                value={borderTopBottom}
                min={0}
                step={0.01}
                onChange={handleTopBottomChange}
              />
              <span className="setting-hint">in</span>
            </div>
            <div className="print-border-input-row">
              <label className="setting-hint">Outer Sides</label>
              <input
                type="number"
                className="print-border-input"
                value={borderSides}
                min={0}
                step={0.01}
                onChange={handleSidesChange}
              />
              <span className="setting-hint">in</span>
            </div>
          </div>

          <div className="setting-notice notice-info" style={{ marginTop: '12px' }}>
            No gap is added between the two copies — the printer cuts there
          </div>

          </div>{/* end greyed wrapper */}

          <div className="sidebar-divider" style={{ marginBottom: '12px', marginTop: '16px' }} />

          <div className="print-resolution-label">
            <span className="setting-label-full">Export Resolution</span>
            <button className="print-info-btn" onClick={() => setShowResolutionInfo(true)}>
              <Info size={13} />
            </button>
          </div>
          <div className="setting-hint" style={{ marginBottom: '8px' }}>Target megapixels for print export scaling</div>

          <div className="print-border-inputs">
            <div className="print-border-input-row">
              <label className="setting-hint">Target</label>
              <input
                type="number"
                className="print-border-input"
                value={exportResolutionMp}
                min={1}
                max={100}
                step={1}
                onChange={handleResolutionChange}
              />
              <span className="setting-hint">MP</span>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Export Resolution Info Modal */}
    <AnimatePresence>
      {showResolutionInfo && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setShowResolutionInfo(false)}
        >
          <motion.div
            className="modal confirm-dialog"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '440px' }}
          >
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Info size={18} style={{ color: '#3b82f6' }} />
                <h2>Export Resolution</h2>
              </div>
              <button className="modal-close-btn" onClick={() => setShowResolutionInfo(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                <p>When the canvas pixel count is below the target, the export is scaled up so the printed image has more detail and sharpness.</p>
                <p>If the canvas is already at or above the target, no scaling is applied.</p>
                <p>The default is <strong style={{ color: 'var(--text-primary)' }}>15 MP</strong>. Higher values produce larger files and longer export times. For most 4×6 prints, 15–20 MP is sufficient.</p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
