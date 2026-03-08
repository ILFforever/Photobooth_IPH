import React from "react";
import ReactDOM from "react-dom/client";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import App from "./App";
import GuestDisplay from "./components/PhotoboothView/GuestDisplay";
import { AuthProvider } from "./contexts";
import { WorkingFolderProvider } from "./contexts";
import { CollageProvider } from "./contexts";
import { AssetsProvider } from "./contexts";
import { QRProvider } from "./contexts";
import { CameraProvider } from "./contexts";
import { PhotoboothSettingsProvider } from "./contexts";
import { PhotoboothProvider } from "./contexts";
import { LiveViewProvider } from "./contexts";
import { VMProvider } from "./contexts";
import { ToastProvider, ToastContainer } from "./contexts";
import { PrintSettingsProvider } from "./contexts";
import { UploadQueueProvider } from "./contexts";
import "./components/PhotoboothView/GuestDisplay.css";
import { createLogger } from './utils/logger';

const logger = createLogger('main');

// Render the app
async function renderApp() {
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

  let AppComponent = App;

  try {
    const currentWindow = getCurrentWebviewWindow();
    const label = currentWindow.label;
    logger.debug('Window label:', label);

    if (label === 'guest-display') {
      AppComponent = GuestDisplay;
      logger.debug('Rendering GuestDisplay component');
    } else if (label === 'splash') {
      // Splash window has its own logic in splash.html
      logger.debug('Splash window detected, skipping React render');
      return;
    } else {
      logger.debug('Rendering App component');
    }
  } catch (e) {
    logger.debug('Not in Tauri environment or window not ready, rendering App', e);
    AppComponent = App;
  }

  // Render the React app
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
                            <UploadQueueProvider>
                              <PhotoboothSettingsProvider>
                                <PrintSettingsProvider>
                                  <AppComponent />
                                </PrintSettingsProvider>
                              </PhotoboothSettingsProvider>
                            </UploadQueueProvider>
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
