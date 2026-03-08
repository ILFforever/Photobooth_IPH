/*
 * gphoto2-storage.h - Storage management utilities
 */

#ifndef GPHOTO2_STORAGE_H
#define GPHOTO2_STORAGE_H

#include <sys/statvfs.h>
#include <dirent.h>
#include <time.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <stdlib.h>

/* Get available disk space in bytes for a given path */
static unsigned long long get_available_space(const char *path) {
    struct statvfs stat;
    if (statvfs(path, &stat) != 0) {
        return 0;
    }
    return (unsigned long long)stat.f_bavail * stat.f_bsize;
}

/* Get file modification time */
static time_t get_file_mtime(const char *filepath) {
    struct stat st;
    if (stat(filepath, &st) == 0) {
        return st.st_mtime;
    }
    return 0;
}

/* Photo entry for sorting */
struct photo_entry {
    char path[512];
    time_t mtime;
    unsigned long size;
};

/* Compare function for sorting photos by modification time */
static int compare_photos(const void *a, const void *b) {
    const struct photo_entry *pa = (const struct photo_entry *)a;
    const struct photo_entry *pb = (const struct photo_entry *)b;
    return (pa->mtime > pb->mtime) ? 1 : ((pa->mtime < pb->mtime) ? -1 : 0);
}

/* Clean up old photos to free space. Returns number of files deleted. */
static int cleanup_old_photos(unsigned long long target_free_bytes, const char *photo_dir, void (*log_fn)(const char *, ...)) {
    DIR *dir = opendir(photo_dir);
    if (!dir) return 0;

    struct photo_entry photos[1000];
    int photo_count = 0;
    struct dirent *entry;

    const char *image_exts[] = {".jpg", ".JPG", ".jpeg", ".JPEG", ".png", ".PNG", ".raf", ".RAF", ".arw", ".ARW", NULL};

    while ((entry = readdir(dir)) != NULL && photo_count < 1000) {
        if (entry->d_type != DT_REG) continue;

        const char *ext = strrchr(entry->d_name, '.');
        if (!ext) continue;

        int is_image = 0;
        for (int i = 0; image_exts[i] != NULL; i++) {
            if (strcasecmp(ext, image_exts[i]) == 0) {
                is_image = 1;
                break;
            }
        }
        if (!is_image) continue;

        char filepath[512];
        snprintf(filepath, sizeof(filepath), "%s/%s", photo_dir, entry->d_name);
        struct stat st;
        if (stat(filepath, &st) == 0) {
            strncpy(photos[photo_count].path, filepath, sizeof(photos[photo_count].path) - 1);
            photos[photo_count].path[sizeof(photos[photo_count].path) - 1] = '\0';
            photos[photo_count].mtime = st.st_mtime;
            photos[photo_count].size = st.st_size;
            photo_count++;
        }
    }
    closedir(dir);

    if (photo_count == 0) return 0;

    /* Sort by modification time (oldest first) */
    qsort(photos, photo_count, sizeof(struct photo_entry), compare_photos);

    int deleted_count = 0;
    unsigned long long freed_space = 0;

    for (int i = 0; i < photo_count && freed_space < target_free_bytes; i++) {
        if (unlink(photos[i].path) == 0) {
            if (log_fn) {
                log_fn("Deleted old photo: %s (%lu bytes)\n", photos[i].path, photos[i].size);
            }
            deleted_count++;
            freed_space += photos[i].size;
        } else {
            if (log_fn) {
                log_fn("Failed to delete %s: %s\n", photos[i].path, strerror(errno));
            }
        }
    }

    return deleted_count;
}

/* Ensure sufficient storage space before saving a file */
static void ensure_storage_space(unsigned long long file_size_estimate, const char *photo_dir, void (*log_fn)(const char *, ...)) {
    const unsigned long long MIN_FREE_MB = 50;
    const unsigned long long MIN_FREE_BYTES = MIN_FREE_MB * 1024 * 1024;
    const unsigned long long BUFFER_BYTES = 10 * 1024 * 1024; /* 10MB buffer */

    unsigned long long available = get_available_space(photo_dir);
    unsigned long long available_mb = available / (1024 * 1024);

    unsigned long long needed = (file_size_estimate > 0) ? file_size_estimate + BUFFER_BYTES : 0;
    if (available < MIN_FREE_BYTES || available < needed) {
        unsigned long long target = (needed > MIN_FREE_BYTES) ? needed : (MIN_FREE_BYTES + BUFFER_BYTES);
        unsigned long long to_free = target - available;

        if (log_fn) {
            log_fn("Low storage! Only %llu MB free, need %llu MB. Cleaning up...\n",
                    available_mb, target / (1024 * 1024));
        }

        int deleted = cleanup_old_photos(to_free, photo_dir, log_fn);
        if (deleted > 0) {
            if (log_fn) {
                log_fn("Cleaned up %d old photo(s) to free space\n", deleted);
            }
        } else {
            if (log_fn) {
                log_fn("WARNING: No photos to delete, but storage is low!\n");
            }
        }
    }
}

#endif /* GPHOTO2_STORAGE_H */
