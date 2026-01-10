import { motion, AnimatePresence } from "framer-motion";
import { GoogleAccount, DriveFolder } from "../../contexts/AuthContext";

interface UploadProgress {
  step: string;
  current: number;
  total: number;
  message: string;
}

interface QRSidebarProps {
  account: GoogleAccount | null;
  rootFolder: DriveFolder | null;
  selectedImages: string[];
  failedImages: {filename: string, type: string, isRaw?: boolean, size?: number}[];
  photos_path: string;
  loading: boolean;
  uploadProgress: UploadProgress | null;
  error: string;
  selectingFolder: boolean;
  onSelectDriveFolder: () => void;
  onAddPhotos: () => void;
  onGenerate: () => void;
  onCancelUpload: () => void;
}

const QRSidebar = ({
  account,
  rootFolder,
  selectedImages,
  failedImages,
  photos_path,
  loading,
  uploadProgress,
  error,
  selectingFolder,
  onSelectDriveFolder,
  onAddPhotos,
  onGenerate,
  onCancelUpload
}: QRSidebarProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="sidebar-section"
    >
      <h2 className="sidebar-title">Generate QR Code</h2>
      <p className="sidebar-description">
        Select a Drive root folder and upload your photobooth images to generate a shareable QR code and link.
      </p>

      <div className="input-group">
        <label>Drive Root Folder</label>
        <div className="folder-selector">
          <input
            type="text"
            value={rootFolder ? rootFolder.name : ""}
            readOnly
            placeholder={account ? "Click to select/create root folder..." : "Sign in first..."}
          />
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onSelectDriveFolder}
            disabled={!account || selectingFolder}
            className="btn-secondary"
          >
            {selectingFolder ? "..." : rootFolder ? "Change" : "Select"}
          </motion.button>
        </div>
        {rootFolder && (
          <p style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem' }}>
            Photos will be organized in encoded folders inside "{rootFolder.name}"
          </p>
        )}
      </div>

      <div className="input-group">
        <label>Add Photos (Local)</label>
        <div className="folder-selector">
          <input
            type="text"
            value={selectedImages.length + failedImages.length > 0 ? `${selectedImages.length + failedImages.length} images selected` : ""}
            readOnly
            placeholder="Select local file or folder to upload..."
          />
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onAddPhotos}
            disabled={loading}
            className="btn-secondary"
          >
            Browse
          </motion.button>
        </div>
      </div>

      <motion.button
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={loading ? onCancelUpload : onGenerate}
        disabled={!loading && (!rootFolder || !photos_path)}
        className={loading ? "btn-uploading" : "btn-primary"}
      >
        {loading ? (
          <>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="spinner"
            >
              ⟳
            </motion.div>
            <span className="upload-text">Uploading...</span>
            <span className="cancel-text">Cancel Upload</span>
          </>
        ) : (
          "Upload & Generate QR Code"
        )}
      </motion.button>

      {/* Upload Progress Display */}
      <AnimatePresence>
        {loading && uploadProgress && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="upload-progress-container"
          >
            <div className="upload-progress-header">
              <span className="upload-progress-step">
                {uploadProgress.step === 'starting' && '🚀 Starting...'}
                {uploadProgress.step === 'creating_folder' && '📁 Creating Folder...'}
                {uploadProgress.step === 'scanning' && '🔍 Scanning Files...'}
                {uploadProgress.step === 'uploading' && '📤 Uploading Files...'}
                {uploadProgress.step === 'permissions' && '🔓 Setting Permissions...'}
                {uploadProgress.step === 'qr_code' && '📱 Generating QR Code...'}
                {uploadProgress.step === 'complete' && '✅ Complete!'}
              </span>
              {uploadProgress.total > 0 && (
                <span className="upload-progress-count">
                  {uploadProgress.current}/{uploadProgress.total}
                </span>
              )}
            </div>
            <div className="upload-progress-message">{uploadProgress.message}</div>
            {uploadProgress.total > 0 && uploadProgress.step === 'uploading' && (
              <div className="upload-progress-bar-container">
                <motion.div
                  className="upload-progress-bar"
                  initial={{ width: 0 }}
                  animate={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="error-message"
          >
            <span className="error-icon">⚠️</span>
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default QRSidebar;
