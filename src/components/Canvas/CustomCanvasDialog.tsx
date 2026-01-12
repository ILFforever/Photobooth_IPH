import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useCollage } from "../../contexts/CollageContext";

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

  // Format aspect ratio as a readable string (e.g., "4:3", "16:9")
  const aspectRatioText = useMemo(() => {
    if (aspectRatio === 0) return '-';

    // Find common ratios
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

    // Calculate simplified ratio
    const gcd = (a: number, b: number): number => {
      return b === 0 ? a : gcd(b, a % b);
    };

    const precision = 100;
    const ar = aspectRatio;
    const w = Math.round(ar * precision);
    const h = precision;
    const divisor = gcd(w, h);

    return `${w / divisor}:${h / divisor}`;
  }, [aspectRatio]);

  // Handle template selection
  const handleSelectTemplate = (template: PresetTemplate) => {
    setSelectedTemplate(template);
    setWidth(template.width.toString());
    setHeight(template.height.toString());
    setUnit(template.unit);
    setName(template.name);
  };

  // Handle create canvas
  const handleCreate = async () => {
    if (!width || !height || !name) {
      return;
    }

    const newCanvas = {
      width: pixelDimensions.width,
      height: pixelDimensions.height,
      name,
      created_at: new Date().toISOString(),
    };

    setCanvasSize({
      width: pixelDimensions.width,
      height: pixelDimensions.height,
      name,
    });

    // Save to appdata using dedicated command
    try {
      await invoke('save_custom_canvas_size', { canvas: newCanvas });
      console.log('Custom canvas saved:', newCanvas);
    } catch (error) {
      console.error('Failed to save custom canvas:', error);
    }

    // Reset form
    setWidth('');
    setHeight('');
    setName('');
    setSelectedTemplate(null);
    onClose();
  };

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setWidth('');
      setHeight('');
      setName('');
      setSelectedTemplate(null);
    }
  }, [isOpen]);

  // Group templates by category
  const templatesByCategory = useMemo(() => {
    const grouped: Record<string, PresetTemplate[]> = {
      standard: [],
      social: [],
      photo: [],
    };

    PRESET_TEMPLATES.forEach(template => {
      grouped[template.category].push(template);
    });

    return grouped;
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.7)',
              zIndex: 9998,
              backdropFilter: 'blur(4px)',
            }}
          />

          {/* Dialog */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 9999,
              pointerEvents: 'auto',
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              style={{
                width: '90vw',
                maxWidth: '900px',
                maxHeight: '85vh',
                background: 'linear-gradient(145deg, rgba(30, 30, 35, 0.98), rgba(20, 20, 25, 0.98))',
                borderRadius: '16px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                overflow: 'hidden',
              }}
            >
            {/* Header */}
            <div style={{
              padding: '24px 32px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <h2 style={{
                  margin: 0,
                  fontSize: '24px',
                  fontWeight: 600,
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}>
                  <span>✏️</span>
                  Custom Canvas Size
                </h2>
                <p style={{
                  margin: '4px 0 0 0',
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                }}>
                  Create a custom canvas or use a preset template
                </p>
              </div>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '20px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                }}
              >
                ✕
              </motion.button>
            </div>

            {/* Content */}
            <div style={{
              padding: '32px',
              overflowY: 'auto',
              flex: 1,
              display: 'grid',
              gridTemplateColumns: '1fr 300px',
              gap: '32px',
            }}>
              {/* Left side - Templates */}
              <div>
                <h3 style={{
                  margin: '0 0 16px 0',
                  fontSize: '16px',
                  fontWeight: 600,
                  color: 'rgba(255, 255, 255, 0.9)',
                }}>
                  Preset Templates
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {Object.entries(templatesByCategory).map(([category, templates]) => (
                    <div key={category}>
                      <h4 style={{
                        margin: '0 0 8px 0',
                        fontSize: '13px',
                        fontWeight: 500,
                        color: 'rgba(255, 255, 255, 0.5)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}>
                        {category === 'standard' && '📄 Standard Paper'}
                        {category === 'social' && '📱 Social Media'}
                        {category === 'photo' && '🖼️ Photo Prints'}
                      </h4>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                        gap: '8px',
                      }}>
                        {templates.map(template => (
                          <motion.button
                            key={template.name}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleSelectTemplate(template)}
                            style={{
                              padding: '12px',
                              borderRadius: '8px',
                              background: selectedTemplate?.name === template.name
                                ? 'rgba(59, 130, 246, 0.2)'
                                : 'rgba(255, 255, 255, 0.05)',
                              border: selectedTemplate?.name === template.name
                                ? '2px solid rgba(59, 130, 246, 0.5)'
                                : '1px solid rgba(255, 255, 255, 0.1)',
                              color: '#ffffff',
                              fontSize: '13px',
                              cursor: 'pointer',
                              textAlign: 'left',
                              transition: 'all 0.2s',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>{template.name}</span>
                            <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)' }}>
                              {template.width}×{template.height} {template.unit}
                            </span>
                          </motion.button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right side - Custom input & preview */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '24px',
              }}>
                {/* Live preview */}
                <div>
                  <h3 style={{
                    margin: '0 0 12px 0',
                    fontSize: '14px',
                    fontWeight: 600,
                    color: 'rgba(255, 255, 255, 0.9)',
                  }}>
                    Live Preview
                  </h3>
                  <div style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    borderRadius: '12px',
                    padding: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '160px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}>
                    {aspectRatio > 0 ? (
                      <motion.div
                        key={aspectRatio}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.2 }}
                        style={{
                          width: aspectRatio > 1 ? '100px' : '80px',
                          maxWidth: '120px',
                          maxHeight: '120px',
                          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(147, 51, 234, 0.3))',
                          border: '2px solid rgba(59, 130, 246, 0.5)',
                          borderRadius: '4px',
                          aspectRatio: `${aspectRatio}`,
                          boxShadow: '0 8px 16px rgba(0, 0, 0, 0.3)',
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '80px',
                        height: '100px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '2px dashed rgba(255, 255, 255, 0.2)',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'rgba(255, 255, 255, 0.3)',
                        fontSize: '12px',
                      }}>
                        Preview
                      </div>
                    )}
                  </div>
                  <div style={{
                    marginTop: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '13px',
                    color: 'rgba(255, 255, 255, 0.6)',
                  }}>
                    <span>Aspect Ratio: <strong style={{ color: '#ffffff' }}>{aspectRatioText}</strong></span>
                    <span>{pixelDimensions.width}×{pixelDimensions.height} px</span>
                  </div>
                </div>

                {/* Custom input */}
                <div>
                  <h3 style={{
                    margin: '0 0 12px 0',
                    fontSize: '14px',
                    fontWeight: 600,
                    color: 'rgba(255, 255, 255, 0.9)',
                  }}>
                    Custom Size
                  </h3>
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '12px',
                    padding: '16px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}>
                    {/* Canvas name */}
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 500,
                        color: 'rgba(255, 255, 255, 0.7)',
                        marginBottom: '6px',
                      }}>
                        Canvas Name
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="My Custom Canvas"
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: '6px',
                          background: 'rgba(0, 0, 0, 0.3)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#ffffff',
                          fontSize: '14px',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    {/* Dimensions */}
                    <div style={{ marginBottom: '12px' }}>
                      <label style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 500,
                        color: 'rgba(255, 255, 255, 0.7)',
                        marginBottom: '6px',
                      }}>
                        Dimensions
                      </label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <input
                            type="number"
                            value={width}
                            onChange={(e) => setWidth(e.target.value)}
                            placeholder="Width"
                            min="0"
                            step="0.1"
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              borderRadius: '6px',
                              background: 'rgba(0, 0, 0, 0.3)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              color: '#ffffff',
                              fontSize: '14px',
                              outline: 'none',
                              boxSizing: 'border-box',
                            }}
                          />
                        </div>
                        <span style={{
                          display: 'flex',
                          alignItems: 'center',
                          color: 'rgba(255, 255, 255, 0.4)',
                          fontSize: '18px',
                        }}>×</span>
                        <div style={{ flex: 1 }}>
                          <input
                            type="number"
                            value={height}
                            onChange={(e) => setHeight(e.target.value)}
                            placeholder="Height"
                            min="0"
                            step="0.1"
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              borderRadius: '6px',
                              background: 'rgba(0, 0, 0, 0.3)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              color: '#ffffff',
                              fontSize: '14px',
                              outline: 'none',
                              boxSizing: 'border-box',
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Unit selector */}
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: 500,
                        color: 'rgba(255, 255, 255, 0.7)',
                        marginBottom: '6px',
                      }}>
                        Unit
                      </label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {(['px', 'mm', 'cm', 'in'] as Unit[]).map(u => (
                          <button
                            key={u}
                            onClick={() => setUnit(u)}
                            style={{
                              flex: 1,
                              padding: '8px',
                              borderRadius: '6px',
                              background: unit === u
                                ? 'rgba(59, 130, 246, 0.3)'
                                : 'rgba(0, 0, 0, 0.3)',
                              border: unit === u
                                ? '2px solid rgba(59, 130, 246, 0.5)'
                                : '1px solid rgba(255, 255, 255, 0.1)',
                              color: '#ffffff',
                              fontSize: '13px',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              textTransform: 'uppercase',
                            }}
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
            <div style={{
              padding: '20px 32px',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '12px',
            }}>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                style={{
                  padding: '12px 24px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                Cancel
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleCreate}
                disabled={!width || !height || !name}
                style={{
                  padding: '12px 24px',
                  borderRadius: '8px',
                  background: (!width || !height || !name)
                    ? 'rgba(59, 130, 246, 0.3)'
                    : 'linear-gradient(135deg, rgba(59, 130, 246, 0.8), rgba(147, 51, 234, 0.8))',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: (!width || !height || !name) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  opacity: (!width || !height || !name) ? 0.5 : 1,
                }}
              >
                Create Canvas
              </motion.button>
            </div>
          </motion.div>
        </div>
        </>
      )}
    </AnimatePresence>
  );
}
