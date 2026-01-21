import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { useCollage } from '../../contexts/CollageContext';
import { LayerPosition } from '../../types/overlay';

interface ImportOverlaysModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ImportOverlaysModal({ isOpen, onClose }: ImportOverlaysModalProps) {
  const { importOverlayFiles } = useCollage();
  const [selectedPosition, setSelectedPosition] = useState<LayerPosition>('above-frames');
  const [importing, setImporting] = useState(false);

  const handleFileSelect = async () => {
    try {
      setImporting(true);

      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'PNG Images',
            extensions: ['png', 'PNG']
          }
        ]
      });

      if (selected && selected.length > 0) {
        await importOverlayFiles(selected as string[], selectedPosition);
        onClose();
      }
    } catch (error) {
      console.error('Failed to open file dialog:', error);
    } finally {
      setImporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => !importing && onClose()}
      >
        <motion.div
          className="modal-content import-overlays-modal"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2>Import Overlay Images</h2>
          <p className="modal-description">
            Select PNG images to add as overlay layers. Transparent PNGs work best.
          </p>

          <div className="import-options">
            <label className="import-option">
              <input
                type="radio"
                name="layer-position"
                value="above-frames"
                checked={selectedPosition === 'above-frames'}
                onChange={(e) => setSelectedPosition(e.target.value as LayerPosition)}
              />
              <span className="import-option-content">
                <span className="import-option-title">Above Frames</span>
                <span className="import-option-desc">Overlay will appear on top of photo zones</span>
              </span>
            </label>
            <label className="import-option">
              <input
                type="radio"
                name="layer-position"
                value="below-frames"
                checked={selectedPosition === 'below-frames'}
                onChange={(e) => setSelectedPosition(e.target.value as LayerPosition)}
              />
              <span className="import-option-content">
                <span className="import-option-title">Below Frames</span>
                <span className="import-option-desc">Overlay will appear behind photo zones</span>
              </span>
            </label>
          </div>

          <div className="modal-actions">
            <button
              className="modal-btn modal-btn-cancel"
              onClick={onClose}
              disabled={importing}
            >
              Cancel
            </button>
            <button
              className="modal-btn modal-btn-primary"
              onClick={handleFileSelect}
              disabled={importing}
            >
              {importing ? 'Opening...' : 'Select Files'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
