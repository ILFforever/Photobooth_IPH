/*
 * gphoto2-controller - Long-running camera controller process
 *
 * Manages camera connection with a command queue. Polls for new files
 * from physical shutter button while accepting commands via named pipe.
 *
 * Commands (write to /tmp/camera_cmd):
 *   CAPTURE          - Trigger software capture
 *   STATUS           - Get current status
 *   LIVEVIEW_START   - Enter live view mode (stops polling)
 *   LIVEVIEW_STOP    - Exit live view mode (resumes polling)
 *   LIVEVIEW_FRAME   - Capture one preview frame (base64 JPEG)
 *   QUIT             - Shutdown the controller
 *
 * Status output (writes to /tmp/camera_status):
 *   {"mode":"idle"}               - Polling for new files
 *   {"mode":"capture"}            - Capturing
 *   {"mode":"liveview"}           - Live view active
 *   {"mode":"idle","status":{...}}  - Camera status (ISO, aperture, etc)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <errno.h>
#include <gphoto2/gphoto2.h>
#include <sys/statvfs.h>
#include <dirent.h>
#include <time.h>

#define CMD_PIPE "/tmp/camera_cmd"
#define STATUS_PIPE "/tmp/camera_status"
#define MAX_FILES 100
#define POLL_INTERVAL_MS 1000
#define MAX_OPEN_RETRIES 5
#define OPEN_RETRY_DELAY_MS 2000

static volatile sig_atomic_t g_running = 1;
static int g_status_fd = -1;
static int g_widgets_listed = 0;  // Track if we've listed widgets for debug

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
            fprintf(stderr, "controller: Deleted old photo: %s (%lu bytes)\n", photos[i].path, photos[i].size);
            freed_space += photos[i].size;
            deleted_count++;
        } else {
            fprintf(stderr, "controller: Failed to delete %s: %s\n", photos[i].path, strerror(errno));
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

        fprintf(stderr, "controller: Low storage! Only %llu MB free, need %llu MB. Cleaning up...\n",
                available_mb, target / (1024 * 1024));

        int deleted = cleanup_old_photos(to_free);
        if (deleted > 0) {
            fprintf(stderr, "controller: Cleaned up %d old photo(s) to free space\n", deleted);
        } else {
            fprintf(stderr, "controller: WARNING: No photos to delete, but storage is low!\n");
        }
    }
}

static Camera* open_camera(int camera_index, int *ret_out) {
    Camera *camera = NULL;
    CameraList *list = NULL;
    GPPortInfoList *port_info_list = NULL;
    CameraAbilitiesList *abilities_list = NULL;
    GPPortInfo port_info;
    CameraAbilities abilities;
    const char *model_name = NULL;
    const char *port_name = NULL;
    int ret, count;
    GPContext *context = create_context();

    if (ret_out) *ret_out = GP_OK;

    ret = gp_camera_new(&camera);
    if (ret < GP_OK) {
        gp_context_unref(context);
        if (ret_out) *ret_out = ret;
        return NULL;
    }

    ret = gp_list_new(&list);
    if (ret < GP_OK) { goto error; }

    ret = gp_port_info_list_new(&port_info_list);
    if (ret < GP_OK) { goto error; }

    ret = gp_port_info_list_load(port_info_list);
    if (ret < GP_OK) { goto error; }

    ret = gp_abilities_list_new(&abilities_list);
    if (ret < GP_OK) { goto error; }

    ret = gp_abilities_list_load(abilities_list, context);
    if (ret < GP_OK) { goto error; }

    ret = gp_abilities_list_detect(abilities_list, port_info_list, list, context);
    if (ret < GP_OK) { goto error; }

    count = gp_list_count(list);
    if (count < 1) {
        if (ret_out) *ret_out = GP_ERROR_MODEL_NOT_FOUND;
        goto error;
    }

    if (camera_index >= count) {
        fprintf(stderr, "controller: Camera index %d out of range (found %d cameras)\n",
                camera_index, count);
        if (ret_out) *ret_out = GP_ERROR_MODEL_NOT_FOUND;
        goto error;
    }

    gp_list_get_name(list, camera_index, &model_name);
    gp_list_get_value(list, camera_index, &port_name);
    /* Only log on first open — suppress for repeated poll opens */

    int model_index = gp_abilities_list_lookup_model(abilities_list, model_name);
    if (model_index < GP_OK) { goto error; }

    gp_abilities_list_get_abilities(abilities_list, model_index, &abilities);
    int port_index = gp_port_info_list_lookup_path(port_info_list, port_name);
    if (port_index < GP_OK) { goto error; }

    gp_port_info_list_get_info(port_info_list, port_index, &port_info);
    gp_camera_set_abilities(camera, abilities);
    gp_camera_set_port_info(camera, port_info);

    ret = gp_camera_init(camera, context);
    if (ret < GP_OK) {
        fprintf(stderr, "controller: Failed to init camera: %s\n", gp_result_as_string(ret));
        if (ret_out) *ret_out = ret;
        goto error;
    }

    gp_abilities_list_free(abilities_list);
    gp_port_info_list_free(port_info_list);
    gp_list_free(list);
    gp_context_unref(context);

    return camera;

