import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useCollage } from "../../contexts/CollageContext";
import { DEFAULT_TRANSFORM } from "../../types/collage";
import { convertFileSrc } from "@tauri-apps/api/core";
import "./ImageManipulator.css";

const ImageManipulator = () => {
  const { selectedZone, placedImages, updatePlacedImage, removePlacedImage, background, backgroundTransform, setBackgroundTransform, isBackgroundSelected } = useCollage();
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const placedImage = selectedZone ? placedImages.get(selectedZone) : null;
  const isBackgroundMode = isBackgroundSelected && background;

  // Convert file paths to Tauri-compatible URLs for preview
  const previewSrc = isBackgroundMode
    ? (background?.startsWith('http') || background?.startsWith('data:')
        ? background
        : convertFileSrc(background?.replace('asset://', '') || ''))
    : placedImage
      ? convertFileSrc(placedImage.sourceFile.replace('asset://', ''))
      : '';

  // Reset panning state when selection changes
  useEffect(() => {
    setIsPanning(false);
  }, [selectedZone, isBackgroundSelected]);

  // Handle mouse up when panning
  useEffect(() => {
    if (isPanning) {
      const handleMouseUp = () => setIsPanning(false);
      window.addEventListener('mouseup', handleMouseUp);
      return () => window.removeEventListener('mouseup', handleMouseUp);
    }
  }, [isPanning]);

  // Early return if no image selected
  if ((!selectedZone || !placedImage) && !isBackgroundMode) {
    return (
      <div className="image-manipulator">
        <div className="manipulator-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <p>Select an image to adjust</p>
        </div>
      </div>
    );
  }

  const transform = isBackgroundMode ? backgroundTransform : placedImage!.transform;
  const currentTransform = transform;

  const handleScaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const scale = parseFloat(e.target.value);
    if (isBackgroundMode) {
      setBackgroundTransform({ ...backgroundTransform, scale });
    } else {
      updatePlacedImage(selectedZone!, {
        transform: { ...placedImage!.transform, scale },
      });
    }
  };

  const handleRotationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rotation = parseFloat(e.target.value);
    if (isBackgroundMode) {
      // Background doesn't support rotation
      return;
    } else {
      updatePlacedImage(selectedZone!, {
        transform: { ...placedImage!.transform, rotation },
      });
    }
  };

  const handleFlipHorizontal = () => {
    if (isBackgroundMode) {
      // Background doesn't support flip
      return;
    } else {
      updatePlacedImage(selectedZone!, {
        transform: { ...placedImage!.transform, flipHorizontal: !placedImage!.transform.flipHorizontal },
      });
    }
  };

  const handleFlipVertical = () => {
    if (isBackgroundMode) {
      // Background doesn't support flip
      return;
    } else {
      updatePlacedImage(selectedZone!, {
        transform: { ...placedImage!.transform, flipVertical: !placedImage!.transform.flipVertical },
      });
    }
  };

  const handleResetTransform = () => {
    if (isBackgroundMode) {
      setBackgroundTransform({ scale: 1, offsetX: 0, offsetY: 0 });
    } else {
      // Use the original optimal scale calculated when the image was placed
      const optimalScale = placedImage!.originalScale || DEFAULT_TRANSFORM.scale;
      updatePlacedImage(selectedZone!, {
        transform: { ...DEFAULT_TRANSFORM, scale: optimalScale },
      });
    }
  };

  const handleRemoveImage = () => {
    if (isBackgroundMode) {
      // Cannot remove background, just clear it
      return;
    } else if (selectedZone) {
      removePlacedImage(selectedZone);
    }
  };

  const handlePanStart = (e: React.MouseEvent) => {
    setIsPanning(true);
    setPanStart({ x: e.clientX - transform.offsetX, y: e.clientY - transform.offsetY });
  };

  const handlePanMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const offsetX = e.clientX - panStart.x;
      const offsetY = e.clientY - panStart.y;
      if (isBackgroundMode) {
        setBackgroundTransform({ ...backgroundTransform, offsetX, offsetY });
      } else {
        updatePlacedImage(selectedZone!, {
          transform: { ...placedImage!.transform, offsetX, offsetY },
        });
      }
    }
  };

  const handlePanEnd = () => {
    setIsPanning(false);
  };

  return (
    <div className="image-manipulator">
      <div className="manipulator-header">
        <h3>{isBackgroundMode ? 'Background Controls' : 'Image Controls'}</h3>
        <span className="zone-label">{isBackgroundMode ? 'Background Layer' : `Zone ${selectedZone}`}</span>
      </div>

      <div className="manipulator-content">
        {/* Preview Image */}
        <div
          className={`image-preview ${isPanning ? 'panning' : ''}`}
          onMouseDown={handlePanStart}
          onMouseMove={handlePanMove}
          onMouseUp={handlePanEnd}
          onMouseLeave={handlePanEnd}
        >
          <img
            src={previewSrc}
            alt="Preview"
            style={{
              transform: isBackgroundMode
                ? `scale(${transform.scale}) translate(${transform.offsetX / transform.scale}px, ${transform.offsetY / transform.scale}px)`
                : `
                scale(${placedImage!.transform.scale})
                translate(${placedImage!.transform.offsetX / placedImage!.transform.scale}px, ${placedImage!.transform.offsetY / placedImage!.transform.scale}px)
                rotate(${placedImage!.transform.rotation}deg)
                scaleX(${placedImage!.transform.flipHorizontal ? -1 : 1})
                scaleY(${placedImage!.transform.flipVertical ? -1 : 1})
              `,
            }}
            draggable={false}
          />
          {isPanning && (
            <div className="pan-hint">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M19 9l3 3-3 3M9 19l3 3 3-3M2 12h20M12 2v20"/>
              </svg>
              <span>Drag to pan</span>
            </div>
          )}
        </div>

        {/* Scale Control */}
        <div className="control-group">
          <label>
            <svg className="control-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              <line x1="11" y1="8" x2="11" y2="14"/>
              <line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
            <span>Scale</span>
            <span className="control-value">{transform.scale.toFixed(2)}x</span>
          </label>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={transform.scale}
            onChange={handleScaleChange}
            className="slider"
          />
          <div className="slider-labels">
            <span>0.5x</span>
            <span>3x</span>
          </div>
        </div>

        {/* Rotation Control - hidden for background */}
        {!isBackgroundMode && (
          <div className="control-group">
            <label>
              <svg className="control-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38"/>
              </svg>
              <span>Rotation</span>
              <span className="control-value">{placedImage!.transform.rotation}°</span>
            </label>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={placedImage!.transform.rotation}
              onChange={handleRotationChange}
              className="slider"
            />
            <div className="slider-labels">
              <span>-180°</span>
              <span>180°</span>
            </div>
          </div>
        )}

        {/* Pan Control */}
        <div className="control-group">
          <label>
            <svg className="control-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M19 9l3 3-3 3M9 19l3 3 3-3M2 12h20M12 2v20"/>
            </svg>
            <span>Position</span>
          </label>
          <div className="pan-info">
            <span>X: {transform.offsetX}px</span>
            <span>Y: {transform.offsetY}px</span>
          </div>
          <p className="control-hint">Click and drag the preview image to pan</p>
        </div>

        {/* Flip Controls - hidden for background */}
        {!isBackgroundMode && (
          <div className="control-group">
            <label>
              <svg className="control-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              <span>Flip</span>
            </label>
            <div className="button-row">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleFlipHorizontal}
                className={`btn-flip ${placedImage!.transform.flipHorizontal ? 'active' : ''}`}
              >
                Horizontal
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleFlipVertical}
                className={`btn-flip ${placedImage!.transform.flipVertical ? 'active' : ''}`}
              >
                Vertical
              </motion.button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="manipulator-actions">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleResetTransform}
            className="btn-reset"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
            Reset
          </motion.button>
          {!isBackgroundMode && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleRemoveImage}
              className="btn-remove"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
              Remove
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageManipulator;
