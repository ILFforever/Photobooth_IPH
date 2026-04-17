import { motion, AnimatePresence } from 'framer-motion';
import { X, Monitor, Layers, MousePointer2, Save } from 'lucide-react';
import Icon from '@mdi/react';
import {
  mdiViewQuilt,
  mdiQrcode,
  mdiFormatText,
  mdiImage,
  mdiFileGifBox,
  mdiStickerEmoji,
  mdiRectangleOutline,
  mdiLightbulbOutline,
  mdiMonitor,
  mdiExport,
  mdiImport,
} from '@mdi/js';
import '../Sidebar/Collage/modals/CollageHelpModal.css';
import './DisplayLayoutHelpModal.css';

interface DisplayLayoutHelpModalProps {
  show: boolean;
  onClose: () => void;
}

const workflow = [
  {
    icon: <Icon path={mdiMonitor} size={0.72} />,
    title: 'Pick or create a layout',
    detail: 'Use the layout picker at the top of the left sidebar to switch between saved layouts or create a new one.',
  },
  {
    icon: <MousePointer2 size={16} />,
    title: 'Add and position elements',
    detail: 'Add a collage placeholder, QR code, text, images, shapes, or GIFs — then drag and resize them directly on the canvas.',
  },
  {
    icon: <Layers size={16} />,
    title: 'Adjust layers',
    detail: 'The element list on the right controls layer order. Drag rows to reorder; select an element to edit its properties.',
  },
  {
    icon: <Save size={16} />,
    title: 'Save, then activate',
    detail: 'Save your layout here, then go to Photobooth → Settings → Display Layout to select it for use.',
  },
];

const tips = [
  {
    label: 'Layer order',
    detail: 'Drag rows in the right panel element list to reorder layers.',
  },
  {
    label: 'Resize & rotate',
    detail: 'Select any element to reveal scale and rotation handles.',
  },
  {
    label: 'Center snap',
    detail: 'Elements snap to the canvas center axis while dragging.',
  },
  {
    label: 'Unsaved changes',
    detail: 'The save icon turns amber when you have unsaved changes.',
  },
  {
    label: 'Aspect ratio',
    detail: 'Switching ratio keeps elements at their pixel positions.',
  },
];

const primaryElements = [
  {
    icon: mdiViewQuilt,
    name: 'Collage',
    badge: 'One per layout',
    desc: 'Renders the finalize collage from the current photo session.',
  },
  {
    icon: mdiQrcode,
    name: 'QR Code',
    badge: 'One per layout',
    desc: 'Scannable link guests use to retrieve their photos.',
  },
];

const secondaryElements = [
  {
    icon: mdiFormatText,
    name: 'Text',
    desc: 'Custom copy with full font, size, weight, and color control.',
  },
  {
    icon: mdiImage,
    name: 'Image',
    desc: 'PNG / JPG / WebP — logos, branding, or decoration.',
  },
  {
    icon: mdiFileGifBox,
    name: 'GIF',
    desc: 'Animated GIF that plays on the guest display.',
  },
  {
    icon: mdiStickerEmoji,
    name: 'Emoji',
    desc: 'Large decorative emoji as a scalable text element.',
  },
  {
    icon: mdiRectangleOutline,
    name: 'Shape',
    desc: 'Rect, circle, line, triangle and more — fill and border editable.',
  },
];

