import { motion } from "framer-motion";
import CollageCanvas from "./CollageCanvas";
import "./CollageWorkspace.css";

const CollageWorkspace = () => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="collage-workspace"
    >
      {/* Collage Canvas - Full Width */}
      <div className="workspace-canvas">
        <CollageCanvas />
      </div>
    </motion.div>
  );
};

export default CollageWorkspace;
