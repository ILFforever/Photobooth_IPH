/*
 * camera_open.c - Camera opening, caching, and detection
 *
 * Extracted from gphoto2-controller.c
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <time.h>
#include <gphoto2/gphoto2.h>
#include "camera-brand.h"
#include "camera_open.h"

/* Timestamped logging - defined in gphoto2-controller.c */
extern void log_timestamped(const char *format, ...);
#define log_ts(...) log_timestamped(__VA_ARGS__)

/* Global caching state - shared with gphoto2-controller.c */
extern GPPortInfoList *g_cached_port_info_list;
extern CameraAbilitiesList *g_cached_abilities_list;
extern int g_cached_camera_index;
extern int g_detection_valid;
extern char g_last_camera_port[128];
extern CameraBrand g_current_brand;
extern CameraBrand g_last_logged_brand;

/* Error callback for gphoto2 context */
static void ctx_error_func(GPContext *context, const char *msg, void *data) {
    (void)context; (void)data;
    fprintf(stderr, "gphoto2 ERROR: %s\n", msg);
}

/* Create a new gphoto2 context with error callback configured */
GPContext* create_context(void) {
    GPContext *ctx = gp_context_new();
    if (ctx) {
        gp_context_set_error_func(ctx, ctx_error_func, NULL);
    }
    return ctx;
}

/* Wrapper function for opening camera with default timeout */
Camera* open_camera(int camera_index, int *ret_out) {
    return open_camera_with_timeout(camera_index, ret_out, 0);  // 0 = no timeout (use default)
}

/*
 * Open camera with optional timeout (in seconds). Returns NULL if timeout exceeded.
 *
 * This function handles:
 * - Camera detection and auto-detection
 * - Caching of abilities and port info lists
 * - USB port tracking for reset functionality
 * - Brand detection (only on first detection)
 * - Timeout management throughout the opening process
 */
Camera* open_camera_with_timeout(int camera_index, int *ret_out, int timeout_sec) {
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
