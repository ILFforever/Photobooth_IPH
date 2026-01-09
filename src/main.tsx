import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { WorkingFolderProvider } from "./contexts/WorkingFolderContext";
import { CollageProvider } from "./contexts/CollageContext";
import { AssetsProvider } from "./contexts/AssetsContext";
import { QRProvider } from "./contexts/QRContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <QRProvider>
        <WorkingFolderProvider>
          <AssetsProvider>
            <CollageProvider>
              <App />
            </CollageProvider>
          </AssetsProvider>
        </WorkingFolderProvider>
      </QRProvider>
    </AuthProvider>
  </React.StrictMode>,
);
