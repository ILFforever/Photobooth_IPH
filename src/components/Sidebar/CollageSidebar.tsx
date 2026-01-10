import { motion } from "framer-motion";
import { WorkingFolderGallery } from "../WorkingFolder/WorkingFolderGallery";
import ImageManipulator from "../Canvas/ImageManipulator";
import "./CollageSidebar.css";

const CollageSidebar = () => {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="collage-sidebar"
    >
      {/* Working Folder Gallery Section */}
      <div className="sidebar-subsection">
        <div className="subsection-content">
          <WorkingFolderGallery />
        </div>
      </div>

      {/* Image Manipulator Section */}
      <div className="sidebar-subsection">
        <div className="subsection-content">
          <ImageManipulator />
        </div>
      </div>
    </motion.div>
  );
};

export default CollageSidebar;
