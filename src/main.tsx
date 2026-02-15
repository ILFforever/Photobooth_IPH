import React from "react";
import ReactDOM from "react-dom/client";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import App from "./App";
import GuestDisplay from "./components/PhotoboothView/GuestDisplay";
import { AuthProvider } from "./contexts/AuthContext";
import { WorkingFolderProvider } from "./contexts/WorkingFolderContext";
import { CollageProvider } from "./contexts/CollageContext";
import { AssetsProvider } from "./contexts/AssetsContext";
import { QRProvider } from "./contexts/QRContext";
import { CameraProvider } from "./contexts/CameraContext";
import { PhotoboothSettingsProvider } from "./contexts/PhotoboothSettingsContext";
import { PhotoboothProvider } from "./contexts/PhotoboothContext";
import { LiveViewProvider } from "./contexts/LiveViewContext";
import { VMProvider } from "./contexts/VMContext";
import { ToastProvider, ToastContainer } from "./contexts/ToastContext";
import { PrintSettingsProvider } from "./contexts/PrintSettingsContext";
import "./components/PhotoboothView/GuestDisplay.css";

// Determine which component to render based on the window label
async function renderApp() {
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

  let AppComponent = App;

  try {
    const currentWindow = getCurrentWebviewWindow();
    // In Tauri v2, label is a property, not a method
    const label = currentWindow.label;
    console.log('Window label:', label);

    if (label === 'guest-display') {
      AppComponent = GuestDisplay;
      console.log('Rendering GuestDisplay component');
    } else {
      console.log('Rendering App component');
    }
  } catch (e) {
    console.log('Not in Tauri environment or window not ready, rendering App', e);
    // Not in Tauri environment or window not ready, default to App
    AppComponent = App;
  }

  root.render(
    <React.StrictMode>
      <DndProvider backend={HTML5Backend}>
        <LiveViewProvider>
          <AuthProvider>
            <QRProvider>
              <CameraProvider>
                <VMProvider>
                  <WorkingFolderProvider>
                    <AssetsProvider>
                      <CollageProvider>
                        <PhotoboothProvider>
                          <ToastProvider>
                            <PhotoboothSettingsProvider>
                              <PrintSettingsProvider>
                                <AppComponent />
                              </PrintSettingsProvider>
                            </PhotoboothSettingsProvider>
                            <ToastContainer />
                          </ToastProvider>
                        </PhotoboothProvider>
                      </CollageProvider>
                    </AssetsProvider>
                  </WorkingFolderProvider>
                </VMProvider>
              </CameraProvider>
            </QRProvider>
          </AuthProvider>
        </LiveViewProvider>
      </DndProvider>
    </React.StrictMode>,
  );
}

renderApp();
