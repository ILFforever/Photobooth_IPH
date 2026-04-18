import { useState, useRef, useEffect } from 'react';
import { OverlayLayer as OverlayLayerType, BlendMode, LayerPosition } from '../../../types/overlay';
import { useCollage } from '../../../contexts';
import { useAssetLibrary } from '../../../contexts/system/AssetLibraryContext';
import Icon from '@mdi/react';
import {
  mdiFlipHorizontal,
  mdiFlipVertical,
  mdiEye,
  mdiEyeOff,
  mdiRefresh,
  mdiChevronDown,
} from '@mdi/js';

const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

interface OverlayPropertiesPanelProps {
  overlay: OverlayLayerType;
}

export function OverlayPropertiesPanel({ overlay }: OverlayPropertiesPanelProps) {
  const { updateOverlay, toggleOverlayVisibility } = useCollage();
  const { resolveAssetUrl } = useAssetLibrary();
  const thumbSrc = overlay.thumbnail || resolveAssetUrl(overlay.assetId);
  const [blendOpen, setBlendOpen] = useState(false);
  const blendRef = useRef<HTMLDivElement>(null);
  const previewBlendModeRef = useRef<BlendMode | null>(null);
  const [editName, setEditName] = useState(overlay.name);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditName(overlay.name);
  }, [overlay.id, overlay.name]);

  const handleTransformChange = (key: string, value: number | boolean) => {
    updateOverlay(overlay.id, {
      transform: { ...overlay.transform, [key]: value },
    });
  };

  const handleResetTransform = () => {
    updateOverlay(overlay.id, {
      transform: {
        x: 0, y: 0, scale: 1, rotation: 0,
        flipHorizontal: false, flipVertical: false, opacity: 1,
      },
    });
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (blendRef.current && !blendRef.current.contains(e.target as Node)) {
        setBlendOpen(false);
      }
    };
    if (blendOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [blendOpen]);

  const currentBlendLabel = BLEND_MODES.find(m => m.value === overlay.blendMode)?.label || 'Normal';

  return (
    <div className="overlay-properties-panel">
      {/* Header */}
      <div className="props-header">
        <div className="props-header-info">
          <div className="props-thumb">
            {thumbSrc && <img src={thumbSrc} alt={overlay.name} />}
          </div>
          <input
            ref={nameRef}
            className="props-name-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={() => {
              const trimmed = editName.trim();
              if (trimmed && trimmed !== overlay.name) {
                updateOverlay(overlay.id, { name: trimmed });
              } else {
                setEditName(overlay.name);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === 'Escape') {
                setEditName(overlay.name);
                (e.target as HTMLInputElement).blur();
              }
            }}
            title="Click to rename"
          />
        </div>
        <button
          className={`props-vis-btn ${overlay.visible ? '' : 'off'}`}
          onClick={() => toggleOverlayVisibility(overlay.id)}
          title={overlay.visible ? 'Hide' : 'Show'}
        >
          <Icon path={overlay.visible ? mdiEye : mdiEyeOff} size={0.65} />
        </button>
      </div>

      {/* Position */}
      <div className="props-group">
        <div className="props-group-label">Position</div>
        <div className="props-row-2col">
          <div className="props-field">
            <label>X</label>
            <input
              type="number"
              value={Math.round(overlay.transform.x)}
              onChange={(e) => handleTransformChange('x', Number(e.target.value))}
            />
          </div>
          <div className="props-field">
            <label>Y</label>
            <input
              type="number"
              value={Math.round(overlay.transform.y)}
              onChange={(e) => handleTransformChange('y', Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      {/* Transform */}
      <div className="props-group">
        <div className="props-group-label">Transform</div>

        <div className="props-slider-row">
          <label>Scale</label>
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={overlay.transform.scale}
            onChange={(e) => handleTransformChange('scale', Number(e.target.value))}
          />
          <span className="props-slider-value">{overlay.transform.scale.toFixed(1)}x</span>
        </div>

        <div className="props-slider-row">
          <label>Rotation</label>
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            value={overlay.transform.rotation}
            onChange={(e) => handleTransformChange('rotation', Number(e.target.value))}
          />
          <span className="props-slider-value">{overlay.transform.rotation}°</span>
        </div>

        <div className="props-slider-row">
          <label>Opacity</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={overlay.transform.opacity}
            onChange={(e) => handleTransformChange('opacity', Number(e.target.value))}
          />
          <span className="props-slider-value">{Math.round(overlay.transform.opacity * 100)}%</span>
        </div>

        <div className="props-tools-row">
          <button
            className={`props-tool-btn ${overlay.transform.flipHorizontal ? 'active' : ''}`}
            onClick={() => handleTransformChange('flipHorizontal', !overlay.transform.flipHorizontal)}
            title="Flip Horizontal"
          >
            <Icon path={mdiFlipHorizontal} size={0.6} />
          </button>
          <button
            className={`props-tool-btn ${overlay.transform.flipVertical ? 'active' : ''}`}
            onClick={() => handleTransformChange('flipVertical', !overlay.transform.flipVertical)}
            title="Flip Vertical"
          >
            <Icon path={mdiFlipVertical} size={0.6} />
          </button>
          <div className="props-tools-spacer" />
          <button
            className="props-tool-btn reset"
            onClick={handleResetTransform}
            title="Reset Transform"
          >
            <Icon path={mdiRefresh} size={0.6} />
          </button>
        </div>
      </div>

      {/* Appearance */}
      <div className="props-group">
        <div className="props-group-label">Appearance</div>

        <div className="props-field">
          <label>Blend Mode</label>
          <div className="props-dropdown" ref={blendRef}>
            <button
              className="props-dropdown-trigger"
              onClick={() => setBlendOpen(!blendOpen)}
            >
              <span>{currentBlendLabel}</span>
              <Icon path={mdiChevronDown} size={0.55} />
            </button>
            {blendOpen && (
              <div
                className="props-dropdown-menu"
                onMouseLeave={() => {
                  if (previewBlendModeRef.current !== null) {
                    updateOverlay(overlay.id, { blendMode: previewBlendModeRef.current });
                    previewBlendModeRef.current = null;
                  }
                }}
              >
                {BLEND_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    className={`props-dropdown-item ${overlay.blendMode === mode.value ? 'active' : ''}`}
                    onMouseEnter={() => {
                      if (previewBlendModeRef.current === null) {
                        previewBlendModeRef.current = overlay.blendMode;
                      }
                      updateOverlay(overlay.id, { blendMode: mode.value });
                    }}
                    onClick={() => {
                      previewBlendModeRef.current = null;
                      updateOverlay(overlay.id, { blendMode: mode.value });
                      setBlendOpen(false);
                    }}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="props-field">
          <label>Position</label>
          <div className="props-toggle-group">
            <button
              className={`props-toggle-btn ${overlay.position === 'below-frames' ? 'active' : ''}`}
              onClick={() => updateOverlay(overlay.id, { position: 'below-frames' as LayerPosition })}
            >
              Below
            </button>
            <button
              className={`props-toggle-btn ${overlay.position === 'above-frames' ? 'active' : ''}`}
              onClick={() => updateOverlay(overlay.id, { position: 'above-frames' as LayerPosition })}
            >
              Above
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
