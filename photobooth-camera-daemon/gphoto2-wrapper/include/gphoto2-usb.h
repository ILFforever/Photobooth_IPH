/*
 * gphoto2-usb.h - USB device detection and management utilities
 */

#ifndef GPHOTO2_USB_H
#define GPHOTO2_USB_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <errno.h>
#include <dirent.h>
#include <stdarg.h>

/* USB device reset ioctl */
#define USBDEVFS_RESET _IO('U', 20)

/* Logging function pointer type */
typedef void (*log_fn_t)(const char *, ...);

/* Reset USB device to recover from bad PTP state */
static int reset_usb_device(const char *port_name, log_fn_t log_fn) {
    if (!port_name || strncmp(port_name, "usb:", 4) != 0) {
        if (log_fn) log_fn("Cannot reset USB - invalid port name: %s\n", port_name ? port_name : "NULL");
        return -1;
    }

    int bus_num, dev_num;
    if (sscanf(port_name + 4, "%d,%d", &bus_num, &dev_num) != 2) {
        if (log_fn) log_fn("Cannot parse USB port: %s\n", port_name);
        return -1;
    }

    char dev_path[64];
    snprintf(dev_path, sizeof(dev_path), "/dev/bus/usb/%03d/%03d", bus_num, dev_num);

    if (log_fn) log_fn("Attempting USB reset on %s (port %s)...\n", dev_path, port_name);

    int fd = open(dev_path, O_WRONLY);
    if (fd < 0) {
        if (log_fn) log_fn("Failed to open %s: %s\n", dev_path, strerror(errno));
        return -1;
    }

    int ret = ioctl(fd, USBDEVFS_RESET, 0);
    close(fd);

    if (ret < 0) {
        if (log_fn) log_fn("USB reset ioctl failed: %s\n", strerror(errno));
        return -1;
    }

    if (log_fn) log_fn("USB reset successful, waiting 2 seconds for device to re-enumerate...\n");
    sleep(2);

    return 0;
}

/* Detect USB version from speed in Mbps */
static const char *speed_to_usb_version(float speed_mbps, char *buf, size_t buf_size) {
    if (speed_mbps >= 5000) {
        snprintf(buf, buf_size, "USB 3.x (%.0f Gbps)", speed_mbps / 1000);
    } else if (speed_mbps >= 400) {
        snprintf(buf, buf_size, "USB 2.0 (%.0f Mbps)", speed_mbps);
    } else if (speed_mbps >= 10) {
        snprintf(buf, buf_size, "USB 1.1 (%.0f Mbps)", speed_mbps);
    } else {
        snprintf(buf, buf_size, "USB 1.0 (%.1f Mbps)", speed_mbps);
    }
    return buf;
}

/* Detect USB version from sysfs by scanning for camera devices */
static const char *detect_usb_version(const char *port, log_fn_t log_fn) {
    static char usb_buf[32];
    usb_buf[0] = '\0';

    int bus_num = 0, device_num = 0;
    int have_bus_dev = (port && sscanf(port, "usb:%d,%d", &bus_num, &device_num) == 2);

    DIR *dir = opendir("/sys/bus/usb/devices");
    if (!dir) return usb_buf;

    struct dirent *entry;
    float best_speed = 0;

    while ((entry = readdir(dir)) != NULL) {
        if (entry->d_name[0] == '.') continue;
        if (strncmp(entry->d_name, "usb", 3) == 0) continue;

        char speed_path[300];
        snprintf(speed_path, sizeof(speed_path), "/sys/bus/usb/devices/%s/speed", entry->d_name);

        FILE *f = fopen(speed_path, "r");
        if (!f) continue;

        float speed = 0;
        if (fscanf(f, "%f", &speed) != 1) {
            fclose(f);
            continue;
        }
        fclose(f);

        if (have_bus_dev) {
            char busnum_path[300], devnum_path[300];
            int bus = -1, dev = -1;

            snprintf(busnum_path, sizeof(busnum_path), "/sys/bus/usb/devices/%s/busnum", entry->d_name);
            snprintf(devnum_path, sizeof(devnum_path), "/sys/bus/usb/devices/%s/devnum", entry->d_name);

            FILE *bf = fopen(busnum_path, "r");
            FILE *df = fopen(devnum_path, "r");
            if (bf && df) {
                fscanf(bf, "%d", &bus);
                fscanf(df, "%d", &dev);
            }
            if (bf) fclose(bf);
            if (df) fclose(df);

            if (bus == bus_num && dev == device_num) {
                speed_to_usb_version(speed, usb_buf, sizeof(usb_buf));
                if (log_fn) log_fn("USB detected device='%s' speed=%.0f -> %s\n",
                        entry->d_name, speed, usb_buf);
                break;
            }
            continue;
        }

        /* No bus/device numbers - match by product name */
        char product_path[300];
        snprintf(product_path, sizeof(product_path), "/sys/bus/usb/devices/%s/product", entry->d_name);

        FILE *pf = fopen(product_path, "r");
        if (!pf) continue;

        char product[128] = "";
        if (fgets(product, sizeof(product), pf)) {
            char *nl = strchr(product, '\n');
            if (nl) *nl = '\0';

            if (strstr(product, "Camera") || strstr(product, "FUJIFILM") ||
                strstr(product, "Canon") || strstr(product, "NIKON") ||
                strstr(product, "Sony") || strstr(product, "X-")) {
                if (speed > best_speed) {
                    best_speed = speed;
                    speed_to_usb_version(speed, usb_buf, sizeof(usb_buf));
                }
            }
        }
        fclose(pf);
    }
    closedir(dir);

    if (usb_buf[0] != '\0' && log_fn) {
        log_fn("USB detection result: %s\n", usb_buf);
    }
    return usb_buf;
}

/* Lightweight USB presence check */
static int check_usb_device_present(const char *port) {
    int bus_num = 0, device_num = 0;
    if (!port || !port[0]) return 0;
    if (sscanf(port, "usb:%d,%d", &bus_num, &device_num) != 2) {
        return 1;
    }

    DIR *dir = opendir("/sys/bus/usb/devices");
    if (!dir) return 0;

    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        if (entry->d_name[0] == '.') continue;
        if (strncmp(entry->d_name, "usb", 3) == 0) continue;

        char busnum_path[300], devnum_path[300];
        snprintf(busnum_path, sizeof(busnum_path), "/sys/bus/usb/devices/%s/busnum", entry->d_name);
        snprintf(devnum_path, sizeof(devnum_path), "/sys/bus/usb/devices/%s/devnum", entry->d_name);

        FILE *bf = fopen(busnum_path, "r");
        FILE *df = fopen(devnum_path, "r");
        if (!bf || !df) {
            if (bf) fclose(bf);
            if (df) fclose(df);
            continue;
        }

        int bus = -1, dev = -1;
        fscanf(bf, "%d", &bus);
        fscanf(df, "%d", &dev);
        fclose(bf);
        fclose(df);

        if (bus == bus_num && dev == device_num) {
            closedir(dir);
            return 1;
        }
    }
    closedir(dir);
    return 0;
}

#endif /* GPHOTO2_USB_H */
