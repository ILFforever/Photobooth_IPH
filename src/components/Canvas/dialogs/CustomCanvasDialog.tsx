import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useCollage } from "../../../contexts";
import { createLogger } from "../../../utils/logger";
import "./CustomCanvasDialog.css";

const logger = createLogger('CustomCanvasDialog');

type Unit = 'px' | 'mm' | 'cm' | 'in';

interface PresetTemplate {
  name: string;
  width: number;
  height: number;
  unit: Unit;
  category: 'standard' | 'social' | 'photo' | 'custom';
}

const PRESET_TEMPLATES: PresetTemplate[] = [
  // Standard paper sizes
  { name: 'A4', width: 210, height: 297, unit: 'mm', category: 'standard' },
  { name: 'A3', width: 297, height: 420, unit: 'mm', category: 'standard' },
  { name: 'A5', width: 148, height: 210, unit: 'mm', category: 'standard' },
  { name: 'A2', width: 420, height: 594, unit: 'mm', category: 'standard' },
  { name: 'Letter', width: 8.5, height: 11, unit: 'in', category: 'standard' },
  { name: 'Legal', width: 8.5, height: 14, unit: 'in', category: 'standard' },

  // Social media
  { name: 'Instagram Square', width: 1080, height: 1080, unit: 'px', category: 'social' },
  { name: 'Instagram Portrait', width: 1080, height: 1350, unit: 'px', category: 'social' },
  { name: 'Instagram Landscape', width: 1080, height: 608, unit: 'px', category: 'social' },
  { name: 'Facebook Post', width: 1200, height: 630, unit: 'px', category: 'social' },
  { name: 'Twitter Post', width: 1200, height: 675, unit: 'px', category: 'social' },
  { name: 'LinkedIn Post', width: 1200, height: 627, unit: 'px', category: 'social' },

  // Photo sizes
  { name: '4×6', width: 4, height: 6, unit: 'in', category: 'photo' },
  { name: '5×7', width: 5, height: 7, unit: 'in', category: 'photo' },
  { name: '8×10', width: 8, height: 10, unit: 'in', category: 'photo' },
  { name: '11×14', width: 11, height: 14, unit: 'in', category: 'photo' },
];

// Conversion factors to pixels at 300 DPI
const UNIT_TO_PX: Record<Unit, number> = {
  'px': 1,
  'mm': 300 / 25.4,
  'cm': 300 / 2.54,
  'in': 300,
};

const CATEGORY_LABELS: Record<string, string> = {
  standard: 'Standard Paper',
  social: 'Social Media',
  photo: 'Photo Prints',
};

interface CustomCanvasDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CustomCanvasDialog({ isOpen, onClose }: CustomCanvasDialogProps) {
  const { setCanvasSize } = useCollage();
  const [width, setWidth] = useState<string>('');
  const [height, setHeight] = useState<string>('');
  const [unit, setUnit] = useState<Unit>('px');
  const [name, setName] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<PresetTemplate | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Calculate dimensions in pixels
  const pixelDimensions = useMemo(() => {
    const w = parseFloat(width) || 0;
    const h = parseFloat(height) || 0;
    const factor = UNIT_TO_PX[unit];
    return {
      width: Math.round(w * factor),
      height: Math.round(h * factor),
    };
  }, [width, height, unit]);

  // Calculate aspect ratio
  const aspectRatio = useMemo(() => {
    const w = parseFloat(width) || 0;
    const h = parseFloat(height) || 0;
    if (h === 0) return 0;
    return w / h;
  }, [width, height]);

  // Format aspect ratio as a readable string
  const aspectRatioText = useMemo(() => {
    if (aspectRatio === 0) return '—';

    const commonRatios: { ratio: number; text: string }[] = [
      { ratio: 1, text: '1:1' },
      { ratio: 4/3, text: '4:3' },
      { ratio: 3/4, text: '3:4' },
      { ratio: 16/9, text: '16:9' },
      { ratio: 9/16, text: '9:16' },
      { ratio: 5/4, text: '5:4' },
      { ratio: 4/5, text: '4:5' },
      { ratio: 3/2, text: '3:2' },
      { ratio: 2/3, text: '2:3' },
    ];

    const match = commonRatios.find(r => Math.abs(aspectRatio - r.ratio) < 0.05);
    if (match) return match.text;

    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const precision = 100;
    const w = Math.round(aspectRatio * precision);
    const h = precision;
    const divisor = gcd(w, h);
    return `${w / divisor}:${h / divisor}`;
  }, [aspectRatio]);

  const handleSelectTemplate = (template: PresetTemplate) => {
    setSelectedTemplate(template);
    setWidth(template.width.toString());
    setHeight(template.height.toString());
    setUnit(template.unit);
    setName(template.name);
    setSubmitted(false);
  };

