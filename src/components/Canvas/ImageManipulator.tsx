import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useCollage } from "../../contexts/CollageContext";
import { DEFAULT_TRANSFORM } from "../../types/collage";
import "./ImageManipulator.css";

const ImageManipulator = () => {
  const { selectedZone, placedImages, updatePlacedImage, removePlacedImage, background, backgroundTransform, setBackgroundTransform, isBackgroundSelected } = useCollage();
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const placedImage = selectedZone ? placedImages.get(selectedZone) : null;
  const isBackgroundMode = isBackgroundSelected && background;

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
          <span className="empty-icon">🎨</span>
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
            src={isBackgroundMode ? background : (placedImage?.thumbnail || placedImage?.sourceFile)}
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
              <span>🖐️ Drag to pan</span>
            </div>
          )}
        </div>

        {/* Scale Control */}
        <div className="control-group">
          <label>
            <span className="control-icon">🔍</span>
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
              <span className="control-icon">🔄</span>
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
            <span className="control-icon">✋</span>
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
              <span className="control-icon">🔀</span>
              <span>Flip</span>
            </label>
            <div className="button-row">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleFlipHorizontal}
                className={`btn-flip ${placedImage!.transform.flipHorizontal ? 'active' : ''}`}
              >
                ↔️ Horizontal
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleFlipVertical}
                className={`btn-flip ${placedImage!.transform.flipVertical ? 'active' : ''}`}
              >
                ↕️ Vertical
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
            🔄 Reset
          </motion.button>
          {!isBackgroundMode && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleRemoveImage}
              className="btn-remove"
            >
              🗑️ Remove
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageManipulator;
