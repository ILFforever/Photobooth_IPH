import { motion } from "framer-motion";

interface ImageGalleryProps {
  selectedImages: string[];
  failedImages: {filename: string, type: string, isRaw?: boolean, size?: number}[];
  processingImages: string[];
  loadedImages: Record<string, boolean>;
  isDragging: boolean;
  loading: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onImageLoaded: (path: string) => void;
  onRemoveImage: (imagePath: string) => void;
  onRemoveFailedImage: (filename: string) => void;
  onClearGallery: () => void;
}

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const ImageGallery = ({
  selectedImages,
  failedImages,
  processingImages,
  loadedImages,
  isDragging,
  loading,
  onDragOver,
  onDragLeave,
  onDrop,
  onImageLoaded,
  onRemoveImage,
  onRemoveFailedImage,
  onClearGallery
}: ImageGalleryProps) => {
  return (
    <motion.div
      key="gallery"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="gallery-view"
    >
      {selectedImages.length > 0 || failedImages.length > 0 ? (
        <div
          className={`gallery-with-images ${isDragging ? 'dragging' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="image-grid">
            {selectedImages.map((imagePath, index) => {
              const isLoaded = loadedImages[imagePath];
              return (
                <motion.div
                  key={imagePath}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="image-card"
                >
                  {!isLoaded && <div className="shimmer-overlay" />}
                  <img
                    src={imagePath}
                    alt={`Selected ${index + 1}`}
                    onLoad={() => {
                      onImageLoaded(imagePath);
                    }}
                    onError={(e) => console.error(`Image ${index} failed to load:`, imagePath, e)}
                  />
                  <button
                    className="remove-image-btn"
                    onClick={() => onRemoveImage(imagePath)}
                    title="Remove image"
                  >
                    ×
                  </button>
                </motion.div>
              );
            })}

            {/* Show placeholder cards for failed images */}
            {failedImages.map((failedImg) => (
              <motion.div
                key={`failed-${failedImg.filename}`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="image-card failed-card"
                data-is-raw={failedImg.isRaw ? "true" : "false"}
              >
                <div className="failed-image-content">
                  <div className="failed-icon">{failedImg.isRaw ? '📄' : '⚠️'}</div>
                  <div className="failed-filename">{failedImg.filename}</div>
                  <div className="failed-type">{failedImg.type}</div>
                  {failedImg.size && <div className="failed-size">{formatFileSize(failedImg.size)}</div>}
                  {!failedImg.isRaw && <div className="failed-message">Preview failed</div>}
                </div>
                <button
                  className="remove-image-btn"
                  onClick={() => onRemoveFailedImage(failedImg.filename)}
                  title="Remove failed image"
                >
                  ×
                </button>
              </motion.div>
            ))}

            {/* Show loading cards for images being processed */}
            {processingImages.map((filename) => (
              <motion.div
                key={`processing-${filename}`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="image-card loading-card"
              />
            ))}

            {/* Drop zone placeholder */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="drop-placeholder"
            >
              <div className="drop-placeholder-content">
                <span className="drop-placeholder-icon">🖱️</span>
                <span className="drop-placeholder-text">Drop more photos here</span>
              </div>
            </motion.div>
          </div>
          <div className="gallery-footer">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onClearGallery}
              disabled={loading}
              className="btn-clear-gallery"
            >
              🗑️ Clear All ({selectedImages.length + failedImages.length})
            </motion.button>
          </div>
        </div>
      ) : (
        <div
          className={`drop-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="drop-zone-content">
            <div className="drop-zone-icon">📷</div>
            <h3>No Images Selected</h3>
            <p>Photos added from the sidebar or dropped here will appear in this gallery.</p>

            <p className="drop-zone-hint">or drag and drop photos here</p>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default ImageGallery;
