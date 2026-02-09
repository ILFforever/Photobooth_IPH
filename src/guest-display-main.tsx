import React from "react";
import ReactDOM from "react-dom/client";
import GuestDisplay from "./components/PhotoboothView/GuestDisplay";
import { LiveViewProvider } from "./contexts/LiveViewContext";
import "./components/PhotoboothView/GuestDisplay.css";

// Entry point for the guest display window
ReactDOM.createRoot(document.getElementById("guest-root") as HTMLElement).render(
  <React.StrictMode>
    <LiveViewProvider>
      <GuestDisplay />
    </LiveViewProvider>
  </React.StrictMode>,
);
