import { motion, AnimatePresence } from "framer-motion";

interface ConfirmDialogProps {
  show: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export default function ConfirmDialog({
  show,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  isLoading = false,
}: ConfirmDialogProps) {
  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onCancel}
      >
        <motion.div
          className="modal confirm-dialog"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h2>{title}</h2>
          </div>

          <div className="modal-body">
            <p>{message}</p>
          </div>

          <div className="modal-footer">
            <button
              className="button button-secondary"
              onClick={onCancel}
              disabled={isLoading}
            >
              {cancelText}
            </button>
            <button
              className="button button-danger"
              onClick={onConfirm}
              disabled={isLoading}
            >
              {isLoading ? "Processing..." : confirmText}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
