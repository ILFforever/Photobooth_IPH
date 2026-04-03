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
#include "common/camera-brand.h"

/* Module headers - extracted functions */
#include "controller/camera_open.h"
#include "controller/camera_storage.h"
#include "controller/camera_capture.h"
#include "controller/camera_preview.h"
#include "controller/camera_config.h"
#include "controller/camera_filemgmt.h"

/* Pipe and configuration paths */
#define CMD_PIPE "/tmp/camera_cmd"
#define STATUS_PIPE "/tmp/camera_status"
#define STREAM_PIPE "/tmp/camera_stream"
#define CONFIG_RESPONSE_FILE "/tmp/camera_config_response"
#define MAX_FILES 100
#define POLL_INTERVAL_MS 1000
#define MAX_OPEN_RETRIES 5
#define OPEN_RETRY_DELAY_MS 2000
#define CAMERA_OPEN_TIMEOUT_SEC 10
#define CAMERA_SWITCH_GRACE_SEC 5
#define STREAM_TARGET_FPS 25

/* Controller modes */
typedef enum {
    MODE_IDLE,
    MODE_CAPTURE,
    MODE_LIVEVIEW
} ControllerMode;

/* ============================================================================
 * GLOBAL VARIABLES - referenced by modules via extern declarations
 * ============================================================================ */

/* Running state and file descriptors */
volatile sig_atomic_t g_running = 1;
int g_status_fd = -1;  /* Status pipe file descriptor - used by preview module */
int g_stream_fd = -1;  /* Stream pipe file descriptor - used by preview module */
int g_widgets_listed = 0;
time_t g_last_camera_switch = 0;

/* Camera detection cache - accessed by camera_open module */
GPPortInfoList *g_cached_port_info_list = NULL;
CameraAbilitiesList *g_cached_abilities_list = NULL;
int g_cached_camera_index = -1;
int g_detection_valid = 0;
char g_last_camera_port[128] = "";

/* Camera brand state - accessed by camera_open module */
CameraBrand g_current_brand = BRAND_UNKNOWN;
CameraBrand g_last_logged_brand = BRAND_UNKNOWN;

/* Streaming state tracking - accessed by camera_preview module */
volatile sig_atomic_t g_streaming_active = 0;
volatile sig_atomic_t g_streaming_paused = 0;
volatile sig_atomic_t g_streaming_was_active_before_polling_pause = 0;
time_t g_last_status_time = 0;

/* ============================================================================
 * TIMESTAMPED LOGGING - used by all modules
 * ============================================================================ */

