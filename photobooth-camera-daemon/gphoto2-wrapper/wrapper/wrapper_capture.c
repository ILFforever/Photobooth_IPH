/*
 * wrapper_capture.c - Capture functions
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <gphoto2/gphoto2.h>
#include "wrapper_capture.h"
#include "wrapper_open.h"

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

void capture_image(int camera_index) {
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
