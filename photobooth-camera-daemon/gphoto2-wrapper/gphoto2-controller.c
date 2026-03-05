/*
 * gphoto2-controller - Long-running camera controller process
 *
 * Manages camera connection with a command queue. Polls for new files
 * from physical shutter button while accepting commands via named pipe.
 *
 * Commands (write to /tmp/camera_cmd):
 *   CAPTURE                 - Trigger software capture
 *   STATUS                  - Get current status
 *   LIVEVIEW_START          - Enter live view mode (stops polling)
 *   LIVEVIEW_STOP           - Exit live view mode (resumes polling)
 *   LIVEVIEW_FRAME          - Capture one preview frame (base64 JPEG)
 *   LIVEVIEW_STREAM_START   - Start continuous PTP streaming (MJPEG to /tmp/camera_stream)
 *   LIVEVIEW_STREAM_STOP    - Stop continuous PTP streaming
 *   QUIT                    - Shutdown the controller
 *
 * Status output (writes to /tmp/camera_status):
 *   {"mode":"idle"}                - Polling for new files
 *   {"mode":"capture"}             - Capturing
 *   {"mode":"liveview"}            - Live view active
 *   {"mode":"liveview_streaming"}  - Continuous PTP streaming active
 *   {"mode":"idle","status":{...}} - Camera status (ISO, aperture, etc)
 *
 * Stream output (writes to /tmp/camera_stream):
 *   MJPEG stream with boundary markers: --FRAME\nContent-Length: XXX\n\n<JPEG data>
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/ioctl.h>
#include <errno.h>
#include <gphoto2/gphoto2.h>
#include <sys/statvfs.h>
#include <dirent.h>
#include <time.h>
#include <stdarg.h>
#include <poll.h>
#include "camera-brand.h"

/* Timestamped logging - adds HH:MM:SS prefix to all stderr output */
static void log_timestamped(const char *format, ...) {
    va_list args;
    char timestamp[32];
    struct timespec ts;
    struct tm tm_info;

    clock_gettime(CLOCK_REALTIME, &ts);
    localtime_r(&ts.tv_sec, &tm_info);
    snprintf(timestamp, sizeof(timestamp), "[%02d:%02d:%02d.%03ld] ",
             tm_info.tm_hour, tm_info.tm_min, tm_info.tm_sec, ts.tv_nsec / 1000000);

    fprintf(stderr, "%s", timestamp);
    va_start(args, format);
    vfprintf(stderr, format, args);
    va_end(args);
}

#define log_ts(...) log_timestamped(__VA_ARGS__)

/* Reset USB device to recover from bad PTP state */
static int reset_usb_device(const char *port_name) {
    /* port_name format: "usb:001,005" where 001=bus, 005=device */
    if (!port_name || strncmp(port_name, "usb:", 4) != 0) {
        log_ts("controller: Cannot reset USB - invalid port name: %s\n", port_name ? port_name : "NULL");
        return -1;
    }

    /* Extract bus and device numbers */
    int bus_num, dev_num;
    if (sscanf(port_name + 4, "%d,%d", &bus_num, &dev_num) != 2) {
        log_ts("controller: Cannot parse USB port: %s\n", port_name);
        return -1;
    }

    /* Construct device path: /dev/bus/usb/BBB/DDD */
    char dev_path[64];
    snprintf(dev_path, sizeof(dev_path), "/dev/bus/usb/%03d/%03d", bus_num, dev_num);

    log_ts("controller: Attempting USB reset on %s (port %s)...\n", dev_path, port_name);

    /* Open USB device */
    int fd = open(dev_path, O_WRONLY);
    if (fd < 0) {
        log_ts("controller: Failed to open %s: %s\n", dev_path, strerror(errno));
        return -1;
    }

    /* USBDEVFS_RESET ioctl value */
    #define USBDEVFS_RESET _IO('U', 20)

    /* Issue USB reset ioctl */
    int ret = ioctl(fd, USBDEVFS_RESET, 0);
    close(fd);

    if (ret < 0) {
        log_ts("controller: USB reset ioctl failed: %s\n", strerror(errno));
        return -1;
    }

    log_ts("controller: USB reset successful, waiting 2 seconds for device to re-enumerate...\n");
    sleep(2);  /* Give device time to re-enumerate on USB bus */

    return 0;
}

/* Detect USB version from port string
 * Port format: "usb:BUS,DEVICE" e.g., "usb:003,002"
 */
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

