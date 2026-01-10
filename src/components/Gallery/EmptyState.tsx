import { motion } from "framer-motion";
import { GoogleAccount, DriveFolder } from "../../contexts/AuthContext";

interface EmptyStateProps {
  account: GoogleAccount | null;
  rootFolder: DriveFolder | null;
}

const EmptyState = ({ account, rootFolder }: EmptyStateProps) => {
  return (
    <motion.div
      key="empty"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="empty-state"
    >
      <div className="empty-state-icon">📸</div>
      <h3>No QR Code Yet</h3>
      <p>
        {!account
          ? "Sign in with Google to get started"
          : !rootFolder
          ? "Select a Drive root folder first"
          : "Select a local photos folder and upload to generate a QR code"
        }
      </p>
    </motion.div>
  );
};

export default EmptyState;
