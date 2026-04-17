import { motion } from "framer-motion";
import { useState } from "react";
import { WorkingFolderGallery } from "../../WorkingFolder/WorkingFolderGallery";
import { ImageManipulator } from "../../Canvas";
import { FrameCreator } from "../FrameCreator";
import { CustomSetsSidebar } from "../CustomSets";
import { LayersSidebar } from "../Layers";
import { BackgroundSidebar } from "../Background";
import { useCollage } from "../../../contexts";
import "./CollageSidebar.css";
import Icon from "@mdi/react";
import { mdiFolderOutline, mdiPencilOutline, mdiLayersOutline, mdiContentSaveOutline, mdiFileExportOutline, mdiWallpaper, mdiViewGridOutline, mdiHelpCircleOutline } from "@mdi/js";
import { ExportSidebar } from "../Export/ExportSidebar";
import { CollageHelpModal } from "./modals/CollageHelpModal";

const CollageSidebar = () => {
  const { activeSidebarTab, setActiveSidebarTab, currentFrame, canvasSize } = useCollage();
  const exportDisabled = !currentFrame || !canvasSize;
  const [showHelpModal, setShowHelpModal] = useState(false);

  return (
    <div className="collage-sidebar">
      {/* Vertical Button Column */}
      <div className="sidebar-tabs-column">
        {/* Primary tabs */}
        <motion.button
          className={`sidebar-tab ${activeSidebarTab === 'background' ? 'active' : ''}`}
          onClick={() => setActiveSidebarTab('background')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="tab-icon"><Icon path={mdiWallpaper} size={0.9} /></span>
        </motion.button>
        <motion.button
          className={`sidebar-tab ${activeSidebarTab === 'frames' ? 'active' : ''}`}
          onClick={() => setActiveSidebarTab('frames')}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="tab-icon"><Icon path={mdiViewGridOutline} size={0.9} /></span>
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

        {/* Divider */}
        <div className="sidebar-tabs-divider" />

        {/* Secondary tabs */}
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
          className={`sidebar-tab ${activeSidebarTab === 'export' ? 'active' : ''} ${exportDisabled ? 'disabled' : ''}`}
          onClick={() => !exportDisabled && setActiveSidebarTab('export')}
          whileHover={exportDisabled ? {} : { scale: 1.05 }}
          whileTap={exportDisabled ? {} : { scale: 0.95 }}
        >
          <span className="tab-icon"><Icon path={mdiFileExportOutline} size={0.9} /></span>
        </motion.button>

        {/* Spacer to push help button to bottom */}
        <div style={{ flex: 1 }} />

        {/* Help Button */}
        <motion.button
          className="sidebar-tab"
          onClick={() => setShowHelpModal(true)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-tertiary)';
          }}
        >
          <span className="tab-icon"><Icon path={mdiHelpCircleOutline} size={0.9} /></span>
        </motion.button>
      </div>

      {/* Content Area - Optimized with conditional unmounting for memory saving */}
      <div className="sidebar-content">
        <div className={`sidebar-panel ${activeSidebarTab === 'file' ? 'panel-visible' : 'panel-hidden'}`}>
          {activeSidebarTab === 'file' && <WorkingFolderGallery />}
        </div>
        
        {/* We keep ImageManipulator and FrameCreator always mounted because they might have 
            complex local state (like unsaved edits or selections) that we don't want to lose
            when quickly switching tabs. */}
        <div className={`sidebar-panel ${activeSidebarTab === 'edit' ? 'panel-visible' : 'panel-hidden'}`}>
          <ImageManipulator />
        </div>
        <div className={`sidebar-panel ${activeSidebarTab === 'frames' ? 'panel-visible' : 'panel-hidden'}`}>
          <FrameCreator />
        </div>

        <div className={`sidebar-panel ${activeSidebarTab === 'background' ? 'panel-visible' : 'panel-hidden'}`}>
          {activeSidebarTab === 'background' && <BackgroundSidebar />}
        </div>
        <div className={`sidebar-panel ${activeSidebarTab === 'layers' ? 'panel-visible' : 'panel-hidden'}`}>
          {activeSidebarTab === 'layers' && <LayersSidebar />}
        </div>
        <div className={`sidebar-panel ${activeSidebarTab === 'custom-sets' ? 'panel-visible' : 'panel-hidden'}`}>
          {activeSidebarTab === 'custom-sets' && <CustomSetsSidebar />}
        </div>
        <div className={`sidebar-panel ${activeSidebarTab === 'export' ? 'panel-visible' : 'panel-hidden'}`}>
          {activeSidebarTab === 'export' && <ExportSidebar />}
        </div>
      </div>

      {/* Help Modal */}
      <CollageHelpModal
        show={showHelpModal}
        onClose={() => setShowHelpModal(false)}
      />
    </div>
  );
};

export default CollageSidebar;