  const handleCreate = async () => {
    setSubmitted(true);
    if (!width || !height || !name) return;

    const newCanvas = {
      width: pixelDimensions.width,
      height: pixelDimensions.height,
      name,
      created_at: Math.floor(Date.now() / 1000),
    };

    setCanvasSize({
      width: pixelDimensions.width,
      height: pixelDimensions.height,
      name,
    });

    try {
      await invoke('save_custom_canvas_size', { canvas: newCanvas });
    } catch (error) {
      logger.error('Failed to save custom canvas:', error);
    }

    setWidth('');
    setHeight('');
    setName('');
    setSelectedTemplate(null);
    setSubmitted(false);
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      setWidth('');
      setHeight('');
      setName('');
      setSelectedTemplate(null);
      setSubmitted(false);
    }
  }, [isOpen]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter') handleCreate();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, width, height, name]);

  const templatesByCategory = useMemo(() => {
    const grouped: Record<string, PresetTemplate[]> = { standard: [], social: [], photo: [] };
    PRESET_TEMPLATES.forEach(t => grouped[t.category].push(t));
    return grouped;
  }, []);

  const isValid = !!(width && height && name);
  const showNameError = submitted && !name;
  const showWidthError = submitted && !width;
  const showHeightError = submitted && !height;

  // Preview dimensions: fit within 120×120
  const previewSize = useMemo(() => {
    if (aspectRatio <= 0) return null;
    const maxW = 120, maxH = 120;
    if (aspectRatio >= 1) {
      return { width: maxW, height: Math.round(maxW / aspectRatio) };
    } else {
      return { width: Math.round(maxH * aspectRatio), height: maxH };
    }
  }, [aspectRatio]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="ccd-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <div className="ccd-positioner" onClick={(e) => e.stopPropagation()}>
            <motion.div
              className="ccd-dialog"
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
            >
              {/* Header */}
              <div className="ccd-header">
                <div>
                  <h2 className="ccd-title">Custom Canvas Size</h2>
                  <p className="ccd-subtitle">Create a custom canvas or choose a preset</p>
                </div>
                <button
                  className="ccd-close-btn"
                  onClick={onClose}
                  aria-label="Close dialog"
                >
                  ✕
                </button>
              </div>

              {/* Content */}
              <div className="ccd-content">
                {/* Left — Templates */}
                <div>
                  <h3 className="ccd-section-label">Preset Templates</h3>
                  <div className="ccd-templates">
                    {Object.entries(templatesByCategory).map(([category, templates]) => (
                      <div key={category}>
                        <h4 className="ccd-category-label">
                          {CATEGORY_LABELS[category]}
                        </h4>
                        <div className="ccd-template-grid">
                          {templates.map(template => (
                            <button
                              key={template.name}
                              className={`ccd-template-btn${selectedTemplate?.name === template.name ? ' selected' : ''}`}
                              onClick={() => handleSelectTemplate(template)}
                            >
                              <span className="ccd-template-name">{template.name}</span>
                              <span className="ccd-template-dims">
                                {template.width}×{template.height} {template.unit}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right — Preview + Inputs */}
                <div className="ccd-right">
                  {/* Live Preview */}
                  <div>
                    <h3 className="ccd-section-label" style={{ fontSize: 'var(--text-lg)' }}>Preview</h3>
                    <div className="ccd-preview-box">
                      {previewSize ? (
                        <motion.div
                          key={`${previewSize.width}x${previewSize.height}`}
                          className="ccd-preview-canvas"
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.15 }}
                          style={{ width: previewSize.width, height: previewSize.height }}
                        />
                      ) : (
                        <div className="ccd-preview-empty">canvas</div>
                      )}
                    </div>
                    <div className="ccd-preview-meta">
                      <span>Ratio: <strong>{aspectRatioText}</strong></span>
                      {pixelDimensions.width > 0 && (
                        <span>{pixelDimensions.width}×{pixelDimensions.height} px</span>
                      )}
                    </div>
                  </div>

                  {/* Custom inputs */}
                  <div>
                    <h3 className="ccd-section-label" style={{ fontSize: 'var(--text-lg)' }}>Custom Size</h3>
                    <div className="ccd-inputs">
                      {/* Canvas name */}
                      <div className="ccd-field">
                        <label className="ccd-label">Canvas Name</label>
                        <input
                          className={`ccd-input${showNameError ? ' error' : ''}`}
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="e.g. My 4×6 Print"
                        />
                        {showNameError && (
                          <span className="ccd-error-msg">Name is required</span>
                        )}
                      </div>

                      {/* Dimensions */}
                      <div className="ccd-field">
                        <label className="ccd-label">Dimensions</label>
                        <div className="ccd-input-row">
                          <input
                            className={`ccd-input${showWidthError ? ' error' : ''}`}
                            type="number"
                            value={width}
                            onChange={(e) => setWidth(e.target.value)}
                            placeholder="Width"
                            min="0"
                            step="0.1"
                          />
                          <span className="ccd-times">×</span>
                          <input
                            className={`ccd-input${showHeightError ? ' error' : ''}`}
                            type="number"
                            value={height}
                            onChange={(e) => setHeight(e.target.value)}
                            placeholder="Height"
                            min="0"
                            step="0.1"
                          />
                        </div>
                        {(showWidthError || showHeightError) && (
                          <span className="ccd-error-msg">Width and height are required</span>
                        )}
                      </div>

                      {/* Unit selector */}
                      <div className="ccd-field">
                        <label className="ccd-label">Unit</label>
                        <div className="ccd-units">
                          {(['px', 'mm', 'cm', 'in'] as Unit[]).map(u => (
                            <button
                              key={u}
                              className={`ccd-unit-btn${unit === u ? ' active' : ''}`}
                              onClick={() => setUnit(u)}
                            >
                              {u}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="ccd-footer">
                <button className="ccd-btn-cancel" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="ccd-btn-create"
                  onClick={handleCreate}
                  disabled={submitted && !isValid}
                >
                  Create Canvas
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
