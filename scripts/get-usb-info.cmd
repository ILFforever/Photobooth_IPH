@echo off
setlocal

echo === USB Devices attached to VM ===
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" showvminfo PhotoboothLinux | findstr /i "USB"

echo.
echo === USB Filters ===
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" list usbfilters

echo.
echo === Attached USB Devices ===
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" list usbhostsdetectors

echo.
echo === Running USB Filters ===
"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" showvminfo PhotoboothLinux | findstr /i "USB Version"
