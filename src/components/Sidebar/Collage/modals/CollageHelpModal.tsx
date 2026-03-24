import { motion, AnimatePresence } from "framer-motion";
import { X, BookOpen } from "lucide-react";
import Icon from "@mdi/react";
import {
  mdiWallpaper,
  mdiViewGridOutline,
  mdiLayersOutline,
  mdiContentSaveOutline,
  mdiFolderOutline,
  mdiPencilOutline,
  mdiFileExportOutline,
} from "@mdi/js";
import "./CollageHelpModal.css";

interface CollageHelpModalProps {
  show: boolean;
  onClose: () => void;
}

const steps = [
  {
    step: 1,
    title: "Set a Background",
    description: "Choose a color, gradient, or upload a background image.",
    secondary: false,
  },
  {
    step: 2,
    title: "Choose a Frame",
    description: "Pick a grid layout or build a custom frame with precise zones.",
    secondary: false,
  },
  {
    step: 3,
    title: "Save as a Custom Set",
    description: "Save the layout — this is what gets used in Photobooth mode.",
    secondary: false,
  },
  {
    step: 4,
    title: "Add Photos",
    description: "Optionally add photos from your folder to preview the layout.",
    secondary: true,
  },
  {
    step: 5,
    title: "Arrange & Edit",
    description: "Optionally adjust photo positions, rotation, and layer order.",
    secondary: true,
  },
  {
    step: 6,
    title: "Export",
    description: "Optionally render and save the finished collage as an image.",
    secondary: true,
  },
];

const tabs = [
  {
    id: "custom-sets",
    name: "Custom Sets",
    icon: mdiContentSaveOutline,
    description: "Save your background and frame layout as a reusable template. Saved sets are available directly in Photobooth mode.",
    tips: ["Saves background + frame together", "Loads directly in Photobooth mode"],
    primary: true,
  },
  {
    id: "background",
    name: "Background",
    icon: mdiWallpaper,
    description: "Set the canvas background with solid colors, gradients, or a custom image.",
    tips: ["Presets & custom gradients", "Upload your own image"],
    primary: false,
  },
  {
    id: "frames",
    name: "Frames",
    icon: mdiViewGridOutline,
    description: "Choose a grid template to organize photos into zones.",
    tips: ["2×2, 3×3, 4×4 presets", "Custom frame builder"],
    primary: false,
  },
  {
    id: "file",
    name: "File Gallery",
    icon: mdiFolderOutline,
    description: "Browse and select photos from your active working folder.",
    tips: ["Click to add to canvas"],
    primary: false,
  },
  {
    id: "edit",
    name: "Edit",
    icon: mdiPencilOutline,
    description: "Adjust the selected photo's position, scale, and rotation.",
    tips: ["Arrow keys for fine adjustment"],
    primary: false,
  },
  {
    id: "layers",
    name: "Layers",
    icon: mdiLayersOutline,
    description: "View and reorder all photos on the canvas.",
    tips: ["Drag to reorder", "Click × to remove"],
    primary: false,
  },
  {
    id: "export",
    name: "Export",
    icon: mdiFileExportOutline,
    description: "Render and save the current canvas as a high-resolution image.",
    tips: ["Requires a frame & canvas size"],
    primary: false,
  },
];

const essentialSteps = steps.filter((s) => !s.secondary);
const optionalSteps = steps.filter((s) => s.secondary);

export function CollageHelpModal({ show, onClose }: CollageHelpModalProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="help-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            className="help-modal"
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", duration: 0.38, bounce: 0.1 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="help-modal-header">
              <div className="help-modal-header-icon">
                <BookOpen size={19} />
              </div>
              <div className="help-modal-header-text">
                <span className="help-modal-title">Collage Creator Guide</span>
                <span className="help-modal-subtitle">
                  Design a frame layout and background, then save it as a Custom Set to use in Photobooth mode
                </span>
              </div>
              <button className="help-modal-close" onClick={onClose} aria-label="Close">
                <X size={17} />
              </button>
            </div>

            {/* Two-column body */}
            <div className="help-modal-body">

              {/* Left — Workflow timeline */}
              <div className="help-left-panel">
                <p className="help-panel-label">Workflow</p>

                <div className="help-timeline">
                  {essentialSteps.map((item, i) => (
                    <motion.div
                      key={item.step}
                      className="help-timeline-item"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06, duration: 0.22 }}
                    >
                      <div className="help-timeline-line" />
                      <div className="help-timeline-dot">{item.step}</div>
                      <div className="help-timeline-content">
                        <span className="help-timeline-title">{item.title}</span>
                        <p className="help-timeline-desc">{item.description}</p>
                      </div>
                    </motion.div>
                  ))}

                  {/* Divider between essential and optional */}
                  <motion.div
                    className="help-timeline-divider"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.22, duration: 0.3 }}
                  >
                    <div className="help-timeline-divider-line" />
                    <span className="help-timeline-divider-label">optional</span>
                    <div className="help-timeline-divider-line" />
                  </motion.div>

                  {optionalSteps.map((item, i) => (
                    <motion.div
                      key={item.step}
                      className="help-timeline-item help-timeline-item--secondary"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.28 + i * 0.06, duration: 0.22 }}
                    >
                      <div className="help-timeline-line" />
                      <div className="help-timeline-dot">{item.step}</div>
                      <div className="help-timeline-content">
                        <span className="help-timeline-title">{item.title}</span>
                        <p className="help-timeline-desc">{item.description}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Right — Tab reference */}
              <div className="help-right-panel">
                <p className="help-panel-label">Tab Reference</p>

                <div className="help-tabs-grid">
                  {tabs.map((tab, i) => (
                    <motion.div
                      key={tab.id}
                      className={`help-tab-card${tab.primary ? " help-tab-card--primary" : ""}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.22 }}
                    >
                      <div className="help-tab-card-header">
                        <div className="help-tab-card-icon">
                          <Icon path={tab.icon} size={0.72} />
                        </div>
                        <span className="help-tab-card-name">{tab.name}</span>
                      </div>
                      <p className="help-tab-card-desc">{tab.description}</p>
                      <div className="help-tab-card-tips">
                        {tab.tips.map((tip, j) => (
                          <span key={j} className="help-tip-chip">{tip}</span>
                        ))}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
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
