import { motion } from "framer-motion";
import { WorkingFolderGallery } from "../WorkingFolder/WorkingFolderGallery";
import ImageManipulator from "../Canvas/ImageManipulator";
import FrameCreator from "./FrameCreator";
import { CustomSetsSidebar } from "./CustomSetsSidebar";
import { LayersSidebar } from "./LayersSidebar";
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
        <motion.button
          className={`sidebar-tab ${activeSidebarTab === 'frames' ? 'active' : ''}`}
          onClick={() => setActiveSidebarTab('frames')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="tab-icon">🖼️</span>
        </motion.button>
        <motion.button
          className={`sidebar-tab ${activeSidebarTab === 'layers' ? 'active' : ''}`}
          onClick={() => setActiveSidebarTab('layers')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="tab-icon">📚</span>
        </motion.button>
        <motion.button
          className={`sidebar-tab ${activeSidebarTab === 'custom-sets' ? 'active' : ''}`}
          onClick={() => setActiveSidebarTab('custom-sets')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="tab-icon">💾</span>
        </motion.button>
      </div>

      {/* Content Area - All components stay mounted */}
      <div className="sidebar-content">
        <div className={`sidebar-panel ${activeSidebarTab === 'file' ? 'panel-visible' : 'panel-hidden'}`}>
          <WorkingFolderGallery />
        </div>
        <div className={`sidebar-panel ${activeSidebarTab === 'edit' ? 'panel-visible' : 'panel-hidden'}`}>
          <ImageManipulator />
        </div>
        <div className={`sidebar-panel ${activeSidebarTab === 'frames' ? 'panel-visible' : 'panel-hidden'}`}>
          <FrameCreator />
        </div>
        <div className={`sidebar-panel ${activeSidebarTab === 'layers' ? 'panel-visible' : 'panel-hidden'}`}>
          <LayersSidebar />
        </div>
        <div className={`sidebar-panel ${activeSidebarTab === 'custom-sets' ? 'panel-visible' : 'panel-hidden'}`}>
          <CustomSetsSidebar />
        </div>
      </div>
    </div>
  );
};

export default CollageSidebar;
