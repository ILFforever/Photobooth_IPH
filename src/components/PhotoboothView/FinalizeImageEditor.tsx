import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { X, Plus, Minus } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { PlacedImage, ImageTransform, DEFAULT_TRANSFORM } from "../../types/collage";
import { usePhotobooth } from "../../contexts/PhotoboothContext";
import "./FinalizeImageEditor.css";

interface FinalizeImageEditorProps {
  onClose: () => void;
}

export default function FinalizeImageEditor({ onClose }: FinalizeImageEditorProps) {
  const {
    finalizeEditingZoneId: selectedZone,
    placedImages,
    updatePlacedImage,
    photoboothFrame
  } = usePhotobooth();

  const placedImage = selectedZone ? placedImages.get(selectedZone) : null;
  const transformRef = useRef<ImageTransform | null>(null);

  // Keep transformRef in sync with current transform
  useEffect(() => {
    if (placedImage) {
      transformRef.current = placedImage.transform;
    }
  }, [placedImage]);

  // Early return if no image selected
  if (!selectedZone || !placedImage) {
    return null;
  }

  // Find the zone and its index for display
  const zone = photoboothFrame?.zones.find(z => z.id === selectedZone);
  const zoneIndex = photoboothFrame?.zones.findIndex(z => z.id === selectedZone) ?? -1;
  const zoneName = zone ? `Zone ${zoneIndex + 1}` : 'Unknown Zone';

  const transform = placedImage.transform;
  const previewSrc = convertFileSrc(placedImage.sourceFile.replace('asset://', ''));

  const updateTransform = useCallback((updates: Partial<ImageTransform>) => {
    const currentTransform = transformRef.current;
    if (!currentTransform) return;
    updatePlacedImage(selectedZone, {
      transform: { ...currentTransform, ...updates },
    });
  }, [selectedZone, updatePlacedImage]);

  const handleZoomIn = () => {
    const currentTransform = transformRef.current;
    if (!currentTransform) return;
    const newScale = Math.min(3, currentTransform.scale + 0.1);
    updateTransform({ scale: newScale });
  };

  const handleZoomOut = () => {
    const currentTransform = transformRef.current;
    if (!currentTransform) return;
    const newScale = Math.max(0.5, currentTransform.scale - 0.1);
    updateTransform({ scale: newScale });
  };

  const handleRotationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateTransform({ rotation: parseFloat(e.target.value) });
  };

  const handleFlipHorizontal = () => {
    const currentTransform = transformRef.current;
    if (!currentTransform) return;
    updateTransform({ flipHorizontal: !currentTransform.flipHorizontal });
  };

  const handleFlipVertical = () => {
    const currentTransform = transformRef.current;
    if (!currentTransform) return;
    updateTransform({ flipVertical: !currentTransform.flipVertical });
  };

  const handleReset = () => {
    const optimalScale = placedImage.originalScale || DEFAULT_TRANSFORM.scale;
    updatePlacedImage(selectedZone, {
      transform: { ...DEFAULT_TRANSFORM, scale: optimalScale },
    });
  };

  return (
    <motion.div
      className="finalize-editor-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="finalize-editor-modal"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="finalize-editor-header">
          <div className="finalize-editor-header-content">
            <h3>Adjust Image</h3>
            <span className="finalize-editor-zone-name">{zoneName}</span>
          </div>
          <button className="finalize-editor-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="finalize-editor-content">
          {/* Preview - Non-interactive */}
          <div className="finalize-editor-preview">
            <img
              src={previewSrc}
              alt="Preview"
              style={{
                transform: `
                  scale(${transform.scale})
                  translate(${transform.offsetX / transform.scale}px, ${transform.offsetY / transform.scale}px)
                  rotate(${transform.rotation}deg)
                  scaleX(${transform.flipHorizontal ? -1 : 1})
                  scaleY(${transform.flipVertical ? -1 : 1})
                `,
              }}
              draggable={false}
            />
          </div>

          {/* Zoom with +/- buttons */}
          <div className="fe-control-group">
            <label>
              <svg className="fe-control-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
              <span>Zoom</span>
              <span className="fe-control-value">{transform.scale.toFixed(2)}x</span>
            </label>
            <div className="fe-zoom-controls">
              <button
                onClick={handleZoomOut}
                disabled={transform.scale <= 0.5}
                className="fe-zoom-btn"
                title="Zoom out"
              >
                <Minus size={16} />
              </button>
              <span className="fe-zoom-value">{transform.scale.toFixed(1)}x</span>
              <button
                onClick={handleZoomIn}
                disabled={transform.scale >= 3}
                className="fe-zoom-btn"
                title="Zoom in"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          {/* Rotation */}
          <div className="fe-control-group">
            <label>
              <svg className="fe-control-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38" />
              </svg>
              <span>Rotation</span>
              <span className="fe-control-value">{transform.rotation}</span>
            </label>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={transform.rotation}
              onChange={handleRotationChange}
              className="fe-slider"
            />
            <div className="fe-slider-labels">
              <span>-180</span>
              <span>180</span>
            </div>
          </div>

          {/* Position Info */}
          <div className="fe-control-group">
            <label>
              <svg className="fe-control-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M19 9l3 3-3 3M9 19l3 3 3-3M2 12h20M12 2v20" />
              </svg>
              <span>Position</span>
              <div className="fe-position-values">
                <span>X: {Math.round(transform.offsetX)}</span>
                <span>Y: {Math.round(transform.offsetY)}</span>
              </div>
            </label>
          </div>

          {/* Flip */}
          <div className="fe-control-group">
            <label>
              <svg className="fe-control-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              <span>Flip</span>
            </label>
            <div className="fe-flip-buttons">
              <button
                onClick={handleFlipHorizontal}
                className={`fe-btn-flip ${transform.flipHorizontal ? 'active' : ''}`}
                title="Flip horizontal"
              >
                ⬌
              </button>
              <button
                onClick={handleFlipVertical}
                className={`fe-btn-flip ${transform.flipVertical ? 'active' : ''}`}
                title="Flip vertical"
              >
                ⬍
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="finalize-editor-actions">
          <button className="fe-btn-reset" onClick={handleReset}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Reset
          </button>
          <button className="fe-btn-done" onClick={onClose}>
            Done
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
