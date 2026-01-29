/*
 * gphoto2-wrapper - Simple CLI wrapper around libgphoto2
 *
 * Commands:
 *   gphoto2-wrapper version   - Check libgphoto2 availability
 *   gphoto2-wrapper list      - List connected cameras (JSON)
 *   gphoto2-wrapper capture   - Capture image and print file path
 *   gphoto2-wrapper debug     - Print camera abilities and config summary
 *   gphoto2-wrapper config    - Get current camera configuration/settings (JSON)
 *
 * Output is JSON for easy parsing by the camera daemon.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <gphoto2/gphoto2.h>
#include <gphoto2/gphoto2-port-version.h>
#include <gphoto2/gphoto2-version.h>

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
        const char *name, *port;
        gp_list_get_name(list, i, &name);
        gp_list_get_value(list, i, &port);
        if (i > 0) printf(",");
        printf("{\"id\":\"%d\",\"model\":\"%s\",\"port\":\"%s\"}", i, name, port);
    }
    printf("]\n");

    gp_abilities_list_free(abilities_list);
    gp_port_info_list_free(port_info_list);
    gp_list_free(list);
    gp_context_unref(context);
}

static void debug_camera(void) {
    Camera *camera = NULL;
    GPContext *context = NULL;
    CameraAbilities abilities;
    int ret;

    context = create_context();
    if (!context) {
        printf("{\"error\":\"Failed to create context\"}\n");
        return;
    }

    ret = gp_camera_new(&camera);
    if (ret < GP_OK) {
        printf("{\"error\":\"Failed to create camera: %s (code %d)\"}\n",
               gp_result_as_string(ret), ret);
        gp_context_unref(context);
        return;
    }

    fprintf(stderr, "debug: Initializing camera...\n");
    ret = gp_camera_init(camera, context);
    if (ret < GP_OK) {
        printf("{\"error\":\"Failed to init camera: %s (code %d)\"}\n",
               gp_result_as_string(ret), ret);
        gp_camera_free(camera);
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
static void get_config(void) {
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

    ret = gp_camera_new(&camera);
    if (ret < GP_OK) {
        printf("{\"error\":\"Failed to create camera: %s\"}\n", gp_result_as_string(ret));
        gp_context_unref(context);
        return;
    }

    fprintf(stderr, "config: Initializing camera...\n");
    ret = gp_camera_init(camera, context);
    if (ret < GP_OK) {
        printf("{\"error\":\"Failed to init camera: %s\"}\n", gp_result_as_string(ret));
        gp_camera_free(camera);
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
        "shutterspeed",
        "shutterspeed2",
        "exposurecompensation",
        "whitebalance",
        "focusmode",
        "drivemode",
        "imageformat",
        "imagesize",
        "flashmode",
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

static void capture_image(void) {
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

    ret = gp_camera_new(&camera);
    if (ret < GP_OK) {
        printf("{\"success\":false,\"error\":\"Failed to create camera: %s (code %d)\"}\n",
               gp_result_as_string(ret), ret);
        gp_context_unref(context);
        return;
    }

    fprintf(stderr, "capture: Initializing camera...\n");
    ret = gp_camera_init(camera, context);
    if (ret < GP_OK) {
        printf("{\"success\":false,\"error\":\"Failed to init camera: %s (code %d)\"}\n",
               gp_result_as_string(ret), ret);
        gp_camera_free(camera);
        gp_context_unref(context);
        return;
    }

    /*
     * Fuji cameras (like X-H2) have a known quirk: gp_camera_capture fires the
     * shutter but returns GP_ERROR with "Fuji Capture failed: Perhaps no auto-focus?"
     * The photo IS taken, but the function reports failure.
     *
     * Strategy: Try gp_camera_capture first. If it succeeds, great.
     * If it fails, don't give up -- wait for GP_EVENT_FILE_ADDED events
     * because the shutter may have actually fired.
     */
    int capture_returned_path = 0;

    fprintf(stderr, "capture: Trying gp_camera_capture...\n");
    ret = gp_camera_capture(camera, GP_CAPTURE_IMAGE, &camera_file_path, context);

    if (ret >= GP_OK) {
        fprintf(stderr, "capture: gp_camera_capture succeeded: %s/%s\n",
                camera_file_path.folder, camera_file_path.name);
        capture_returned_path = 1;
    } else {
        fprintf(stderr, "capture: gp_camera_capture returned %d (%s) - shutter may have fired anyway\n",
                ret, gp_result_as_string(ret));
        fprintf(stderr, "capture: Waiting for file event from camera...\n");

        /* Wait for file events -- the camera may have taken the photo despite the error */
        int wait_retries = 50; /* wait up to ~10 seconds */
        int got_file = 0;
        while (wait_retries-- > 0) {
            CameraEventType event_type;
            void *event_data = NULL;

            ret = gp_camera_wait_for_event(camera, 200, &event_type, &event_data, context);
            if (ret < GP_OK) {
                fprintf(stderr, "capture: wait_for_event error: %d (%s)\n",
                        ret, gp_result_as_string(ret));
                break;
            }

            if (event_type == GP_EVENT_FILE_ADDED) {
                CameraFilePath *path = (CameraFilePath *)event_data;
                fprintf(stderr, "capture: File added: %s/%s\n", path->folder, path->name);
                memcpy(&camera_file_path, path, sizeof(CameraFilePath));
                got_file = 1;
                free(event_data);
                break;
            } else if (event_type == GP_EVENT_CAPTURE_COMPLETE) {
                fprintf(stderr, "capture: Capture complete event (continue waiting for file)\n");
            } else if (event_type == GP_EVENT_TIMEOUT) {
                /* Keep waiting */
            } else {
                fprintf(stderr, "capture: Event type %d\n", event_type);
            }

            if (event_data && event_type != GP_EVENT_FILE_ADDED)
                free(event_data);
        }

        if (!got_file) {
            /* Last resort: try trigger_capture */
            fprintf(stderr, "capture: No file event. Trying gp_camera_trigger_capture...\n");
            ret = gp_camera_trigger_capture(camera, context);
            if (ret < GP_OK) {
                fprintf(stderr, "capture: trigger_capture also failed: %d (%s)\n",
                        ret, gp_result_as_string(ret));
            }

            /* Wait again for file event after trigger */
            wait_retries = 50;
            while (wait_retries-- > 0) {
                CameraEventType event_type;
                void *event_data = NULL;

                ret = gp_camera_wait_for_event(camera, 200, &event_type, &event_data, context);
                if (ret < GP_OK) break;

                if (event_type == GP_EVENT_FILE_ADDED) {
                    CameraFilePath *path = (CameraFilePath *)event_data;
                    fprintf(stderr, "capture: File added (after trigger): %s/%s\n", path->folder, path->name);
                    memcpy(&camera_file_path, path, sizeof(CameraFilePath));
                    got_file = 1;
                    free(event_data);
                    break;
                }
                if (event_data) free(event_data);
            }
        }

        if (!got_file) {
            printf("{\"success\":false,\"error\":\"Capture fired but could not retrieve file from camera\"}\n");
            gp_camera_exit(camera, context);
            gp_camera_free(camera);
            gp_context_unref(context);
            return;
        }
        capture_returned_path = 1;
    }

    fprintf(stderr, "capture: Got file %s/%s, downloading...\n",
            camera_file_path.folder, camera_file_path.name);

    /* Download the file from camera to /tmp */
    ret = gp_file_new(&file);
    if (ret < GP_OK) {
        printf("{\"success\":false,\"error\":\"Failed to create file: %s (code %d)\"}\n",
               gp_result_as_string(ret), ret);
        gp_camera_exit(camera, context);
        gp_camera_free(camera);
        gp_context_unref(context);
        return;
    }

    ret = gp_camera_file_get(camera, camera_file_path.folder, camera_file_path.name,
                              GP_FILE_TYPE_NORMAL, file, context);
    if (ret < GP_OK) {
        printf("{\"success\":false,\"error\":\"Failed to download: %s (code %d)\"}\n",
               gp_result_as_string(ret), ret);
        gp_file_free(file);
        gp_camera_exit(camera, context);
        gp_camera_free(camera);
        gp_context_unref(context);
        return;
    }

    snprintf(output_path, sizeof(output_path), "/tmp/%s", camera_file_path.name);
    ret = gp_file_save(file, output_path);
    if (ret < GP_OK) {
        printf("{\"success\":false,\"error\":\"Failed to save file: %s (code %d)\"}\n",
               gp_result_as_string(ret), ret);
    } else {
        printf("{\"success\":true,\"file_path\":\"%s\",\"camera_path\":\"%s/%s\"}\n",
               output_path, camera_file_path.folder, camera_file_path.name);
    }

    /* Delete from camera after download */
    gp_camera_file_delete(camera, camera_file_path.folder, camera_file_path.name, context);

    gp_file_free(file);
    gp_camera_exit(camera, context);
    gp_camera_free(camera);
    gp_context_unref(context);
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: gphoto2-wrapper <version|list|capture|debug|config>\n");
        return 1;
    }

    if (strcmp(argv[1], "version") == 0) {
        print_version();
    } else if (strcmp(argv[1], "list") == 0) {
        print_cameras();
    } else if (strcmp(argv[1], "capture") == 0) {
        capture_image();
    } else if (strcmp(argv[1], "debug") == 0) {
        debug_camera();
    } else if (strcmp(argv[1], "config") == 0) {
        get_config();
    } else {
        fprintf(stderr, "{\"error\":\"Unknown command: %s\"}\n", argv[1]);
        return 1;
    }

    return 0;
}
