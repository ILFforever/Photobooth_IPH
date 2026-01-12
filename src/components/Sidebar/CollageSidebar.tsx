import { useState } from "react";
import { motion } from "framer-motion";
import { WorkingFolderGallery } from "../WorkingFolder/WorkingFolderGallery";
import ImageManipulator from "../Canvas/ImageManipulator";
import "./CollageSidebar.css";

const CollageSidebar = () => {
  const [activeTab, setActiveTab] = useState<'file' | 'edit'>('file');

  return (
    <div className="collage-sidebar">
      {/* Vertical Button Column */}
      <div className="sidebar-tabs-column">
        <motion.button
          className={`sidebar-tab ${activeTab === 'file' ? 'active' : ''}`}
          onClick={() => setActiveTab('file')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="tab-icon">📁</span>
        </motion.button>
        <motion.button
          className={`sidebar-tab ${activeTab === 'edit' ? 'active' : ''}`}
          onClick={() => setActiveTab('edit')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="tab-icon">✏️</span>
        </motion.button>
      </div>

      {/* Content Area - Both components stay mounted */}
      <div className="sidebar-content">
        <div className={`sidebar-panel ${activeTab === 'file' ? 'panel-visible' : 'panel-hidden'}`}>
          <WorkingFolderGallery />
        </div>
        <div className={`sidebar-panel ${activeTab === 'edit' ? 'panel-visible' : 'panel-hidden'}`}>
          <ImageManipulator />
        </div>
      </div>
    </div>
  );
};

export default CollageSidebar;
