# Installers Directory

Place the VirtualBox installer in this directory for bundling with the application.

## Download VirtualBox

Download the VirtualBox platform package from:
https://www.virtualbox.org/wiki/Downloads

Required file: `VirtualBox-7.0.x-Win.exe` (or latest version)

Place the downloaded file in this directory as: `VirtualBox-Win.exe`

## Build Process

The Tauri build will bundle this installer with the application and include it in the resources.

During installation:
1. The installer will check if VirtualBox is already installed
2. If not found, it will prompt the user to install VirtualBox
3. The bundled VirtualBox installer can be launched from the application folder

## Alternative: Chocolatey

For enterprise deployment, VirtualBox can be installed via Chocolatey:
```
choco install virtualbox
```

Or download directly:
https://download.virtualbox.org/virtualbox/7.0.20/VirtualBox-7.0.20-163906-Win.exe
