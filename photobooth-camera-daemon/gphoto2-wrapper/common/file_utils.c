/*
 * file_utils.c - File tracking and management implementation
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dirent.h>
#include <sys/stat.h>
#include <gphoto2/gphoto2.h>
#include "file_utils.h"

/* Extract file number from filename */
int extract_file_number(const char *filename) {
    if (!filename) return -1;

    const char *p = filename;
    while (*p && !(*p >= '0' && *p <= '9')) p++;

    if (!*p) return -1;

    int num = 0;
    while (*p >= '0' && *p <= '9') {
        num = num * 10 + (*p - '0');
        p++;
    }

    return num;
}

/* Find highest file number on camera */
int find_highest_file(void *camera, void *context, const char *folder) {
    Camera *cam = (Camera *)camera;
    GPContext *ctx = (GPContext *)context;
    CameraList *list;
    int ret, highest = -1;

    ret = gp_list_new(&list);
    if (ret < GP_OK) return -1;

    ret = gp_camera_folder_list_files(cam, folder, list, ctx);
    if (ret < GP_OK) {
        gp_list_free(list);
        return -1;
    }

    int count = gp_list_count(list);
    for (int i = 0; i < count; i++) {
        const char *name;
        gp_list_get_name(list, i, &name);
        int num = extract_file_number(name);
        if (num > highest) highest = num;
    }

    gp_list_free(list);
    return highest;
}

/* Check if file exists locally */
int file_exists_locally(const char *filename, const char *dir) {
    char path[512];
    snprintf(path, sizeof(path), "%s/%s", dir ? dir : "/tmp", filename);

    struct stat st;
    return (stat(path, &st) == 0);
}

/* Get file modification time */
time_t get_file_mtime(const char *filepath) {
    struct stat st;
    if (stat(filepath, &st) == 0) {
        return st.st_mtime;
    }
    return 0;
}

/* Compare function for sorting photos by modification time */
int compare_photos(const void *a, const void *b) {
    const struct photo_entry *pa = (const struct photo_entry *)a;
    const struct photo_entry *pb = (const struct photo_entry *)b;
    return (pa->mtime > pb->mtime) ? 1 : ((pa->mtime < pb->mtime) ? -1 : 0);
}
