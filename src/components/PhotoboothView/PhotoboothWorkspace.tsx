import { motion } from "framer-motion";
import "./PhotoboothWorkspace.css";

interface PhotoboothWorkspaceProps {
  // Add props as needed when implementing the photobooth functionality
}

export default function PhotoboothWorkspace(props: PhotoboothWorkspaceProps) {
  return (
    <div className="photobooth-workspace">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="photobooth-placeholder"
      >
        <div className="placeholder-content">
          <div className="placeholder-icon">📷</div>
          <h2>Photobooth Mode</h2>
          <p>Auto-capture photobooth functionality coming soon.</p>
        </div>
      </motion.div>
    </div>
  );
}
