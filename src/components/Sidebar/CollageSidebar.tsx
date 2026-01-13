import { motion } from "framer-motion";
import { WorkingFolderGallery } from "../WorkingFolder/WorkingFolderGallery";
import ImageManipulator from "../Canvas/ImageManipulator";
import { useCollage } from "../../contexts/CollageContext";
import "./CollageSidebar.css";

const CollageSidebar = () => {
  const { activeSidebarTab, setActiveSidebarTab } = useCollage();

  return (
    <div className="collage-sidebar">
      {/* Vertical Button Column */}
      <div className="sidebar-tabs-column">
        <motion.button
          className={`sidebar-tab ${activeSidebarTab === 'file' ? 'active' : ''}`}
          onClick={() => setActiveSidebarTab('file')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="tab-icon">📁</span>
        </motion.button>
        <motion.button
          className={`sidebar-tab ${activeSidebarTab === 'edit' ? 'active' : ''}`}
          onClick={() => setActiveSidebarTab('edit')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="tab-icon">✏️</span>
        </motion.button>
      </div>

      {/* Content Area - Both components stay mounted */}
      <div className="sidebar-content">
        <div className={`sidebar-panel ${activeSidebarTab === 'file' ? 'panel-visible' : 'panel-hidden'}`}>
          <WorkingFolderGallery />
        </div>
        <div className={`sidebar-panel ${activeSidebarTab === 'edit' ? 'panel-visible' : 'panel-hidden'}`}>
          <ImageManipulator />
        </div>
      </div>
    </div>
  );
};

export default CollageSidebar;
