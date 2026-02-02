/*
 * gphoto2-wrapper - Simple CLI wrapper around libgphoto2
 *
 * Commands:
 *   gphoto2-wrapper version               - Check libgphoto2 availability
 *   gphoto2-wrapper list                  - List connected cameras (JSON)
 *   gphoto2-wrapper capture [camera_id]   - Capture image and print file path
 *   gphoto2-wrapper debug [camera_id]     - Print camera abilities and config summary
 *   gphoto2-wrapper config [camera_id]    - Get current camera configuration/settings (JSON)
 *   gphoto2-wrapper widgets [camera_id]   - List all available config widgets (JSON)
 *   gphoto2-wrapper setconfig <json> [camera_id] - Set camera configuration (JSON input)
 *   gphoto2-wrapper status [camera_id]    - Get quick camera status (battery, ISO, etc.)
 *
 * camera_id: Optional index of camera to use (0-based). Default: 0 (first camera)
 *
 * Output is JSON for easy parsing by the camera daemon.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <gphoto2/gphoto2.h>
#include <gphoto2/gphoto2-port-version.h>
#include <gphoto2/gphoto2-version.h>

/* Global flag for signal-based shutdown (used by watch/liveview loops) */
static volatile sig_atomic_t g_shutdown_requested = 0;

#define MAX_CAPTURED_FILES 10

static void signal_handler(int sig) {
    (void)sig;
    g_shutdown_requested = 1;
}

static void install_signal_handlers(void) {
    struct sigaction sa;
    sa.sa_handler = signal_handler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = 0;
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGINT, &sa, NULL);
}

/* Context error/status/message callbacks for verbose logging */
static void ctx_error_func(GPContext *context, const char *msg, void *data) {
    (void)context; (void)data;
    fprintf(stderr, "gphoto2 ERROR: %s\n", msg);
}

static void ctx_status_func(GPContext *context, const char *msg, void *data) {
    (void)context; (void)data;
    fprintf(stderr, "gphoto2 status: %s\n", msg);
}

static void ctx_message_func(GPContext *context, const char *msg, void *data) {
    (void)context; (void)data;
    fprintf(stderr, "gphoto2 message: %s\n", msg);
}

static GPContext *create_context(void);
static void list_widgets_recursive(CameraWidget *widget, int depth, int reset_first);
static void list_all_widgets(int camera_index);
static void get_camera_status(int camera_index);
static void set_config(const char *json_config, int camera_index);
static Camera* open_camera_by_index(int camera_index, GPContext *context, int *ret_out);
static void watch_camera(int camera_index);

