import { OverlayLayer as OverlayLayerType, BlendMode, LayerPosition } from '../../types/overlay';
import { useCollage } from '../../contexts/CollageContext';

interface OverlayPropertiesPanelProps {
  overlay: OverlayLayerType;
}

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

export function OverlayPropertiesPanel({ overlay }: OverlayPropertiesPanelProps) {
  const { updateOverlay } = useCollage();

  return (
    <div className="overlay-properties-panel">
      <h4>Layer Properties</h4>

      {/* Position controls */}
      <div className="property-row">
        <label>Position X</label>
        <div className="property-input-group">
          <input
            type="number"
            value={Math.round(overlay.transform.x)}
            onChange={(e) => updateOverlay(overlay.id, {
              transform: { ...overlay.transform, x: Number(e.target.value) }
            })}
            className="property-input"
          />
          <span className="property-unit">px</span>
        </div>
      </div>

      <div className="property-row">
        <label>Position Y</label>
        <div className="property-input-group">
          <input
            type="number"
            value={Math.round(overlay.transform.y)}
            onChange={(e) => updateOverlay(overlay.id, {
              transform: { ...overlay.transform, y: Number(e.target.value) }
            })}
            className="property-input"
          />
          <span className="property-unit">px</span>
        </div>
      </div>

      {/* Scale */}
      <div className="property-row">
        <label>Scale</label>
        <div className="property-slider-group">
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={overlay.transform.scale}
            onChange={(e) => updateOverlay(overlay.id, {
              transform: { ...overlay.transform, scale: Number(e.target.value) }
            })}
            className="property-slider"
          />
          <span className="property-value">{overlay.transform.scale.toFixed(1)}x</span>
        </div>
      </div>

      {/* Rotation */}
      <div className="property-row">
        <label>Rotation</label>
        <div className="property-slider-group">
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            value={overlay.transform.rotation}
            onChange={(e) => updateOverlay(overlay.id, {
              transform: { ...overlay.transform, rotation: Number(e.target.value) }
            })}
            className="property-slider"
          />
          <span className="property-value">{overlay.transform.rotation}°</span>
        </div>
      </div>

      {/* Opacity */}
      <div className="property-row">
        <label>Opacity</label>
        <div className="property-slider-group">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={overlay.transform.opacity}
            onChange={(e) => updateOverlay(overlay.id, {
              transform: { ...overlay.transform, opacity: Number(e.target.value) }
            })}
            className="property-slider"
          />
          <span className="property-value">{Math.round(overlay.transform.opacity * 100)}%</span>
        </div>
      </div>

      {/* Blend mode */}
      <div className="property-row">
        <label>Blend Mode</label>
        <select
          value={overlay.blendMode}
          onChange={(e) => updateOverlay(overlay.id, { blendMode: e.target.value as BlendMode })}
          className="property-select"
        >
          {BLEND_MODES.map(mode => (
            <option key={mode.value} value={mode.value}>{mode.label}</option>
          ))}
        </select>
      </div>

      {/* Layer position */}
      <div className="property-row">
        <label>Layer Position</label>
        <div className="property-toggle-group">
          <button
            className={`property-toggle ${overlay.position === 'below-frames' ? 'active' : ''}`}
            onClick={() => updateOverlay(overlay.id, { position: 'below-frames' as LayerPosition })}
          >
            Below Frames
          </button>
          <button
            className={`property-toggle ${overlay.position === 'above-frames' ? 'active' : ''}`}
            onClick={() => updateOverlay(overlay.id, { position: 'above-frames' as LayerPosition })}
          >
            Above Frames
          </button>
        </div>
      </div>

      {/* Flip controls */}
      <div className="property-row">
        <label>Flip</label>
        <div className="property-button-group">
          <button
            className={`property-button ${overlay.transform.flipHorizontal ? 'active' : ''}`}
            onClick={() => updateOverlay(overlay.id, {
              transform: { ...overlay.transform, flipHorizontal: !overlay.transform.flipHorizontal }
            })}
            title="Flip Horizontal"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 2v12h2V2H4zm8 0v12h2V2h-2zM7 4h2v8H7V4z" />
            </svg>
          </button>
          <button
            className={`property-button ${overlay.transform.flipVertical ? 'active' : ''}`}
            onClick={() => updateOverlay(overlay.id, {
              transform: { ...overlay.transform, flipVertical: !overlay.transform.flipVertical }
            })}
            title="Flip Vertical"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 4v2h12V4H2zm0 8v2h12v-2H2zM4 7h8v2H4V7z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Reset button */}
      <div className="property-row">
        <button
          className="property-reset-btn"
          onClick={() => updateOverlay(overlay.id, {
            transform: {
              x: 0,
              y: 0,
              scale: 1,
              rotation: 0,
              flipHorizontal: false,
              flipVertical: false,
              opacity: 1,
            }
          })}
        >
          Reset Transform
        </button>
      </div>
    </div>
  );
}
