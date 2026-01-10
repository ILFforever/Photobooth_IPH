import { motion } from "framer-motion";

interface Result {
  folder_name: string;
  link: string;
  qr_data: string;
}

interface QRResultViewProps {
  result: Result;
  onCopyLink: () => void;
  onNew: () => void;
}

const QRResultView = ({ result, onCopyLink, onNew }: QRResultViewProps) => {
  return (
    <motion.div
      key="result"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="result-view"
    >
      <div className="result-header">
        <h2>QR Code Generated</h2>
        <div className="result-badge">
          <span className="badge-icon">✓</span>
          <span>Ready to Share</span>
        </div>
      </div>

      <div className="result-body">
        <div className="qr-section">
          <div className="qr-container">
            <img
              src={`data:image/png;base64,${result.qr_data}`}
              alt="QR Code"
              className="qr-code"
            />
          </div>
          <p className="qr-label">Scan to view photos</p>
        </div>

        <div className="info-section">
          <div className="info-item">
            <label>Folder Name</label>
            <div className="info-value">{result.folder_name}</div>
          </div>

          <div className="info-item">
            <label>Share Link</label>
            <div className="link-container">
              <input
                type="text"
                value={result.link}
                readOnly
                className="link-input"
              />
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onCopyLink}
                className="btn-copy"
              >
                📋 Copy
              </motion.button>
            </div>
          </div>

          <motion.a
            href={result.link}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-open"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            Open in Browser →
          </motion.a>

          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            onClick={onNew}
            className="btn-new"
          >
            🔄 New Batch
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

export default QRResultView;
