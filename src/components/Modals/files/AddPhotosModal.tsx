import { motion, AnimatePresence } from "framer-motion";

interface AddPhotosModalProps {
  show: boolean;
  onClose: () => void;
  onAddSingleImage: () => void;
  onAddFromFolder: () => void;
}

export default function AddPhotosModal({
  show,
  onClose,
  onAddSingleImage,
  onAddFromFolder,
}: AddPhotosModalProps) {
  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="modal-overlay"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="modal-content"
          style={{ maxWidth: '400px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Add Photos</h2>
          <div className="add-options" style={{ marginTop: 0, justifyContent: 'center' }}>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onAddSingleImage}
              className="add-option-btn"
            >
              <span className="add-option-icon">🖼️</span>
              <span>Single Image</span>
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onAddFromFolder}
              className="add-option-btn"
            >
              <span className="add-option-icon">📁</span>
              <span>From Folder</span>
            </motion.button>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="btn-secondary"
            style={{ marginTop: '1.5rem', width: '100%' }}
          >
            Cancel
          </motion.button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
