import { motion } from "framer-motion";
import "./PhotoboothSidebar.css";

interface PhotoboothSidebarProps {
  // Add props as needed when implementing the photobooth functionality
}

export default function PhotoboothSidebar(props: PhotoboothSidebarProps) {
  return (
    <div className="sidebar">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="sidebar-section"
      >
        <h2 className="sidebar-title">Photobooth Settings</h2>
        <p className="sidebar-description">
          Configure your photobooth auto-capture settings.
        </p>

        <div className="placeholder-content">
          <p>Photobooth controls coming soon.</p>
        </div>
      </motion.div>
    </div>
  );
}
