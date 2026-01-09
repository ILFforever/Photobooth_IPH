import { motion, AnimatePresence } from "framer-motion";

interface DriveFolder {
  id: string;
  name: string;
  is_shared_drive: boolean;
}

interface FolderPickerModalProps {
  show: boolean;
  onClose: () => void;
  driveFolders: DriveFolder[];
  loadingFolders: boolean;
  folderPath: { id: string; name: string }[];
  newFolderName: string;
  creatingFolder: boolean;
  onSetNewFolderName: (name: string) => void;
  onFetchFolders: (parentId: string | null) => void;
  onNavigateFolder: (folder: DriveFolder) => void;
  onNavigateUp: () => void;
  onConfirmSelection: (folder: DriveFolder) => void;
  onSelectCurrentDir: () => void;
  onCreateFolder: () => void;
  onDeleteFolder: (folder: DriveFolder) => void;
}

export default function FolderPickerModal({
  show,
  onClose,
  driveFolders,
  loadingFolders,
  folderPath,
  newFolderName,
  creatingFolder,
  onSetNewFolderName,
  onFetchFolders,
  onNavigateFolder,
  onNavigateUp,
  onConfirmSelection,
  onSelectCurrentDir,
  onCreateFolder,
  onDeleteFolder,
}: FolderPickerModalProps) {
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
          onClick={(e) => e.stopPropagation()}
        >
          <h2>Select Drive Root Folder</h2>

          {/* Breadcrumb Navigation */}
          <div className="folder-breadcrumbs">
            <button
              onClick={() => { onFetchFolders(null); }}
              className="breadcrumb-item"
              disabled={folderPath.length === 0}
            >
              🏠 My Drive
            </button>
            {folderPath.map((item) => (
              <span key={item.id} className="breadcrumb-segment">
                <span className="breadcrumb-separator">/</span>
                <button
                  className="breadcrumb-item"
                  onClick={() => {
                    onFetchFolders(item.id);
                  }}
                >
                  {item.name}
                </button>
              </span>
            ))}
          </div>

          {folderPath.length > 0 && (
            <button
              className="btn-back"
              onClick={onNavigateUp}
            >
              ← Back
            </button>
          )}

          <div className="folder-list">
            {loadingFolders ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  style={{ display: 'inline-block', marginBottom: '0.5rem' }}
                >
                  ⟳
                </motion.div>
                <div>Loading...</div>
              </div>
            ) : driveFolders.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#666', padding: '2rem' }}>No folders found</p>
            ) : (
              driveFolders.map((folder) => (
                <div
                  key={folder.id}
                  className="folder-row"
                >
                  <button
                    className="folder-name-btn"
                    onClick={() => onNavigateFolder(folder)}
                  >
                    <span className="folder-icon">
                      {folder.is_shared_drive ? "🏢" : "📁"}
                    </span>
                    <span className="folder-name-text">{folder.name}</span>
                  </button>

                  <div className="folder-actions">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="folder-delete-btn"
                      onClick={() => onDeleteFolder(folder)}
                      title="Delete folder"
                    >
                      🗑️
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="folder-select-btn"
                      onClick={() => onConfirmSelection(folder)}
                    >
                      Select
                    </motion.button>
                  </div>
                </div>
              ))
            )}
          </div>

          {folderPath.length > 0 && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="btn-primary"
                style={{ width: '100%' }}
                onClick={onSelectCurrentDir}
              >
                Select Current Folder: {folderPath[folderPath.length - 1].name}
              </motion.button>
            </div>
          )}

          <div className="create-folder-section">
            <h3>Or Create New Folder Here</h3>
            <div className="input-group">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => onSetNewFolderName(e.target.value)}
                placeholder="Enter folder name..."
                onKeyDown={(e) => e.key === 'Enter' && onCreateFolder()}
              />
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onCreateFolder}
                disabled={creatingFolder || !newFolderName.trim()}
                className="btn-primary"
              >
                {creatingFolder ? "Creating..." : "Create"}
              </motion.button>
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="btn-secondary"
            style={{ marginTop: '1rem', width: '100%' }}
          >
            Cancel
          </motion.button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