static const char *detect_usb_version(const char *port) {
    static char usb_buf[32];
    usb_buf[0] = '\0';

    /* Scan /sys/bus/usb/devices/ for camera devices by product name.
     * gphoto2 often reports port as just "usb:" without bus/device numbers,
     * so we match by product name which reliably identifies cameras. */
    int bus_num = 0, device_num = 0;
    int have_bus_dev = (port && sscanf(port, "usb:%d,%d", &bus_num, &device_num) == 2);

    DIR *dir = opendir("/sys/bus/usb/devices");
    if (!dir) return usb_buf;

    struct dirent *entry;
    float best_speed = 0;

    while ((entry = readdir(dir)) != NULL) {
        if (entry->d_name[0] == '.') continue;
        if (strncmp(entry->d_name, "usb", 3) == 0) continue; /* Skip root hubs */

        char speed_path[300];
        snprintf(speed_path, sizeof(speed_path), "/sys/bus/usb/devices/%s/speed", entry->d_name);

        FILE *f = fopen(speed_path, "r");
        if (!f) continue;

        float speed = 0;
        int got_speed = (fscanf(f, "%f", &speed) == 1);
        fclose(f);
        if (!got_speed) continue;

        /* Try matching by bus/device number if available */
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
                fprintf(stderr, "controller: USB detected device='%s' speed=%.0f → %s\n",
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

    if (usb_buf[0] != '\0') {
        fprintf(stderr, "controller: USB detection result: %s\n", usb_buf);
    }
    return usb_buf;
}

/* Detect camera USB port by scanning sysfs for camera-like devices.
 * Returns 1 if a camera is found, and fills port_out with "usb:BBB,DDD" format.
 * No gphoto2 needed — purely reads sysfs. */
static int detect_camera_usb_port(char *port_out, size_t port_out_size) {
    DIR *dir = opendir("/sys/bus/usb/devices");
    if (!dir) return 0;

    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        if (entry->d_name[0] == '.') continue;
        if (strncmp(entry->d_name, "usb", 3) == 0) continue; /* Skip root hubs */

        /* Check if this device has a product name matching a camera */
        char product_path[300];
        snprintf(product_path, sizeof(product_path), "/sys/bus/usb/devices/%s/product", entry->d_name);

        FILE *pf = fopen(product_path, "r");
        if (!pf) continue;

        char product[128] = "";
        int is_camera = 0;
        if (fgets(product, sizeof(product), pf)) {
            char *nl = strchr(product, '\n');
            if (nl) *nl = '\0';

            if (strstr(product, "Camera") || strstr(product, "FUJIFILM") ||
                strstr(product, "Canon") || strstr(product, "NIKON") ||
                strstr(product, "Sony") || strstr(product, "X-") ||
                strstr(product, "PTP")) {
                is_camera = 1;
            }
        }
        fclose(pf);
        if (!is_camera) continue;

        /* Read bus and device numbers */
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

        if (bus > 0 && dev > 0) {
            snprintf(port_out, port_out_size, "usb:%03d,%03d", bus, dev);
            closedir(dir);
            return 1;
        }
    }
    closedir(dir);
    return 0;
}

/* Lightweight USB presence check - no gphoto2 needed, just reads sysfs.
 * Returns 1 if the device at the given port (e.g. "usb:003,005") is still present. */
static int check_usb_device_present(const char *port) {
    int bus_num = 0, device_num = 0;
    if (!port || !port[0]) return 0;
    if (sscanf(port, "usb:%d,%d", &bus_num, &device_num) != 2) {
        return 1;  /* Can't determine presence - assume still connected */
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

#define CMD_PIPE "/tmp/camera_cmd"
#define STATUS_PIPE "/tmp/camera_status"
#define STREAM_PIPE "/tmp/camera_stream"
#define CONFIG_RESPONSE_FILE "/tmp/camera_config_response"
#define MAX_FILES 100
#define POLL_INTERVAL_MS 1000
#define MAX_OPEN_RETRIES 5
#define OPEN_RETRY_DELAY_MS 2000
#define CAMERA_OPEN_TIMEOUT_SEC 10  // Max time to wait for camera open during polling
#define CAMERA_SWITCH_GRACE_SEC 5  // Grace period after camera switch before reporting disconnect
#define MAX_DOWNLOAD_RETRIES 3     // Max download attempts before skipping a file
#define FAILED_FILE_RESET_SEC 300  // Reset failed files after 5 minutes
#define STREAM_TARGET_FPS 25       // Target FPS for continuous streaming

// Track files that have failed to download
#define MAX_FAILED_FILES 50
typedef struct {
    char filename[128];
    int retry_count;
    time_t first_failure;
} FailedFile;

static FailedFile g_failed_files[MAX_FAILED_FILES];
static int g_failed_file_count = 0;

static volatile sig_atomic_t g_running = 1;
static int g_status_fd = -1;
static int g_stream_fd = -1;  // File descriptor for stream output pipe
static int g_widgets_listed = 0;  // Track if we've listed widgets for debug
static time_t g_last_camera_switch = 0;  // Timestamp of last camera switch
static CameraBrand g_current_brand = BRAND_UNKNOWN;  // Detected camera brand
static CameraBrand g_last_logged_brand = BRAND_UNKNOWN;  // Track last logged brand

// Streaming state
static volatile sig_atomic_t g_streaming_active = 0;  // Flag for continuous streaming
static volatile sig_atomic_t g_streaming_paused = 0;  // Flag for pause during operations
static volatile sig_atomic_t g_streaming_was_active_before_polling_pause = 0;  // Track if streaming was active before polling pause
static time_t g_last_status_time = 0;  // Track when status was last sent during streaming

// Persistent detection cache - only auto-detect once per camera connection
static GPPortInfoList *g_cached_port_info_list = NULL;
static CameraAbilitiesList *g_cached_abilities_list = NULL;
static int g_cached_camera_index = -1;
static int g_detection_valid = 0;
static char g_last_camera_port[128] = "";  // Store last known USB port for reset

typedef enum {
    MODE_IDLE,
    MODE_CAPTURE,
    MODE_LIVEVIEW
} ControllerMode;

static void signal_handler(int sig) {
    (void)sig;
    g_running = 0;
}

static void install_signal_handlers(void) {
    struct sigaction sa;
    sa.sa_handler = signal_handler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = 0;
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGINT, &sa, NULL);

    /* Ignore SIGPIPE — writing to a pipe/FIFO with no reader must not kill us */
    signal(SIGPIPE, SIG_IGN);
}

static void ctx_error_func(GPContext *context, const char *msg, void *data) {
    (void)context; (void)data;
    fprintf(stderr, "gphoto2 ERROR: %s\n", msg);
}

static GPContext* create_context(void) {
    GPContext *ctx = gp_context_new();
    if (ctx) {
        gp_context_set_error_func(ctx, ctx_error_func, NULL);
    }
    return ctx;
}

/* Check available disk space in bytes for a given path */
static unsigned long long get_available_space(const char *path) {
    struct statvfs stat;
    if (statvfs(path, &stat) != 0) {
        return 0;
    }
    return (unsigned long long)stat.f_bavail * stat.f_bsize;
}

/* Helper to get file modification time */
static time_t get_file_mtime(const char *filepath) {
    struct stat st;
    if (stat(filepath, &st) == 0) {
        return st.st_mtime;
    }
    return 0;
}

/* Forward declaration */
static Camera* open_camera_with_timeout(int camera_index, int *ret_out, int timeout_sec);

/* Clean up old photos to free space. Returns number of files deleted. */
static int cleanup_old_photos(unsigned long long target_free_bytes) {
    DIR *dir = opendir("/tmp");
    if (!dir) return 0;

    // Build list of image files with their mtimes
    struct {
        char path[512];
        time_t mtime;
        unsigned long size;
    } photos[1000];
    int photo_count = 0;

    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL && photo_count < 1000) {
        if (entry->d_type != DT_REG) continue;

        // Check if it's an image file
        const char *ext = strrchr(entry->d_name, '.');
        if (!ext) continue;

        int is_image = 0;
        const char *image_exts[] = {".jpg", ".JPG", ".jpeg", ".JPEG", ".png", ".PNG", ".raf", ".RAF", ".arw", ".ARW", NULL};
        for (int i = 0; image_exts[i] != NULL; i++) {
            if (strcasecmp(ext, image_exts[i]) == 0) {
                is_image = 1;
                break;
            }
        }
        if (!is_image) continue;

        // Get file info
        char filepath[512];
        snprintf(filepath, sizeof(filepath), "/tmp/%s", entry->d_name);
        struct stat st;
        if (stat(filepath, &st) == 0) {
            strcpy(photos[photo_count].path, filepath);
            photos[photo_count].mtime = st.st_mtime;
            photos[photo_count].size = st.st_size;
            photo_count++;
        }
    }
    closedir(dir);

    if (photo_count == 0) return 0;

    // Sort by modification time (oldest first) - bubble sort
    for (int i = 0; i < photo_count - 1; i++) {
        for (int j = 0; j < photo_count - i - 1; j++) {
            if (photos[j].mtime > photos[j + 1].mtime) {
                // Swap
                char tmp_path[512];
                strcpy(tmp_path, photos[j].path);
                strcpy(photos[j].path, photos[j + 1].path);
                strcpy(photos[j + 1].path, tmp_path);

                time_t tmp_mtime = photos[j].mtime;
                photos[j].mtime = photos[j + 1].mtime;
                photos[j + 1].mtime = tmp_mtime;

                unsigned long tmp_size = photos[j].size;
                photos[j].size = photos[j + 1].size;
                photos[j + 1].size = tmp_size;
            }
        }
    }

    // Delete oldest files until we free enough space
    int deleted_count = 0;
    unsigned long long freed_space = 0;

    for (int i = 0; i < photo_count && freed_space < target_free_bytes; i++) {
        if (unlink(photos[i].path) == 0) {
            log_ts("controller: Deleted old photo: %s (%lu bytes)\n", photos[i].path, photos[i].size);
            freed_space += photos[i].size;
            deleted_count++;
        } else {
            log_ts("controller: Failed to delete %s: %s\n", photos[i].path, strerror(errno));
        }
    }

    return deleted_count;
}

/* Ensure sufficient storage space before saving a file */
static void ensure_storage_space(unsigned long long file_size_estimate) {
    const unsigned long long MIN_FREE_MB = 50;
    const unsigned long long MIN_FREE_BYTES = MIN_FREE_MB * 1024 * 1024;
    const unsigned long long BUFFER_BYTES = 10 * 1024 * 1024; // 10MB buffer

    unsigned long long available = get_available_space("/tmp");
    unsigned long long available_mb = available / (1024 * 1024);

    // Check if we need cleanup (either below min free, or not enough for this file)
    unsigned long long needed = (file_size_estimate > 0) ? file_size_estimate + BUFFER_BYTES : 0;
    if (available < MIN_FREE_BYTES || available < needed) {
        unsigned long long target = (needed > MIN_FREE_BYTES) ? needed : (MIN_FREE_BYTES + BUFFER_BYTES);
        unsigned long long to_free = target - available;

        log_ts("controller: Low storage! Only %llu MB free, need %llu MB. Cleaning up...\n",
                available_mb, target / (1024 * 1024));

        int deleted = cleanup_old_photos(to_free);
        if (deleted > 0) {
            log_ts("controller: Cleaned up %d old photo(s) to free space\n", deleted);
        } else {
            log_ts("controller: WARNING: No photos to delete, but storage is low!\n");
        }
    }
}

/* Forward declarations for camera connection event functions */
static void send_camera_connecting_event(int camera_index);
static void send_camera_connected_event(Camera *camera, GPContext *context, int camera_index);
static char *get_single_config_value(Camera *camera, GPContext *context, const char *setting_name);

static Camera* open_camera(int camera_index, int *ret_out) {
    return open_camera_with_timeout(camera_index, ret_out, 0);  // 0 = no timeout (use default)
}

/* Open camera with optional timeout (in seconds). Returns NULL if timeout exceeded. */
static Camera* open_camera_with_timeout(int camera_index, int *ret_out, int timeout_sec) {
    Camera *camera = NULL;
    CameraList *list = NULL;
    GPPortInfo port_info;
    CameraAbilities abilities;
    const char *model_name = NULL;
    const char *port_name = NULL;
    int ret, count;
    GPContext *context = create_context();
    struct timespec t_start, t_detect_end, t_init_end, t_now;
    int did_detection = 0;

    clock_gettime(CLOCK_MONOTONIC, &t_start);

    if (ret_out) *ret_out = GP_OK;

    ret = gp_camera_new(&camera);
    if (ret < GP_OK) {
        gp_context_unref(context);
        if (ret_out) *ret_out = ret;
        return NULL;
    }

    /* Check if we need to do auto-detect (only once per camera connection) */
    if (!g_detection_valid || g_cached_camera_index != camera_index) {
        log_ts("controller: [AUTO-DETECT] Running camera detection (first time or camera changed)...\n");
        did_detection = 1;

        /* Check timeout before expensive auto-detect */
        if (timeout_sec > 0) {
            clock_gettime(CLOCK_MONOTONIC, &t_now);
            long elapsed_sec = t_now.tv_sec - t_start.tv_sec;
            if (elapsed_sec >= timeout_sec) {
                log_ts("controller: Camera open timeout exceeded (%d sec) before detection\n", timeout_sec);
                if (ret_out) *ret_out = GP_ERROR_IO;
                goto error;
            }
        }

        /* Free old cached lists if they exist */
        if (g_cached_abilities_list) {
            gp_abilities_list_free(g_cached_abilities_list);
            g_cached_abilities_list = NULL;
        }
        if (g_cached_port_info_list) {
            gp_port_info_list_free(g_cached_port_info_list);
            g_cached_port_info_list = NULL;
        }

        /* Create and populate persistent lists */
        ret = gp_port_info_list_new(&g_cached_port_info_list);
        if (ret < GP_OK) { goto error; }

        ret = gp_port_info_list_load(g_cached_port_info_list);
        if (ret < GP_OK) { goto error; }

        ret = gp_abilities_list_new(&g_cached_abilities_list);
        if (ret < GP_OK) { goto error; }

        ret = gp_abilities_list_load(g_cached_abilities_list, context);
        if (ret < GP_OK) { goto error; }

        /* Check timeout after auto-detect */
        if (timeout_sec > 0) {
            clock_gettime(CLOCK_MONOTONIC, &t_now);
            long elapsed_sec = t_now.tv_sec - t_start.tv_sec;
            if (elapsed_sec >= timeout_sec) {
                log_ts("controller: Camera open timeout exceeded (%d sec) after detection\n", timeout_sec);
                if (ret_out) *ret_out = GP_ERROR_IO;
                goto error;
            }
        }

        /* Mark cache as valid */
        g_cached_camera_index = camera_index;
        g_detection_valid = 1;
    }

    /* Always need to detect cameras in the current session (but lists are cached) */
    ret = gp_list_new(&list);
    if (ret < GP_OK) { goto error; }

    /* Check timeout before abilities_list_detect (can be slow) */
    if (timeout_sec > 0) {
        clock_gettime(CLOCK_MONOTONIC, &t_now);
        long elapsed_sec = t_now.tv_sec - t_start.tv_sec;
        if (elapsed_sec >= timeout_sec) {
            log_ts("controller: Camera open timeout exceeded (%d sec) before detect\n", timeout_sec);
            if (ret_out) *ret_out = GP_ERROR_IO;
            goto error;
        }
    }

    ret = gp_abilities_list_detect(g_cached_abilities_list, g_cached_port_info_list, list, context);
    if (ret < GP_OK) { goto error; }

    count = gp_list_count(list);
    if (count < 1) {
        if (ret_out) *ret_out = GP_ERROR_MODEL_NOT_FOUND;
        goto error;
    }

    if (camera_index >= count) {
        log_ts("controller: Camera index %d out of range (found %d cameras)\n",
                camera_index, count);
        if (ret_out) *ret_out = GP_ERROR_MODEL_NOT_FOUND;
        goto error;
    }

    gp_list_get_name(list, camera_index, &model_name);
    gp_list_get_value(list, camera_index, &port_name);

    /* Save port name for potential USB reset - only if it has full bus:dev numbers.
     * gphoto2 often returns just "usb:" on first detection; the sysfs fallback
     * in main() handles that case, so we silently skip incomplete ports here. */
    if (port_name) {
        int tmp_bus = 0, tmp_dev = 0;
        if (sscanf(port_name, "usb:%d,%d", &tmp_bus, &tmp_dev) == 2) {
            strncpy(g_last_camera_port, port_name, sizeof(g_last_camera_port) - 1);
            g_last_camera_port[sizeof(g_last_camera_port) - 1] = '\0';
        }
    }

    /* Get abilities for the model */
    int model_index = gp_abilities_list_lookup_model(g_cached_abilities_list, model_name);
    if (model_index < GP_OK) {
        if (ret_out) *ret_out = model_index;
        goto error;
    }
    gp_abilities_list_get_abilities(g_cached_abilities_list, model_index, &abilities);

    int port_index = gp_port_info_list_lookup_path(g_cached_port_info_list, port_name);
    if (port_index < GP_OK) { goto error; }

    gp_port_info_list_get_info(g_cached_port_info_list, port_index, &port_info);
    gp_camera_set_abilities(camera, abilities);
    gp_camera_set_port_info(camera, port_info);

    gp_list_free(list);
    list = NULL;

    clock_gettime(CLOCK_MONOTONIC, &t_detect_end);
    long detect_ms = (t_detect_end.tv_sec - t_start.tv_sec) * 1000 +
                     (t_detect_end.tv_nsec - t_start.tv_nsec) / 1000000;

    /* Check timeout before gp_camera_init (blocking call) */
    if (timeout_sec > 0) {
        clock_gettime(CLOCK_MONOTONIC, &t_now);
        long elapsed_sec = t_now.tv_sec - t_start.tv_sec;
        if (elapsed_sec >= timeout_sec) {
            log_ts("controller: Camera open timeout exceeded (%d sec) before init\n", timeout_sec);
            if (ret_out) *ret_out = GP_ERROR_TIMEOUT;
            goto error;
        }
    }

    ret = gp_camera_init(camera, context);

    /* Check for timeout after init */
    if (timeout_sec > 0) {
        clock_gettime(CLOCK_MONOTONIC, &t_now);
        long elapsed_sec = t_now.tv_sec - t_start.tv_sec;
        if (elapsed_sec >= timeout_sec) {
            log_ts("controller: Camera open timeout exceeded (%d sec) during or after init\n", timeout_sec);
            if (ret >= GP_OK) {
                /* Camera init succeeded but took too long - close it */
                gp_camera_exit(camera, context);
            }
            if (ret_out) *ret_out = GP_ERROR_IO;
            goto error;
        }
    }

    if (ret < GP_OK) {
        log_ts("controller: Failed to init camera: %s\n", gp_result_as_string(ret));
        if (ret_out) *ret_out = ret;
        goto error;
    }

    /* Brand detection with summary - only on first detection */
    if (g_current_brand == BRAND_UNKNOWN) {
        const char *manufacturer = NULL;
        char manufacturer_buf[128] = {0};
        CameraText summary;
        ret = gp_camera_get_summary(camera, &summary, context);
        if (ret >= GP_OK) {
            const char *mfg_key = "Manufacturer:";
            const char *mfg_pos = strstr(summary.text, mfg_key);
            if (mfg_pos) {
                mfg_pos += strlen(mfg_key);
                while (*mfg_pos == ' ' || *mfg_pos == '\t') mfg_pos++;
                int j = 0;
                while (*mfg_pos && *mfg_pos != '\n' && *mfg_pos != '\r' && j < 127) {
                    manufacturer_buf[j++] = *mfg_pos++;
                }
                manufacturer_buf[j] = '\0';
                manufacturer = manufacturer_buf;
            }
        }

        if (manufacturer && strlen(manufacturer) > 0) {
            g_current_brand = detect_camera_brand(manufacturer);
        } else {
            g_current_brand = detect_camera_brand(model_name);
        }

        const char *brand_name = "Unknown";
        switch (g_current_brand) {
            case BRAND_FUJI:     brand_name = "Fujifilm"; break;
            case BRAND_CANON:    brand_name = "Canon"; break;
            case BRAND_NIKON:    brand_name = "Nikon"; break;
            case BRAND_SONY:     brand_name = "Sony"; break;
            case BRAND_PANASONIC: brand_name = "Panasonic"; break;
            case BRAND_OLYMPUS:  brand_name = "Olympus"; break;
            default:             brand_name = "Unknown"; break;
        }
        log_ts("controller: Detected brand: %s\n", brand_name);
        g_last_logged_brand = g_current_brand;
    }

    clock_gettime(CLOCK_MONOTONIC, &t_init_end);
    long init_ms = (t_init_end.tv_sec - t_detect_end.tv_sec) * 1000 +
                   (t_init_end.tv_nsec - t_detect_end.tv_nsec) / 1000000;
    long total_ms = (t_init_end.tv_sec - t_start.tv_sec) * 1000 +
                    (t_init_end.tv_nsec - t_start.tv_nsec) / 1000000;

    if (did_detection) {
        log_ts("controller: [OPEN TIMING] Detection: %ldms (with auto-detect) | Init: %ldms | Total: %ldms\n",
                detect_ms, init_ms, total_ms);
    } else {
        log_ts("controller: [OPEN TIMING] Detection: %ldms (cached lists) | Init: %ldms | Total: %ldms\n",
                detect_ms, init_ms, total_ms);
    }

    gp_context_unref(context);
    return camera;

error:
    if (list) gp_list_free(list);
    if (camera) gp_camera_free(camera);
    gp_context_unref(context);
    if (ret_out) *ret_out = ret;
    return NULL;
}

/* Send camera_connected event to daemon for caching */
static void send_camera_connected_event(Camera *camera, GPContext *context, int camera_index) {
    if (g_status_fd < 0 || !camera) return;

    /* Send camera_connecting event before fetching lens/fields info */
    send_camera_connecting_event(camera_index);

    CameraText summary;
    char manufacturer[128] = "";
    char model[128] = "";
    char port[64] = "";
    int ret;

    // Get camera summary for manufacturer and model
    ret = gp_camera_get_summary(camera, &summary, context);
    if (ret >= GP_OK) {
        const char *mfg_key = "Manufacturer:";
        const char *mfg_pos = strstr(summary.text, mfg_key);
        if (mfg_pos) {
            mfg_pos += strlen(mfg_key);
            while (*mfg_pos == ' ' || *mfg_pos == '\t') mfg_pos++;
            int j = 0;
            while (*mfg_pos && *mfg_pos != '\n' && *mfg_pos != '\r' && j < 127) {
                manufacturer[j++] = *mfg_pos++;
            }
            manufacturer[j] = '\0';
        }

        const char *model_key = "Model:";
        const char *model_pos = strstr(summary.text, model_key);
        if (model_pos) {
            model_pos += strlen(model_key);
            while (*model_pos == ' ' || *model_pos == '\t') model_pos++;
            int j = 0;
            while (*model_pos && *model_pos != '\n' && *model_pos != '\r' && j < 127) {
                model[j++] = *model_pos++;
            }
            model[j] = '\0';
        }
    }

    // Get port info - try multiple methods
    // First, use g_last_camera_port which was saved during camera detection with the full "usb:XXX,YYY" format
    if (g_last_camera_port[0] != '\0') {
        snprintf(port, sizeof(port), "%s", g_last_camera_port);
    } else {
        // Fallback: try gp_camera_get_port_info
        GPPortInfo port_info;
        ret = gp_camera_get_port_info(camera, &port_info);
        if (ret >= GP_OK) {
            char *port_path = NULL;
            gp_port_info_get_path(port_info, &port_path);
            if (port_path) {
                snprintf(port, sizeof(port), "%s", port_path);
            }
        }
        // Final fallback: if port is incomplete ("usb:" without numbers), get it from the port list
        if (strcmp(port, "usb:") == 0 || strcmp(port, "") == 0) {
            // Try to get port from cached port info list using camera index
            if (g_cached_port_info_list && g_cached_camera_index >= 0) {
                GPPortInfo cached_port_info;
                ret = gp_port_info_list_get_info(g_cached_port_info_list, g_cached_camera_index, &cached_port_info);
                if (ret >= GP_OK) {
                    char *cached_port_name = NULL;
                    gp_port_info_get_path(cached_port_info, &cached_port_name);
                    if (cached_port_name && strstr(cached_port_name, "usb:") != NULL) {
                        snprintf(port, sizeof(port), "%s", cached_port_name);
                        fprintf(stderr, "USB DEBUG: Using cached port name: %s\n", port);
                    }
                }
            }
        }
    }
    if (strlen(manufacturer) > 0 && strlen(model) > 0) {
        const char *usb_version = detect_usb_version(port);

        // Fetch serial number and firmware version (one-time, not polled)
        const BrandWidgets *widgets = get_widgets_for_brand(g_current_brand);
        char *serial = get_single_config_value(camera, context, widgets->serial);
        char *deviceversion = get_single_config_value(camera, context, widgets->deviceversion);

        char event[1024];
        snprintf(event, sizeof(event),
                "{\"type\":\"camera_connected\",\"camera_id\":\"%d\",\"manufacturer\":\"%s\",\"model\":\"%s\",\"port\":\"%s\",\"usb_version\":\"%s\",\"serial_number\":\"%s\",\"firmware\":\"%s\"}\n",
                camera_index, manufacturer, model, port, usb_version,
                serial ? serial : "",
                deviceversion ? deviceversion : "");
        ssize_t written = write(g_status_fd, event, strlen(event));
        if (written > 0) {
            log_ts("controller: Sent camera_connected event: %s %s at %s (USB: %s, Serial: %s, FW: %s)\n",
                    manufacturer, model, port, usb_version,
                    serial ? serial : "N/A",
                    deviceversion ? deviceversion : "N/A");
        }

        if (serial) free(serial);
        if (deviceversion) free(deviceversion);
    }
}

/* Send camera_connecting event when connection attempt starts */
static void send_camera_connecting_event(int camera_index) {
    if (g_status_fd < 0) return;

    char event[128];
    snprintf(event, sizeof(event),
            "{\"type\":\"camera_connecting\",\"camera_id\":\"%d\"}\n",
            camera_index);
    ssize_t written = write(g_status_fd, event, strlen(event));
    if (written > 0) {
        log_ts("controller: Sent camera_connecting event for camera %d\n", camera_index);
    }
}


/* Extract number from filename like DSCF0042.JPG */
static int extract_file_number(const char *filename) {
    const char *p = filename;
    int number = 0;
    while (*p && !(*p >= '0' && *p <= '9')) p++;
    while (*p >= '0' && *p <= '9') {
        number = number * 10 + (*p - '0');
        p++;
    }
    return number;
}

/*
 * Extract a value from JSON string by key
 * Returns a newly allocated string that must be freed by caller, or NULL if not found
 */
static char *extract_json_value(const char *json, const char *key) {
    char search[128];
    snprintf(search, sizeof(search), "\"%s\":\"", key);

    const char *start = strstr(json, search);
    if (!start) return NULL;

    start += strlen(search);  // Move past the key and ":\"

    const char *end = strchr(start, '"');
    if (!end) return NULL;

    size_t len = end - start;
    char *result = malloc(len + 1);
    if (result) {
        memcpy(result, start, len);
        result[len] = '\0';
    }
    return result;
}

/*
 * Find a widget by name or path (e.g., "parent.child") in the config tree
 */
static CameraWidget* find_widget_by_name(CameraWidget *root, const char *name) {
    if (!root || !name) return NULL;

    /* Check for dot-separated path (e.g., "capturesettings.aperture") */
    const char *dot = strchr(name, '.');
    if (dot) {
        /* First part is the parent widget name */
        char parent_name[64];
        size_t parent_len = dot - name;
        if (parent_len >= sizeof(parent_name)) parent_len = sizeof(parent_name) - 1;
        strncpy(parent_name, name, parent_len);
        parent_name[parent_len] = '\0';

        /* Find parent widget */
        const char *widget_name = NULL;
        gp_widget_get_name(root, &widget_name);
        if (widget_name && strcmp(widget_name, parent_name) == 0) {
            /* Found parent, now search for child */
            return find_widget_by_name(root, dot + 1);
        }

        /* Search children for parent */
        int child_count = gp_widget_count_children(root);
        for (int i = 0; i < child_count; i++) {
            CameraWidget *child = NULL;
            if (gp_widget_get_child(root, i, &child) == GP_OK && child) {
                CameraWidget *found = find_widget_by_name(child, name);
                if (found) return found;
            }
        }
        return NULL;
    }

    /* No dot - simple name match */
    const char *widget_name = NULL;
    gp_widget_get_name(root, &widget_name);
    if (widget_name && strcmp(widget_name, name) == 0) {
        return root;
    }

    /* Search children recursively */
    int child_count = gp_widget_count_children(root);
    for (int i = 0; i < child_count; i++) {
        CameraWidget *child = NULL;
        if (gp_widget_get_child(root, i, &child) == GP_OK && child) {
            CameraWidget *found = find_widget_by_name(child, name);
            if (found) return found;
        }
    }

    return NULL;
}

/*
 * Get a single config value by name (searches full config tree)
 * This is needed for widgets like "5010" that gp_camera_get_single_config might not find
 */
static char *get_config_valuebyname(Camera *camera, GPContext *context, const char *setting_name) {
    CameraWidget *config = NULL;
    CameraWidget *widget = NULL;
    char *result = NULL;

    int ret = gp_camera_get_config(camera, &config, context);
    if (ret < GP_OK) {
        log_ts("controller: Failed to get config for '%s': %s\n",
                setting_name, gp_result_as_string(ret));
        return NULL;
    }

    widget = find_widget_by_name(config, setting_name);
    if (!widget) {
        // log_ts("controller: Widget '%s' not found in config tree\n", setting_name);
        gp_widget_free(config);
        return NULL;
    }

    // Get value based on widget type
    CameraWidgetType type;
    gp_widget_get_type(widget, &type);

    if (type == GP_WIDGET_RADIO || type == GP_WIDGET_MENU) {
        const char *current_value = NULL;
        ret = gp_widget_get_value(widget, &current_value);
        if (ret >= GP_OK && current_value) {
            result = strdup(current_value);
        }
    } else if (type == GP_WIDGET_TEXT) {
        const char *text = NULL;
        gp_widget_get_value(widget, &text);
        if (text) {
            result = strdup(text);
        }
    } else if (type == GP_WIDGET_RANGE) {
        float current;
        ret = gp_widget_get_value(widget, &current);
        if (ret >= GP_OK) {
            char buf[64];
            snprintf(buf, sizeof(buf), "%.1f", current);
            result = strdup(buf);
        }
    }

    gp_widget_free(config);
    return result;
}

/*
 * Get a single camera config value by name
 * Returns the value as a string (must be freed by caller) or NULL on error
 *
 * First tries gp_camera_get_single_config (fast path), then falls back to
 * full config tree search (slow path) for widgets not accessible via single config.
 * This is needed for Canon cameras where many widgets return GP_ERROR_BAD_PARAMETERS
 * when accessed via get_single_config.
 */
static char *get_single_config_value(Camera *camera, GPContext *context, const char *setting_name) {
    CameraWidget *widget = NULL;
    int ret;
    char *result = NULL;

    /* Try fast path: gp_camera_get_single_config (works for Canon with libgphoto2 >= 2.5.31) */
    // log_ts("controller: [FAST PATH] Trying gp_camera_get_single_config for '%s'...\n", setting_name);
    ret = gp_camera_get_single_config(camera, setting_name, &widget, context);

    /* If single config fails, try slow path: full config tree search */
    if (ret < GP_OK) {
        /* Blacklist for slow path: widgets that are unreliable and not critical */
        const char *slow_path_blacklist[] = {
            "d36b",         /* BatteryInfo2 - intermittently fails on Fuji, not critical */
            "batterylevel", /* Generic battery - not critical */
            NULL
        };

        int is_blacklisted = 0;
        for (int i = 0; slow_path_blacklist[i] != NULL; i++) {
            if (strcmp(setting_name, slow_path_blacklist[i]) == 0) {
                is_blacklisted = 1;
                break;
            }
        }

        if (is_blacklisted) {
            log_ts("controller: [FAST PATH FAILED] '%s' returned %d (%s), SKIPPING slow path (blacklisted)\n",
                    setting_name, ret, gp_result_as_string(ret));
            return NULL;
        }

        log_ts("controller: [FAST PATH FAILED] '%s' returned %d (%s), falling back to SLOW PATH (full config tree)...\n",
                setting_name, ret, gp_result_as_string(ret));
        /* Fall back to full config tree search (works for nested widgets on Canon) */
        result = get_config_valuebyname(camera, context, setting_name);
        if (result) {
            /* Successfully found via full config search */
            log_ts("controller: [SLOW PATH SUCCESS] Found '%s' via full config tree\n", setting_name);
            return result;
        }
        log_ts("controller: Failed to get config '%s': %s (tried single config and full tree)\n",
                setting_name, gp_result_as_string(ret));
        return NULL;
    }

    // log_ts("controller: [FAST PATH SUCCESS] Got '%s' via single config\n", setting_name);

    if (!widget) {
        log_ts("controller: Config '%s' not found\n", setting_name);
        return NULL;
    }

    char value_buf[256] = {0};
    CameraWidgetType type;

    gp_widget_get_type(widget, &type);
    // log_ts("controller: Widget '%s' type: %d\n", setting_name, type);

    /* Get current value based on widget type */
    if (type == GP_WIDGET_RADIO || type == GP_WIDGET_MENU) {
        /* RADIO/MENU widgets return the current value as a string pointer */
        const char *current_value = NULL;
        ret = gp_widget_get_value(widget, &current_value);
        if (ret >= GP_OK && current_value) {
            strncpy(value_buf, current_value, sizeof(value_buf) - 1);
            result = strdup(value_buf);
            // log_ts("controller: Got RADIO/MENU value: %s\n", result);
        } else {
            log_ts("controller: Failed to get RADIO/MENU value: %s\n", gp_result_as_string(ret));
        }
    } else if (type == GP_WIDGET_TEXT) {
        const char *text = NULL;
        gp_widget_get_value(widget, &text);
        if (text) {
            result = strdup(text);
            // log_ts("controller: Got TEXT value: %s\n", result);
        }
    } else if (type == GP_WIDGET_RANGE) {
        float current;
        ret = gp_widget_get_value(widget, &current);
        if (ret >= GP_OK) {
            snprintf(value_buf, sizeof(value_buf), "%.1f", current);
            result = strdup(value_buf);
            // log_ts("controller: Got RANGE value: %s\n", result);
        }
    } else {
        log_ts("controller: Unknown widget type %d for '%s'\n", type, setting_name);
    }

    gp_widget_free(widget);
    return result;
}

/*
 * Debug: List all available camera config widgets
 */
static void list_all_widgets(Camera *camera, GPContext *context) {
    CameraWidget *config = NULL;
    int ret = gp_camera_get_config(camera, &config, context);
    if (ret < GP_OK) return;

    log_ts("controller: === Available camera widgets ===\n");

    int child_count = gp_widget_count_children(config);
    for (int i = 0; i < child_count; i++) {
        CameraWidget *child = NULL;
        const char *name = NULL;
        const char *label = NULL;
        CameraWidgetType type;

        gp_widget_get_child(config, i, &child);
        if (child) {
            gp_widget_get_name(child, &name);
            gp_widget_get_label(child, &label);
            gp_widget_get_type(child, &type);

            fprintf(stderr, "  [%d] name='%s' label='%s' type=%d\n",
                    i, name ? name : "NULL", label ? label : "NULL", type);
        }
    }
    log_ts("controller: === End of widgets ===\n");

    gp_widget_free(config);
}

/*
 * Get camera settings (ISO, aperture, shutter, etc.) as JSON
 * Returns 0 on success with status_json populated, -1 on error
 */
static int get_camera_status_json(Camera *camera, GPContext *context, char *status_json, size_t max_size) {
    CameraWidget *widget = NULL, *config = NULL;
    int ret;

    ret = gp_camera_get_config(camera, &config, context);
    if (ret < GP_OK) {
        log_ts("controller: Failed to get camera config: %s\n", gp_result_as_string(ret));
        return -1;
    }

    /* Get brand-specific widget names */
    const BrandWidgets *widgets = get_widgets_for_brand(g_current_brand);

    /* Build settings list from brand-specific widget names */
    const char *settings[] = {
        widgets->iso,
        widgets->aperture,
        "shutterspeed",
        "shutterspeed2",
        widgets->ev,
        "exposurecompensation",  /* Fallback for EV */
        widgets->wb,
        widgets->focus,
        widgets->metering,
        widgets->battery,
        "batterylevel",  /* Generic fallback */
        NULL
    };

    /* Shooting mode widget names to try (brand-specific first, then fallbacks) */
    const char *shooting_mode_widgets[] = {
        widgets->mode,           /* Brand-specific primary */
        "expprogram",            /* Fuji */
        "autoexposuremode",      /* Canon */
        "autoexposuremodedial",  /* Canon alternative */
        "exposureprogram",
        "exposuremode",
        "capturemode",
        NULL
    };

    /* Build JSON output */
    int json_offset = 0;
    json_offset += snprintf(status_json + json_offset, max_size - json_offset, "{");

    int first = 1;
    for (int i = 0; settings[i] != NULL; i++) {
        /* Find widget by name - iterate through children */
        widget = NULL;
        int child_count = gp_widget_count_children(config);
        for (int j = 0; j < child_count; j++) {
            CameraWidget *child = NULL;
            const char *child_name = NULL;
            gp_widget_get_child(config, j, &child);
            if (child) {
                gp_widget_get_name(child, &child_name);
                if (child_name && strcmp(child_name, settings[i]) == 0) {
                    widget = child;
                    break;
                }
            }
        }
        if (!widget) continue;

        const char *label = NULL;
        const char *name = NULL;
        CameraWidgetType type;

        gp_widget_get_label(widget, &label);
        gp_widget_get_name(widget, &name);
        gp_widget_get_type(widget, &type);

        /* Skip widgets without labels or widgets that are sections/sections */
        if (!label || type == GP_WIDGET_SECTION) {
            continue;
        }

        const char *value = NULL;
        char value_buf[256] = {0};

        /* Get current value based on widget type */
        if (type == GP_WIDGET_RADIO || type == GP_WIDGET_MENU) {
            int choice_count = gp_widget_count_choices(widget);
            for (int c = 0; c < choice_count; c++) {
                const char *choice = NULL;
                gp_widget_get_choice(widget, c, &choice);
                /* Check if this choice is currently selected */
                int current = 0;
                ret = gp_widget_get_value(widget, &current);
                if (ret >= GP_OK && current == c) {
                    value = choice;
                    break;
                }
            }
        } else if (type == GP_WIDGET_TEXT) {
            const char *text = NULL;
            gp_widget_get_value(widget, &text);
            if (text) {
                strncpy(value_buf, text, sizeof(value_buf) - 1);
                value = value_buf;
            }
        } else if (type == GP_WIDGET_RANGE) {
            float current;
            ret = gp_widget_get_value(widget, &current);
            if (ret >= GP_OK) {
                snprintf(value_buf, sizeof(value_buf), "%.1f", current);
                value = value_buf;
            }
        }

        if (value && value[0] != '\0') {
            if (!first) {
                json_offset += snprintf(status_json + json_offset, max_size - json_offset, ",");
            }
            first = 0;

            /* JSON escape the value and write it */
            json_offset += snprintf(status_json + json_offset, max_size - json_offset, "\"%s\":", name);

            /* Simple JSON escaping for the value */
            for (const char *p = value; *p && json_offset < max_size - 10; p++) {
                if (*p == '"') {
                    json_offset += snprintf(status_json + json_offset, max_size - json_offset, "\\\"");
                } else if (*p == '\\') {
                    json_offset += snprintf(status_json + json_offset, max_size - json_offset, "\\\\");
                } else if (*p == '\n') {
                    json_offset += snprintf(status_json + json_offset, max_size - json_offset, "\\n");
                } else if (*p >= 32 && *p < 127) {
                    json_offset += snprintf(status_json + json_offset, max_size - json_offset, "%c", *p);
                }
            }
            json_offset += snprintf(status_json + json_offset, max_size - json_offset, "\"");
        }
    }

    /* Try to find shooting mode from config (still using the same config tree) */
    char *shootingmode = NULL;
    for (int j = 0; shooting_mode_widgets[j] != NULL; j++) {
        CameraWidget *sm_widget = NULL;
        int sm_child_count = gp_widget_count_children(config);
        for (int k = 0; k < sm_child_count; k++) {
            CameraWidget *child = NULL;
            const char *child_name = NULL;
            gp_widget_get_child(config, k, &child);
            if (child) {
                gp_widget_get_name(child, &child_name);
                if (child_name && strcmp(child_name, shooting_mode_widgets[j]) == 0) {
                    sm_widget = child;
                    break;
                }
            }
        }

        if (sm_widget) {
            const char *sm_value = NULL;
            CameraWidgetType sm_type;
            gp_widget_get_type(sm_widget, &sm_type);
            if (sm_type == GP_WIDGET_RADIO || sm_type == GP_WIDGET_MENU) {
                gp_widget_get_value(sm_widget, &sm_value);
                if (sm_value) {
                    shootingmode = strdup(sm_value);
                    break;
                }
            }
        }
    }

    /* Add shooting mode to JSON */
    if (shootingmode && shootingmode[0] != '\0') {
        if (!first) {
            json_offset += snprintf(status_json + json_offset, max_size - json_offset, ",");
        }
        json_offset += snprintf(status_json + json_offset, max_size - json_offset, "\"shootingmode\":\"%s\"", shootingmode);
        free(shootingmode);
    }

    json_offset += snprintf(status_json + json_offset, max_size - json_offset, "}");

    gp_widget_free(config);
    return (json_offset < max_size) ? 0 : -1;
}

/*
 * Helper: append a JSON-escaped string to a buffer.
 * Returns number of chars written.
 */
static int json_escape_append(char *buf, size_t max, const char *str) {
    int offset = 0;
    if (!str) return 0;
    for (const char *p = str; *p && offset < (int)max - 6; p++) {
        if (*p == '"') {
            offset += snprintf(buf + offset, max - offset, "\\\"");
        } else if (*p == '\\') {
            offset += snprintf(buf + offset, max - offset, "\\\\");
        } else if (*p == '\n') {
            offset += snprintf(buf + offset, max - offset, "\\n");
        } else if (*p >= 32 && *p < 127) {
            buf[offset++] = *p;
        }
    }
    buf[offset] = '\0';
    return offset;
}

/*
 * Get the string value of a widget (for config output).
 * Returns pointer to a static buffer or the internal string, valid until next call.
 */
static const char* widget_value_str(CameraWidget *widget) {
    static char vbuf[256];
    CameraWidgetType type;
    gp_widget_get_type(widget, &type);

    if (type == GP_WIDGET_TEXT || type == GP_WIDGET_RADIO || type == GP_WIDGET_MENU) {
        const char *val = NULL;
        gp_widget_get_value(widget, &val);
        return val ? val : "";
    } else if (type == GP_WIDGET_RANGE) {
        float fval;
        gp_widget_get_value(widget, &fval);
        snprintf(vbuf, sizeof(vbuf), "%.1f", fval);
        return vbuf;
    } else if (type == GP_WIDGET_TOGGLE) {
        int ival;
        gp_widget_get_value(widget, &ival);
        return ival ? "true" : "false";
    }
    return "";
}

/*
 * Write full camera config JSON to CONFIG_RESPONSE_FILE.
 * Output matches the format produced by gphoto2-wrapper's get_config():
 *   {"iso":{"value":"800","label":"ISO Speed","type":"radio","choices":["100","200",...]}, ...}
 *
 * Uses atomic write (temp file + rename) to avoid partial reads.
 * Returns 0 on success, -1 on error.
 */
static int write_full_config_json(Camera *camera, GPContext *context) {
    CameraWidget *config = NULL;
    int ret;

    ret = gp_camera_get_config(camera, &config, context);
    if (ret < GP_OK) {
        /* Write error JSON */
        FILE *f = fopen(CONFIG_RESPONSE_FILE ".tmp", "w");
        if (f) {
            fprintf(f, "{\"error\":\"Failed to get config: %s\"}\n", gp_result_as_string(ret));
            fclose(f);
            rename(CONFIG_RESPONSE_FILE ".tmp", CONFIG_RESPONSE_FILE);
        }
        return -1;
    }

    /* Same settings list as the wrapper's get_config() */
    const char *settings[] = {
        "iso",
        "aperture",           /* Canon aperture */
        "f-number",           /* Fuji aperture */
        "shutterspeed",
        "shutterspeed2",
        "exposurecompensation",
        "5010",               /* Exposure Bias Compensation (Fuji PTP) */
        "whitebalance",
        "focusmode",
        "exposuremetermode",  /* Fuji */
        "meteringmode",       /* Canon */
        "500b",               /* PTP property */
        "drivemode",
        "imageformat",
        "imagesize",
        "flashmode",
        "lensname",
        "d36b",               /* BatteryInfo2 (Fuji) */
        "5001",               /* Canon battery PTP */
        "batterylevel",
        "autoexposuremode",
        "autoexposuremodedial",
        "expprogram",
        NULL
    };

    /* Build JSON into a large buffer */
    #define CONFIG_BUF_SIZE (128 * 1024)  /* 128KB should be plenty */
    char *buf = malloc(CONFIG_BUF_SIZE);
    if (!buf) {
        gp_widget_free(config);
        return -1;
    }

    int off = 0;
    off += snprintf(buf + off, CONFIG_BUF_SIZE - off, "{");
    int first = 1;

    for (int i = 0; settings[i] != NULL; i++) {
        CameraWidget *widget = find_widget_by_name(config, settings[i]);
        if (!widget) continue;

        const char *value = widget_value_str(widget);
        const char *label = NULL;
        const char *name = NULL;
        CameraWidgetType type;

        gp_widget_get_label(widget, &label);
        gp_widget_get_name(widget, &name);
        gp_widget_get_type(widget, &type);

        if (!first) off += snprintf(buf + off, CONFIG_BUF_SIZE - off, ",");
        first = 0;

        /* Key */
        off += snprintf(buf + off, CONFIG_BUF_SIZE - off, "\"");
        off += json_escape_append(buf + off, CONFIG_BUF_SIZE - off, name ? name : settings[i]);
        off += snprintf(buf + off, CONFIG_BUF_SIZE - off, "\":{");

        /* Value */
        off += snprintf(buf + off, CONFIG_BUF_SIZE - off, "\"value\":\"");
        off += json_escape_append(buf + off, CONFIG_BUF_SIZE - off, value);
        off += snprintf(buf + off, CONFIG_BUF_SIZE - off, "\",");

        /* Label */
        off += snprintf(buf + off, CONFIG_BUF_SIZE - off, "\"label\":\"");
        off += json_escape_append(buf + off, CONFIG_BUF_SIZE - off, label ? label : "");
        off += snprintf(buf + off, CONFIG_BUF_SIZE - off, "\",");

        /* Type */
        const char *type_str = "unknown";
        switch (type) {
            case GP_WIDGET_TEXT:   type_str = "text"; break;
            case GP_WIDGET_RANGE:  type_str = "range"; break;
            case GP_WIDGET_TOGGLE: type_str = "toggle"; break;
            case GP_WIDGET_RADIO:  type_str = "radio"; break;
            case GP_WIDGET_MENU:   type_str = "menu"; break;
            case GP_WIDGET_DATE:   type_str = "date"; break;
            default: break;
        }
        off += snprintf(buf + off, CONFIG_BUF_SIZE - off, "\"type\":\"%s\"", type_str);

        /* Choices for radio/menu */
        if (type == GP_WIDGET_RADIO || type == GP_WIDGET_MENU) {
            int choices = gp_widget_count_choices(widget);
            if (choices > 0) {
                off += snprintf(buf + off, CONFIG_BUF_SIZE - off, ",\"choices\":[");
                for (int j = 0; j < choices; j++) {
                    const char *choice = NULL;
                    gp_widget_get_choice(widget, j, &choice);
                    if (j > 0) off += snprintf(buf + off, CONFIG_BUF_SIZE - off, ",");
                    off += snprintf(buf + off, CONFIG_BUF_SIZE - off, "\"");
                    off += json_escape_append(buf + off, CONFIG_BUF_SIZE - off, choice ? choice : "");
                    off += snprintf(buf + off, CONFIG_BUF_SIZE - off, "\"");
                }
                off += snprintf(buf + off, CONFIG_BUF_SIZE - off, "]");
            }
        }

        /* Range min/max/step */
        if (type == GP_WIDGET_RANGE) {
            float min, max, step;
            gp_widget_get_range(widget, &min, &max, &step);
            off += snprintf(buf + off, CONFIG_BUF_SIZE - off, ",\"min\":%g,\"max\":%g,\"step\":%g", min, max, step);
        }

        off += snprintf(buf + off, CONFIG_BUF_SIZE - off, "}");
    }

    off += snprintf(buf + off, CONFIG_BUF_SIZE - off, "}\n");
    gp_widget_free(config);

    /* Atomic write: temp file + rename */
    FILE *f = fopen(CONFIG_RESPONSE_FILE ".tmp", "w");
    if (!f) {
        log_ts("controller: Failed to open config response temp file: %s\n", strerror(errno));
        free(buf);
        return -1;
    }
    fwrite(buf, 1, off, f);
    fclose(f);
    free(buf);

    if (rename(CONFIG_RESPONSE_FILE ".tmp", CONFIG_RESPONSE_FILE) != 0) {
        log_ts("controller: Failed to rename config response file: %s\n", strerror(errno));
        return -1;
    }

    log_ts("controller: Wrote config response (%d bytes)\n", off);
    return 0;
}

/*
 * Set a single camera config value and write result to CONFIG_RESPONSE_FILE.
 * json_input format: {"setting":"iso","value":"800"}
 * Returns 0 on success, -1 on error.
 */
static int set_config_and_write_response(Camera *camera, GPContext *context, const char *json_input) {
    char *setting = extract_json_value(json_input, "setting");
    char *value = extract_json_value(json_input, "value");

    if (!setting || !value) {
        FILE *f = fopen(CONFIG_RESPONSE_FILE ".tmp", "w");
        if (f) {
            fprintf(f, "{\"error\":\"JSON must contain 'setting' and 'value' keys\"}\n");
            fclose(f);
            rename(CONFIG_RESPONSE_FILE ".tmp", CONFIG_RESPONSE_FILE);
        }
        if (setting) free(setting);
        if (value) free(value);
        return -1;
    }

    log_ts("controller: SETCONFIG %s = %s\n", setting, value);

    /* Get the widget */
    CameraWidget *widget = NULL;
    int ret = gp_camera_get_single_config(camera, setting, &widget, context);
    if (ret < GP_OK || !widget) {
        FILE *f = fopen(CONFIG_RESPONSE_FILE ".tmp", "w");
        if (f) {
            fprintf(f, "{\"error\":\"Setting '%s' not found: %s\"}\n", setting, gp_result_as_string(ret));
            fclose(f);
            rename(CONFIG_RESPONSE_FILE ".tmp", CONFIG_RESPONSE_FILE);
        }
        free(setting);
        free(value);
        return -1;
    }

    /* Set value based on widget type */
    CameraWidgetType type;
    gp_widget_get_type(widget, &type);
    int set_ret = GP_OK;
    const char *error_msg = NULL;

    if (type == GP_WIDGET_RADIO || type == GP_WIDGET_MENU) {
        int choices = gp_widget_count_choices(widget);
        int found = 0;
        for (int i = 0; i < choices && !found; i++) {
            const char *choice = NULL;
            gp_widget_get_choice(widget, i, &choice);
            if (choice && (strcmp(choice, value) == 0 || strcasecmp(choice, value) == 0)) {
                set_ret = gp_widget_set_value(widget, choice);
                found = 1;
            }
        }
        if (!found) {
            error_msg = "Choice not found in available options";
            set_ret = GP_ERROR;
        }
    } else if (type == GP_WIDGET_TOGGLE) {
        int toggle_val = (strcmp(value, "1") == 0 || strcasecmp(value, "on") == 0 || strcasecmp(value, "true") == 0) ? 1 : 0;
        set_ret = gp_widget_set_value(widget, &toggle_val);
    } else if (type == GP_WIDGET_TEXT || type == GP_WIDGET_RANGE) {
        set_ret = gp_widget_set_value(widget, value);
    } else {
        error_msg = "Unsupported widget type";
        set_ret = GP_ERROR;
    }

    /* Write response */
    FILE *f = fopen(CONFIG_RESPONSE_FILE ".tmp", "w");
    if (f) {
        if (set_ret < GP_OK) {
            fprintf(f, "{\"error\":\"Failed to set %s: %s\"}\n",
                    setting, error_msg ? error_msg : gp_result_as_string(set_ret));
        } else {
            /* Save to camera */
            int save_ret = gp_camera_set_single_config(camera, setting, widget, context);
            if (save_ret < GP_OK) {
                fprintf(f, "{\"warning\":\"Value set but failed to save to camera: %s\"}\n",
                        gp_result_as_string(save_ret));
            } else {
                fprintf(f, "{\"success\":true,\"setting\":\"%s\",\"value\":\"%s\"}\n", setting, value);
            }
        }
        fclose(f);
        rename(CONFIG_RESPONSE_FILE ".tmp", CONFIG_RESPONSE_FILE);
    }

    gp_widget_free(widget);
    free(setting);
    free(value);
    return (set_ret >= GP_OK) ? 0 : -1;
}

/* Find highest numbered file in folder */
static int find_highest_file(Camera *camera, GPContext *context,
                             const char *folder, char *out_name, size_t out_size) {
    CameraList *file_list = NULL;
    int ret;
    int max_number = -1;
    char max_name_buf[128] = {0};

    ret = gp_list_new(&file_list);
    if (ret < GP_OK) return -1;

    ret = gp_camera_folder_list_files(camera, folder, file_list, context);
    if (ret < GP_OK) {
        gp_list_free(file_list);
        return -1;
    }

    int count = gp_list_count(file_list);
    for (int i = 0; i < count; i++) {
        const char *name;
        gp_list_get_name(file_list, i, &name);
        int num = extract_file_number(name);
        if (num > max_number) {
            max_number = num;
            strncpy(max_name_buf, name, sizeof(max_name_buf) - 1);
        }
    }

    gp_list_free(file_list);

    if (max_name_buf[0] && out_name) {
        strncpy(out_name, max_name_buf, out_size - 1);
        out_name[out_size - 1] = '\0';
    }

    return max_number;
}

/* Reset old failed file entries (called periodically) */
static void reset_old_failed_files(void) {
    time_t now = time(NULL);
    int new_count = 0;

    for (int i = 0; i < g_failed_file_count; i++) {
        if (now - g_failed_files[i].first_failure < FAILED_FILE_RESET_SEC) {
            // Keep this entry
            if (new_count != i) {
                g_failed_files[new_count] = g_failed_files[i];
            }
            new_count++;
        } else {
            log_ts("controller: Reset failed file entry for %s (was %d retries)\n",
                    g_failed_files[i].filename, g_failed_files[i].retry_count);
        }
    }
    g_failed_file_count = new_count;
}

/* Find a failed file entry, returns index or -1 if not found */
static int find_failed_file(const char *filename) {
    for (int i = 0; i < g_failed_file_count; i++) {
        if (strcmp(g_failed_files[i].filename, filename) == 0) {
            return i;
        }
    }
    return -1;
}

/* Check if a file should be skipped due to too many failures */
static int should_skip_file(const char *filename) {
    int idx = find_failed_file(filename);
    if (idx < 0) return 0;
    return g_failed_files[idx].retry_count >= MAX_DOWNLOAD_RETRIES;
}

/* Record a failed download attempt, returns new retry count */
static int record_failed_download(const char *filename) {
    int idx = find_failed_file(filename);

    if (idx >= 0) {
        // Existing entry
        g_failed_files[idx].retry_count++;
        return g_failed_files[idx].retry_count;
    }

    // New entry
    if (g_failed_file_count < MAX_FAILED_FILES) {
        strncpy(g_failed_files[g_failed_file_count].filename, filename,
                sizeof(g_failed_files[0].filename) - 1);
        g_failed_files[g_failed_file_count].filename[sizeof(g_failed_files[0].filename) - 1] = '\0';
        g_failed_files[g_failed_file_count].retry_count = 1;
        g_failed_files[g_failed_file_count].first_failure = time(NULL);
        g_failed_file_count++;
        return 1;
    }

    // Table full, just return 1
    log_ts("controller: Warning - failed files table full\n");
    return 1;
}

/* Clear a file from failed list (on successful download) */
static void clear_failed_file(const char *filename) {
    int idx = find_failed_file(filename);
    if (idx < 0) return;

    // Shift remaining entries
    for (int i = idx; i < g_failed_file_count - 1; i++) {
        g_failed_files[i] = g_failed_files[i + 1];
    }
    g_failed_file_count--;
}

/* Check if a file already exists locally in /tmp */
static int file_exists_locally(const char *filename) {
    char path[512];
    snprintf(path, sizeof(path), "/tmp/%s", filename);
    FILE *f = fopen(path, "rb");
    if (f) {
        fclose(f);
        return 1;
    }
    return 0;
}

/* Scan folder for all files and download any that don't exist locally */
static int check_and_download_all_files(Camera *camera, GPContext *context) {
    const char *folders[] = {"/store_10000001", "/DCIM/100_FUJI", "/DCIM", NULL};
    int total_downloaded = 0;
    int highest_number = 0;

    for (int fi = 0; folders[fi] != NULL; fi++) {
        CameraList *file_list = NULL;
        int ret = gp_list_new(&file_list);
        if (ret < GP_OK) continue;

        ret = gp_camera_folder_list_files(camera, folders[fi], file_list, context);
        if (ret < GP_OK) {
            gp_list_free(file_list);
            continue;
        }

        int count = gp_list_count(file_list);
        //log_ts("controller: Scanning folder %s (%d files)\n", folders[fi], count);

        for (int i = 0; i < count; i++) {
            const char *name;
            gp_list_get_name(file_list, i, &name);

            // Check if we're interested in this file (image files)
            int is_image = 0;
            const char *ext = strrchr(name, '.');
            if (ext) {
                const char *image_exts[] = {".jpg", ".JPG", ".jpeg", ".JPEG", ".raf", ".RAF", NULL};
                for (int ei = 0; image_exts[ei] != NULL; ei++) {
                    if (strcasecmp(ext, image_exts[ei]) == 0) {
                        is_image = 1;
                        break;
                    }
                }
            }

            if (!is_image) continue;

            // Track highest file number
            int file_num = extract_file_number(name);
            if (file_num > highest_number) {
                highest_number = file_num;
            }

            // Check if file already exists locally
            if (file_exists_locally(name)) {
                log_ts("controller: File already exists locally: %s, deleting from camera...\n", name);
                // File exists locally but still on camera - clean it up!
                int delete_ret = gp_camera_file_delete(camera, folders[fi], name, context);
                if (delete_ret < GP_OK) {
                    log_ts("controller: Failed to delete existing file %s from camera: %s\n",
                            name, gp_result_as_string(delete_ret));
                } else {
                    log_ts("controller: Cleaned up existing file %s from camera\n", name);
                }
                clear_failed_file(name);  // Clear any failed download tracking
                continue;
            }

            // Check if file should be skipped due to repeated failures
            if (should_skip_file(name)) {
                // Only log once in a while to avoid spam
                static time_t last_skip_log = 0;
                time_t now = time(NULL);
                if (now - last_skip_log > 30) {
                    log_ts("controller: Skipping %s - exceeded max download retries (%d)\n",
                            name, MAX_DOWNLOAD_RETRIES);
                    last_skip_log = now;
                }
                continue;
            }

            // Download the file
            CameraFile *file = NULL;
            ret = gp_file_new(&file);
            if (ret < GP_OK) continue;

            ret = gp_camera_file_get(camera, folders[fi], name,
                                     GP_FILE_TYPE_NORMAL, file, context);
            if (ret >= GP_OK) {
                char output_path[512];
                snprintf(output_path, sizeof(output_path), "/tmp/%s", name);

                // Check file size received from camera
                const char *data;
                unsigned long size;
                gp_file_get_data_and_size(file, &data, &size);
                log_ts("controller: Received %lu bytes from camera for %s\n", size, name);

                // Ensure we have enough storage before saving
                ensure_storage_space(size);

                ret = gp_file_save(file, output_path);
                if (ret >= GP_OK) {
                    log_ts("controller: Downloaded %s/%s -> %s\n", folders[fi], name, output_path);
                    total_downloaded++;
                    clear_failed_file(name);  // Clear any previous failure tracking

                    // Emit event to status pipe
                    if (g_status_fd >= 0) {
                        char event[512];
                        snprintf(event, sizeof(event),
                                "{\"type\":\"photo_downloaded\",\"file_path\":\"%s\",\"camera_path\":\"%s/%s\"}\n",
                                output_path, folders[fi], name);
                        ssize_t written = write(g_status_fd, event, strlen(event));
                        if (written < 0) {
                            log_ts("controller: Failed to write to status pipe: %s\n", strerror(errno));
                        } else {
                            log_ts("controller: Emitted photo_downloaded event\n");
                        }
                    }

                    // Delete from camera after successful download
                    int delete_ret = gp_camera_file_delete(camera, folders[fi], name, context);
                    if (delete_ret < GP_OK) {
                        log_ts("controller: Warning - failed to delete %s from camera: %s\n",
                                name, gp_result_as_string(delete_ret));
                    } else {
                        log_ts("controller: Deleted %s from camera\n", name);
                    }
                } else {
                    int retries = record_failed_download(name);
                    log_ts("controller: Failed to save %s: error=%d (%s) [attempt %d/%d]\n",
                            name, ret, gp_result_as_string(ret), retries, MAX_DOWNLOAD_RETRIES);
                    log_ts("controller: Output path: %s, errno: %d (%s)\n", output_path, errno, strerror(errno));

                    // Check disk space
                    FILE *df = popen("df -h /tmp 2>/dev/null", "r");
                    if (df) {
                        char df_line[256];
                        while (fgets(df_line, sizeof(df_line), df)) {
                            log_ts("controller: %s", df_line);
                        }
                        pclose(df);
                    }
                }
            } else {
                int retries = record_failed_download(name);
                log_ts("controller: Failed to download %s: error=%d (%s) [attempt %d/%d]\n",
                        name, ret, gp_result_as_string(ret), retries, MAX_DOWNLOAD_RETRIES);
            }

            gp_file_free(file);
        }

        gp_list_free(file_list);
    }

    if (total_downloaded > 0) {
        log_ts("controller: Downloaded %d new files (highest number: %d)\n", total_downloaded, highest_number);
    }

    return highest_number;
}

/*
 * Download a single file from the camera by folder + name.
 * Saves to /tmp/<name> and emits a status event.
 * Returns 0 on success, -1 on failure.
 */
static int download_file(Camera *camera, GPContext *context,
                         const char *folder, const char *name) {
    CameraFile *file = NULL;
    char output_path[512];
    int ret;

    ret = gp_file_new(&file);
    if (ret < GP_OK) return -1;

    ret = gp_camera_file_get(camera, folder, name,
                             GP_FILE_TYPE_NORMAL, file, context);
    if (ret < GP_OK) {
        gp_file_free(file);
        return -1;
    }

    snprintf(output_path, sizeof(output_path), "/tmp/%s", name);

    // Check file size received from camera
    const char *data;
    unsigned long size;
    gp_file_get_data_and_size(file, &data, &size);
    log_ts("controller: Received %lu bytes from camera for %s\n", size, name);

    // Ensure we have enough storage before saving
    ensure_storage_space(size);

    ret = gp_file_save(file, output_path);
    gp_file_free(file);

    if (ret < GP_OK) {
        log_ts("controller: Failed to save %s: error=%d (%s)\n", name, ret, gp_result_as_string(ret));
        log_ts("controller: Output path: %s, errno: %d (%s)\n", output_path, errno, strerror(errno));

        // Check disk space
        FILE *df = popen("df -h /tmp 2>/dev/null", "r");
        if (df) {
            char df_line[256];
            while (fgets(df_line, sizeof(df_line), df)) {
                log_ts("controller: %s", df_line);
            }
            pclose(df);
        }
        return -1;
    }

    log_ts("controller: Downloaded %s/%s -> %s\n", folder, name, output_path);

    /* Emit event to status pipe */
    if (g_status_fd >= 0) {
        char event[512];
        snprintf(event, sizeof(event),
                "{\"type\":\"photo_downloaded\",\"file_path\":\"%s\",\"camera_path\":\"%s/%s\"}\n",
                output_path, folder, name);
        ssize_t written = write(g_status_fd, event, strlen(event));
        if (written < 0) {
            log_ts("controller: Failed to write photo_downloaded event: %s\n", strerror(errno));
        } else {
            log_ts("controller: Emitted photo_downloaded event for %s\n", name);
        }
    }

    /* Delete from camera after successful download */
    int delete_ret = gp_camera_file_delete(camera, folder, name, context);
    if (delete_ret < GP_OK) {
        log_ts("controller: Warning - failed to delete %s from camera: %s\n",
                name, gp_result_as_string(delete_ret));
    } else {
        log_ts("controller: Deleted %s from camera\n", name);
    }

    return 0;
}

/*
 * Wait for camera events using gp_camera_wait_for_event().
 * This is non-blocking to the camera — the USB bus stays idle between events,
 * so the physical shutter button works normally.
 *
 * When a FILE_ADDED event arrives (physical shutter or after software capture),
 * we download the file.  Returns after the timeout expires with no events.
 */
static void drain_camera_events(Camera *camera, GPContext *context, int timeout_ms) {
    CameraEventType event_type;
    void *event_data = NULL;
    int ret;

    /* Keep draining events until we get a timeout (no more events) */
    while (g_running) {
        event_data = NULL;
        ret = gp_camera_wait_for_event(camera, timeout_ms, &event_type, &event_data, context);
        if (ret < GP_OK) {
            log_ts("controller: wait_for_event error: %s\n", gp_result_as_string(ret));
            if (event_data) free(event_data);
            break;
        }

        if (event_type == GP_EVENT_TIMEOUT) {
            /* No more events — camera is idle */
            if (event_data) free(event_data);
            break;
        }

        if (event_type == GP_EVENT_FILE_ADDED) {
            CameraFilePath *path = (CameraFilePath *)event_data;
            log_ts("controller: FILE_ADDED event: %s/%s\n", path->folder, path->name);
            download_file(camera, context, path->folder, path->name);
        } else if (event_type == GP_EVENT_FOLDER_ADDED) {
            CameraFilePath *path = (CameraFilePath *)event_data;
            log_ts("controller: FOLDER_ADDED event: %s/%s\n", path->folder, path->name);
        } else {
            log_ts("controller: Event type %d\n", event_type);
        }

        if (event_data) free(event_data);
    }
}

/* Capture a live view preview frame and output as base64 JSON */
static int capture_preview_frame(Camera *camera, GPContext *context) {
    CameraFile *file = NULL;
    const char *data = NULL;
    unsigned long size = 0;
    int ret;
    char base64_buf[4 * 1024 * 1024];  // Buffer for base64 output
    int i;
    static const char base64_table[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    log_ts("controller: Capturing preview frame...\n");

    ret = gp_camera_capture_preview(camera, file, context);
    if (ret < GP_OK) {
        log_ts("controller: Preview capture failed: %s\n", gp_result_as_string(ret));
        // Try to exit live view on camera
        gp_camera_exit(camera, context);
        return ret;
    }

    ret = gp_file_get_data_and_size(file, &data, &size);
    if (ret < GP_OK) {
        log_ts("controller: Failed to get preview data: %s\n", gp_result_as_string(ret));
        gp_file_free(file);
        return ret;
    }

    log_ts("controller: Preview frame size: %lu bytes\n", size);

    // Encode to base64
    unsigned long triad;
    for (i = 0; i < size - 2; i += 3) {
        triad = ((unsigned long)data[i]) << 16;
        triad += ((unsigned long)data[i + 1]) << 8;
        triad += ((unsigned long)data[i + 2]);

        if (i / 3 * 4 >= sizeof(base64_buf) - 4) break;  // Prevent overflow

        base64_buf[i / 3 * 4] = base64_table[(triad >> 18) & 0x3F];
        base64_buf[i / 3 * 4 + 1] = base64_table[(triad >> 12) & 0x3F];
        base64_buf[i / 3 * 4 + 2] = base64_table[(triad >> 6) & 0x3F];
        base64_buf[i / 3 * 4 + 3] = base64_table[triad & 0x3F];
    }

    // Handle remaining bytes
    int mod = size % 3;
    int base64_len = (size / 3) * 4;

    if (mod == 1) {
        triad = ((unsigned long)data[size - 1]) << 16;
        base64_buf[base64_len] = base64_table[(triad >> 18) & 0x3F];
        base64_buf[base64_len + 1] = base64_table[(triad >> 12) & 0x3F];
        base64_buf[base64_len + 2] = '=';
        base64_buf[base64_len + 3] = '=';
        base64_len += 4;
    } else if (mod == 2) {
        triad = ((unsigned long)data[size - 2]) << 16;
        triad += ((unsigned long)data[size - 1]) << 8;
        base64_buf[base64_len] = base64_table[(triad >> 18) & 0x3F];
        base64_buf[base64_len + 1] = base64_table[(triad >> 12) & 0x3F];
        base64_buf[base64_len + 2] = base64_table[(triad >> 6) & 0x3F];
        base64_buf[base64_len + 3] = '=';
        base64_len += 4;
    }

    base64_buf[base64_len] = '\0';

    // Write JSON response to status pipe
    if (g_status_fd >= 0) {
        char response[base64_len + 256];
        snprintf(response, sizeof(response),
                "{\"type\":\"liveview_frame\",\"data\":\"%.*s\",\"size\":%lu}\n",
                base64_len, base64_buf, size);
        ssize_t written = write(g_status_fd, response, strlen(response));
        if (written < 0) {
            log_ts("controller: Failed to write preview frame: %s\n", strerror(errno));
        } else {
            log_ts("controller: Sent preview frame (%lu bytes, %d base64)\n", size, base64_len);
        }
    }

    gp_file_free(file);
    return GP_OK;
}

/* Execute software capture and download the resulting files */
static int do_capture(Camera *camera, GPContext *context) {
    CameraFilePath path;
    int ret;
    struct timespec t0, t1, t2;

    clock_gettime(CLOCK_MONOTONIC, &t0);
    log_ts("controller: Triggering capture...\n");
    ret = gp_camera_capture(camera, GP_CAPTURE_IMAGE, &path, context);
    clock_gettime(CLOCK_MONOTONIC, &t1);
    log_ts("controller: [TIMING] gp_camera_capture: %ldms\n",
            (t1.tv_sec - t0.tv_sec) * 1000 + (t1.tv_nsec - t0.tv_nsec) / 1000000);

    if (ret < GP_OK) {
        log_ts("controller: Capture failed: %s\n", gp_result_as_string(ret));
        return ret;  /* Return actual error - let caller handle it */
    }

    log_ts("controller: Capture complete: %s/%s\n", path.folder, path.name);

    /* Download the file returned by gp_camera_capture directly */
    download_file(camera, context, path.folder, path.name);
    clock_gettime(CLOCK_MONOTONIC, &t2);
    log_ts("controller: [TIMING] download_file: %ldms\n",
            (t2.tv_sec - t1.tv_sec) * 1000 + (t2.tv_nsec - t1.tv_nsec) / 1000000);

    /* NOTE: Skipping drain - polling loop picks up any additional files (RAW+JPEG) */

    return GP_OK;
}

/* Stream a single preview frame to the stream pipe (MJPEG format) */
static int stream_preview_frame(Camera *camera, GPContext *context) {
    CameraFile *file = NULL;
    const char *data = NULL;
    unsigned long size = 0;
    int ret;

    /* Check if paused */
    if (g_streaming_paused) {
        return GP_OK;  // Skip this frame
    }

    /* Lazy open stream pipe if not already open */
    if (g_stream_fd < 0 && g_streaming_active) {
        g_stream_fd = open(STREAM_PIPE, O_WRONLY | O_NONBLOCK);
        if (g_stream_fd < 0) {
            /* Pipe not ready yet (no reader), will retry next frame */
            return GP_OK;
        }
        log_ts("controller: Stream pipe opened for writing\n");

        /* Increase pipe buffer to 1MB for better throughput (default is 64KB) */
        #ifndef F_SETPIPE_SZ
        #define F_SETPIPE_SZ 1031  // Linux-specific fcntl command
        #endif
        int pipe_size = 1024 * 1024;  // 1MB
        if (fcntl(g_stream_fd, F_SETPIPE_SZ, pipe_size) < 0) {
            log_ts("controller: Warning - failed to set pipe buffer size: %s\n", strerror(errno));
        } else {
            log_ts("controller: Set stream pipe buffer to 1MB (was 64KB)\n");
        }
    }

    ret = gp_file_new(&file);
    if (ret < GP_OK) {
        log_ts("stream: Failed to create file: %s\n", gp_result_as_string(ret));
        return ret;
    }

    static int frame_count = 0;
    if (frame_count++ % 30 == 0) {
        log_ts("stream: Capturing preview frame #%d...\n", frame_count);
    }

    ret = gp_camera_capture_preview(camera, file, context);
    if (ret < GP_OK) {
        log_ts("stream: Failed to capture preview: %s\n", gp_result_as_string(ret));
        gp_file_free(file);
        return ret;
    }

    ret = gp_file_get_data_and_size(file, &data, &size);
    if (ret < GP_OK || !data || size == 0) {
        log_ts("stream: Failed to get file data: %s\n", gp_result_as_string(ret));
        gp_file_free(file);
        return ret;
    }

    /* Output frame with MJPEG boundary marker */
    if (g_stream_fd >= 0) {
        char header[256];
        int header_len = snprintf(header, sizeof(header),
                                 "--FRAME\r\nContent-Type: image/jpeg\r\nContent-Length: %lu\r\n\r\n", size);

        ssize_t written = write(g_stream_fd, header, header_len);
        if (written < 0) {
            /* Stream pipe closed or error - close and retry next frame */
            close(g_stream_fd);
            g_stream_fd = -1;
            gp_file_free(file);
            return GP_OK;
        }

        written = write(g_stream_fd, data, size);
        if (written < 0) {
            /* Stream pipe closed or error - close and retry next frame */
            close(g_stream_fd);
            g_stream_fd = -1;
            gp_file_free(file);
            return GP_OK;
        }
    }

    gp_file_free(file);
    return GP_OK;
}

/* Main controller loop */
int main(int argc, char *argv[]) {
    Camera *camera = NULL;
    GPContext *context = NULL;
    int cmd_fd = -1;
    int ret;
    ControllerMode mode = MODE_IDLE;
    int last_file_number = 0;
    int camera_index = 0;
    int live_view_active = 0;  // Flag to track live view state

    /* Parse optional camera index */
    if (argc >= 2) {
        camera_index = atoi(argv[1]);
    }

    install_signal_handlers();

    log_ts("controller: ===== gphoto2-controller v1.2 =====\n");

    /* Create status pipe */
    mkfifo(STATUS_PIPE, 0666);
    g_status_fd = open(STATUS_PIPE, O_WRONLY);  // Blocking mode - wait for reader
    if (g_status_fd < 0) {
        log_ts("controller: Warning - cannot open status pipe: %s\n", strerror(errno));
    } else {
        log_ts("controller: Status pipe opened for writing\n");
    }

    /* Create stream pipe (for continuous PTP streaming) */
    mkfifo(STREAM_PIPE, 0666);
    /* Don't open yet - will be opened non-blocking when streaming starts */

    /* Create command pipe early so the daemon knows we're alive */
    mkfifo(CMD_PIPE, 0666);
    cmd_fd = open(CMD_PIPE, O_RDWR | O_NONBLOCK);
    if (cmd_fd < 0) {
        log_ts("controller: Failed to open command pipe: %s\n", strerror(errno));
        return 1;
    }

    /*
     * Wait for camera at startup — retry indefinitely until found.
     * Then RELEASE it immediately so the camera is free.
     */
    context = create_context();
    log_ts("controller: Waiting for camera...\n");
    for (int attempt = 1; g_running; attempt++) {
        camera = open_camera(camera_index, &ret);
        if (camera) break;
        if (attempt % 10 == 0) {
            log_ts("controller: Still waiting for camera (%d attempts)...\n", attempt);
        }
        sleep(1);
    }
    if (!camera) {
        /* Only reaches here if g_running was set to 0 (signal received) */
        log_ts("controller: Shutdown requested while waiting for camera\n");
        if (cmd_fd >= 0) close(cmd_fd);
        if (g_status_fd >= 0) close(g_status_fd);
        gp_context_unref(context);
        unlink(CMD_PIPE);
        unlink(STATUS_PIPE);
        return 1;
    }

    /* Send camera_connected event with full camera info to daemon for caching */
    send_camera_connected_event(camera, context, 0);

    /* If gphoto2 returned an incomplete port (just "usb:" without bus/dev numbers),
     * detect the port from sysfs so disconnect detection works immediately
     * without needing a SWITCH_CAMERA command first. */
    if (g_last_camera_port[0] == '\0') {
        char detected_port[128];
        if (detect_camera_usb_port(detected_port, sizeof(detected_port))) {
            strncpy(g_last_camera_port, detected_port, sizeof(g_last_camera_port) - 1);
            g_last_camera_port[sizeof(g_last_camera_port) - 1] = '\0';
        } else {
            log_ts("controller: Warning - could not detect camera USB port from sysfs, disconnect detection may not work\n");
        }
    }

    /* Get initial file number before releasing */
    {
        char tmp[128];
        last_file_number = find_highest_file(camera, context, "/store_10000001", tmp, sizeof(tmp));
        if (last_file_number < 0) last_file_number = 0;
        log_ts("controller: Initial file number: %d\n", last_file_number);
    }

    log_ts("controller: Camera found, releasing until needed\n");
    gp_camera_exit(camera, context);
    gp_camera_free(camera);
    camera = NULL;

    log_ts("controller: Started, waiting for commands on %s\n", CMD_PIPE);

    /* Main loop — camera is NOT held open between commands */
    char cmd_buffer[256];
    ssize_t cmd_len;
    int consecutive_open_failures = 0;
    int switch_received = 0;  /* Only start polling after first SWITCH_CAMERA command */
    int needs_connected_event = 0;  /* Send camera_connected after first successful open */

    while (g_running) {
        /* Check for command (non-blocking read on persistent fd).
         * Multiple commands may arrive concatenated (e.g. "SWITCH_CAMERA 0\nCONFIG\n"),
         * so we split on newlines and process each one. */
        cmd_len = read(cmd_fd, cmd_buffer, sizeof(cmd_buffer) - 1);
        if (cmd_len > 0) {
            cmd_buffer[cmd_len] = '\0';
        }

        /* Process all commands in the buffer (split by newlines) */
        char *cmd_line = (cmd_len > 0) ? strtok(cmd_buffer, "\n") : NULL;
        while (cmd_line != NULL) {
            /* Skip empty lines */
            if (cmd_line[0] == '\0') {
                cmd_line = strtok(NULL, "\n");
                continue;
            }

            log_ts("controller: Got command: '%s'\n", cmd_line);

            if (strcmp(cmd_line, "CAPTURE") == 0) {
                struct timespec ts_start, ts_open, ts_capture, ts_exit, ts_end;
                clock_gettime(CLOCK_MONOTONIC, &ts_start);
                log_ts("controller: [TIMING] CAPTURE command received\n");

                // Save streaming state for graceful resume
                int was_streaming = g_streaming_active;
                int was_liveview = live_view_active && !g_streaming_active;

                // If streaming is active, close stream pipe to force HTTP client reconnect
                // This prevents stale connections during capture
                if (g_streaming_active) {
                    log_ts("controller: Closing stream pipe for capture (forcing client reconnect)...\n");
                    g_streaming_paused = 0;  // Clear pause flag
                    g_streaming_active = 0;  // Mark as inactive
                    g_streaming_was_active_before_polling_pause = 0;  /* Clear polling pause tracking */

                    // Close stream pipe - this will send EOF to HTTP clients
                    if (g_stream_fd >= 0) {
                        close(g_stream_fd);
                        g_stream_fd = -1;
                    }
                    // Brief sleep to let clients detect EOF and disconnect
                    usleep(100000);  // 100ms
                }

                // Close camera to exit liveview/streaming mode for capture
                // (libgphoto2 requires exiting liveview before capture)
                if (camera) {
                    log_ts("controller: Exiting live view mode for capture...\n");
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                    live_view_active = 0;
                }

                mode = MODE_CAPTURE;

                /* Open camera fresh for capture */
                int capture_attempts = 0;
                int was_disconnected = (consecutive_open_failures > 0);
                while (capture_attempts < MAX_OPEN_RETRIES && g_running) {
                    camera = open_camera(camera_index, &ret);
                    if (camera) {
                        break;
                    }
                    capture_attempts++;
                    log_ts("controller: Camera open failed for capture (attempt %d/%d): %s\n",
                            capture_attempts, MAX_OPEN_RETRIES, gp_result_as_string(ret));
                    if (capture_attempts < MAX_OPEN_RETRIES) {
                        usleep(OPEN_RETRY_DELAY_MS * 1000);
                    }
                }

                if (camera && was_disconnected) {
                    log_ts("controller: Camera reconnected during CAPTURE command - resetting state\n");
                    consecutive_open_failures = 0;
                    mode = MODE_CAPTURE;  /* Ensure mode is correct */
                    send_camera_connected_event(camera, context, g_cached_camera_index);
                } else if (camera) {
                    consecutive_open_failures = 0;
                }
                clock_gettime(CLOCK_MONOTONIC, &ts_open);
                log_ts("controller: [TIMING] open_camera: %ldms\n",
                        (ts_open.tv_sec - ts_start.tv_sec) * 1000 + (ts_open.tv_nsec - ts_start.tv_nsec) / 1000000);

                if (camera) {
                    int capture_ret = do_capture(camera, context);
                    clock_gettime(CLOCK_MONOTONIC, &ts_capture);
                    log_ts("controller: [TIMING] do_capture: %ldms\n",
                            (ts_capture.tv_sec - ts_open.tv_sec) * 1000 + (ts_capture.tv_nsec - ts_open.tv_nsec) / 1000000);

                    // Don't close camera yet if we need to resume streaming
                    if (!was_streaming) {
                        gp_camera_exit(camera, context);
                        clock_gettime(CLOCK_MONOTONIC, &ts_exit);
                        log_ts("controller: [TIMING] gp_camera_exit: %ldms\n",
                                (ts_exit.tv_sec - ts_capture.tv_sec) * 1000 + (ts_exit.tv_nsec - ts_capture.tv_nsec) / 1000000);

                        gp_camera_free(camera);
                        camera = NULL;
                    }

                    /* Send capture error to frontend if capture failed */
                    if (capture_ret < GP_OK && g_status_fd >= 0) {
                        char error_event[256];
                        snprintf(error_event, sizeof(error_event),
                                "{\"type\":\"capture_error\",\"error\":\"%s\"}\n",
                                gp_result_as_string(capture_ret));
                        ssize_t written = write(g_status_fd, error_event, strlen(error_event));
                        if (written < 0) {
                            log_ts("controller: Failed to write capture_error to status pipe: %s\n", strerror(errno));
                        }
                    }
                } else {
                    log_ts("controller: Failed to open camera for capture after %d attempts\n",
                            MAX_OPEN_RETRIES);
                    consecutive_open_failures++;

                    /* Send error event for camera open failure */
                    if (g_status_fd >= 0) {
                        const char *error_event = "{\"type\":\"capture_error\",\"error\":\"Failed to open camera\"}\n";
                        ssize_t written = write(g_status_fd, error_event, strlen(error_event));
                        if (written < 0) {
                            log_ts("controller: Failed to write capture_error to status pipe: %s\n", strerror(errno));
                        }
                    }
                }

                // Gracefully resume streaming if it was active
                if (was_streaming && camera) {
                    log_ts("controller: Resuming PTP stream after capture...\n");

                    // Stream pipe will be reopened lazily when first frame is written
                    // Ensure g_stream_fd is -1 so it knows to open
                    if (g_stream_fd >= 0) {
                        close(g_stream_fd);
                        g_stream_fd = -1;
                    }

                    // Re-enter liveview streaming mode
                    live_view_active = 1;
                    g_streaming_active = 1;
                    g_streaming_paused = 0;
                    mode = MODE_LIVEVIEW;
                    g_last_status_time = time(NULL);  // Initialize status timer

                    // Give HTTP clients time to detect EOF and reconnect
                    usleep(200000);  // 200ms

                    // Send status update so frontend knows streaming is active again
                    if (g_status_fd >= 0) {
                        const char *status_msg = "{\"mode\":\"liveview_streaming\"}\n";
                        ssize_t written = write(g_status_fd, status_msg, strlen(status_msg));
                        if (written < 0) {
                            log_ts("controller: Failed to write liveview_streaming status: %s\n", strerror(errno));
                        }
                    }
                    log_ts("controller: PTP stream resumed (pipe will open on first frame)\n");
                } else if (was_streaming && !camera) {
                    // Camera failed to open - stop streaming
                    log_ts("controller: Cannot resume streaming - camera failed to open\n");
                    g_streaming_active = 0;
                    g_streaming_paused = 0;
                    if (g_stream_fd >= 0) {
                        close(g_stream_fd);
                        g_stream_fd = -1;
                    }
                    mode = MODE_IDLE;
                } else {
                    mode = MODE_IDLE;
                }
                /* NOTE: Not sending mode-only message - polling loop sends full status */

                clock_gettime(CLOCK_MONOTONIC, &ts_end);
                log_ts("controller: [TIMING] CAPTURE total: %ldms\n",
                        (ts_end.tv_sec - ts_start.tv_sec) * 1000 + (ts_end.tv_nsec - ts_start.tv_nsec) / 1000000);

            } else if (strcmp(cmd_line, "STATUS") == 0) {
                /* Determine correct mode string - check streaming state first */
                const char *mode_str;
                if (g_streaming_active) {
                    mode_str = "liveview_streaming";
                } else if (mode == MODE_IDLE) {
                    mode_str = "idle";
                } else if (mode == MODE_CAPTURE) {
                    mode_str = "capture";
                } else {
                    mode_str = "liveview";
                }

                if (g_status_fd >= 0) {
                    char status[128];
                    snprintf(status, sizeof(status), "{\"mode\":\"%s\"}\n", mode_str);
                    ssize_t written = write(g_status_fd, status, strlen(status));
                    if (written < 0) {
                        log_ts("controller: Failed to write status to status pipe: %s\n", strerror(errno));
                    }
                }

            } else if (strcmp(cmd_line, "LIVEVIEW_START") == 0) {
                log_ts("controller: Starting live view...\n");

                // Open camera for live view
                int lv_attempts = 0;
                int was_disconnected = (consecutive_open_failures > 0);
                while (lv_attempts < MAX_OPEN_RETRIES && g_running) {
                    camera = open_camera(camera_index, &ret);
                    if (camera) {
                        break;
                    }
                    lv_attempts++;
                    log_ts("controller: Camera open failed for live view (attempt %d/%d): %s\n",
                            lv_attempts, MAX_OPEN_RETRIES, gp_result_as_string(ret));
                    if (lv_attempts < MAX_OPEN_RETRIES) {
                        usleep(OPEN_RETRY_DELAY_MS * 1000);
                    }
                }

                if (camera) {
                    if (was_disconnected) {
                        log_ts("controller: Camera reconnected during LIVEVIEW_START - resetting state\n");
                        send_camera_connected_event(camera, context, g_cached_camera_index);
                    }
                    consecutive_open_failures = 0;
                    mode = MODE_LIVEVIEW;
                    live_view_active = 1;
                    if (g_status_fd >= 0) {
                        ssize_t written = write(g_status_fd, "{\"mode\":\"liveview\"}\n", 21);
                        if (written < 0) {
                            log_ts("controller: Failed to write mode=liveview to status pipe: %s\n", strerror(errno));
                        }
                    }
                    log_ts("controller: Live view started (polling paused)\n");
                } else {
                    log_ts("controller: Failed to open camera for live view after %d attempts\n",
                            MAX_OPEN_RETRIES);
                    consecutive_open_failures++;
                }

            } else if (strcmp(cmd_line, "LIVEVIEW_STOP") == 0) {
                log_ts("controller: Stopping live view...\n");

                if (camera && live_view_active) {
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                }

                mode = MODE_IDLE;
                live_view_active = 0;
                if (g_status_fd >= 0) {
                    ssize_t written = write(g_status_fd, "{\"mode\":\"idle\"}\n", 17);
                    if (written < 0) {
                        log_ts("controller: Failed to write mode=idle to status pipe: %s\n", strerror(errno));
                    }
                }
                log_ts("controller: Live view stopped (polling resumed)\n");

            } else if (strcmp(cmd_line, "LIVEVIEW_FRAME") == 0) {
                if (camera && live_view_active && mode == MODE_LIVEVIEW) {
                    capture_preview_frame(camera, context);
                } else {
                    log_ts("controller: LIVEVIEW_FRAME ignored - not in live view mode\n");
                    if (g_status_fd >= 0) {
                        const char *err_msg = "{\"type\":\"error\",\"message\":\"Not in live view mode\"}\n";
                        ssize_t written = write(g_status_fd, err_msg, strlen(err_msg));
                        if (written < 0) {
                            log_ts("controller: Failed to write error to status pipe: %s\n", strerror(errno));
                        }
                    }
                }

            } else if (strcmp(cmd_line, "LIVEVIEW_STREAM_START") == 0) {
                log_ts("controller: Starting continuous PTP streaming...\n");

                /* Open camera if not already open */
                if (!camera) {
                    int lv_attempts = 0;
                    int was_disconnected = (consecutive_open_failures > 0);
                    while (lv_attempts < MAX_OPEN_RETRIES && g_running) {
                        camera = open_camera(camera_index, &ret);
                        if (camera) {
                            break;
                        }
                        lv_attempts++;
                        log_ts("controller: Camera open failed for streaming (attempt %d/%d): %s\n",
                                lv_attempts, MAX_OPEN_RETRIES, gp_result_as_string(ret));
                        if (lv_attempts < MAX_OPEN_RETRIES) {
                            usleep(OPEN_RETRY_DELAY_MS * 1000);
                        }
                    }

                    if (camera && was_disconnected) {
                        log_ts("controller: Camera reconnected during LIVEVIEW_STREAM_START - resetting state\n");
                        send_camera_connected_event(camera, context, g_cached_camera_index);
                    }
                }

                if (camera) {
                    consecutive_open_failures = 0;
                    mode = MODE_LIVEVIEW;
                    live_view_active = 1;
                    g_streaming_active = 1;
                    g_streaming_paused = 0;
                    g_last_status_time = time(NULL);  // Initialize status timer

                    /* Note: Stream pipe will be opened lazily when first frame is written
                     * This avoids timing issues with the reader connection */

                    if (g_status_fd >= 0) {
                        ssize_t written = write(g_status_fd, "{\"mode\":\"liveview_streaming\"}\n", 32);
                        if (written < 0) {
                            log_ts("controller: Failed to write mode=liveview_streaming: %s\n", strerror(errno));
                        }
                    }
                    log_ts("controller: Continuous PTP streaming started at %d FPS\n", STREAM_TARGET_FPS);
                } else {
                    log_ts("controller: Failed to open camera for streaming after %d attempts\n", MAX_OPEN_RETRIES);
                    consecutive_open_failures++;

                    if (g_status_fd >= 0) {
                        const char *err_msg = "{\"type\":\"error\",\"message\":\"Failed to open camera for streaming\"}\n";
                        ssize_t written = write(g_status_fd, err_msg, strlen(err_msg));
                        if (written < 0) {
                            log_ts("controller: Failed to write error: %s\n", strerror(errno));
                        }
                    }
                }

            } else if (strcmp(cmd_line, "LIVEVIEW_STREAM_STOP") == 0) {
                log_ts("controller: Stopping continuous PTP streaming...\n");

                g_streaming_active = 0;
                g_streaming_paused = 0;
                g_streaming_was_active_before_polling_pause = 0;  /* Clear the polling pause tracking flag */

                /* Close stream pipe */
                if (g_stream_fd >= 0) {
                    close(g_stream_fd);
                    g_stream_fd = -1;
                }

                /* Close camera */
                if (camera && live_view_active) {
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                }

                mode = MODE_IDLE;
                live_view_active = 0;

                if (g_status_fd >= 0) {
                    ssize_t written = write(g_status_fd, "{\"mode\":\"idle\"}\n", 17);
                    if (written < 0) {
                        log_ts("controller: Failed to write mode=idle: %s\n", strerror(errno));
                    }
                }
                log_ts("controller: Continuous PTP streaming stopped\n");

            } else if (strncmp(cmd_line, "SWITCH_CAMERA ", 14) == 0) {
                int new_index = atoi(cmd_line + 14);
                log_ts("controller: Switching to camera %d (was %d)\n", new_index, camera_index);
                switch_received = 1;
                needs_connected_event = 1;

                /* Close current camera if open */
                if (camera) {
                    if (live_view_active) {
                        log_ts("controller: Stopping live view for camera switch\n");
                        live_view_active = 0;
                    }
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                }

                /* Update camera index and reset state */
                camera_index = new_index;
                last_file_number = 0;
                consecutive_open_failures = 0;
                g_widgets_listed = 0;  /* Re-list widgets for new camera */
                mode = MODE_IDLE;
                g_last_camera_switch = time(NULL);  /* Set grace period timestamp */

                /* Invalidate detection cache - force re-detection for new camera */
                g_detection_valid = 0;
                g_current_brand = BRAND_UNKNOWN;
                g_last_logged_brand = BRAND_UNKNOWN;
                log_ts("controller: Invalidated detection cache for camera switch\n");

                /* Send confirmation */
                if (g_status_fd >= 0) {
                    char switch_msg[128];
                    snprintf(switch_msg, sizeof(switch_msg),
                            "{\"type\":\"camera_switched\",\"camera_index\":%d}\n", new_index);
                    ssize_t written = write(g_status_fd, switch_msg, strlen(switch_msg));
                    if (written < 0) {
                        log_ts("controller: Failed to write camera_switched: %s\n", strerror(errno));
                    }
                }

            } else if (strcmp(cmd_line, "DISCONNECT") == 0) {
                log_ts("controller: DISCONNECT command - stopping polling (camera stays detected)\n");
                switch_received = 0;

                /* Notify daemon */
                if (g_status_fd >= 0) {
                    const char *msg = "{\"type\":\"polling_stopped\"}\n";
                    write(g_status_fd, msg, strlen(msg));
                }

            } else if (strcmp(cmd_line, "PAUSE_POLLING") == 0) {
                log_ts("controller: PAUSE_POLLING command - pausing camera polling\n");
                switch_received = 0;

                /* If streaming is active, stop it to free the camera for physical button use */
                if (g_streaming_active) {
                    log_ts("controller: PAUSE_POLLING - stopping PTP stream to free camera for physical controls\n");
                    g_streaming_was_active_before_polling_pause = 1;
                    g_streaming_active = 0;
                    g_streaming_paused = 0;

                    /* Close stream pipe */
                    if (g_stream_fd >= 0) {
                        close(g_stream_fd);
                        g_stream_fd = -1;
                    }

                    /* Exit live view mode and release camera */
                    if (camera && live_view_active) {
                        gp_camera_exit(camera, context);
                        live_view_active = 0;
                        mode = MODE_IDLE;
                    }

                    /* Send idle status to indicate stream has stopped */
                    if (g_status_fd >= 0) {
                        const char *status_msg = "{\"mode\":\"idle\"}\n";
                        write(g_status_fd, status_msg, strlen(status_msg));
                    }
                } else {
                    g_streaming_was_active_before_polling_pause = 0;
                }

                /* Close camera if held open during idle polling */
                if (camera && mode == MODE_IDLE && !live_view_active && !g_streaming_active) {
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                }

                if (g_status_fd >= 0) {
                    const char *msg = "{\"type\":\"polling_paused\"}\n";
                    write(g_status_fd, msg, strlen(msg));
                }

            } else if (strcmp(cmd_line, "RESUME_POLLING") == 0) {
                log_ts("controller: RESUME_POLLING command - resuming camera polling\n");
                switch_received = 1;

                /* If streaming was active before pause, restart it */
                if (g_streaming_was_active_before_polling_pause) {
                    log_ts("controller: RESUME_POLLING - restarting PTP stream\n");
                    g_streaming_was_active_before_polling_pause = 0;

                    /* Open camera if needed */
                    if (!camera) {
                        int lv_attempts = 0;
                        while (!camera && lv_attempts < 3 && g_running) {
                            camera = open_camera(camera_index, &ret);
                            if (camera) {
                                consecutive_open_failures = 0;
                                log_ts("controller: RESUME_POLLING - camera opened for streaming\n");
                            } else {
                                lv_attempts++;
                                log_ts("controller: RESUME_POLLING - failed to open camera (attempt %d/3): %s\n",
                                       lv_attempts, gp_result_as_string(ret));
                                if (lv_attempts < 3) {
                                    usleep(OPEN_RETRY_DELAY_MS * 1000);
                                }
                            }
                        }
                    }

                    if (camera) {
                        /* Reset stream state */
                        mode = MODE_LIVEVIEW;
                        live_view_active = 1;
                        g_streaming_active = 1;
                        g_streaming_paused = 0;
                        g_last_status_time = time(NULL);

                        /* Close old stream pipe to force client reconnect */
                        if (g_stream_fd >= 0) {
                            close(g_stream_fd);
                            g_stream_fd = -1;
                        }

                        /* Give HTTP clients time to reconnect */
                        usleep(200000);  // 200ms

                        /* Send streaming status */
                        if (g_status_fd >= 0) {
                            const char *status_msg = "{\"mode\":\"liveview_streaming\"}\n";
                            write(g_status_fd, status_msg, strlen(status_msg));
                        }
                        log_ts("controller: RESUME_POLLING - PTP stream restarted\n");
                    } else {
                        log_ts("controller: RESUME_POLLING - failed to restart streaming, camera unavailable\n");
                    }
                }

                if (g_status_fd >= 0) {
                    const char *msg = "{\"type\":\"polling_resumed\"}\n";
                    write(g_status_fd, msg, strlen(msg));
                }

            } else if (strcmp(cmd_line, "CONFIG") == 0) {
                struct timespec cfg_start, cfg_end;
                clock_gettime(CLOCK_MONOTONIC, &cfg_start);
                log_ts("controller: CONFIG command received (camera=%p, live_view=%d, streaming=%d)\n",
                        (void*)camera, live_view_active, g_streaming_active);

                // Pause streaming if active
                if (g_streaming_active) {
                    log_ts("controller: Pausing PTP stream for config read...\n");
                    g_streaming_paused = 1;
                    usleep(50000);  // 50ms delay to let current frame finish
                }

                int we_opened = 0;

                /* Use existing camera if live view is active, otherwise open one */
                if (!camera) {
                    log_ts("controller: CONFIG: Opening camera...\n");
                    camera = open_camera(camera_index, &ret);
                    if (camera) {
                        we_opened = 1;
                        consecutive_open_failures = 0;
                        log_ts("controller: CONFIG: Camera opened successfully\n");
                    } else {
                        log_ts("controller: CONFIG: Failed to open camera: %s\n", gp_result_as_string(ret));
                        FILE *f = fopen(CONFIG_RESPONSE_FILE ".tmp", "w");
                        if (f) {
                            fprintf(f, "{\"error\":\"Failed to open camera: %s\"}\n", gp_result_as_string(ret));
                            fclose(f);
                            rename(CONFIG_RESPONSE_FILE ".tmp", CONFIG_RESPONSE_FILE);
                            log_ts("controller: CONFIG: Wrote error response file\n");
                        } else {
                            log_ts("controller: CONFIG: FAILED to open response file: %s\n", strerror(errno));
                        }
                    }
                } else {
                    log_ts("controller: CONFIG: Reusing existing camera handle\n");
                }

                if (camera) {
                    log_ts("controller: CONFIG: Fetching config...\n");
                    int cfg_ret = write_full_config_json(camera, context);
                    log_ts("controller: CONFIG: write_full_config_json returned %d\n", cfg_ret);
                }

                /* Release camera if we opened it (don't close liveview's camera) */
                if (we_opened && camera) {
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                    log_ts("controller: CONFIG: Camera released\n");
                }

                // Resume streaming if it was paused
                if (g_streaming_active && g_streaming_paused) {
                    log_ts("controller: Resuming PTP stream after config read\n");
                    g_streaming_paused = 0;
                }

                clock_gettime(CLOCK_MONOTONIC, &cfg_end);
                log_ts("controller: CONFIG: Total time %ldms\n",
                        (cfg_end.tv_sec - cfg_start.tv_sec) * 1000 +
                        (cfg_end.tv_nsec - cfg_start.tv_nsec) / 1000000);

            } else if (strncmp(cmd_line, "SETCONFIG ", 10) == 0) {
                const char *json_input = cmd_line + 10;
                log_ts("controller: SETCONFIG command received: %s\n", json_input);

                // Pause streaming if active
                if (g_streaming_active) {
                    log_ts("controller: Pausing PTP stream for config write...\n");
                    g_streaming_paused = 1;
                    usleep(50000);  // 50ms delay
                }

                int we_opened = 0;

                if (!camera) {
                    camera = open_camera(camera_index, &ret);
                    if (camera) {
                        we_opened = 1;
                        consecutive_open_failures = 0;
                    } else {
                        log_ts("controller: Failed to open camera for SETCONFIG: %s\n", gp_result_as_string(ret));
                        FILE *f = fopen(CONFIG_RESPONSE_FILE ".tmp", "w");
                        if (f) {
                            fprintf(f, "{\"error\":\"Failed to open camera: %s\"}\n", gp_result_as_string(ret));
                            fclose(f);
                            rename(CONFIG_RESPONSE_FILE ".tmp", CONFIG_RESPONSE_FILE);
                        }
                    }
                }

                if (camera) {
                    set_config_and_write_response(camera, context, json_input);
                }

                if (we_opened && camera) {
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                }

                // Resume streaming if it was paused
                if (g_streaming_active && g_streaming_paused) {
                    log_ts("controller: Resuming PTP stream after config write\n");
                    g_streaming_paused = 0;
                }

            } else if (strcmp(cmd_line, "QUIT") == 0) {
                log_ts("controller: Quit command received\n");
                g_running = 0;
            }

            /* Next command in buffer (if multiple were concatenated) */
            cmd_line = strtok(NULL, "\n");
        }

        /*
         * When idle, briefly grab the camera to check for new files
         * (from physical shutter), then release it immediately.
         * Camera is only locked for the duration of the check.
         *
         * When in live view mode OR streaming, skip polling entirely:
         * - Live view: camera stays open for preview
         * - Streaming: camera is locked and held open for continuous frames
         * - User can't change settings during streaming anyway, so polling is useless
         *
         * For polling, use minimal retries (2) with short delay - fail fast to detect disconnect.
         * Each attempt has a strict timeout to prevent hanging on unresponsive cameras.
         */
        if (mode == MODE_IDLE && !live_view_active && !g_streaming_active && switch_received) {
            struct timespec cycle_start, camera_open_end, camera_close_start, camera_close_end;
            clock_gettime(CLOCK_MONOTONIC, &cycle_start);

            #define POLL_RETRIES 2
            int poll_attempts = 0;
            int was_disconnected = (consecutive_open_failures > 0);  /* Track disconnect state BEFORE reset */
            while (poll_attempts < POLL_RETRIES && g_running) {
                /* Use timeout version for polling - fail fast on unresponsive cameras */
                camera = open_camera_with_timeout(camera_index, &ret, CAMERA_OPEN_TIMEOUT_SEC);
                if (camera) {
                    break;
                }
                poll_attempts++;
                log_ts("controller: Camera open failed for polling (attempt %d/%d): %s\n",
                        poll_attempts, POLL_RETRIES, gp_result_as_string(ret));

                if (poll_attempts < POLL_RETRIES) {
                    usleep(500000);  /* 500ms before retry */
                }
            }

            if (camera) {
                consecutive_open_failures = 0;  /* Reset counter on success */

                /* Complete state machine reset when reconnecting after disconnect */
                if (was_disconnected) {
                    log_ts("controller: ============================================\n");
                    log_ts("controller: Camera RECONNECTED - resetting state machine\n");
                    log_ts("controller: ============================================\n");

                    /* Reset all mode and streaming state */
                    mode = MODE_IDLE;
                    live_view_active = 0;
                    g_streaming_active = 0;
                    g_streaming_paused = 0;
                    g_streaming_was_active_before_polling_pause = 0;  /* Clear polling pause tracking */

                    /* Reset file tracking */
                    last_file_number = 0;

                    /* Reset UI/debug state */
                    g_widgets_listed = 0;

                    /* Clear grace period */
                    g_last_camera_switch = 0;

                    /* Send camera_connected event with fresh camera info */
                    send_camera_connected_event(camera, context, camera_index);
                } else if (needs_connected_event) {
                    /* First successful open after SWITCH_CAMERA - broadcast camera info */
                    send_camera_connected_event(camera, context, camera_index);
                    needs_connected_event = 0;
                }

                clock_gettime(CLOCK_MONOTONIC, &camera_open_end);
                long camera_open_ms = (camera_open_end.tv_sec - cycle_start.tv_sec) * 1000 +
                                     (camera_open_end.tv_nsec - cycle_start.tv_nsec) / 1000000;

                /* List all available widgets once (for debugging widget names) */
                /* Commented out - debug only, causes extra gp_camera_get_config USB round-trip
                if (!g_widgets_listed) {
                    list_all_widgets(camera, context);
                    g_widgets_listed = 1;
                }
                */

                // Periodically reset old failed file entries (allows retry after timeout)
                reset_old_failed_files();

                struct timespec poll_start, poll_end;
                clock_gettime(CLOCK_MONOTONIC, &poll_start);

                int new_num = check_and_download_all_files(camera, context);
                if (new_num > last_file_number) {
                    last_file_number = new_num;
                }

                struct timespec files_check_end;
                clock_gettime(CLOCK_MONOTONIC, &files_check_end);
                long files_check_ms = (files_check_end.tv_sec - poll_start.tv_sec) * 1000 +
                                     (files_check_end.tv_nsec - poll_start.tv_nsec) / 1000000;

                // Fetch status using brand-specific widget names
                const BrandWidgets *widgets = get_widgets_for_brand(g_current_brand);

                char *battery = get_single_config_value(camera, context, widgets->battery);
                char *iso = get_single_config_value(camera, context, widgets->iso);
                char *aperture = get_single_config_value(camera, context, widgets->aperture);
                char *shutter = get_single_config_value(camera, context, widgets->shutter);
                char *ev = get_single_config_value(camera, context, widgets->ev);
                char *wb = get_single_config_value(camera, context, widgets->wb);
                char *shootingmode = get_single_config_value(camera, context, widgets->mode);

                // Fallback: if primary mode widget fails, try alternatives
                if (!shootingmode && g_current_brand != BRAND_FUJI) {
                    shootingmode = get_single_config_value(camera, context, "expprogram");
                }
                if (!shootingmode) {
                    shootingmode = get_single_config_value(camera, context, "exposureprogram");
                }
                if (!shootingmode) {
                    shootingmode = get_single_config_value(camera, context, "exposuremode");
                }

                /* Canon: map raw PTP values to human-readable strings (safety net) */
                const char *iso_display = iso;
                if (g_current_brand == BRAND_CANON && iso) {
                    iso_display = map_canon_iso_value(iso);
                }

                log_ts("controller: [STATUS] brand=%d | mode=%s | bat=%s | iso=%s (display=%s) | apt=%s | ss=%s | ev=%s | wb=%s\n",
                        g_current_brand,
                        shootingmode ? shootingmode : "N/A",
                        battery ? battery : "N/A",
                        iso ? iso : "N/A",
                        iso_display ? iso_display : "N/A",
                        aperture ? aperture : "N/A",
                        shutter ? shutter : "N/A",
                        ev ? ev : "N/A",
                        wb ? wb : "N/A");

                if (g_status_fd >= 0) {
                    /* Determine correct mode string - check streaming state first */
                    const char *current_mode_str;
                    if (g_streaming_active) {
                        current_mode_str = "liveview_streaming";
                    } else if (mode == MODE_IDLE) {
                        current_mode_str = "idle";
                    } else if (mode == MODE_CAPTURE) {
                        current_mode_str = "capture";
                    } else {
                        current_mode_str = "liveview";
                    }

                    char status_msg[1536];
                    snprintf(status_msg, sizeof(status_msg),
                            "{\"mode\":\"%s\",\"shootingmode\":\"%s\",\"battery\":\"%s\",\"iso\":\"%s\",\"aperture\":\"%s\",\"shutter\":\"%s\",\"ev\":\"%s\",\"wb\":\"%s\"}\n",
                            current_mode_str,
                            shootingmode ? shootingmode : "",
                            battery ? battery : "",
                            iso_display ? iso_display : "",
                            aperture ? aperture : "",
                            shutter ? shutter : "",
                            ev ? ev : "",
                            wb ? wb : "");
                    ssize_t written = write(g_status_fd, status_msg, strlen(status_msg));
                    if (written < 0) {
                        log_ts("controller: Failed to write status: %s\n", strerror(errno));
                    }
                }

                clock_gettime(CLOCK_MONOTONIC, &poll_end);
                long config_fetch_ms = (poll_end.tv_sec - files_check_end.tv_sec) * 1000 +
                                       (poll_end.tv_nsec - files_check_end.tv_nsec) / 1000000;
                long ops_total_ms = (poll_end.tv_sec - poll_start.tv_sec) * 1000 +
                                    (poll_end.tv_nsec - poll_start.tv_nsec) / 1000000;

                if (battery) free(battery);
                if (iso) free(iso);
                if (aperture) free(aperture);
                if (shutter) free(shutter);
                if (ev) free(ev);
                if (wb) free(wb);
                if (shootingmode) free(shootingmode);

                clock_gettime(CLOCK_MONOTONIC, &camera_close_start);
                gp_camera_exit(camera, context);
                gp_camera_free(camera);
                camera = NULL;
                clock_gettime(CLOCK_MONOTONIC, &camera_close_end);

                long camera_close_ms = (camera_close_end.tv_sec - camera_close_start.tv_sec) * 1000 +
                                      (camera_close_end.tv_nsec - camera_close_start.tv_nsec) / 1000000;
                long cycle_total_ms = (camera_close_end.tv_sec - cycle_start.tv_sec) * 1000 +
                                     (camera_close_end.tv_nsec - cycle_start.tv_nsec) / 1000000;

                log_ts("controller: [CYCLE TIMING] Open: %ldms | Files: %ldms | Config: %ldms | Ops: %ldms | Close: %ldms | CYCLE TOTAL: %ldms\n",
                        camera_open_ms, files_check_ms, config_fetch_ms, ops_total_ms, camera_close_ms, cycle_total_ms);
            } else {
                consecutive_open_failures++;
                log_ts("controller: Camera disconnected (consecutive failures: %d)\n",
                        consecutive_open_failures);

                /* Invalidate detection cache on disconnect to force fresh detection on reconnect
                 * This is critical because USB may reassign the camera to a different port */
                if (consecutive_open_failures == 1) {
                    log_ts("controller: Camera disconnect detected, invalidating detection cache and port\n");
                    g_detection_valid = 0;
                    g_last_camera_port[0] = '\0';  /* Clear old port to avoid resetting wrong device */
                    g_cached_camera_index = -1;
                }

                /* Try USB reset early to recover from bad PTP state (only if we have a valid port) */
                if (consecutive_open_failures == 3 && g_last_camera_port[0] != '\0') {
                    log_ts("controller: 3 consecutive failures detected, attempting USB reset...\n");
                    if (reset_usb_device(g_last_camera_port) == 0) {
                        log_ts("controller: USB reset successful, will retry camera connection\n");
                        /* Reset counter to give it a fresh chance after USB reset */
                        consecutive_open_failures = 0;
                    } else {
                        log_ts("controller: USB reset failed, will continue with backoff strategy\n");
                    }
                }

                /* Only send disconnected status if we're outside the grace period after a camera switch */
                time_t now = time(NULL);
                if (now - g_last_camera_switch >= CAMERA_SWITCH_GRACE_SEC) {
                    /* Send disconnected status to frontend */
                    if (g_status_fd >= 0) {
                        const char *disconnected_msg = "{\"type\":\"camera_disconnected\"}\n";
                        ssize_t written = write(g_status_fd, disconnected_msg, strlen(disconnected_msg));
                        if (written < 0) {
                            log_ts("controller: Failed to write disconnected status: %s\n", strerror(errno));
                        }
                    }
                } else {
                    log_ts("controller: In grace period after camera switch (%ld sec remaining), suppressing disconnect\n",
                            (long)(CAMERA_SWITCH_GRACE_SEC - (now - g_last_camera_switch)));
                }
            }
        }

        /* Continuous PTP streaming loop - stream frames when active and not paused */
        if (g_streaming_active && camera && !g_streaming_paused) {
            static int debug_count = 0;
            static int consecutive_stream_failures = 0;
            if (debug_count++ % 30 == 0) {
                log_ts("DEBUG: Streaming loop running (active=%d, camera=%p, paused=%d)\n",
                       g_streaming_active, (void*)camera, g_streaming_paused);
            }

            // Check if we need to send periodic status update (battery, etc) every 60 seconds
            time_t now = time(NULL);
            if (now - g_last_status_time >= 5) {
                log_ts("controller: Sending periodic status update during streaming\n");

                // Fetch status using brand-specific widget names
                const BrandWidgets *widgets = get_widgets_for_brand(g_current_brand);

                char *battery = get_single_config_value(camera, context, widgets->battery);
                char *iso = get_single_config_value(camera, context, widgets->iso);
                char *aperture = get_single_config_value(camera, context, widgets->aperture);
                char *shutter = get_single_config_value(camera, context, widgets->shutter);
                char *ev = get_single_config_value(camera, context, widgets->ev);
                char *wb = get_single_config_value(camera, context, widgets->wb);
                char *shootingmode = get_single_config_value(camera, context, widgets->mode);

                // Fallback for shooting mode
                if (!shootingmode && g_current_brand != BRAND_FUJI) {
                    shootingmode = get_single_config_value(camera, context, "expprogram");
                }
                if (!shootingmode) {
                    shootingmode = get_single_config_value(camera, context, "exposureprogram");
                }
                if (!shootingmode) {
                    shootingmode = get_single_config_value(camera, context, "exposuremode");
                }

                /* Canon: map raw PTP values to human-readable strings (safety net) */
                const char *iso_display = iso;
                if (g_current_brand == BRAND_CANON && iso) {
                    iso_display = map_canon_iso_value(iso);
                }

                // Send status to frontend
                if (g_status_fd >= 0) {
                    char status_msg[1536];
                    snprintf(status_msg, sizeof(status_msg),
                            "{\"mode\":\"liveview_streaming\",\"shootingmode\":\"%s\",\"battery\":\"%s\",\"iso\":\"%s\",\"aperture\":\"%s\",\"shutter\":\"%s\",\"ev\":\"%s\",\"wb\":\"%s\"}\n",
                            shootingmode ? shootingmode : "",
                            battery ? battery : "",
                            iso_display ? iso_display : "",
                            aperture ? aperture : "",
                            shutter ? shutter : "",
                            ev ? ev : "",
                            wb ? wb : "");
                    ssize_t written = write(g_status_fd, status_msg, strlen(status_msg));
                    if (written < 0) {
                        log_ts("controller: Failed to write status: %s\n", strerror(errno));
                    }
                }

                // Free allocated strings
                if (battery) free(battery);
                if (iso) free(iso);
                if (aperture) free(aperture);
                if (shutter) free(shutter);
                if (ev) free(ev);
                if (wb) free(wb);
                if (shootingmode) free(shootingmode);

                g_last_status_time = now;
            }

            struct timespec frame_start, frame_end;
            clock_gettime(CLOCK_MONOTONIC, &frame_start);

            int stream_ret = stream_preview_frame(camera, context);
            if (stream_ret < GP_OK) {
                consecutive_stream_failures++;
                log_ts("controller: Stream frame failed (%d consecutive): %s\n",
                       consecutive_stream_failures, gp_result_as_string(stream_ret));

                if (consecutive_stream_failures >= 5) {
                    log_ts("controller: Too many consecutive stream failures (%d), camera likely disconnected\n",
                           consecutive_stream_failures);

                    /* Stop streaming */
                    g_streaming_active = 0;
                    g_streaming_paused = 0;
                    g_streaming_was_active_before_polling_pause = 0;  /* Clear polling pause tracking */
                    if (g_stream_fd >= 0) {
                        close(g_stream_fd);
                        g_stream_fd = -1;
                    }

                    /* Release camera so polling loop can re-detect */
                    gp_camera_exit(camera, context);
                    gp_camera_unref(camera);
                    camera = NULL;
                    live_view_active = 0;

                    /* Invalidate detection cache so polling re-scans */
                    g_detection_valid = 0;
                    g_last_camera_port[0] = '\0';
                    consecutive_open_failures = 1;  /* Seed failure counter so polling knows we lost connection */

                    /* Send disconnect event to frontend */
                    if (g_status_fd >= 0) {
                        const char *msg = "{\"type\":\"camera_disconnected\",\"reason\":\"stream_failure\"}\n";
                        ssize_t written = write(g_status_fd, msg, strlen(msg));
                        if (written < 0) {
                            log_ts("controller: Failed to write disconnect status: %s\n", strerror(errno));
                        }
                    }

                    consecutive_stream_failures = 0;
                    log_ts("controller: Streaming stopped, returning to polling mode\n");
                    continue;  /* Skip to next main loop iteration (will enter polling path) */
                }

                /* Brief delay before retry to avoid tight error loop */
                usleep(200000);  /* 200ms */
                continue;
            } else {
                consecutive_stream_failures = 0;  /* Reset on successful frame */
            }

            /* Frame rate limiting - maintain target FPS */
            clock_gettime(CLOCK_MONOTONIC, &frame_end);
            long frame_duration_ms = (frame_end.tv_sec - frame_start.tv_sec) * 1000 +
                                    (frame_end.tv_nsec - frame_start.tv_nsec) / 1000000;

            long target_frame_time_ms = 1000 / STREAM_TARGET_FPS;
            long sleep_ms = target_frame_time_ms - frame_duration_ms;

            /* Use poll on command pipe with calculated timeout to maintain FPS */
            if (sleep_ms > 0) {
                struct pollfd pfd = { .fd = cmd_fd, .events = POLLIN };
                poll(&pfd, 1, sleep_ms);
            } else {
                /* Frame took longer than target - check commands immediately */
                struct pollfd pfd = { .fd = cmd_fd, .events = POLLIN };
                poll(&pfd, 1, 0);
            }
        } else {
            /* Skip polling when streaming or liveview is active - camera is already locked */
            if (g_streaming_active || live_view_active) {
                // Camera is held open for streaming/liveview - no polling needed
                // Physical shutter button won't work during streaming (camera is locked)
                if (g_streaming_active) {
                    // Use shorter delay during streaming to keep command pipe responsive
                    struct pollfd pfd = { .fd = cmd_fd, .events = POLLIN };
                    poll(&pfd, 1, 100);  // 100ms - check commands frequently
                } else {
                    // Liveview mode - also skip polling
                    struct pollfd pfd = { .fd = cmd_fd, .events = POLLIN };
                    poll(&pfd, 1, 500);  // 500ms
                }
            } else {
                /* Not streaming - poll at fixed interval or idle wait.
                 * Uses poll() on the command pipe so CONFIG/SETCONFIG are responsive. */
                int poll_timeout_ms = 1500;

                /* Lightweight USB presence check when polling is paused.
                 * No gphoto2 calls — just checks if the USB device still exists in sysfs. */
                if (!switch_received && g_last_camera_port[0] != '\0') {
                    /* Have a known port — check if camera is still physically present */
                    if (!check_usb_device_present(g_last_camera_port)) {
                        log_ts("controller: USB device gone (port %s) - camera unplugged while polling paused\n",
                                g_last_camera_port);
                        g_last_camera_port[0] = '\0';
                        g_detection_valid = 0;
                        g_current_brand = BRAND_UNKNOWN;
                        g_last_logged_brand = BRAND_UNKNOWN;
                        consecutive_open_failures = 1;

                        if (g_status_fd >= 0) {
                            const char *msg = "{\"type\":\"camera_disconnected\",\"reason\":\"usb_unplugged\"}\n";
                            write(g_status_fd, msg, strlen(msg));
                        }
                    }
                } else if (!switch_received && g_last_camera_port[0] == '\0') {
                    /* No known port (after disconnect or startup without port detection).
                     * Scan sysfs for a camera device — if one appears, try to reconnect. */
                    char detected_port[128];
                    if (detect_camera_usb_port(detected_port, sizeof(detected_port))) {
                        log_ts("controller: Camera USB device detected at %s - attempting reconnection\n", detected_port);

                        /* Invalidate cache so open_camera does fresh detection */
                        g_detection_valid = 0;
                        g_cached_camera_index = -1;

                        Camera *reconnect_cam = open_camera(camera_index, &ret);
                        if (reconnect_cam) {
                            log_ts("controller: ============================================\n");
                            log_ts("controller: Camera RECONNECTED via USB scan\n");
                            log_ts("controller: ============================================\n");

                            /* Save the port */
                            strncpy(g_last_camera_port, detected_port, sizeof(g_last_camera_port) - 1);
                            g_last_camera_port[sizeof(g_last_camera_port) - 1] = '\0';

                            /* Reset state */
                            consecutive_open_failures = 0;
                            last_file_number = 0;
                            g_widgets_listed = 0;
                            g_last_camera_switch = 0;

                            /* Send camera_connected event */
                            send_camera_connected_event(reconnect_cam, context, camera_index);

                            /* Release camera until SWITCH_CAMERA activates polling */
                            gp_camera_exit(reconnect_cam, context);
                            gp_camera_free(reconnect_cam);
                            reconnect_cam = NULL;
                        } else {
                            log_ts("controller: USB device found but gphoto2 open failed: %s\n",
                                    gp_result_as_string(ret));
                        }
                    }
                }

                struct pollfd pfd = { .fd = cmd_fd, .events = POLLIN };
                poll(&pfd, 1, poll_timeout_ms);
            }
        }
    }

    /* Cleanup */
    log_ts("controller: Shutting down...\n");
    if (camera) {
        if (live_view_active) {
            log_ts("controller: Exiting live view for shutdown...\n");
        }
        gp_camera_exit(camera, context);
        gp_camera_free(camera);
    }

    /* Free cached detection lists */
    if (g_cached_abilities_list) {
        gp_abilities_list_free(g_cached_abilities_list);
    }
    if (g_cached_port_info_list) {
        gp_port_info_list_free(g_cached_port_info_list);
    }

    gp_context_unref(context);
    if (cmd_fd >= 0) close(cmd_fd);
    if (g_status_fd >= 0) close(g_status_fd);
    if (g_stream_fd >= 0) close(g_stream_fd);
    unlink(CMD_PIPE);
    unlink(STATUS_PIPE);
    unlink(STREAM_PIPE);

    return 0;
}
