# Photobooth IPH

A modern photobooth file sharing application built with [Tauri](https://tauri.app/), [React](https://reactjs.org/), and [TypeScript](https://www.typescriptlang.org/).

This application allows users to automatically upload photos to a specific Google Drive folder, and generate a QR code for instant sharing/downloading. Designed to be light-weight and easy to use.


## Features

-   **Google Drive Integration**: Seamlessly uploads photos to a designated Google Drive folder.
-   **QR Code Generation**: Generates a QR code for each uploaded photo (or folder) to allow users to download their pictures immediately.
-   **Folder Management**: Create and select specific Google Drive folders for organizing event photos.
-   **Cross-Platform**: Runs on desktop operating systems (Windows, macOS, Linux) via Tauri.

## Prerequisites

Before running the application, ensure you have the following installed:

-   [Node.js](https://nodejs.org/) (v16 or newer)
-   [Rust](https://www.rust-lang.org/tools/install) (for Tauri backend)

## Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/your-username/photobooth-qr.git
    cd photobooth-qr
    ```

2.  Install frontend dependencies:
    ```bash
    npm install
    ```

## Running the App

To start the application in development mode:

```bash
npm run tauri dev
```

This will start the Vite dev server and the Tauri application window.

## Building for Production

To build the application for distribution:

```bash
npm run tauri build
```

The build artifacts will be located in `src-tauri/target/release/bundle`.

## Tech Stack

-   **Frontend**: React, TypeScript, Vite, Framer Motion
-   **Backend**: Rust (Tauri)
-   **Integration**: Google Drive API (`google-drive3`, `yup-oauth2`), `qrcode` crate

## License

[MIT](LICENSE)