error:
    if (abilities_list) gp_abilities_list_free(abilities_list);
    if (port_info_list) gp_port_info_list_free(port_info_list);
    if (list) gp_list_free(list);
    if (camera) gp_camera_free(camera);
    gp_context_unref(context);
    if (ret_out) *ret_out = ret;
    return NULL;
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
 * Get a single camera config value by name
 * Returns the value as a string (must be freed by caller) or NULL on error
 */
static char *get_single_config_value(Camera *camera, GPContext *context, const char *setting_name) {
    CameraWidget *widget = NULL;
    int ret;
    char *result = NULL;

    ret = gp_camera_get_single_config(camera, setting_name, &widget, context);
    if (ret < GP_OK) {
        fprintf(stderr, "controller: Failed to get config '%s': %s\n", setting_name, gp_result_as_string(ret));
        return NULL;
    }

    if (!widget) {
        fprintf(stderr, "controller: Config '%s' not found\n", setting_name);
        return NULL;
    }

    char value_buf[256] = {0};
    CameraWidgetType type;

    gp_widget_get_type(widget, &type);
    fprintf(stderr, "controller: Widget '%s' type: %d\n", setting_name, type);

    /* Get current value based on widget type */
    if (type == GP_WIDGET_RADIO || type == GP_WIDGET_MENU) {
        /* RADIO/MENU widgets return the current value as a string pointer */
        const char *current_value = NULL;
        ret = gp_widget_get_value(widget, &current_value);
        if (ret >= GP_OK && current_value) {
            strncpy(value_buf, current_value, sizeof(value_buf) - 1);
            result = strdup(value_buf);
            fprintf(stderr, "controller: Got RADIO/MENU value: %s\n", result);
        } else {
            fprintf(stderr, "controller: Failed to get RADIO/MENU value: %s\n", gp_result_as_string(ret));
        }
    } else if (type == GP_WIDGET_TEXT) {
        const char *text = NULL;
        gp_widget_get_value(widget, &text);
        if (text) {
            result = strdup(text);
            fprintf(stderr, "controller: Got TEXT value: %s\n", result);
        }
    } else if (type == GP_WIDGET_RANGE) {
        float current;
        ret = gp_widget_get_value(widget, &current);
        if (ret >= GP_OK) {
            snprintf(value_buf, sizeof(value_buf), "%.1f", current);
            result = strdup(value_buf);
            fprintf(stderr, "controller: Got RANGE value: %s\n", result);
        }
    } else {
        fprintf(stderr, "controller: Unknown widget type %d for '%s'\n", type, setting_name);
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

    fprintf(stderr, "controller: === Available camera widgets ===\n");

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
    fprintf(stderr, "controller: === End of widgets ===\n");

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
        fprintf(stderr, "controller: Failed to get camera config: %s\n", gp_result_as_string(ret));
        return -1;
    }

    /* Common settings we want to read */
    const char *settings[] = {
        "iso",
        "f-number",
        "shutterspeed",
        "shutterspeed2",
        "exposurecompensation",
        "whitebalance",
        "focusmode",
        "d36b",  // BatteryInfo2 (Fuji X-H2 battery level)
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

    json_offset += snprintf(status_json + json_offset, max_size - json_offset, "}");

    gp_widget_free(config);
    return (json_offset < max_size) ? 0 : -1;
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
        //fprintf(stderr, "controller: Scanning folder %s (%d files)\n", folders[fi], count);

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
                fprintf(stderr, "controller: File already exists locally: %s, deleting from camera...\n", name);
                // File exists locally but still on camera - clean it up!
                int delete_ret = gp_camera_file_delete(camera, folders[fi], name, context);
                if (delete_ret < GP_OK) {
                    fprintf(stderr, "controller: Failed to delete existing file %s from camera: %s\n",
                            name, gp_result_as_string(delete_ret));
                } else {
                    fprintf(stderr, "controller: Cleaned up existing file %s from camera\n", name);
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
                fprintf(stderr, "controller: Received %lu bytes from camera for %s\n", size, name);

                // Ensure we have enough storage before saving
                ensure_storage_space(size);

                ret = gp_file_save(file, output_path);
                if (ret >= GP_OK) {
                    fprintf(stderr, "controller: Downloaded %s/%s -> %s\n", folders[fi], name, output_path);
                    total_downloaded++;

                    // Emit event to status pipe
                    if (g_status_fd >= 0) {
                        char event[512];
                        snprintf(event, sizeof(event),
                                "{\"type\":\"photo_downloaded\",\"file_path\":\"%s\",\"camera_path\":\"%s/%s\"}\n",
                                output_path, folders[fi], name);
                        ssize_t written = write(g_status_fd, event, strlen(event));
                        if (written < 0) {
                            fprintf(stderr, "controller: Failed to write to status pipe: %s\n", strerror(errno));
                        } else {
                            fprintf(stderr, "controller: Emitted photo_downloaded event\n");
                        }
                    }

                    // Delete from camera after successful download
                    int delete_ret = gp_camera_file_delete(camera, folders[fi], name, context);
                    if (delete_ret < GP_OK) {
                        fprintf(stderr, "controller: Warning - failed to delete %s from camera: %s\n",
                                name, gp_result_as_string(delete_ret));
                    } else {
                        fprintf(stderr, "controller: Deleted %s from camera\n", name);
                    }
                } else {
                    fprintf(stderr, "controller: Failed to save %s: error=%d (%s)\n", name, ret, gp_result_as_string(ret));
                    fprintf(stderr, "controller: Output path: %s, errno: %d (%s)\n", output_path, errno, strerror(errno));

                    // Check disk space
                    FILE *df = popen("df -h /tmp 2>/dev/null", "r");
                    if (df) {
                        char df_line[256];
                        while (fgets(df_line, sizeof(df_line), df)) {
                            fprintf(stderr, "controller: %s", df_line);
                        }
                        pclose(df);
                    }
                }
            } else {
                fprintf(stderr, "controller: Failed to download %s: error=%d (%s)\n", name, ret, gp_result_as_string(ret));
            }

            gp_file_free(file);
        }

        gp_list_free(file_list);
    }

    if (total_downloaded > 0) {
        fprintf(stderr, "controller: Downloaded %d new files (highest number: %d)\n", total_downloaded, highest_number);
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
    fprintf(stderr, "controller: Received %lu bytes from camera for %s\n", size, name);

    // Ensure we have enough storage before saving
    ensure_storage_space(size);

    ret = gp_file_save(file, output_path);
    gp_file_free(file);

    if (ret < GP_OK) {
        fprintf(stderr, "controller: Failed to save %s: error=%d (%s)\n", name, ret, gp_result_as_string(ret));
        fprintf(stderr, "controller: Output path: %s, errno: %d (%s)\n", output_path, errno, strerror(errno));

        // Check disk space
        FILE *df = popen("df -h /tmp 2>/dev/null", "r");
        if (df) {
            char df_line[256];
            while (fgets(df_line, sizeof(df_line), df)) {
                fprintf(stderr, "controller: %s", df_line);
            }
            pclose(df);
        }
        return -1;
    }

    fprintf(stderr, "controller: Downloaded %s/%s -> %s\n", folder, name, output_path);

    /* Emit event to status pipe */
    if (g_status_fd >= 0) {
        char event[512];
        snprintf(event, sizeof(event),
                "{\"type\":\"photo_downloaded\",\"file_path\":\"%s\",\"camera_path\":\"%s/%s\"}\n",
                output_path, folder, name);
        ssize_t written = write(g_status_fd, event, strlen(event));
        if (written < 0) {
            fprintf(stderr, "controller: Failed to write photo_downloaded event: %s\n", strerror(errno));
        } else {
            fprintf(stderr, "controller: Emitted photo_downloaded event for %s\n", name);
        }
    }

    /* Delete from camera after successful download */
    int delete_ret = gp_camera_file_delete(camera, folder, name, context);
    if (delete_ret < GP_OK) {
        fprintf(stderr, "controller: Warning - failed to delete %s from camera: %s\n",
                name, gp_result_as_string(delete_ret));
    } else {
        fprintf(stderr, "controller: Deleted %s from camera\n", name);
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
            fprintf(stderr, "controller: wait_for_event error: %s\n", gp_result_as_string(ret));
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
            fprintf(stderr, "controller: FILE_ADDED event: %s/%s\n", path->folder, path->name);
            download_file(camera, context, path->folder, path->name);
        } else if (event_type == GP_EVENT_FOLDER_ADDED) {
            CameraFilePath *path = (CameraFilePath *)event_data;
            fprintf(stderr, "controller: FOLDER_ADDED event: %s/%s\n", path->folder, path->name);
        } else {
            fprintf(stderr, "controller: Event type %d\n", event_type);
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

    fprintf(stderr, "controller: Capturing preview frame...\n");

    ret = gp_camera_capture_preview(camera, file, context);
    if (ret < GP_OK) {
        fprintf(stderr, "controller: Preview capture failed: %s\n", gp_result_as_string(ret));
        // Try to exit live view on camera
        gp_camera_exit(camera, context);
        return ret;
    }

    ret = gp_file_get_data_and_size(file, &data, &size);
    if (ret < GP_OK) {
        fprintf(stderr, "controller: Failed to get preview data: %s\n", gp_result_as_string(ret));
        gp_file_free(file);
        return ret;
    }

    fprintf(stderr, "controller: Preview frame size: %lu bytes\n", size);

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
            fprintf(stderr, "controller: Failed to write preview frame: %s\n", strerror(errno));
        } else {
            fprintf(stderr, "controller: Sent preview frame (%lu bytes, %d base64)\n", size, base64_len);
        }
    }

    gp_file_free(file);
    return GP_OK;
}

