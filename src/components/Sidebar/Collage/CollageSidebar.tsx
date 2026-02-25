import { motion } from "framer-motion";
import { WorkingFolderGallery } from "../../WorkingFolder/WorkingFolderGallery";
import ImageManipulator from "../../Canvas/ImageManipulator";
import { FrameCreator } from "../FrameCreator";
import { CustomSetsSidebar } from "../CustomSets";
import { LayersSidebar } from "../Layers";
import { useCollage } from "../../../contexts/CollageContext";
import "./CollageSidebar.css";
import Icon from "@mdi/react";
import { mdiFolderOutline, mdiPencilOutline, mdiImageOutline, mdiLayersOutline, mdiContentSaveOutline, mdiFileExportOutline } from "@mdi/js";
import { ExportSidebar } from "../Export/ExportSidebar";

const CollageSidebar = () => {
  const { activeSidebarTab, setActiveSidebarTab, currentFrame, canvasSize } = useCollage();
  const exportDisabled = !currentFrame || !canvasSize;

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
          <span className="tab-icon"><Icon path={mdiFolderOutline} size={0.9} /></span>
        </motion.button>
        <motion.button
          className={`sidebar-tab ${activeSidebarTab === 'edit' ? 'active' : ''}`}
          onClick={() => setActiveSidebarTab('edit')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="tab-icon"><Icon path={mdiPencilOutline} size={0.9} /></span>
        </motion.button>
        <motion.button
          className={`sidebar-tab ${activeSidebarTab === 'frames' ? 'active' : ''}`}
          onClick={() => setActiveSidebarTab('frames')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="tab-icon"><Icon path={mdiImageOutline} size={0.9} /></span>
        </motion.button>
        <motion.button
          className={`sidebar-tab ${activeSidebarTab === 'layers' ? 'active' : ''}`}
          onClick={() => setActiveSidebarTab('layers')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="tab-icon"><Icon path={mdiLayersOutline} size={0.9} /></span>
        </motion.button>
        <motion.button
          className={`sidebar-tab ${activeSidebarTab === 'custom-sets' ? 'active' : ''}`}
          onClick={() => setActiveSidebarTab('custom-sets')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="tab-icon"><Icon path={mdiContentSaveOutline} size={0.9} /></span>
        </motion.button>
        <motion.button
          className={`sidebar-tab ${activeSidebarTab === 'export' ? 'active' : ''} ${exportDisabled ? 'disabled' : ''}`}
          onClick={() => !exportDisabled && setActiveSidebarTab('export')}
          whileHover={exportDisabled ? {} : { scale: 1.05 }}
          whileTap={exportDisabled ? {} : { scale: 0.95 }}
        >
          <span className="tab-icon"><Icon path={mdiFileExportOutline} size={0.9} /></span>
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
        <div className={`sidebar-panel ${activeSidebarTab === 'export' ? 'panel-visible' : 'panel-hidden'}`}>
          <ExportSidebar />
        </div>
      </div>
    </div>
  );
};

export default CollageSidebar;