/* Open a specific camera by index (0-based) */
static Camera* open_camera_by_index(int camera_index, GPContext *context, int *ret_out) {
    Camera *camera = NULL;
    CameraList *list = NULL;
    GPPortInfoList *port_info_list = NULL;
    CameraAbilitiesList *abilities_list = NULL;
    GPPortInfo port_info;
    CameraAbilities abilities;
    const char *model_name = NULL;
    const char *port_name = NULL;
    int ret, count;

    if (ret_out) *ret_out = GP_OK;

    /* Create camera object */
    ret = gp_camera_new(&camera);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to create camera: %s\n", gp_result_as_string(ret));
        if (ret_out) *ret_out = ret;
        return NULL;
    }

    /* Create and load lists */
    ret = gp_list_new(&list);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to create list: %s\n", gp_result_as_string(ret));
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_port_info_list_new(&port_info_list);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to create port info list: %s\n", gp_result_as_string(ret));
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_port_info_list_load(port_info_list);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to load port info: %s\n", gp_result_as_string(ret));
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_abilities_list_new(&abilities_list);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to create abilities list: %s\n", gp_result_as_string(ret));
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_abilities_list_load(abilities_list, context);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to load abilities: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    /* Detect cameras */
    ret = gp_abilities_list_detect(abilities_list, port_info_list, list, context);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to detect cameras: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    /* Check camera index is valid */
    count = gp_list_count(list);
    if (camera_index < 0 || camera_index >= count) {
        fprintf(stderr, "open_camera: Camera index %d out of range (0-%d)\n", camera_index, count - 1);
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = GP_ERROR_BAD_PARAMETERS;
        gp_camera_free(camera);
        return NULL;
    }

    /* Get model and port for the selected camera */
    gp_list_get_name(list, camera_index, &model_name);
    gp_list_get_value(list, camera_index, &port_name);
    fprintf(stderr, "open_camera: Opening camera %d: %s at %s\n", camera_index, model_name, port_name);

    /* Lookup abilities */
    int model_index = gp_abilities_list_lookup_model(abilities_list, model_name);
    if (model_index < GP_OK) {
        fprintf(stderr, "open_camera: Failed to lookup model: %s\n", gp_result_as_string(model_index));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = model_index;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_abilities_list_get_abilities(abilities_list, model_index, &abilities);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to get abilities: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    /* Lookup port */
    int port_index = gp_port_info_list_lookup_path(port_info_list, port_name);
    if (port_index < GP_OK) {
        fprintf(stderr, "open_camera: Failed to lookup port: %s\n", gp_result_as_string(port_index));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = port_index;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_port_info_list_get_info(port_info_list, port_index, &port_info);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to get port info: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    /* Set abilities and port on camera */
    ret = gp_camera_set_abilities(camera, abilities);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to set abilities: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_camera_set_port_info(camera, port_info);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to set port info: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    /* Initialize the camera */
    ret = gp_camera_init(camera, context);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to init camera: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    /* Cleanup */
    gp_abilities_list_free(abilities_list);
    gp_port_info_list_free(port_info_list);
    gp_list_free(list);

    fprintf(stderr, "open_camera: Successfully opened camera %d\n", camera_index);
    return camera;
}

static GPContext *create_context(void) {
    GPContext *ctx = gp_context_new();
    if (ctx) {
        gp_context_set_error_func(ctx, ctx_error_func, NULL);
        gp_context_set_status_func(ctx, ctx_status_func, NULL);
        gp_context_set_message_func(ctx, ctx_message_func, NULL);
    }
    return ctx;
}

static void print_version(void) {
    const char **version = gp_library_version(GP_VERSION_SHORT);
    printf("{\"libgphoto2\":\"%s\",\"available\":true}\n", version[0]);
}

static void print_cameras(void) {
    Camera *camera = NULL;
    GPContext *context = NULL;
    CameraList *list = NULL;
    GPPortInfoList *port_info_list = NULL;
    CameraAbilitiesList *abilities_list = NULL;
    CameraAbilities abilities;
    int ret, count;

    context = create_context();
    if (!context) {
        fprintf(stderr, "{\"error\":\"Failed to create context\"}\n");
        return;
    }

    ret = gp_list_new(&list);
    if (ret < GP_OK) {
        fprintf(stderr, "{\"error\":\"Failed to create list: %s\"}\n", gp_result_as_string(ret));
        gp_context_unref(context);
        return;
    }

    ret = gp_port_info_list_new(&port_info_list);
    if (ret < GP_OK) {
        fprintf(stderr, "{\"error\":\"Failed to create port info list\"}\n");
        gp_list_free(list);
        gp_context_unref(context);
        return;
    }

    ret = gp_port_info_list_load(port_info_list);
    if (ret < GP_OK) {
        fprintf(stderr, "{\"error\":\"Failed to load port info: %s\"}\n", gp_result_as_string(ret));
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        gp_context_unref(context);
        return;
    }

    ret = gp_abilities_list_new(&abilities_list);
    if (ret < GP_OK) {
        fprintf(stderr, "{\"error\":\"Failed to create abilities list\"}\n");
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        gp_context_unref(context);
        return;
    }

    ret = gp_abilities_list_load(abilities_list, context);
    if (ret < GP_OK) {
        fprintf(stderr, "{\"error\":\"Failed to load abilities: %s\"}\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        gp_context_unref(context);
        return;
    }

    ret = gp_abilities_list_detect(abilities_list, port_info_list, list, context);
    if (ret < GP_OK) {
        fprintf(stderr, "{\"error\":\"Failed to detect cameras: %s\"}\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        gp_context_unref(context);
        return;
    }

    count = gp_list_count(list);
    printf("[");
    for (int i = 0; i < count; i++) {
        const char *port;
        const char *model_str = "Unknown Camera";
        const char *manufacturer_str = "";
        const char *usb_version_str = "";

        gp_list_get_value(list, i, &port);

        /* Briefly open the camera to get the real model name from summary */
        int open_ret;
        camera = open_camera_by_index(i, context, &open_ret);

        if (camera) {
            /* Get camera summary which contains the real manufacturer and model */
            CameraText summary;
            ret = gp_camera_get_summary(camera, &summary, context);
            if (ret >= GP_OK) {
                /* Parse manufacturer and model from summary text */
                const char *summary_text = summary.text;

                /* Look for "Manufacturer:" line */
                const char *mfg_key = "Manufacturer:";
                const char *mfg_pos = strstr(summary_text, mfg_key);
                if (mfg_pos) {
                    mfg_pos += strlen(mfg_key);
                    /* Skip whitespace */
                    while (*mfg_pos == ' ' || *mfg_pos == '\t') mfg_pos++;
                    /* Extract until newline */
                    static char mfg_buf[128];
                    int j = 0;
                    while (*mfg_pos && *mfg_pos != '\n' && *mfg_pos != '\r' && j < 127) {
                        mfg_buf[j++] = *mfg_pos++;
                    }
                    mfg_buf[j] = '\0';
                    manufacturer_str = mfg_buf;
                }

                /* Look for "Model:" line */
                const char *model_key = "Model:";
                const char *model_pos = strstr(summary_text, model_key);
                if (model_pos) {
                    model_pos += strlen(model_key);
                    /* Skip whitespace */
                    while (*model_pos == ' ' || *model_pos == '\t') model_pos++;
                    /* Extract until newline */
                    static char model_buf[128];
                    int j = 0;
                    while (*model_pos && *model_pos != '\n' && *model_pos != '\r' && j < 127) {
                        model_buf[j++] = *model_pos++;
                    }
                    model_buf[j] = '\0';
                    model_str = model_buf;
                }
            }

            /* Close and cleanup the camera */
            gp_camera_exit(camera, context);
            gp_camera_free(camera);
            camera = NULL;
        }

        /* Detect USB version from port string */
        /* Port format: "usb:BUS,DEVICE" e.g., "usb:003,002" */
        int bus_num = 0, device_num = 0;
        if (sscanf(port, "usb:%d,%d", &bus_num, &device_num) == 2) {
            /* Try to read USB speed from sysfs */
            char sysfs_path[256];
            FILE *speed_file;

            /* Try multiple possible sysfs path formats */
            const char *path_formats[] = {
                "/sys/bus/usb/devices/%d-%d/speed",
                "/sys/bus/usb/devices/%d-%d:1.0/speed",
                "/sys/bus/usb/devices/usb%d/speed",
                NULL
            };

            for (int fmt_idx = 0; path_formats[fmt_idx] != NULL; fmt_idx++) {
                snprintf(sysfs_path, sizeof(sysfs_path), path_formats[fmt_idx], bus_num, device_num);
                speed_file = fopen(sysfs_path, "r");

                if (speed_file) {
                    float speed_mbps = 0;
                    if (fscanf(speed_file, "%f", &speed_mbps) == 1) {
                        /* Determine USB version from speed */
                        static char usb_buf[32];
                        if (speed_mbps >= 5000) {
                            snprintf(usb_buf, sizeof(usb_buf), "USB 3.x (%.0f Gbps)", speed_mbps / 1000);
                            usb_version_str = usb_buf;
                        } else if (speed_mbps == 480) {
                            snprintf(usb_buf, sizeof(usb_buf), "USB 2.0 (480 Mbps)");
                            usb_version_str = usb_buf;
                        } else if (speed_mbps == 12) {
                            usb_version_str = "USB 1.1 (12 Mbps)";
                        } else if (speed_mbps <= 1.5) {
                            usb_version_str = "USB 1.0 (1.5 Mbps)";
                        }
                        fprintf(stderr, "USB detection: path=%s speed=%.1f result=%s\n",
                                sysfs_path, speed_mbps, usb_version_str);
                    }
                    fclose(speed_file);
                    if (usb_version_str[0] != '\0') break; /* Found it */
                }
            }
        }

        if (i > 0) printf(",");

        /* Escape strings for JSON */
        printf("{\"id\":\"%d\",\"manufacturer\":\"", i);
        for (const char *p = manufacturer_str; *p; p++) {
            if (*p == '"') printf("\\\"");
            else if (*p == '\\') printf("\\\\");
            else if (*p == '\n') printf("\\n");
            else if (*p >= 32) putchar(*p);
        }
        printf("\",\"model\":\"");
        for (const char *p = model_str; *p; p++) {
            if (*p == '"') printf("\\\"");
            else if (*p == '\\') printf("\\\\");
            else if (*p == '\n') printf("\\n");
            else if (*p >= 32) putchar(*p);
        }
        printf("\",\"port\":\"%s\",\"usb_version\":\"", port);
        for (const char *p = usb_version_str; *p; p++) {
            if (*p == '"') printf("\\\"");
            else if (*p == '\\') printf("\\\\");
            else if (*p == '\n') printf("\\n");
            else if (*p >= 32) putchar(*p);
        }
        printf("\"}");
    }
    printf("]\n");

    gp_abilities_list_free(abilities_list);
    gp_port_info_list_free(port_info_list);
    gp_list_free(list);
    gp_context_unref(context);
}

static void debug_camera(int camera_index) {
    Camera *camera = NULL;
    GPContext *context = NULL;
    CameraAbilities abilities;
    int ret;

    context = create_context();
    if (!context) {
        printf("{\"error\":\"Failed to create context\"}\n");
        return;
    }

    fprintf(stderr, "debug: Opening camera %d...\n", camera_index);
    camera = open_camera_by_index(camera_index, context, &ret);
    if (!camera) {
        printf("{\"error\":\"Failed to open camera %d: %s (code %d)\"}\n",
               camera_index, gp_result_as_string(ret), ret);
        gp_context_unref(context);
        return;
    }

    /* Get camera abilities */
    ret = gp_camera_get_abilities(camera, &abilities);
    if (ret < GP_OK) {
        printf("{\"error\":\"Failed to get abilities: %s (code %d)\"}\n",
               gp_result_as_string(ret), ret);
        gp_camera_exit(camera, context);
        gp_camera_free(camera);
        gp_context_unref(context);
        return;
    }

    /* Get camera summary */
    CameraText summary;
    ret = gp_camera_get_summary(camera, &summary, context);

    printf("{\"model\":\"%s\",\"driver_status\":%d,"
           "\"operations\":%d,"
           "\"file_operations\":%d,"
           "\"folder_operations\":%d,"
           "\"capture_supported\":%s,"
           "\"preview_supported\":%s,"
           "\"config_supported\":%s",
           abilities.model,
           abilities.status,
           abilities.operations,
           abilities.file_operations,
           abilities.folder_operations,
           (abilities.operations & GP_OPERATION_CAPTURE_IMAGE) ? "true" : "false",
           (abilities.operations & GP_OPERATION_CAPTURE_PREVIEW) ? "true" : "false",
           (abilities.operations & GP_OPERATION_CONFIG) ? "true" : "false");

    if (ret >= GP_OK) {
        /* Print first 200 chars of summary, escaping quotes/newlines */
        printf(",\"summary\":\"");
        int len = strlen(summary.text);
        if (len > 500) len = 500;
        for (int i = 0; i < len; i++) {
            char c = summary.text[i];
            if (c == '"') printf("\\\"");
            else if (c == '\\') printf("\\\\");
            else if (c == '\n') printf("\\n");
            else if (c == '\r') continue;
            else if (c >= 32) putchar(c);
        }
        printf("\"");
    }

    printf("}\n");

    gp_camera_exit(camera, context);
    gp_camera_free(camera);
    gp_context_unref(context);
}

/* Helper to find a widget by name in the config tree */
static CameraWidget* find_widget(CameraWidget *widget, const char *name) {
    if (!widget) return NULL;

    /* Check if this widget matches */
    const char *widget_name = NULL;
    gp_widget_get_name(widget, &widget_name);
    if (widget_name && strcmp(widget_name, name) == 0) {
        return widget;
    }

    /* Search through all children */
    for (int i = 0; ; i++) {
        CameraWidget *sub_widget = NULL;
        int ret = gp_widget_get_child(widget, i, &sub_widget);
        if (ret != GP_OK) break;

        CameraWidget *found = find_widget(sub_widget, name);
        if (found) return found;
    }

    return NULL;
}

/* Helper to get string value from a widget */
static const char* get_widget_value(CameraWidget *widget) {
    static char value_buf[256];
    const char *value = NULL;
    CameraWidgetType type;

    gp_widget_get_type(widget, &type);

    if (type == GP_WIDGET_TEXT) {
        gp_widget_get_value(widget, &value);
    } else if (type == GP_WIDGET_RADIO || type == GP_WIDGET_MENU) {
        gp_widget_get_value(widget, &value);
    } else if (type == GP_WIDGET_RANGE) {
        float float_val;
        gp_widget_get_value(widget, &float_val);
        snprintf(value_buf, sizeof(value_buf), "%.1f", float_val);
        return value_buf;
    } else if (type == GP_WIDGET_TOGGLE) {
        int toggle_val;
        gp_widget_get_value(widget, &toggle_val);
        snprintf(value_buf, sizeof(value_buf), "%s", toggle_val ? "true" : "false");
        return value_buf;
    }

    return value ? value : "";
}

/* Get camera configuration as JSON */
static void get_config(int camera_index) {
    Camera *camera = NULL;
    GPContext *context = NULL;
    CameraWidget *config = NULL;
    CameraWidget *widget = NULL;
    int ret;

    context = create_context();
    if (!context) {
        printf("{\"error\":\"Failed to create context\"}\n");
        return;
    }

    fprintf(stderr, "config: Opening camera %d...\n", camera_index);
    camera = open_camera_by_index(camera_index, context, &ret);
    if (!camera) {
        printf("{\"error\":\"Failed to open camera %d: %s\"}\n",
               camera_index, gp_result_as_string(ret));
        gp_context_unref(context);
        return;
    }

    /* Get configuration */
    ret = gp_camera_get_config(camera, &config, context);
    if (ret < GP_OK) {
        printf("{\"error\":\"Failed to get config: %s\"}\n", gp_result_as_string(ret));
        gp_camera_exit(camera, context);
        gp_camera_free(camera);
        gp_context_unref(context);
        return;
    }

    /* Common settings we want to read */
    const char *settings[] = {
        "iso",
        "aperture",
        "f-number",  // Alternative aperture name
        "shutterspeed",
        "shutterspeed2",
        "exposurecompensation",
        "whitebalance",
        "focusmode",
        "drivemode",
        "imageformat",
        "imagesize",
        "flashmode",
        "lensname",  // Lens name (Camera Status Information)
        "d36b",  // BatteryInfo2 (Fuji X-H2 battery level)
        NULL
    };

    printf("{");
    int first = 1;
    for (int i = 0; settings[i] != NULL; i++) {
        widget = find_widget(config, settings[i]);
        if (widget) {
            const char *value = get_widget_value(widget);
            const char *label = NULL;
            const char *name = NULL;
            CameraWidgetType type;

            gp_widget_get_label(widget, &label);
            gp_widget_get_name(widget, &name);
            gp_widget_get_type(widget, &type);

            if (!first) printf(",");
            first = 0;

            /* Escape strings for JSON */
            printf("\"%s\":{", name ? name : settings[i]);

            /* Output value */
            printf("\"value\":\"");
            for (const char *p = value; *p; p++) {
                if (*p == '"') printf("\\\"");
                else if (*p == '\\') printf("\\\\");
                else if (*p == '\n') printf("\\n");
                else if (*p >= 32) putchar(*p);
            }
            printf("\",");

            /* Output label */
            printf("\"label\":\"");
            if (label) {
                for (const char *p = label; *p; p++) {
                    if (*p == '"') printf("\\\"");
                    else if (*p == '\\') printf("\\\\");
                    else if (*p == '\n') printf("\\n");
                    else if (*p >= 32) putchar(*p);
                }
            }
            printf("\",");

            /* Output type */
            const char *type_str = "unknown";
            switch (type) {
                case GP_WIDGET_TEXT: type_str = "text"; break;
                case GP_WIDGET_RANGE: type_str = "range"; break;
                case GP_WIDGET_TOGGLE: type_str = "toggle"; break;
                case GP_WIDGET_RADIO: type_str = "radio"; break;
                case GP_WIDGET_MENU: type_str = "menu"; break;
                case GP_WIDGET_DATE: type_str = "date"; break;
                default: break;
            }
            printf("\"type\":\"%s\"", type_str);

            /* For radio/menu, output available choices */
            if (type == GP_WIDGET_RADIO || type == GP_WIDGET_MENU) {
                int choices = gp_widget_count_choices(widget);
                if (choices > 0) {
                    printf(",\"choices\":[");
                    for (int j = 0; j < choices; j++) {
                        const char *choice = NULL;
                        gp_widget_get_choice(widget, j, &choice);
                        if (j > 0) printf(",");
                        printf("\"");
                        if (choice) {
                            for (const char *p = choice; *p; p++) {
                                if (*p == '"') printf("\\\"");
                                else if (*p == '\\') printf("\\\\");
                                else if (*p >= 32) putchar(*p);
                            }
                        }
                        printf("\"");
                    }
                    printf("]");
                }
            }

            /* For range, output min/max/step */
            if (type == GP_WIDGET_RANGE) {
                float min, max, step;
                gp_widget_get_range(widget, &min, &max, &step);
                printf(",\"min\":%g,\"max\":%g,\"step\":%g", min, max, step);
            }

            printf("}");
        }
    }
    printf("}\n");

    gp_widget_free(config);
    gp_camera_exit(camera, context);
    gp_camera_free(camera);
    gp_context_unref(context);
}

/* Set camera configuration from JSON */
static void set_config(const char *json_config, int camera_index) {
    Camera *camera = NULL;
    GPContext *context = NULL;
    CameraWidget *widget = NULL;
    int ret;

    /* Simple JSON parser to extract "setting" and "value" */
    const char *setting_key = NULL;
    const char *value_str = NULL;

    /* Create a mutable copy of the JSON string for parsing */
    char *json_copy = strdup(json_config);
    if (!json_copy) {
        printf("{\"error\":\"Memory allocation failed\"}\n");
        return;
    }

    /* Parse JSON manually - looking for "setting" and "value" keys */
    char *p = json_copy;
    while (*p && *p != '\0') {
        if (strncmp(p, "\"setting\"", 9) == 0) {
            p += 9;  // skip "setting"
            while (*p && (*p == ' ' || *p == '\t' || *p == ':')) p++;
            if (*p == '"') {
                p++;  // skip opening quote
                setting_key = p;
                while (*p && *p != '"') p++;
                if (*p) { *p = '\0'; p++; }  // null terminate string
            }
        } else if (strncmp(p, "\"value\"", 7) == 0) {
            p += 7;  // skip "value"
            while (*p && (*p == ' ' || *p == '\t' || *p == ':')) p++;
            if (*p == '"') {
                p++;  // skip opening quote
                value_str = p;
                while (*p && *p != '"') p++;
                if (*p) { *p = '\0'; p++; }  // null terminate string
            }
        } else {
            p++;
        }
    }

    if (!setting_key || !value_str) {
        free(json_copy);
        printf("{\"error\":\"JSON must contain 'setting' and 'value' keys. Example: {\\\"setting\\\":\\\"iso\\\", \\\"value\\\":\\\"800\\\"}\"}\n");
        return;
    }

    context = create_context();
    if (!context) {
        printf("{\"error\":\"Failed to create context\"}\n");
        free(json_copy);
        return;
    }

    fprintf(stderr, "setconfig: Opening camera %d...\n", camera_index);
    camera = open_camera_by_index(camera_index, context, &ret);
    if (!camera) {
        printf("{\"error\":\"Failed to open camera %d: %s\"}\n",
               camera_index, gp_result_as_string(ret));
        gp_context_unref(context);
        free(json_copy);
        return;
    }

    /* Get single config widget directly (much faster than fetching entire config tree) */
    ret = gp_camera_get_single_config(camera, setting_key, &widget, context);
    if (ret < GP_OK || !widget) {
        printf("{\"error\":\"Setting '%s' not found in camera configuration: %s\"}\n",
               setting_key, gp_result_as_string(ret));
        gp_camera_exit(camera, context);
        gp_camera_free(camera);
        gp_context_unref(context);
        free(json_copy);
        return;
    }

    /* Set the value */
    CameraWidgetType type;
    gp_widget_get_type(widget, &type);

    int set_ret = GP_OK;
    const char *error_msg = NULL;

    if (type == GP_WIDGET_RADIO || type == GP_WIDGET_MENU) {
        /* For radio/menu, try to set by choice value */
        int choices = gp_widget_count_choices(widget);
        int found = 0;
        for (int i = 0; i < choices && !found; i++) {
            const char *choice = NULL;
            gp_widget_get_choice(widget, i, &choice);
            if (choice && (strcmp(choice, value_str) == 0 ||
                         strcasecmp(choice, value_str) == 0)) {
                set_ret = gp_widget_set_value(widget, choice);
                found = 1;
                fprintf(stderr, "setconfig: Set %s to choice '%s' (index %d)\n",
                       setting_key, choice, i);
            }
        }
        if (!found) {
            error_msg = "Choice not found in available options";
            set_ret = GP_ERROR;
        }
    } else if (type == GP_WIDGET_TOGGLE) {
        /* For toggle, accept "0"/"1" or "off"/"on" */
        int toggle_val = 0;
        if (strcmp(value_str, "1") == 0 || strcasecmp(value_str, "on") == 0 ||
            strcasecmp(value_str, "true") == 0) {
            toggle_val = 1;
        }
        set_ret = gp_widget_set_value(widget, &toggle_val);
        fprintf(stderr, "setconfig: Set %s to %d\n", setting_key, toggle_val);
    } else if (type == GP_WIDGET_TEXT || type == GP_WIDGET_RANGE) {
        /* For text/range, set the string value */
        set_ret = gp_widget_set_value(widget, value_str);
        fprintf(stderr, "setconfig: Set %s to '%s'\n", setting_key, value_str);
    } else {
        error_msg = "Unsupported widget type for setting";
        set_ret = GP_ERROR;
    }

    if (set_ret < GP_OK) {
        printf("{\"error\":\"Failed to set %s: %s\"}\n",
                setting_key,
                error_msg ? error_msg : gp_result_as_string(set_ret));
    } else {
        /* Save single config to camera (much faster than saving entire config tree) */
        int save_ret = gp_camera_set_single_config(camera, setting_key, widget, context);
        if (save_ret < GP_OK) {
            printf("{\"warning\":\"Value set but failed to save to camera: %s\"}\n",
                   gp_result_as_string(save_ret));
        }

        printf("{\"success\":true,\"setting\":\"%s\",\"value\":\"%s\"}\n",
               setting_key, value_str);
    }

    gp_widget_free(widget);
    gp_camera_exit(camera, context);
    gp_camera_free(camera);
    gp_context_unref(context);
    free(json_copy);
}

typedef struct {
    char folder[128];
    char name[128];
    char local_path[512];
} CapturedFile;

/* Extract the numeric part from a filename like "DSCF0042.JPG" or "DSCF0001.RAF" */
static int extract_file_number(const char *filename) {
    const char *p = filename;
    int number = 0;

    /* Skip to first digit */
    while (*p && !(*p >= '0' && *p <= '9')) p++;

    /* Parse number */
    while (*p >= '0' && *p <= '9') {
        number = number * 10 + (*p - '0');
        p++;
    }

    return number;
}

/* List files in a folder and find the highest numbered file */
static int find_highest_file(Camera *camera, const char *folder, GPContext *context,
                             char *out_name, size_t out_name_size) {
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
    fprintf(stderr, "find_highest_file: %d files in %s\n", count, folder);

    for (int i = 0; i < count; i++) {
        const char *name;
        gp_list_get_name(file_list, i, &name);
        int num = extract_file_number(name);
        if (num > max_number) {
            max_number = num;
            strncpy(max_name_buf, name, sizeof(max_name_buf) - 1);
            max_name_buf[sizeof(max_name_buf) - 1] = '\0';
        }
    }

    gp_list_free(file_list);

    if (max_name_buf[0] && out_name) {
        strncpy(out_name, max_name_buf, out_name_size - 1);
        out_name[out_name_size - 1] = '\0';
        fprintf(stderr, "find_highest_file: highest is %s (number %d)\n", max_name_buf, max_number);
    }

    return max_number;
}

static void capture_image(int camera_index) {
    Camera *camera = NULL;
    GPContext *context = NULL;
    CameraFilePath camera_file_path;
    CameraFile *file = NULL;
    int ret;
    char output_path[512];

    context = create_context();
    if (!context) {
        printf("{\"success\":false,\"error\":\"Failed to create context\"}\n");
        return;
    }

    fprintf(stderr, "capture: Opening camera %d...\n", camera_index);
    camera = open_camera_by_index(camera_index, context, &ret);
    if (!camera) {
        printf("{\"success\":false,\"error\":\"Failed to open camera %d: %s (code %d)\"}\n",
               camera_index, gp_result_as_string(ret), ret);
        gp_context_unref(context);
        return;
    }

    /* DEBUG: Find highest file before capture */
    char highest_before[128];
    const char *folders[] = {"/store_10000001", "/DCIM/100_FUJI", "/DCIM", NULL};
    for (int fi = 0; folders[fi] != NULL; fi++) {
        int num = find_highest_file(camera, folders[fi], context, highest_before, sizeof(highest_before));
        if (num >= 0) {
            fprintf(stderr, "DEBUG: Before capture - highest in %s is %s (number %d)\n", folders[fi], highest_before, num);
            break;
        }
    }

    /*
     * Fuji cameras (like X-H2) have a known quirk: gp_camera_capture fires the
     * shutter but returns GP_ERROR with "Fuji Capture failed: Perhaps no auto-focus?"
     * The photo IS taken, but the function reports failure.
     *
     * For RAW+JPEG mode, we need to wait for and download ALL files.
     */
    CapturedFile captured_files[MAX_CAPTURED_FILES];
    int captured_count = 0;
    int capture_complete = 0;

    fprintf(stderr, "capture: Trying gp_camera_capture...\n");
    ret = gp_camera_capture(camera, GP_CAPTURE_IMAGE, &camera_file_path, context);

    if (ret >= GP_OK) {
        fprintf(stderr, "capture: gp_camera_capture succeeded: %s/%s\n",
                camera_file_path.folder, camera_file_path.name);
        strncpy(captured_files[captured_count].folder, camera_file_path.folder, sizeof(captured_files[captured_count].folder) - 1);
        strncpy(captured_files[captured_count].name, camera_file_path.name, sizeof(captured_files[captured_count].name) - 1);
        captured_count++;
    } else {
        fprintf(stderr, "capture: gp_camera_capture returned %d (%s) - waiting for file events\n",
                ret, gp_result_as_string(ret));
    }

    /* Wait for ALL files from this capture (RAW+JPEG produces 2 files)
     * If gp_camera_capture succeeded, we already have the first file, so wait briefly
     * for additional files (RAW+JPEG case). If it failed (Fuji quirk), wait longer. */
    int wait_retries = (captured_count > 0) ? 15 : 100; /* 3 seconds if success, 20 seconds if Fuji quirk */
    int files_after_complete = 0;

    while (wait_retries-- > 0 && captured_count < MAX_CAPTURED_FILES) {
        CameraEventType event_type;
        void *event_data = NULL;

        ret = gp_camera_wait_for_event(camera, 200, &event_type, &event_data, context);
        if (ret < GP_OK) {
            fprintf(stderr, "capture: wait_for_event error: %d (%s)\n",
                    ret, gp_result_as_string(ret));
            /* Continue waiting for more files even after error */
            continue;
        }

        if (event_type == GP_EVENT_FILE_ADDED) {
            CameraFilePath *path = (CameraFilePath *)event_data;
            fprintf(stderr, "capture: File added: %s/%s\n", path->folder, path->name);

            /* Check if this file is already in our list */
            int already_captured = 0;
            for (int i = 0; i < captured_count; i++) {
                if (strcmp(captured_files[i].name, path->name) == 0 &&
                    strcmp(captured_files[i].folder, path->folder) == 0) {
                    already_captured = 1;
                    break;
                }
            }

            if (!already_captured && captured_count < MAX_CAPTURED_FILES) {
                strncpy(captured_files[captured_count].folder, path->folder, sizeof(captured_files[captured_count].folder) - 1);
                strncpy(captured_files[captured_count].name, path->name, sizeof(captured_files[captured_count].name) - 1);
                captured_count++;
            }
            free(event_data);

        } else if (event_type == GP_EVENT_CAPTURE_COMPLETE) {
            fprintf(stderr, "capture: Capture complete event (files may still be coming)\n");
            capture_complete = 1;
            if (event_data) free(event_data);

            /* After capture complete, wait a bit more for additional files */
            files_after_complete = 5; /* ~1 more second */

        } else if (event_type == GP_EVENT_TIMEOUT) {
            if (capture_complete && files_after_complete > 0) {
                files_after_complete--;
                if (files_after_complete <= 0) {
                    fprintf(stderr, "capture: Timeout after capture complete, stopping\n");
                    break;
                }
            }
        } else {
            if (event_data) free(event_data);
        }
    }

    /* DEBUG: Find highest file after capture */
    char highest_after[128];
    for (int fi = 0; folders[fi] != NULL; fi++) {
        int num = find_highest_file(camera, folders[fi], context, highest_after, sizeof(highest_after));
        if (num >= 0) {
            fprintf(stderr, "DEBUG: After capture - highest in %s is %s (number %d)\n", folders[fi], highest_after, num);
            break;
        }
    }

    fprintf(stderr, "capture: Got %d file(s), downloading...\n", captured_count);

    if (captured_count == 0) {
        printf("{\"success\":false,\"error\":\"Capture fired but could not retrieve file from camera\"}\n");
        gp_camera_exit(camera, context);
        gp_camera_free(camera);
        gp_context_unref(context);
        return;
    }

    /* Download all captured files */
    printf("{\"success\":true,\"files\":[");
    for (int i = 0; i < captured_count; i++) {
        /* Download the file from camera to /tmp */
        ret = gp_file_new(&file);
        if (ret < GP_OK) {
            fprintf(stderr, "capture: Failed to create file object: %s\n", gp_result_as_string(ret));
            continue;
        }

        snprintf(output_path, sizeof(output_path), "/tmp/%s", captured_files[i].name);
        ret = gp_camera_file_get(camera, captured_files[i].folder, captured_files[i].name,
                                  GP_FILE_TYPE_NORMAL, file, context);
        if (ret < GP_OK) {
            fprintf(stderr, "capture: Failed to download %s: %s\n", captured_files[i].name, gp_result_as_string(ret));
            gp_file_free(file);
            continue;
        }

        ret = gp_file_save(file, output_path);
        if (ret < GP_OK) {
            fprintf(stderr, "capture: Failed to save %s: %s\n", output_path, gp_result_as_string(ret));
        } else {
            fprintf(stderr, "capture: Saved to %s\n", output_path);
        }

        /* Delete from camera after download */
        gp_camera_file_delete(camera, captured_files[i].folder, captured_files[i].name, context);

        gp_file_free(file);

        /* Output JSON for this file */
        if (i > 0) printf(",");
        printf("{\"file_path\":\"%s\",\"camera_path\":\"%s/%s\"}",
               output_path, captured_files[i].folder, captured_files[i].name);
    }
    printf("]}\n");

    gp_camera_exit(camera, context);
    gp_camera_free(camera);
    gp_context_unref(context);
}

/* List all widgets in the config tree */
static void list_all_widgets(int camera_index) {
    Camera *camera = NULL;
    GPContext *context = NULL;
    CameraWidget *config = NULL;
    int ret;

    context = create_context();
    if (!context) {
        printf("{\"error\":\"Failed to create context\"}\n");
        return;
    }

    fprintf(stderr, "widgets: Opening camera %d...\n", camera_index);
    camera = open_camera_by_index(camera_index, context, &ret);
    if (!camera) {
        printf("{\"error\":\"Failed to open camera %d: %s\"}\n",
               camera_index, gp_result_as_string(ret));
        gp_context_unref(context);
        return;
    }

    ret = gp_camera_get_config(camera, &config, context);
    if (ret < GP_OK) {
        printf("{\"error\":\"Failed to get config: %s\"}\n", gp_result_as_string(ret));
        gp_camera_exit(camera, context);
        gp_camera_free(camera);
        gp_context_unref(context);
        return;
    }

    printf("{\"widgets\":[");
    list_widgets_recursive(config, 0, 0);
    printf("]}\n");

    gp_widget_free(config);
    gp_camera_exit(camera, context);
    gp_camera_free(camera);
    gp_context_unref(context);
}

/* Get camera status using gp_camera_get_single_config for fast queries */
static void get_camera_status(int camera_index) {
    Camera *camera = NULL;
    GPContext *context = NULL;
    CameraWidget *widget = NULL;
    int ret;
    const char *value;
    int first = 1;

    context = create_context();
    if (!context) {
        printf("{\"error\":\"Failed to create context\"}\n");
        return;
    }

    fprintf(stderr, "status: Opening camera %d...\n", camera_index);
    camera = open_camera_by_index(camera_index, context, &ret);
    if (!camera) {
        printf("{\"error\":\"Failed to open camera %d: %s\"}\n",
               camera_index, gp_result_as_string(ret));
        gp_context_unref(context);
        return;
    }

    /* List of widgets to query - common camera settings */
    const char *widget_names[] = {
        "d36b",                  /* Battery level (Fuji specific) */
        "batterylevel",          /* Generic battery level */
        "iso",                   /* ISO speed */
        "shutterspeed",          /* Shutter speed */
        "aperture",              /* Aperture */
        "exposurecompensation",  /* Exposure compensation */
        "focusmode",             /* Focus mode */
        "whitebalance",          /* White balance */
        "imageformat",           /* Image format (RAW/JPEG) */
        "imagesize",             /* Image size/resolution */
        "drange",                /* Dynamic range (Fuji) */
        "filmrecmode",           /* Film simulation mode (Fuji) */
        NULL
    };

    printf("{\"status\":{");

    for (int i = 0; widget_names[i] != NULL; i++) {
        const char *name = widget_names[i];

        ret = gp_camera_get_single_config(camera, name, &widget, context);
        if (ret == GP_OK && widget != NULL) {
            const char *label = NULL;
            const char *val = NULL;

            gp_widget_get_label(widget, &label);
            val = get_widget_value(widget);

            if (val != NULL && val[0] != '\0') {
                if (!first) printf(",");
                first = 0;

                /* Sanitize value for JSON */
                char sanitized[256];
                int j = 0;
                for (const char *p = val; *p && j < 255; p++) {
                    if (*p == '"') {
                        sanitized[j++] = '\\';
                        sanitized[j++] = '"';
                    } else if (*p == '\\') {
                        sanitized[j++] = '\\';
                        sanitized[j++] = '\\';
                    } else if (*p == '\n') {
                        sanitized[j++] = '\\';
                        sanitized[j++] = 'n';
                    } else if (*p == '\r') {
                        sanitized[j++] = '\\';
                        sanitized[j++] = 'r';
                    } else if (*p == '\t') {
                        sanitized[j++] = '\\';
                        sanitized[j++] = 't';
                    } else if (*p >= ' ' && *p <= '~') {
                        sanitized[j++] = *p;
                    }
                }
                sanitized[j] = '\0';

                printf("\"%s\":\"%s\"", name, sanitized);
            }

            gp_widget_free(widget);
            widget = NULL;
        }
    }

    printf("}}\n");

    gp_camera_exit(camera, context);
    gp_camera_free(camera);
    gp_context_unref(context);
}

/* Helper to escape string for JSON output */
static void print_json_escaped(const char *str) {
    if (!str) return;
    for (const char *p = str; *p; p++) {
        if (*p == '"') printf("\\\"");
        else if (*p == '\\') printf("\\\\");
        else if (*p == '\n') printf("\\n");
        else if (*p == '\r') printf("\\r");
        else if (*p == '\t') printf("\\t");
        else if (*p >= 32 && *p <= 126) putchar(*p);
        else printf("\\u%04x", (unsigned char)*p);
    }
}

/* Recursive helper to list all widgets */
static void list_widgets_recursive(CameraWidget *widget, int depth, int reset_first) {
    const char *name = NULL;
    const char *label = NULL;
    CameraWidgetType type;
    int count, i;
    static int first = 1;

    /* Reset first flag when starting a new children array */
    if (reset_first) {
        first = 1;
    }

    gp_widget_get_name(widget, &name);
    gp_widget_get_label(widget, &label);
    gp_widget_get_type(widget, &type);

    if (!first) printf(",");
    first = 0;

    printf("{\"name\":\"");
    print_json_escaped(name ? name : "");
    printf("\",\"label\":\"");
    print_json_escaped(label ? label : "");
    printf("\",\"type\":%d", type);

    count = gp_widget_count_children(widget);
    if (count > 0) {
        printf(",\"children\":[");
        for (i = 0; i < count; i++) {
            CameraWidget *child = NULL;
            gp_widget_get_child(widget, i, &child);
            if (child) {
                /* Only reset first flag for the first child in this array */
                list_widgets_recursive(child, depth + 1, (i == 0));
            }
        }
        printf("]");
    }
    printf("}");
}

/*
 * watch_camera - Continuously monitor camera for new files (physical shutter)
 * Outputs JSON for each downloaded photo:
 * {"type":"photo_downloaded","file_path":"/tmp/IMG_0001.JPG","camera_path":"/store_00010001/..."}
 */
static void watch_camera(int camera_index) {
    Camera *camera = NULL;
    GPContext *context = NULL;
    CameraFilePath camera_file_path;
    CameraFile *file = NULL;
    int ret;
    char output_path[512];
    int running = 1;

    context = create_context();
    if (!context) {
        fprintf(stderr, "{\"error\":\"Failed to create context\"}\n");
        return;
    }

    fprintf(stderr, "watch: Opening camera %d for monitoring...\n", camera_index);
    camera = open_camera_by_index(camera_index, context, &ret);
    if (!camera) {
        printf("{\"error\":\"Failed to open camera %d: %s\"}\n",
               camera_index, gp_result_as_string(ret));
        gp_context_unref(context);
        return;
    }

    fprintf(stderr, "watch: Monitoring camera %d for new files...\n", camera_index);
    install_signal_handlers();

    /* Monitor loop - wait for file events */
    while (running && !g_shutdown_requested) {
        CameraEventType event_type = GP_EVENT_UNKNOWN;
        void *event_data = NULL;

        /* Wait for events with 1 second timeout */
        ret = gp_camera_wait_for_event(camera, 1000, &event_type, &event_data, context);

        if (ret < GP_OK) {
            /* Error or timeout, continue monitoring */
            continue;
        }

        switch (event_type) {
            case GP_EVENT_FILE_ADDED: {
                CameraFilePath *path = (CameraFilePath *)event_data;
                fprintf(stderr, "watch: New file detected: %s/%s\n", path->folder, path->name);

                /* Download the file */
                ret = gp_file_new(&file);
                if (ret >= GP_OK) {
                    snprintf(output_path, sizeof(output_path), "/tmp/%s", path->name);

                    ret = gp_camera_file_get(camera, path->folder, path->name,
                                              GP_FILE_TYPE_NORMAL, file, context);
                    if (ret >= GP_OK) {
                        ret = gp_file_save(file, output_path);
                        if (ret >= GP_OK) {
                            fprintf(stderr, "watch: Downloaded to %s\n", output_path);

                            /* Output JSON notification */
                            printf("{\"type\":\"photo_downloaded\",\"file_path\":\"%s\",\"camera_path\":\"%s/%s\"}\n",
                                   output_path, path->folder, path->name);
                            fflush(stdout);

                            /* Delete from camera after download */
                            gp_camera_file_delete(camera, path->folder, path->name, context);
                        } else {
                            fprintf(stderr, "watch: Failed to save file: %s\n", gp_result_as_string(ret));
                        }
                    } else {
                        fprintf(stderr, "watch: Failed to download file: %s\n", gp_result_as_string(ret));
                    }
                    gp_file_free(file);
                    file = NULL;
                }

                free(event_data);
                break;
            }

            case GP_EVENT_CAPTURE_COMPLETE:
                fprintf(stderr, "watch: Capture complete event\n");
                if (event_data) free(event_data);
                break;

            case GP_EVENT_TIMEOUT:
                /* Normal timeout, continue waiting */
                break;

            case GP_EVENT_UNKNOWN:
                if (event_data) free(event_data);
                break;

            default:
                if (event_data) free(event_data);
                break;
        }
    }

    gp_camera_exit(camera, context);
    gp_camera_free(camera);
    gp_context_unref(context);
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: gphoto2-wrapper <version|list|capture|debug|config|widgets|status|watch> [camera_id]\n");
        return 1;
    }

    /* Parse optional camera_id parameter (default: 0) */
    int camera_index = 0;
    if (argc >= 3) {
        camera_index = atoi(argv[2]);
        if (camera_index < 0) {
            fprintf(stderr, "{\"error\":\"Invalid camera_id: %s\"}\n", argv[2]);
            return 1;
        }
    }

    if (strcmp(argv[1], "version") == 0) {
        print_version();
    } else if (strcmp(argv[1], "list") == 0) {
        print_cameras();
    } else if (strcmp(argv[1], "capture") == 0) {
        capture_image(camera_index);
    } else if (strcmp(argv[1], "debug") == 0) {
        debug_camera(camera_index);
    } else if (strcmp(argv[1], "config") == 0) {
        get_config(camera_index);
    } else if (strcmp(argv[1], "setconfig") == 0) {
        if (argc < 3) {
            fprintf(stderr, "Usage: gphoto2-wrapper setconfig '<json>' [camera_id]\n");
            fprintf(stderr, "Example: gphoto2-wrapper setconfig '{\"setting\":\"iso\",\"value\":\"800\"}'\n");
            printf("{\"error\":\"Missing JSON configuration argument\"}\n");
            return 1;
        }
        const char *json_config = argv[2];
        int camera_idx = (argc >= 4) ? atoi(argv[3]) : 0;
        set_config(json_config, camera_idx);
    } else if (strcmp(argv[1], "widgets") == 0) {
        list_all_widgets(camera_index);
    } else if (strcmp(argv[1], "status") == 0) {
        get_camera_status(camera_index);
    } else if (strcmp(argv[1], "watch") == 0) {
        watch_camera(camera_index);
    } else {
        fprintf(stderr, "{\"error\":\"Unknown command: %s\"}\n", argv[1]);
        return 1;
    }

    return 0;
}
