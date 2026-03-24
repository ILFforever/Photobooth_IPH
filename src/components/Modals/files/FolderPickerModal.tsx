import { motion, AnimatePresence } from "framer-motion";
import { Trash2, X, ChevronLeft, ChevronRight, Home, Folder, Building2, Check, FolderPlus } from 'lucide-react';
import "../../../styles/Modal.css";
import "../../../styles/FolderPicker.css";
import "../../../styles/Buttons.css";

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
  onNavigateToRoot: () => void;
  onNavigateToBreadcrumb: (index: number) => void;
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
  onNavigateFolder,
  onNavigateUp,
  onNavigateToRoot,
  onNavigateToBreadcrumb,
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
          initial={{ opacity: 0, scale: 0.98, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: 10 }}
          transition={{ duration: 0.15 }}
          className="folder-picker-modal"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="folder-picker-header">
            <h2>Select Google Drive Folder</h2>
            <button
              className="folder-picker-close"
              onClick={onClose}
              title="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Breadcrumb Navigation */}
          <div className="folder-breadcrumbs">
            {folderPath.length > 0 && (
              <button
                className="breadcrumb-back-btn"
                onClick={onNavigateUp}
                title="Go back"
              >
                <ChevronLeft size={14} />
                <span>Back</span>
              </button>
            )}
            <button
              onClick={onNavigateToRoot}
              className="breadcrumb-item"
            >
              <Home size={14} />
              <span>My Drive</span>
            </button>
            {folderPath.map((item, index) => (
              <div key={item.id} className="breadcrumb-segment">
                <ChevronRight size={12} className="breadcrumb-separator" />
                <button
                  className="breadcrumb-item"
                  onClick={() => onNavigateToBreadcrumb(index)}
                >
                  {item.name}
                </button>
              </div>
            ))}
          </div>

          {/* Folder List */}
          <div className="folder-list-container">
            {loadingFolders ? (
              <div className="folder-loading">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="folder-loading-spinner"
                >
                  <Folder size={36} />
                </motion.div>
                <span>Loading folders...</span>
              </div>
            ) : !driveFolders || driveFolders.length === 0 ? (
              <div className="folder-empty">
                <Folder size={48} />
                <span>No folders in this location</span>
              </div>
            ) : (
              <div className="folder-list">
                {driveFolders.map((folder) => (
                  <div
                    key={folder.id}
                    className="folder-row"
                  >
                    <button
                      className="folder-info-btn"
                      onClick={() => onNavigateFolder(folder)}
                      title="Open folder"
                    >
                      {folder.is_shared_drive
                        ? <Building2 size={20} className="folder-icon" />
                        : <Folder size={20} className="folder-icon" />
                      }
                      <span className="folder-name">{folder.name}</span>
                    </button>
                    <div className="folder-actions">
                      <button
                        className="folder-select-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onConfirmSelection(folder);
                        }}
                        title="Select this folder"
                      >
                        <Check size={13} />
                        <span>Select</span>
                      </button>
                      <button
                        className="folder-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          console.warn('[FolderPicker] Delete clicked for:', folder.name);
                          onDeleteFolder(folder);
                        }}
                        title="Delete folder"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="folder-picker-footer">
            {folderPath.length > 0 && (
              <button
                className="btn-select-current"
                onClick={onSelectCurrentDir}
              >
                Select Current: {folderPath[folderPath.length - 1].name}
              </button>
            )}
            <div className="create-folder-row">
              <FolderPlus size={16} />
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => onSetNewFolderName(e.target.value)}
                placeholder="New folder name"
                onKeyDown={(e) => e.key === 'Enter' && onCreateFolder()}
              />
              <button
                onClick={onCreateFolder}
                disabled={creatingFolder || !newFolderName.trim()}
                className="btn-create-folder"
              >
                {creatingFolder ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
