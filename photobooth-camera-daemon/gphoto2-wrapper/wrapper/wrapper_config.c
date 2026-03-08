/*
 * wrapper_config.c - Config functions
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string.h>
#include <gphoto2/gphoto2.h>
#include "wrapper_config.h"
#include "wrapper_open.h"
#include "wrapper_widgets.h"

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

/* Get camera configuration as JSON */
void get_config(int camera_index) {
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

    /* Common settings we want to read - includes Fuji and Canon widget names */
    const char *settings[] = {
        "iso",
        "aperture",           // Canon aperture
        "f-number",           // Fuji aperture
        "shutterspeed",
        "shutterspeed2",
        "exposurecompensation",
        "5010",               // Exposure Bias Compensation (Fuji PTP property)
        "whitebalance",
        "focusmode",
        "exposuremetermode",  // Exposure Metering Mode (Fuji)
        "meteringmode",       // Metering Mode (Canon)
        "500b",               // Exposure Metering Mode (PTP property)
        "drivemode",
        "imageformat",
        "imagesize",
        "flashmode",
        "lensname",           // Lens name (Camera Status Information)
        "d36b",               // BatteryInfo2 (Fuji X-H2 battery level)
        "5001",               // Canon battery PTP property
        "batterylevel",       // Generic battery
        "autoexposuremode",   // Canon Auto Exposure Mode
        "autoexposuremodedial", // Canon Auto Exposure Mode Dial
        "expprogram",         // Fuji/other shooting mode
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
void set_config(const char *json_config, int camera_index) {
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
