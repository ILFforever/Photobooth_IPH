#include "camera_storage.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <dirent.h>
#include <sys/statvfs.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

/* Timestamped logging - defined in gphoto2-controller.c */
extern void log_timestamped(const char *format, ...);
#define log_ts(...) log_timestamped(__VA_ARGS__)

/* Check available disk space in bytes for a given path */
unsigned long long get_available_space(const char *path) {
    struct statvfs stat;
    if (statvfs(path, &stat) != 0) {
        return 0;
    }
    return (unsigned long long)stat.f_bavail * stat.f_bsize;
}

/* Helper to get file modification time */
time_t get_file_mtime(const char *filepath) {
    struct stat st;
    if (stat(filepath, &st) == 0) {
        return st.st_mtime;
    }
    return 0;
}

/* Clean up old photos to free space. Returns number of files deleted. */
int cleanup_old_photos(unsigned long long target_free_bytes) {
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
            log_ts("controller: Deleted old photo: %s (%lu bytes)\n", photos[i].path, photos[i].size);
            freed_space += photos[i].size;
            deleted_count++;
        } else {
            log_ts("controller: Failed to delete %s: %s\n", photos[i].path, strerror(errno));
        }
    }

    return deleted_count;
}

/* Ensure sufficient storage space before saving a file */
void ensure_storage_space(unsigned long long file_size_estimate) {
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

        log_ts("controller: Low storage! Only %llu MB free, need %llu MB. Cleaning up...\n",
                available_mb, target / (1024 * 1024));

        int deleted = cleanup_old_photos(to_free);
        if (deleted > 0) {
            log_ts("controller: Cleaned up %d old photo(s) to free space\n", deleted);
        } else {
            log_ts("controller: WARNING: No photos to delete, but storage is low!\n");
        }
    }
}