void log_timestamped(const char *format, ...) {
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

/* ============================================================================
 * USB RESET FUNCTIONS - controller-specific
 * ============================================================================ */

/* Reset USB device by port (e.g., "usb:003,005") via ioctl.
 * Returns 0 on success, -1 on failure. */
static int reset_usb_device(const char *port_name) {
    if (!port_name || strncmp(port_name, "usb:", 4) != 0) {
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
    sleep(2);

    return 0;
}

/* ============================================================================
 * USB DETECTION FUNCTIONS - controller-specific
 * ============================================================================ */

/* Convert USB speed to human-readable version string */
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

/* Detect USB version from port string */
static const char *detect_usb_version(const char *port) {
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
        int got_speed = (fscanf(f, "%f", &speed) == 1);
        fclose(f);
        if (!got_speed) continue;

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
                fprintf(stderr, "controller: USB detected device='%s' speed=%.0f -> %s\n",
                        entry->d_name, speed, usb_buf);
                break;
            }
            continue;
        }

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

/* Detect camera USB port by scanning sysfs */
static int detect_camera_usb_port(char *port_out, size_t port_out_size) {
    DIR *dir = opendir("/sys/bus/usb/devices");
    if (!dir) return 0;

    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        if (entry->d_name[0] == '.') continue;
        if (strncmp(entry->d_name, "usb", 3) == 0) continue;

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

/* ============================================================================
 * SIGNAL HANDLING
 * ============================================================================ */

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
    signal(SIGPIPE, SIG_IGN);
}

/* ============================================================================
 * CAMERA CONNECTION EVENTS
 * ============================================================================ */

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

/* Send camera_connected event to daemon for caching */
static void send_camera_connected_event(Camera *camera, GPContext *context, int camera_index) {
    if (g_status_fd < 0 || !camera) return;

    send_camera_connecting_event(camera_index);

    CameraText summary;
    char manufacturer[128] = "";
    char model[128] = "";
    char port[64] = "";
    int ret;

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

    if (g_last_camera_port[0] != '\0') {
        snprintf(port, sizeof(port), "%s", g_last_camera_port);
    } else {
        GPPortInfo port_info;
        ret = gp_camera_get_port_info(camera, &port_info);
        if (ret >= GP_OK) {
            char *port_path = NULL;
            gp_port_info_get_path(port_info, &port_path);
            if (port_path) {
                snprintf(port, sizeof(port), "%s", port_path);
            }
        }
        if (strcmp(port, "usb:") == 0 || strcmp(port, "") == 0) {
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

        const BrandWidgets *widgets = get_widgets_for_brand(g_current_brand);
        char *serial = get_single_config_value(camera, context, widgets->serial);
        char *deviceversion = get_single_config_value(camera, context, widgets->deviceversion);
        char *lens = widgets->lens ? get_single_config_value(camera, context, widgets->lens) : NULL;

        char event[1024];
        snprintf(event, sizeof(event),
                "{\"type\":\"camera_connected\",\"camera_id\":\"%d\",\"manufacturer\":\"%s\",\"model\":\"%s\",\"port\":\"%s\",\"usb_version\":\"%s\",\"serial_number\":\"%s\",\"firmware\":\"%s\",\"lens\":\"%s\"}\n",
                camera_index, manufacturer, model, port, usb_version,
                serial ? serial : "",
                deviceversion ? deviceversion : "",
                lens ? lens : "");
        ssize_t written = write(g_status_fd, event, strlen(event));
        if (written > 0) {
            log_ts("controller: Sent camera_connected event: %s %s at %s (USB: %s, Serial: %s, FW: %s, Lens: %s)\n",
                    manufacturer, model, port, usb_version,
                    serial ? serial : "N/A",
                    deviceversion ? deviceversion : "N/A",
                    lens ? lens : "N/A");
        }

        if (serial) free(serial);
        if (deviceversion) free(deviceversion);
        if (lens) free(lens);
    }
}

/* ============================================================================
 * JSON HELPER FUNCTIONS - for config commands
 * ============================================================================ */

/*
 * Extract a value from JSON string by key
 */
static char *extract_json_value(const char *json, const char *key) {
    char search[128];
    snprintf(search, sizeof(search), "\"%s\":\"", key);

    const char *start = strstr(json, search);
    if (!start) return NULL;

    start += strlen(search);

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

/* ============================================================================
 * MAIN CONTROLLER LOOP
 * ============================================================================ */

int main(int argc, char *argv[]) {
    Camera *camera = NULL;
    GPContext *context = NULL;
    int cmd_fd = -1;
    int ret;
    ControllerMode mode = MODE_IDLE;
    int last_file_number = 0;
    int camera_index = 0;
    int live_view_active = 0;

    if (argc >= 2) {
        camera_index = atoi(argv[1]);
    }

    install_signal_handlers();

    log_ts("controller: ===== gphoto2-controller v1.3 (refactored) =====\n");

    /* Create status pipe */
    mkfifo(STATUS_PIPE, 0666);
    g_status_fd = open(STATUS_PIPE, O_WRONLY);
    if (g_status_fd < 0) {
        log_ts("controller: Warning - cannot open status pipe: %s\n", strerror(errno));
    } else {
        log_ts("controller: Status pipe opened for writing\n");
    }

    /* Create stream pipe */
    mkfifo(STREAM_PIPE, 0666);
    /* Don't open yet - will be opened non-blocking when streaming starts */

    /* Create command pipe */
    mkfifo(CMD_PIPE, 0666);
    cmd_fd = open(CMD_PIPE, O_RDWR | O_NONBLOCK);
    if (cmd_fd < 0) {
        log_ts("controller: Failed to open command pipe: %s\n", strerror(errno));
        return 1;
    }

    /* Wait for camera at startup */
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
        log_ts("controller: Shutdown requested while waiting for camera\n");
        if (cmd_fd >= 0) close(cmd_fd);
        if (g_status_fd >= 0) close(g_status_fd);
        gp_context_unref(context);
        unlink(CMD_PIPE);
        unlink(STATUS_PIPE);
        return 1;
    }

    send_camera_connected_event(camera, context, 0);

    /* Detect USB port if incomplete */
    if (g_last_camera_port[0] == '\0') {
        char detected_port[128];
        if (detect_camera_usb_port(detected_port, sizeof(detected_port))) {
            strncpy(g_last_camera_port, detected_port, sizeof(g_last_camera_port) - 1);
            g_last_camera_port[sizeof(g_last_camera_port) - 1] = '\0';
        } else {
            log_ts("controller: Warning - could not detect camera USB port from sysfs\n");
        }
    }

    /* Get initial file number */
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

    /* Main loop */
    char cmd_buffer[256];
    ssize_t cmd_len;
    int consecutive_open_failures = 0;
    int switch_received = 0;
    int needs_connected_event = 0;

    while (g_running) {
        cmd_len = read(cmd_fd, cmd_buffer, sizeof(cmd_buffer) - 1);
        if (cmd_len > 0) {
            cmd_buffer[cmd_len] = '\0';
        }

        char *cmd_line = (cmd_len > 0) ? strtok(cmd_buffer, "\n") : NULL;
        while (cmd_line != NULL) {
            if (cmd_line[0] == '\0') {
                cmd_line = strtok(NULL, "\n");
                continue;
            }

            log_ts("controller: Got command: '%s'\n", cmd_line);

            if (strcmp(cmd_line, "CAPTURE") == 0) {
                int was_streaming = g_streaming_active;
                int was_liveview = live_view_active && !g_streaming_active;

                if (g_streaming_active) {
                    log_ts("controller: Closing stream pipe for capture...\n");
                    g_streaming_paused = 0;
                    g_streaming_active = 0;
                    g_streaming_was_active_before_polling_pause = 0;

                    if (g_stream_fd >= 0) {
                        close(g_stream_fd);
                        g_stream_fd = -1;
                    }
                    usleep(100000);
                }

                if (camera) {
                    log_ts("controller: Exiting live view mode for capture...\n");
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                    live_view_active = 0;
                }

                mode = MODE_CAPTURE;

                int capture_attempts = 0;
                int was_disconnected = (consecutive_open_failures > 0);
                while (capture_attempts < MAX_OPEN_RETRIES && g_running) {
                    camera = open_camera(camera_index, &ret);
                    if (camera) break;
                    capture_attempts++;
                    log_ts("controller: Camera open failed for capture (attempt %d/%d): %s\n",
                            capture_attempts, MAX_OPEN_RETRIES, gp_result_as_string(ret));
                    if (capture_attempts < MAX_OPEN_RETRIES) {
                        usleep(OPEN_RETRY_DELAY_MS * 1000);
                    }
                }

                if (camera && was_disconnected) {
                    log_ts("controller: Camera reconnected during CAPTURE - resetting state\n");
                    consecutive_open_failures = 0;
                    mode = MODE_CAPTURE;
                    send_camera_connected_event(camera, context, g_cached_camera_index);
                } else if (camera) {
                    consecutive_open_failures = 0;
                }

                if (camera) {
                    int capture_ret = do_capture(camera, context);

                    if (!was_streaming) {
                        gp_camera_exit(camera, context);
                        gp_camera_free(camera);
                        camera = NULL;
                    }

                    if (capture_ret < GP_OK && g_status_fd >= 0) {
                        char error_event[256];
                        snprintf(error_event, sizeof(error_event),
                                "{\"type\":\"capture_error\",\"error\":\"%s\"}\n",
                                gp_result_as_string(capture_ret));
                        write(g_status_fd, error_event, strlen(error_event));
                    }
                } else {
                    log_ts("controller: Failed to open camera for capture after %d attempts\n",
                            MAX_OPEN_RETRIES);
                    consecutive_open_failures++;

                    if (g_status_fd >= 0) {
                        const char *error_event = "{\"type\":\"capture_error\",\"error\":\"Failed to open camera\"}\n";
                        write(g_status_fd, error_event, strlen(error_event));
                    }
                }

                if (was_streaming && camera) {
                    log_ts("controller: Resuming PTP stream after capture...\n");

                    if (g_stream_fd >= 0) {
                        close(g_stream_fd);
                        g_stream_fd = -1;
                    }

                    live_view_active = 1;
                    g_streaming_active = 1;
                    g_streaming_paused = 0;
                    mode = MODE_LIVEVIEW;
                    g_last_status_time = time(NULL);

                    if (g_current_brand == BRAND_CANON) {
                        CameraWidget *lv_widget = NULL;
                        int lv_ret = gp_camera_get_single_config(camera, "liveviewsize", &lv_widget, context);
                        if (lv_ret >= GP_OK && lv_widget) {
                            const char *lv_val = NULL;
                            gp_widget_get_value(lv_widget, &lv_val);
                            int lv_count = gp_widget_count_choices(lv_widget);
                            for (int ci = 0; ci < lv_count; ci++) {
                                const char *choice = NULL;
                                gp_widget_get_choice(lv_widget, ci, &choice);
                                if (choice && strcmp(choice, "Large") == 0) {
                                    if (!lv_val || strcmp(lv_val, choice) != 0) {
                                        gp_widget_set_value(lv_widget, choice);
                                        gp_camera_set_single_config(camera, "liveviewsize", lv_widget, context);
                                    }
                                    break;
                                }
                            }
                            gp_widget_free(lv_widget);
                        }
                    }

                    usleep(200000);

                    if (g_status_fd >= 0) {
                        const char *status_msg = "{\"mode\":\"liveview_streaming\"}\n";
                        write(g_status_fd, status_msg, strlen(status_msg));
                    }
                } else if (was_streaming && !camera) {
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

            } else if (strcmp(cmd_line, "STATUS") == 0) {
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
                    write(g_status_fd, status, strlen(status));
                }

            } else if (strcmp(cmd_line, "LIVEVIEW_START") == 0) {
                log_ts("controller: Starting live view...\n");

                int lv_attempts = 0;
                int was_disconnected = (consecutive_open_failures > 0);
                while (lv_attempts < MAX_OPEN_RETRIES && g_running) {
                    camera = open_camera(camera_index, &ret);
                    if (camera) break;
                    lv_attempts++;
                    if (lv_attempts < MAX_OPEN_RETRIES) {
                        usleep(OPEN_RETRY_DELAY_MS * 1000);
                    }
                }

                if (camera) {
                    if (was_disconnected) {
                        send_camera_connected_event(camera, context, g_cached_camera_index);
                    }
                    consecutive_open_failures = 0;
                    mode = MODE_LIVEVIEW;
                    live_view_active = 1;

                    if (g_current_brand == BRAND_CANON) {
                        CameraWidget *lv_widget = NULL;
                        int lv_ret = gp_camera_get_single_config(camera, "liveviewsize", &lv_widget, context);
                        if (lv_ret >= GP_OK && lv_widget) {
                            int lv_count = gp_widget_count_choices(lv_widget);
                            for (int ci = 0; ci < lv_count; ci++) {
                                const char *choice = NULL;
                                gp_widget_get_choice(lv_widget, ci, &choice);
                                if (choice && strcmp(choice, "Large") == 0) {
                                    gp_widget_set_value(lv_widget, choice);
                                    gp_camera_set_single_config(camera, "liveviewsize", lv_widget, context);
                                    break;
                                }
                            }
                            gp_widget_free(lv_widget);
                        }
                    }

                    if (g_status_fd >= 0) {
                        write(g_status_fd, "{\"mode\":\"liveview\"}\n", 21);
                    }
                } else {
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
                    write(g_status_fd, "{\"mode\":\"idle\"}\n", 17);
                }

            } else if (strcmp(cmd_line, "LIVEVIEW_FRAME") == 0) {
                if (camera && live_view_active && mode == MODE_LIVEVIEW) {
                    capture_preview_frame(camera, context);
                }

            } else if (strcmp(cmd_line, "LIVEVIEW_STREAM_START") == 0) {
                log_ts("controller: Starting continuous PTP streaming...\n");

                if (!camera) {
                    int lv_attempts = 0;
                    int was_disconnected = (consecutive_open_failures > 0);
                    while (lv_attempts < MAX_OPEN_RETRIES && g_running) {
                        camera = open_camera(camera_index, &ret);
                        if (camera) break;
                        lv_attempts++;
                        if (lv_attempts < MAX_OPEN_RETRIES) {
                            usleep(OPEN_RETRY_DELAY_MS * 1000);
                        }
                    }

                    if (camera && was_disconnected) {
                        send_camera_connected_event(camera, context, g_cached_camera_index);
                    }
                }

                if (camera) {
                    consecutive_open_failures = 0;
                    mode = MODE_LIVEVIEW;
                    live_view_active = 1;
                    g_streaming_active = 1;
                    g_streaming_paused = 0;
                    g_last_status_time = time(NULL);

                    if (g_current_brand == BRAND_CANON) {
                        CameraWidget *lv_widget = NULL;
                        int lv_ret = gp_camera_get_single_config(camera, "liveviewsize", &lv_widget, context);
                        if (lv_ret >= GP_OK && lv_widget) {
                            int lv_count = gp_widget_count_choices(lv_widget);
                            for (int ci = 0; ci < lv_count; ci++) {
                                const char *choice = NULL;
                                gp_widget_get_choice(lv_widget, ci, &choice);
                                if (choice && strcmp(choice, "Large") == 0) {
                                    gp_widget_set_value(lv_widget, choice);
                                    gp_camera_set_single_config(camera, "liveviewsize", lv_widget, context);
                                    break;
                                }
                            }
                            gp_widget_free(lv_widget);
                        }
                    }

                    if (g_status_fd >= 0) {
                        write(g_status_fd, "{\"mode\":\"liveview_streaming\"}\n", 32);
                    }
                } else {
                    consecutive_open_failures++;
                }

            } else if (strcmp(cmd_line, "LIVEVIEW_STREAM_STOP") == 0) {
                log_ts("controller: Stopping continuous PTP streaming...\n");

                g_streaming_active = 0;
                g_streaming_paused = 0;
                g_streaming_was_active_before_polling_pause = 0;

                if (g_stream_fd >= 0) {
                    close(g_stream_fd);
                    g_stream_fd = -1;
                }

                if (camera && live_view_active) {
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                }

                mode = MODE_IDLE;
                live_view_active = 0;

                if (g_status_fd >= 0) {
                    write(g_status_fd, "{\"mode\":\"idle\"}\n", 17);
                }

            } else if (strncmp(cmd_line, "SWITCH_CAMERA ", 14) == 0) {
                int new_index = atoi(cmd_line + 14);
                log_ts("controller: Switching to camera %d\n", new_index);
                switch_received = 1;
                needs_connected_event = 1;

                if (camera) {
                    if (live_view_active) {
                        live_view_active = 0;
                    }
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                }

                camera_index = new_index;
                last_file_number = 0;
                consecutive_open_failures = 0;
                g_widgets_listed = 0;
                mode = MODE_IDLE;
                g_last_camera_switch = time(NULL);
                g_detection_valid = 0;
                g_current_brand = BRAND_UNKNOWN;
                g_last_logged_brand = BRAND_UNKNOWN;

                if (g_status_fd >= 0) {
                    char switch_msg[128];
                    snprintf(switch_msg, sizeof(switch_msg),
                            "{\"type\":\"camera_switched\",\"camera_index\":%d}\n", new_index);
                    write(g_status_fd, switch_msg, strlen(switch_msg));
                }

            } else if (strcmp(cmd_line, "DISCONNECT") == 0) {
                switch_received = 0;
                if (g_status_fd >= 0) {
                    write(g_status_fd, "{\"type\":\"polling_stopped\"}\n", 28);
                }

            } else if (strcmp(cmd_line, "PAUSE_POLLING") == 0) {
                switch_received = 0;

                if (g_streaming_active) {
                    g_streaming_was_active_before_polling_pause = 1;
                    g_streaming_active = 0;
                    g_streaming_paused = 0;

                    if (g_stream_fd >= 0) {
                        close(g_stream_fd);
                        g_stream_fd = -1;
                    }

                    if (camera && live_view_active) {
                        gp_camera_exit(camera, context);
                        live_view_active = 0;
                        mode = MODE_IDLE;
                    }

                    if (g_status_fd >= 0) {
                        write(g_status_fd, "{\"mode\":\"idle\"}\n", 17);
                    }
                } else {
                    g_streaming_was_active_before_polling_pause = 0;
                }

                if (camera && mode == MODE_IDLE && !live_view_active && !g_streaming_active) {
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                }

                if (g_status_fd >= 0) {
                    write(g_status_fd, "{\"type\":\"polling_paused\"}\n", 28);
                }

            } else if (strcmp(cmd_line, "RESUME_POLLING") == 0) {
                switch_received = 1;

                if (g_streaming_was_active_before_polling_pause) {
                    g_streaming_was_active_before_polling_pause = 0;

                    if (!camera) {
                        int lv_attempts = 0;
                        while (!camera && lv_attempts < 3 && g_running) {
                            camera = open_camera(camera_index, &ret);
                            if (camera) {
                                consecutive_open_failures = 0;
                            } else {
                                lv_attempts++;
                                if (lv_attempts < 3) {
                                    usleep(OPEN_RETRY_DELAY_MS * 1000);
                                }
                            }
                        }
                    }

                    if (camera) {
                        mode = MODE_LIVEVIEW;
                        live_view_active = 1;
                        g_streaming_active = 1;
                        g_streaming_paused = 0;
                        g_last_status_time = time(NULL);

                        if (g_stream_fd >= 0) {
                            close(g_stream_fd);
                            g_stream_fd = -1;
                        }

                        usleep(200000);

                        if (g_status_fd >= 0) {
                            write(g_status_fd, "{\"mode\":\"liveview_streaming\"}\n", 32);
                        }
                    }
                }

                if (g_status_fd >= 0) {
                    write(g_status_fd, "{\"type\":\"polling_resumed\"}\n", 29);
                }

            } else if (strcmp(cmd_line, "CONFIG") == 0) {
                if (g_streaming_active) {
                    g_streaming_paused = 1;
                    usleep(50000);
                }

                int we_opened = 0;

                if (!camera) {
                    camera = open_camera(camera_index, &ret);
                    if (camera) {
                        we_opened = 1;
                        consecutive_open_failures = 0;
                    }
                }

                if (camera) {
                    write_full_config_json(camera, context, g_current_brand);
                }

                if (we_opened && camera) {
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                }

                if (g_streaming_active && g_streaming_paused) {
                    g_streaming_paused = 0;
                }

            } else if (strncmp(cmd_line, "SETCONFIG ", 10) == 0) {
                const char *json_input = cmd_line + 10;

                if (g_streaming_active) {
                    g_streaming_paused = 1;
                    usleep(50000);
                }

                int we_opened = 0;

                if (!camera) {
                    camera = open_camera(camera_index, &ret);
                    if (camera) {
                        we_opened = 1;
                        consecutive_open_failures = 0;
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

                if (g_streaming_active && g_streaming_paused) {
                    g_streaming_paused = 0;
                }

            } else if (strcmp(cmd_line, "QUIT") == 0) {
                log_ts("controller: Quit command received\n");
                g_running = 0;
            }

            cmd_line = strtok(NULL, "\n");
        }

        /* Polling loop for new files from physical shutter */
        if (mode == MODE_IDLE && !live_view_active && !g_streaming_active && switch_received) {
            #define POLL_RETRIES 2
            int poll_attempts = 0;
            int was_disconnected = (consecutive_open_failures > 0);
            while (poll_attempts < POLL_RETRIES && g_running) {
                camera = open_camera_with_timeout(camera_index, &ret, CAMERA_OPEN_TIMEOUT_SEC);
                if (camera) break;
                poll_attempts++;
                if (poll_attempts < POLL_RETRIES) {
                    usleep(500000);
                }
            }

            if (camera) {
                consecutive_open_failures = 0;

                if (was_disconnected) {
                    log_ts("controller: Camera RECONNECTED - resetting state\n");
                    mode = MODE_IDLE;
                    live_view_active = 0;
                    g_streaming_active = 0;
                    g_streaming_paused = 0;
                    g_streaming_was_active_before_polling_pause = 0;
                    last_file_number = 0;
                    g_widgets_listed = 0;
                    g_last_camera_switch = 0;
                    send_camera_connected_event(camera, context, camera_index);
                } else if (needs_connected_event) {
                    send_camera_connected_event(camera, context, camera_index);
                    needs_connected_event = 0;
                }

                reset_old_failed_files();

                int new_num = check_and_download_all_files(camera, context);
                if (new_num > last_file_number) {
                    last_file_number = new_num;
                }

                const BrandWidgets *widgets = get_widgets_for_brand(g_current_brand);

                char *battery = get_single_config_value(camera, context, widgets->battery);
                char *iso = get_single_config_value(camera, context, widgets->iso);
                char *aperture = get_single_config_value(camera, context, widgets->aperture);
                char *shutter = get_single_config_value(camera, context, widgets->shutter);
                char *ev = get_single_config_value(camera, context, widgets->ev);
                char *wb = get_single_config_value(camera, context, widgets->wb);
                char *shootingmode = get_single_config_value(camera, context, widgets->mode);

                if (!shootingmode && g_current_brand != BRAND_FUJI) {
                    shootingmode = get_single_config_value(camera, context, "expprogram");
                }
                if (!shootingmode) {
                    shootingmode = get_single_config_value(camera, context, "exposureprogram");
                }

                const char *iso_display = iso;
                if (g_current_brand == BRAND_CANON && iso) {
                    iso_display = map_canon_iso_value(iso);
                }

                if (g_status_fd >= 0) {
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
                    write(g_status_fd, status_msg, strlen(status_msg));
                }

                if (battery) free(battery);
                if (iso) free(iso);
                if (aperture) free(aperture);
                if (shutter) free(shutter);
                if (ev) free(ev);
                if (wb) free(wb);
                if (shootingmode) free(shootingmode);

                gp_camera_exit(camera, context);
                gp_camera_free(camera);
                camera = NULL;
            } else {
                consecutive_open_failures++;

                if (consecutive_open_failures == 1) {
                    g_detection_valid = 0;
                    g_last_camera_port[0] = '\0';
                    g_cached_camera_index = -1;
                }

                if (consecutive_open_failures == 3 && g_last_camera_port[0] != '\0') {
                    log_ts("controller: 3 consecutive failures, attempting USB reset...\n");
                    if (reset_usb_device(g_last_camera_port) == 0) {
                        consecutive_open_failures = 0;
                    }
                }

                time_t now = time(NULL);
                if (now - g_last_camera_switch >= CAMERA_SWITCH_GRACE_SEC) {
                    if (g_status_fd >= 0) {
                        write(g_status_fd, "{\"type\":\"camera_disconnected\"}\n", 34);
                    }
                }
            }
        }

        /* Streaming loop */
        if (g_streaming_active && camera && !g_streaming_paused) {
            time_t now = time(NULL);
            if (now - g_last_status_time >= 5) {
                const BrandWidgets *widgets = get_widgets_for_brand(g_current_brand);

                char *battery = get_single_config_value(camera, context, widgets->battery);
                char *iso = get_single_config_value(camera, context, widgets->iso);
                char *aperture = get_single_config_value(camera, context, widgets->aperture);
                char *shutter = get_single_config_value(camera, context, widgets->shutter);
                char *ev = get_single_config_value(camera, context, widgets->ev);
                char *wb = get_single_config_value(camera, context, widgets->wb);
                char *shootingmode = get_single_config_value(camera, context, widgets->mode);

                if (!shootingmode && g_current_brand != BRAND_FUJI) {
                    shootingmode = get_single_config_value(camera, context, "expprogram");
                }

                const char *iso_display = iso;
                if (g_current_brand == BRAND_CANON && iso) {
                    iso_display = map_canon_iso_value(iso);
                }

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
                    write(g_status_fd, status_msg, strlen(status_msg));
                }

                if (battery) free(battery);
                if (iso) free(iso);
                if (aperture) free(aperture);
                if (shutter) free(shutter);
                if (ev) free(ev);
                if (wb) free(wb);
                if (shootingmode) free(shootingmode);

                g_last_status_time = now;
            }

            int stream_ret = stream_preview_frame(camera, context);
            if (stream_ret < GP_OK) {
                g_streaming_active = 0;
                g_streaming_paused = 0;
                g_streaming_was_active_before_polling_pause = 0;
                if (g_stream_fd >= 0) {
                    close(g_stream_fd);
                    g_stream_fd = -1;
                }
                gp_camera_exit(camera, context);
                gp_camera_unref(camera);
                camera = NULL;
                live_view_active = 0;
                g_detection_valid = 0;
                g_last_camera_port[0] = '\0';
                consecutive_open_failures = 1;

                if (g_status_fd >= 0) {
                    write(g_status_fd, "{\"type\":\"camera_disconnected\",\"reason\":\"stream_failure\"}\n", 62);
                }
                continue;
            }

            struct pollfd pfd = { .fd = cmd_fd, .events = POLLIN };
            poll(&pfd, 1, 1000 / STREAM_TARGET_FPS);
        } else {
            if (g_streaming_active || live_view_active) {
                struct pollfd pfd = { .fd = cmd_fd, .events = POLLIN };
                poll(&pfd, 1, g_streaming_active ? 100 : 500);
            } else {
                int poll_timeout_ms = 1500;

                if (!switch_received && g_last_camera_port[0] != '\0') {
                    if (!check_usb_device_present(g_last_camera_port)) {
                        log_ts("controller: USB device gone\n");
                        g_last_camera_port[0] = '\0';
                        g_detection_valid = 0;
                        g_current_brand = BRAND_UNKNOWN;
                        g_last_logged_brand = BRAND_UNKNOWN;
                        consecutive_open_failures = 1;

                        /* Free cached gphoto2 detection data to remove from device array */
                        if (g_cached_abilities_list) {
                            gp_abilities_list_free(g_cached_abilities_list);
                            g_cached_abilities_list = NULL;
                        }
                        if (g_cached_port_info_list) {
                            gp_port_info_list_free(g_cached_port_info_list);
                            g_cached_port_info_list = NULL;
                        }
                        g_cached_camera_index = -1;

                        if (g_status_fd >= 0) {
                            write(g_status_fd, "{\"type\":\"camera_disconnected\",\"reason\":\"usb_unplugged\"}\n", 69);
                        }
                    }
                } else if (!switch_received && g_last_camera_port[0] == '\0') {
                    char detected_port[128];
                    if (detect_camera_usb_port(detected_port, sizeof(detected_port))) {
                        g_detection_valid = 0;
                        g_cached_camera_index = -1;

                        Camera *reconnect_cam = open_camera(camera_index, &ret);
                        if (reconnect_cam) {
                            strncpy(g_last_camera_port, detected_port, sizeof(g_last_camera_port) - 1);
                            g_last_camera_port[sizeof(g_last_camera_port) - 1] = '\0';
                            consecutive_open_failures = 0;
                            last_file_number = 0;
                            g_widgets_listed = 0;
                            g_last_camera_switch = 0;
                            send_camera_connected_event(reconnect_cam, context, camera_index);
                            gp_camera_exit(reconnect_cam, context);
                            gp_camera_free(reconnect_cam);
                            reconnect_cam = NULL;
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
        gp_camera_exit(camera, context);
        gp_camera_free(camera);
    }

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
