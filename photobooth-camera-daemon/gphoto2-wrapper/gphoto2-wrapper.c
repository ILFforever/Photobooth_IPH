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
#include <dirent.h>
#include <gphoto2/gphoto2.h>
#include <gphoto2/gphoto2-port-version.h>
#include <gphoto2/gphoto2-version.h>
#include "common/camera-brand.h"
#include "wrapper/wrapper_open.h"
#include "wrapper/wrapper_capture.h"
#include "wrapper/wrapper_config.h"
#include "wrapper/wrapper_status.h"
#include "wrapper/wrapper_widgets.h"

/* Global flag for signal-based shutdown (used by watch/liveview loops) */
static volatile sig_atomic_t g_shutdown_requested = 0;

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

        /* Detect USB version by scanning /sys/bus/usb/devices/.
         * Match by bus/device number if available, otherwise by product name. */
        {
            int bus_num = 0, device_num = 0;
            int have_bus_dev = (sscanf(port, "usb:%d,%d", &bus_num, &device_num) == 2);
            float best_speed = 0;

            DIR *usb_dir = opendir("/sys/bus/usb/devices");
            if (usb_dir) {
                struct dirent *usb_entry;
                while ((usb_entry = readdir(usb_dir)) != NULL) {
                    if (usb_entry->d_name[0] == '.') continue;
                    if (strncmp(usb_entry->d_name, "usb", 3) == 0) continue;

                    char speed_path[300];
                    snprintf(speed_path, sizeof(speed_path), "/sys/bus/usb/devices/%s/speed", usb_entry->d_name);
                    FILE *sf = fopen(speed_path, "r");
                    if (!sf) continue;

                    float speed = 0;
                    int got = (fscanf(sf, "%f", &speed) == 1);
                    fclose(sf);
                    if (!got) continue;

                    if (have_bus_dev) {
                        char bp[300], dp[300];
                        int bus = -1, dev = -1;
                        snprintf(bp, sizeof(bp), "/sys/bus/usb/devices/%s/busnum", usb_entry->d_name);
                        snprintf(dp, sizeof(dp), "/sys/bus/usb/devices/%s/devnum", usb_entry->d_name);
                        FILE *bf = fopen(bp, "r");
                        FILE *df = fopen(dp, "r");
                        if (bf && df) { fscanf(bf, "%d", &bus); fscanf(df, "%d", &dev); }
                        if (bf) fclose(bf);
                        if (df) fclose(df);

                        if (bus == bus_num && dev == device_num) {
                            best_speed = speed;
                            break;
                        }
                    } else {
                        char pp[300];
                        snprintf(pp, sizeof(pp), "/sys/bus/usb/devices/%s/product", usb_entry->d_name);
                        FILE *pf = fopen(pp, "r");
                        if (!pf) continue;
                        char product[128] = "";
                        if (fgets(product, sizeof(product), pf)) {
                            char *nl = strchr(product, '\n');
                            if (nl) *nl = '\0';
                            if (strstr(product, "Camera") || strstr(product, "FUJIFILM") ||
                                strstr(product, "Canon") || strstr(product, "NIKON") ||
                                strstr(product, "Sony") || strstr(product, "X-")) {
                                if (speed > best_speed) best_speed = speed;
                            }
                        }
                        fclose(pf);
                    }
                }
                closedir(usb_dir);
            }

            if (best_speed > 0) {
                static char usb_buf[32];
                if (best_speed >= 5000)
                    snprintf(usb_buf, sizeof(usb_buf), "USB 3.x (%.0f Gbps)", best_speed / 1000);
                else if (best_speed >= 400)
                    snprintf(usb_buf, sizeof(usb_buf), "USB 2.0 (%.0f Mbps)", best_speed);
                else if (best_speed >= 10)
                    snprintf(usb_buf, sizeof(usb_buf), "USB 1.1 (%.0f Mbps)", best_speed);
                else
                    snprintf(usb_buf, sizeof(usb_buf), "USB 1.0 (%.1f Mbps)", best_speed);
                usb_version_str = usb_buf;
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
        list_all_widgets_json(camera_index);
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
