/*
 * camera_config.c - Camera configuration operations
 *
 * Handles getting/setting camera configuration values through gphoto2.
 * Extracted from gphoto2-controller.c for modularity.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <gphoto2/gphoto2.h>
#include <time.h>
#include <stdarg.h>

#include "camera-brand.h"

/* Path for config response JSON file */
#define CONFIG_RESPONSE_FILE "/tmp/camera_config_response"

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
char *get_single_config_value(Camera *camera, GPContext *context, const char *setting_name) {
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
int write_full_config_json(Camera *camera, GPContext *context, CameraBrand current_brand) {
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
int set_config_and_write_response(Camera *camera, GPContext *context, const char *json_input) {
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

/*
 * Get camera settings (ISO, aperture, shutter, etc.) as JSON
 * Returns 0 on success with status_json populated, -1 on error
 */
int get_camera_status_json(Camera *camera, GPContext *context, char *status_json, size_t max_size, CameraBrand current_brand) {
    CameraWidget *widget = NULL, *config = NULL;
    int ret;

    ret = gp_camera_get_config(camera, &config, context);
    if (ret < GP_OK) {
        log_ts("controller: Failed to get camera config: %s\n", gp_result_as_string(ret));
        return -1;
    }

    /* Get brand-specific widget names */
    const BrandWidgets *widgets = get_widgets_for_brand(current_brand);

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
