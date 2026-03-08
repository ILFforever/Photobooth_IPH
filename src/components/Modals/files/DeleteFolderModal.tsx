import { motion, AnimatePresence } from "framer-motion";

interface DriveFolder {
  id: string;
  name: string;
  is_shared_drive: boolean;
}

interface DeleteFolderModalProps {
  show: boolean;
  folderToDelete: DriveFolder | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeleteFolderModal({
  show,
  folderToDelete,
  deleting,
  onCancel,
  onConfirm,
}: DeleteFolderModalProps) {
  if (!show || !folderToDelete) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="modal-overlay"
        onClick={onCancel}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="confirm-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <h3>Delete Folder?</h3>
          <p>
            Are you sure you want to delete "<strong>{folderToDelete.name}</strong>"?
            This will permanently delete the folder and all its contents from Google Drive.
          </p>
          <div className="confirm-modal-actions">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onCancel}
              className="btn-secondary"
              disabled={deleting}
            >
              Cancel
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onConfirm}
              className="btn-danger"
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  >
                    ⟳
                  </motion.span>
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