export function DisplayLayoutHelpModal({ show, onClose }: DisplayLayoutHelpModalProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="help-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            className="help-modal dlh-modal"
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0.08 }}
            onClick={e => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div className="help-modal-header">
              <div className="help-modal-header-icon">
                <Monitor size={19} />
              </div>
              <div className="help-modal-header-text">
                <span className="help-modal-title">Display Layout Editor</span>
                <span className="help-modal-subtitle">
                  Design the guest finalize screen — position the collage, QR code, text, and graphics exactly as you want
                </span>
              </div>
              <button
                className="help-modal-close"
                onClick={onClose}
                aria-label="Close help"
              >
                <X size={17} />
              </button>
            </div>

            {/* ── Two-panel body ── */}
            <div className="help-modal-body dlh-body">

              {/* Left panel — Workflow */}
              <div className="help-left-panel dlh-left">

                <p className="help-panel-label">How it works</p>

                <div className="dlh-workflow">
                  {workflow.map((step, i) => (
                    <motion.div
                      key={step.title}
                      className="dlh-workflow-step"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06, duration: 0.2 }}
                    >
                      <div className="dlh-workflow-connector">
                        <div className="dlh-workflow-dot">
                          {step.icon}
                        </div>
                        {i < workflow.length - 1 && <div className="dlh-workflow-line" />}
                      </div>
                      <div className="dlh-workflow-content">
                        <span className="dlh-workflow-title">{step.title}</span>
                        <p className="dlh-workflow-detail">{step.detail}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Tips */}
                <p className="help-panel-label dlh-tips-label">Good to know</p>
                <div className="dlh-tips-list">
                  {tips.map((t, i) => (
                    <motion.div
                      key={t.label}
                      className="dlh-tip"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.26 + i * 0.04, duration: 0.18 }}
                    >
                      <span className="dlh-tip-label">{t.label}</span>
                      <span className="dlh-tip-detail">{t.detail}</span>
                    </motion.div>
                  ))}
                </div>

              </div>

              {/* Right panel — Elements */}
              <div className="help-right-panel dlh-right">
                <p className="help-panel-label">Elements</p>

                {/* Primary elements — Collage + QR */}
                <div className="dlh-primary-elements">
                  {primaryElements.map((el, i) => (
                    <motion.div
                      key={el.name}
                      className="dlh-primary-card"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06, duration: 0.2 }}
                    >
                      <div className="dlh-primary-card-top">
                        <div className="dlh-primary-icon">
                          <Icon path={el.icon} size={0.78} />
                        </div>
                        <div>
                          <span className="dlh-element-name">{el.name}</span>
                          <span className="dlh-element-badge">{el.badge}</span>
                        </div>
                      </div>
                      <p className="dlh-element-desc">{el.desc}</p>
                    </motion.div>
                  ))}
                </div>

                <div className="dlh-elements-divider" />

                {/* Secondary elements — inline reference list */}
                <div className="dlh-secondary-elements">
                  {secondaryElements.map((el, i) => (
                    <motion.div
                      key={el.name}
                      className="dlh-secondary-card"
                      initial={{ opacity: 0, x: 6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 + i * 0.04, duration: 0.16 }}
                    >
                      <div className="dlh-secondary-icon">
                        <Icon path={el.icon} size={0.72} />
                      </div>
                      <div className="dlh-secondary-text">
                        <span className="dlh-element-name">{el.name}</span>
                        <p className="dlh-element-desc">{el.desc}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>

                <div className="dlh-elements-divider" />

                {/* Import / Export */}
                <p className="help-panel-label dlh-section-label">Import &amp; Export</p>
                <div className="dlh-secondary-elements dlh-importexport-grid">
                  <div className="dlh-secondary-card">
                    <div className="dlh-secondary-icon">
                      <Icon path={mdiExport} size={0.72} />
                    </div>
                    <div className="dlh-secondary-text">
                      <span className="dlh-element-name">Export</span>
                      <p className="dlh-element-desc">Saves the layout to a <code className="dlh-code">.iplayout</code> file with all images embedded.</p>
                    </div>
                  </div>
                  <div className="dlh-secondary-card">
                    <div className="dlh-secondary-icon">
                      <Icon path={mdiImport} size={0.72} />
                    </div>
                    <div className="dlh-secondary-text">
                      <span className="dlh-element-name">Import</span>
                      <p className="dlh-element-desc">Loads a <code className="dlh-code">.iplayout</code> file as a new layout — nothing existing is replaced.</p>
                    </div>
                  </div>
                </div>

                <div className="dlh-elements-divider" />

                {/* How to activate callout */}
                <div className="dlh-callout dlh-callout--step">
                  <div className="dlh-callout-icon">
                    <Icon path={mdiLightbulbOutline} size={0.62} />
                  </div>
                  <div>
                    <p className="dlh-callout-heading">To use a layout in Photobooth mode</p>
                    <p className="dlh-callout-text">
                      Go to <strong>Photobooth</strong> → <strong>Settings</strong> → <strong>Display Layout</strong> and select the layout you want to use. Changes here in the editor do not automatically activate a layout.
                    </p>
                  </div>
                </div>
              </div>

            </div>

            {/* ── Footer ── */}
            <div className="help-modal-footer">
              <button className="help-modal-footer-btn" onClick={onClose}>
                Got it
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