/* Execute software capture and download the resulting files */
static int do_capture(Camera *camera, GPContext *context) {
    CameraFilePath path;
    int ret;

    fprintf(stderr, "controller: Triggering capture...\n");
    ret = gp_camera_capture(camera, GP_CAPTURE_IMAGE, &path, context);
    if (ret < GP_OK) {
        fprintf(stderr, "controller: Capture failed (Fuji quirk): %s\n", gp_result_as_string(ret));
        /*
         * Fuji X-H2 returns error but photo was taken.
         * DON'T drain events - it causes "Access Denied" errors.
         * Let the polling loop pick up the files instead.
         */
        return GP_OK;  /* Return success - photo was actually taken */
    }

    fprintf(stderr, "controller: Capture complete: %s/%s\n", path.folder, path.name);

    /* Download the file returned by gp_camera_capture directly */
    download_file(camera, context, path.folder, path.name);

    /* Drain remaining events to pick up RAW+JPEG second file, etc. */
    drain_camera_events(camera, context, 2000);

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

    /* Create status pipe */
    mkfifo(STATUS_PIPE, 0666);
    g_status_fd = open(STATUS_PIPE, O_WRONLY);  // Blocking mode - wait for reader
    if (g_status_fd < 0) {
        fprintf(stderr, "controller: Warning - cannot open status pipe: %s\n", strerror(errno));
    } else {
        fprintf(stderr, "controller: Status pipe opened for writing\n");
    }

    /* Create command pipe early so the daemon knows we're alive */
    mkfifo(CMD_PIPE, 0666);
    cmd_fd = open(CMD_PIPE, O_RDWR | O_NONBLOCK);
    if (cmd_fd < 0) {
        fprintf(stderr, "controller: Failed to open command pipe: %s\n", strerror(errno));
        return 1;
    }

    /*
     * Verify camera exists at startup — retry up to 60s for USB enumeration.
     * Then RELEASE it immediately so the camera is free.
     */
    context = create_context();
    fprintf(stderr, "controller: Waiting for camera...\n");
    for (int attempt = 1; attempt <= 60 && g_running; attempt++) {
        camera = open_camera(camera_index, &ret);
        if (camera) break;
        if (attempt % 10 == 0) {
            fprintf(stderr, "controller: Still waiting for camera (%d/60)...\n", attempt);
        }
        sleep(1);
    }
    if (!camera) {
        fprintf(stderr, "controller: Failed to open camera after 60 attempts\n");
        if (cmd_fd >= 0) close(cmd_fd);
        if (g_status_fd >= 0) close(g_status_fd);
        gp_context_unref(context);
        unlink(CMD_PIPE);
        unlink(STATUS_PIPE);
        return 1;
    }

    /* Get initial file number before releasing */
    {
        char tmp[128];
        last_file_number = find_highest_file(camera, context, "/store_10000001", tmp, sizeof(tmp));
        if (last_file_number < 0) last_file_number = 0;
        fprintf(stderr, "controller: Initial file number: %d\n", last_file_number);
    }

    fprintf(stderr, "controller: Camera found, releasing until needed\n");
    gp_camera_exit(camera, context);
    gp_camera_free(camera);
    camera = NULL;

    fprintf(stderr, "controller: Started, waiting for commands on %s\n", CMD_PIPE);

    /* Main loop — camera is NOT held open between commands */
    char cmd_buffer[256];
    ssize_t cmd_len;
    int consecutive_open_failures = 0;

    while (g_running) {
        /* Check for command (non-blocking read on persistent fd) */
        cmd_len = read(cmd_fd, cmd_buffer, sizeof(cmd_buffer) - 1);
        if (cmd_len > 0) {
            cmd_buffer[cmd_len] = '\0';
            /* Remove trailing newline */
            if (cmd_len > 0 && cmd_buffer[cmd_len - 1] == '\n') {
                cmd_buffer[cmd_len - 1] = '\0';
            }

            fprintf(stderr, "controller: Got command: %s\n", cmd_buffer);

            if (strcmp(cmd_buffer, "CAPTURE") == 0) {
                // If live view is active, exit it first
                if (live_view_active && camera) {
                    fprintf(stderr, "controller: Exiting live view for capture...\n");
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                    live_view_active = 0;
                }

                mode = MODE_CAPTURE;
                if (g_status_fd >= 0) {
                    ssize_t written = write(g_status_fd, "{\"mode\":\"capture\"}\n", 18);
                    if (written < 0) {
                        fprintf(stderr, "controller: Failed to write mode=capture to status pipe: %s\n", strerror(errno));
                    }
                }

                /* Open camera for capture with retry logic */
                int capture_attempts = 0;
                while (capture_attempts < MAX_OPEN_RETRIES && g_running) {
                    camera = open_camera(camera_index, &ret);
                    if (camera) {
                        consecutive_open_failures = 0;  /* Reset counter on success */
                        break;
                    }
                    capture_attempts++;
                    fprintf(stderr, "controller: Camera open failed for capture (attempt %d/%d): %s\n",
                            capture_attempts, MAX_OPEN_RETRIES, gp_result_as_string(ret));
                    if (capture_attempts < MAX_OPEN_RETRIES) {
                        usleep(OPEN_RETRY_DELAY_MS * 1000);
                    }
                }

                if (camera) {
                    do_capture(camera, context);
                    gp_camera_exit(camera, context);
                    gp_camera_free(camera);
                    camera = NULL;
                } else {
                    fprintf(stderr, "controller: Failed to open camera for capture after %d attempts\n",
                            MAX_OPEN_RETRIES);
                    consecutive_open_failures++;
                }

                mode = MODE_IDLE;
                if (g_status_fd >= 0) {
                    ssize_t written = write(g_status_fd, "{\"mode\":\"idle\"}\n", 17);
                    if (written < 0) {
                        fprintf(stderr, "controller: Failed to write mode=idle to status pipe: %s\n", strerror(errno));
                    }
                }

            } else if (strcmp(cmd_buffer, "STATUS") == 0) {
                const char *mode_str = (mode == MODE_IDLE) ? "idle" :
                                      (mode == MODE_CAPTURE) ? "capture" : "liveview";
                if (g_status_fd >= 0) {
                    char status[128];
                    snprintf(status, sizeof(status), "{\"mode\":\"%s\"}\n", mode_str);
                    ssize_t written = write(g_status_fd, status, strlen(status));
                    if (written < 0) {
                        fprintf(stderr, "controller: Failed to write status to status pipe: %s\n", strerror(errno));
                    }
                }

            } else if (strcmp(cmd_buffer, "LIVEVIEW_START") == 0) {
                fprintf(stderr, "controller: Starting live view...\n");

                // Open camera for live view
                int lv_attempts = 0;
                while (lv_attempts < MAX_OPEN_RETRIES && g_running) {
                    camera = open_camera(camera_index, &ret);
                    if (camera) {
                        consecutive_open_failures = 0;
                        break;
                    }
                    lv_attempts++;
                    fprintf(stderr, "controller: Camera open failed for live view (attempt %d/%d): %s\n",
                            lv_attempts, MAX_OPEN_RETRIES, gp_result_as_string(ret));
                    if (lv_attempts < MAX_OPEN_RETRIES) {
                        usleep(OPEN_RETRY_DELAY_MS * 1000);
                    }
                }

                if (camera) {
                    mode = MODE_LIVEVIEW;
                    live_view_active = 1;
                    if (g_status_fd >= 0) {
                        ssize_t written = write(g_status_fd, "{\"mode\":\"liveview\"}\n", 21);
                        if (written < 0) {
                            fprintf(stderr, "controller: Failed to write mode=liveview to status pipe: %s\n", strerror(errno));
                        }
                    }
                    fprintf(stderr, "controller: Live view started (polling paused)\n");
                } else {
                    fprintf(stderr, "controller: Failed to open camera for live view after %d attempts\n",
                            MAX_OPEN_RETRIES);
                    consecutive_open_failures++;
                }

            } else if (strcmp(cmd_buffer, "LIVEVIEW_STOP") == 0) {
                fprintf(stderr, "controller: Stopping live view...\n");

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
                        fprintf(stderr, "controller: Failed to write mode=idle to status pipe: %s\n", strerror(errno));
                    }
                }
                fprintf(stderr, "controller: Live view stopped (polling resumed)\n");

            } else if (strcmp(cmd_buffer, "LIVEVIEW_FRAME") == 0) {
                if (camera && live_view_active && mode == MODE_LIVEVIEW) {
                    capture_preview_frame(camera, context);
                } else {
                    fprintf(stderr, "controller: LIVEVIEW_FRAME ignored - not in live view mode\n");
                    if (g_status_fd >= 0) {
                        const char *err_msg = "{\"type\":\"error\",\"message\":\"Not in live view mode\"}\n";
                        ssize_t written = write(g_status_fd, err_msg, strlen(err_msg));
                        if (written < 0) {
                            fprintf(stderr, "controller: Failed to write error to status pipe: %s\n", strerror(errno));
                        }
                    }
                }

            } else if (strcmp(cmd_buffer, "QUIT") == 0) {
                fprintf(stderr, "controller: Quit command received\n");
                g_running = 0;
            }
        }

        /*
         * When idle, briefly grab the camera to check for new files
         * (from physical shutter), then release it immediately.
         * Camera is only locked for the duration of the check.
         *
         * When in live view mode, skip polling entirely - camera stays open.
         *
         * Retry logic with exponential backoff for camera open failures.
         */
        if (mode == MODE_IDLE && !live_view_active) {
            int poll_attempts = 0;
            while (poll_attempts < MAX_OPEN_RETRIES && g_running) {
                camera = open_camera(camera_index, &ret);
                if (camera) {
                    consecutive_open_failures = 0;  /* Reset counter on success */
                    break;
                }
                poll_attempts++;
                fprintf(stderr, "controller: Camera open failed for polling (attempt %d/%d): %s\n",
                        poll_attempts, MAX_OPEN_RETRIES, gp_result_as_string(ret));

                if (poll_attempts < MAX_OPEN_RETRIES) {
                    /* Exponential backoff: 2s, 4s, 8s, 16s, 32s */
                    int backoff_ms = OPEN_RETRY_DELAY_MS * (1 << (poll_attempts - 1));
                    fprintf(stderr, "controller: Waiting %d ms before retry...\n", backoff_ms);
                    usleep(backoff_ms * 1000);
                }
            }

            if (camera) {
                // List all available widgets once (for debugging widget names)
                if (!g_widgets_listed) {
                    list_all_widgets(camera, context);
                    g_widgets_listed = 1;
                }

                int new_num = check_and_download_all_files(camera, context);
                if (new_num > last_file_number) {
                    last_file_number = new_num;
                }

                // Fetch battery, ISO, aperture, shutter, EV, white balance, and shooting mode
                char *battery = get_single_config_value(camera, context, "d36b");
                char *iso = get_single_config_value(camera, context, "iso");
                char *aperture = get_single_config_value(camera, context, "f-number");
                char *shutter = get_single_config_value(camera, context, "shutterspeed");
                char *ev = get_single_config_value(camera, context, "exposurecompensation");
                char *wb = get_single_config_value(camera, context, "whitebalance");

                // Try multiple possible widget names for shooting mode
                char *shootingmode = get_single_config_value(camera, context, "expprogram");
                if (!shootingmode) {
                    shootingmode = get_single_config_value(camera, context, "exposureprogram");
                }
                if (!shootingmode) {
                    shootingmode = get_single_config_value(camera, context, "exposuremode");
                }
                if (!shootingmode) {
                    shootingmode = get_single_config_value(camera, context, "capturemode");
                }

                fprintf(stderr, "controller: Mode: %s | Battery: %s | ISO: %s | Aperture: %s | Shutter: %s | EV: %s | WB: %s\n",
                        shootingmode ? shootingmode : "N/A",
                        battery ? battery : "N/A",
                        iso ? iso : "N/A",
                        aperture ? aperture : "N/A",
                        shutter ? shutter : "N/A",
                        ev ? ev : "N/A",
                        wb ? wb : "N/A");

                if (g_status_fd >= 0) {
                    char status_msg[1536];
                    snprintf(status_msg, sizeof(status_msg),
                            "{\"mode\":\"idle\",\"shootingmode\":\"%s\",\"battery\":\"%s\",\"iso\":\"%s\",\"aperture\":\"%s\",\"shutter\":\"%s\",\"ev\":\"%s\",\"wb\":\"%s\"}\n",
                            shootingmode ? shootingmode : "",
                            battery ? battery : "",
                            iso ? iso : "",
                            aperture ? aperture : "",
                            shutter ? shutter : "",
                            ev ? ev : "",
                            wb ? wb : "");
                    ssize_t written = write(g_status_fd, status_msg, strlen(status_msg));
                    if (written < 0) {
                        fprintf(stderr, "controller: Failed to write status: %s\n", strerror(errno));
                    }
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
                fprintf(stderr, "controller: Failed to open camera for polling after %d attempts (consecutive failures: %d)\n",
                        MAX_OPEN_RETRIES, consecutive_open_failures);

                /* If we've had too many consecutive failures, wait longer before next poll */
                if (consecutive_open_failures > 3) {
                    fprintf(stderr, "controller: Multiple consecutive failures, waiting 10 seconds...\n");
                    sleep(10);
                }
            }
        }

        /* Sleep 2 seconds between polls — camera is free during this time */
        sleep(2);
    }

    /* Cleanup */
    fprintf(stderr, "controller: Shutting down...\n");
    if (camera) {
        if (live_view_active) {
            fprintf(stderr, "controller: Exiting live view for shutdown...\n");
        }
        gp_camera_exit(camera, context);
        gp_camera_free(camera);
    }
    gp_context_unref(context);
    if (cmd_fd >= 0) close(cmd_fd);
    if (g_status_fd >= 0) close(g_status_fd);
    unlink(CMD_PIPE);
    unlink(STATUS_PIPE);

    return 0;
}
