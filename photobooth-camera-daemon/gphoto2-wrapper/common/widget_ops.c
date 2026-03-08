/*
 * widget_ops.c - Camera widget operations implementation
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <gphoto2/gphoto2.h>
#include "widget_ops.h"

/* Find a widget by name recursively starting from root */
CameraWidget* find_widget_by_name(CameraWidget *root, const char *name) {
    if (!root || !name) return NULL;

    /* Check for dot-separated path (e.g., "capturesettings.aperture") */
    const char *dot = strchr(name, '.');
    if (dot) {
        char parent_name[64];
        size_t parent_len = dot - name;
        if (parent_len >= sizeof(parent_name)) parent_len = sizeof(parent_name) - 1;
        strncpy(parent_name, name, parent_len);
        parent_name[parent_len] = '\0';

        const char *widget_name = NULL;
        gp_widget_get_name(root, &widget_name);
        if (widget_name && strcmp(widget_name, parent_name) == 0) {
            return find_widget_by_name(root, dot + 1);
        }

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

    /* Simple name match */
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

/* Get widget value as a string */
const char* get_widget_value(CameraWidget *widget) {
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

/* Get config value by name (searches full config tree) */
char* get_config_value_by_name(Camera *camera, GPContext *context, const char *setting_name) {
    CameraWidget *config = NULL;
    CameraWidget *widget = NULL;
    char *result = NULL;

    int ret = gp_camera_get_config(camera, &config, context);
    if (ret < GP_OK) {
        return NULL;
    }

    widget = find_widget_by_name(config, setting_name);
    if (!widget) {
        gp_widget_free(config);
        return NULL;
    }

    const char *value = get_widget_value(widget);
    if (value && value[0]) {
        result = strdup(value);
    }

    gp_widget_free(config);
    return result;
}

/* JSON escape string - append to buffer */
int json_escape_append(char *buf, size_t max, const char *str) {
    size_t len = strlen(buf);
    char *p = buf + len;

    while (*str && len < max - 2) {
        switch (*str) {
            case '"':  if (len < max - 7) { strcpy(p, "\\\""); p += 2; len += 2; } else goto done; break;
            case '\\': if (len < max - 7) { strcpy(p, "\\\\"); p += 2; len += 2; } else goto done; break;
            case '\b': if (len < max - 7) { strcpy(p, "\\b"); p += 2; len += 2; } else goto done; break;
            case '\f': if (len < max - 7) { strcpy(p, "\\f"); p += 2; len += 2; } else goto done; break;
            case '\n': if (len < max - 7) { strcpy(p, "\\n"); p += 2; len += 2; } else goto done; break;
            case '\r': if (len < max - 7) { strcpy(p, "\\r"); p += 2; len += 2; } else goto done; break;
            case '\t': if (len < max - 7) { strcpy(p, "\\t"); p += 2; len += 2; } else goto done; break;
            default:
                if ((unsigned char)*str < 32 || (unsigned char)*str > 126) {
                    if (len < max - 7) {
                        sprintf(p, "\\u%04x", (unsigned char)*str);
                        p += 6;
                        len += 6;
                    } else goto done;
                } else {
                    *p++ = *str;
                    len++;
                }
                break;
        }
        str++;
    }

done:
    *p = '\0';
    return len;
}

/* Get widget value as string for JSON output */
const char* widget_value_to_string(CameraWidget *widget) {
    return get_widget_value(widget);
}

/* Default logging function that writes to stderr */
static void default_log(const char *fmt, ...) {
    va_list args;
    va_start(args, fmt);
    vfprintf(stderr, fmt, args);
    va_end(args);
}

/* List all widgets recursively */
void list_all_widgets(Camera *camera, GPContext *context, void (*log_fn)(const char *, ...)) {
    CameraWidget *config = NULL;
    CameraWidget *root = NULL;

    if (!log_fn) log_fn = default_log;

    if (gp_camera_get_config(camera, &config, context) != GP_OK) {
        log_fn("Failed to get config\n");
        return;
    }

    root = config;

    void list_recursive(CameraWidget *widget, int depth) {
        const char *name = NULL;
        const char *label = NULL;
        const char *value = NULL;
        CameraWidgetType type;

        gp_widget_get_type(widget, &type);
        gp_widget_get_name(widget, &name);
        gp_widget_get_label(widget, &label);
        gp_widget_get_value(widget, &value);

        char indent[32] = {0};
        for (int i = 0; i < depth && i < 31; i++) indent[i] = ' ';

        char buf[512];
        snprintf(buf, sizeof(buf), "%s[%s] %s (type=%d): ", indent, name ? name : "?", label ? label : "", type);
        log_fn(buf);

        if (type == GP_WIDGET_RADIO || type == GP_WIDGET_MENU) {
            snprintf(buf, sizeof(buf), "%s\n", value ? value : "?");
            log_fn(buf);
            /* Show available options */
            int count = gp_widget_count_choices(widget);
            for (int i = 0; i < count; i++) {
                const char *choice = NULL;
                gp_widget_get_choice(widget, i, &choice);
                if (choice) {
                    int is_current = (value && strcmp(choice, value) == 0);
                    snprintf(buf, sizeof(buf), "%s    %c %s\n", indent, is_current ? '*' : ' ', choice);
                    log_fn(buf);
                }
            }
        } else {
            snprintf(buf, sizeof(buf), "%s\n", value ? value : "?");
            log_fn(buf);
        }

        int child_count = gp_widget_count_children(widget);
        for (int i = 0; i < child_count; i++) {
            CameraWidget *child = NULL;
            if (gp_widget_get_child(widget, i, &child) == GP_OK && child) {
                list_recursive(child, depth + 1);
            }
        }
    }

    list_recursive(root, 0);
    gp_widget_free(config);
}
