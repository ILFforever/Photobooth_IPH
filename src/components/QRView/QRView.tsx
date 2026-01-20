import { motion, AnimatePresence } from "framer-motion";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useState, useCallback, useEffect, useRef } from "react";
import "./QRView.css";
import type { NoPreviewImage, Result } from "../../types/qr";

interface QRViewProps {
  result: Result | null;
  selectedImages: string[];
  noPreviewImages: NoPreviewImage[];
  loadedImages: Record<string, boolean>;
  isDragging: boolean;
  processingImages: string[];
  onCopyLink: () => void;
  onNew: () => void;
  onBack: () => void;
  onRemoveImage: (path: string) => void;
  onRemoveNoPreviewImage: (filename: string) => void;
  onImageLoaded: (path: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  formatFileSize: (bytes?: number) => string;
}

export default function QRView({
  result,
  selectedImages,
  noPreviewImages,
  loadedImages,
  isDragging,
  processingImages,
  onCopyLink,
  onNew,
  onBack,
  onRemoveImage,
  onRemoveNoPreviewImage,
  onImageLoaded,
  onDragOver,
  onDragLeave,
  onDrop,
  formatFileSize,
}: QRViewProps) {
  // Use a counter to force refresh when component becomes visible
  const [refreshKey, setRefreshKey] = useState(0);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const isMountedRef = useRef(true);

  // Convert all image URLs when selectedImages changes or on refresh
  useEffect(() => {
    if (!isMountedRef.current) return;

    const urls: Record<string, string> = {};
    for (const path of selectedImages) {
      try {
        urls[path] = convertFileSrc(path.replace('asset://', ''));
      } catch (e) {
        console.error('[QRView] Failed to convert file src:', path, e);
      }
    }
    setImageUrls(urls);
    console.log('[QRView] Converted image URLs for', selectedImages.length, 'images, refreshKey:', refreshKey);
  }, [selectedImages, refreshKey]);

  // Force refresh on visibility change (handles sleep/wake)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[QRView] Document became visible, refreshing images...');
        setRefreshKey(prev => prev + 1);
        setFailedImages(new Set());
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Also refresh when component mounts (handles mode switch)
  useEffect(() => {
    console.log('[QRView] Component mounted/updated, refreshing images...');
    setRefreshKey(prev => prev + 1);
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []); // Run once on mount

  // Handle image load error with retry
  const handleImageError = useCallback((imagePath: string, index: number) => {
    console.error(`[QRView] Image ${index} failed to load: ${imagePath}`);

    // Mark as failed and trigger retry
    if (!failedImages.has(imagePath)) {
      setFailedImages(prev => new Set([...prev, imagePath]));

      // Retry after delay
      setTimeout(() => {
        if (!isMountedRef.current) return;
        setRefreshKey(prev => prev + 1);
        setTimeout(() => {
          if (isMountedRef.current) {
            setFailedImages(prev => {
              const next = new Set(prev);
              next.delete(imagePath);
              return next;
            });
          }
        }, 100);
      }, 300);
    }
  }, [failedImages]);

  return (
    <div className="gallery-view">
      <AnimatePresence mode="wait" initial={false}>
        {result ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="result-view"
          >
            <div className="result-header">
              <h2>QR Code Generated</h2>
              <div className="result-badge">
                <span className="badge-icon">✓</span>
                <span>Ready to Share</span>
              </div>
            </div>

            <div className="result-body">
              <div className="qr-section">
                <div className="qr-container">
                  <img
                    src={`data:image/png;base64,${result.qr_data}`}
                    alt="QR Code"
                    className="qr-code"
                  />
                </div>
                <p className="qr-label">Scan to view photos</p>
              </div>

              <div className="info-section">
                <div className="info-item">
                  <label>Folder Name</label>
                  <div className="info-value">{result.folder_name}</div>
                </div>

                <div className="info-item">
                  <label>Share Link</label>
                  <div className="link-container">
                    <input
                      type="text"
                      value={result.link}
                      readOnly
                      className="link-input"
                    />
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={onCopyLink}
                      className="btn-copy"
                    >
                      📋 Copy
                    </motion.button>
                  </div>
                </div>

                <motion.a
                  href={result.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-open"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                >
                  Open in Browser →
                </motion.a>

                <div className="button-row">
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={onNew}
                    className="btn-new btn-green"
                  >
                    New Batch
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={onBack}
                    className="btn-back"
                  >
                    ← Back
                  </motion.button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="gallery"
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="gallery-motion-wrapper"
          >
            {selectedImages.length > 0 || noPreviewImages.length > 0 ? (
              <div
                className={`gallery-with-images ${isDragging ? 'dragging' : ''}`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <div className="image-grid">
                  {selectedImages.map((imagePath, index) => {
                    const isLoaded = loadedImages[imagePath];
                    const hasFailed = failedImages.has(imagePath);
                    const imageUrl = imageUrls[imagePath];

                    // Use refreshKey in key to force remount on refresh
                    const imageCardKey = `${imagePath}-${refreshKey}`;

                    return (
                      <motion.div
                        key={imageCardKey}
                        layout
                        initial={false}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.2 }}
                        className="image-card"
                      >
                        {(!isLoaded || hasFailed) && <div className="shimmer-overlay" />}
                        {imageUrl && (
                          <img
                            key={`img-${imagePath}-${refreshKey}`}
                            src={imageUrl}
                            alt={`Selected ${index + 1}`}
                            onLoad={() => onImageLoaded(imagePath)}
                            onError={() => handleImageError(imagePath, index)}
                            style={{ opacity: isLoaded && !hasFailed ? 1 : 0 }}
                          />
                        )}
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

                  {/* Show placeholder cards for processing images */}
                  {processingImages.map((filename) => (
                    <motion.div
                      key={`processing-${filename}`}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className="image-card loading-card"
                    >
                      <div className="shimmer-overlay" />
                    </motion.div>
                  ))}

                  {/* Show placeholder cards for images without preview (RAW files, etc.) */}
                  {noPreviewImages.map((img) => (
                    <motion.div
                      key={`no-preview-${img.filename}`}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className="image-card no-preview-card"
                      data-is-raw={img.isRaw ? "true" : "false"}
                    >
                      <div className="no-preview-content">
                        <div className="no-preview-icon">{img.isRaw ? '📄' : '⚠️'}</div>
                        <div className="no-preview-filename">{img.filename}</div>
                        <div className="no-preview-type">{img.type}</div>
                        {img.size && <div className="no-preview-size">{formatFileSize(img.size)}</div>}
                        {img.isRaw && (
                          <div className="no-preview-message">Will upload RAW file</div>
                        )}
                      </div>
                      <button
                        className="remove-image-btn"
                        onClick={() => onRemoveNoPreviewImage(img.filename)}
                        title="Remove image"
                      >
                        ×
                      </button>
                    </motion.div>
                  ))}
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
        )}
      </AnimatePresence>
    </div>
  );
}
