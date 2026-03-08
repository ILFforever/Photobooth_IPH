/*
 * file_utils.h - File tracking and management utilities
 */

#ifndef FILE_UTILS_H
#define FILE_UTILS_H

#include <time.h>

/* Extract file number from filename (e.g., "IMG_0123.JPG" -> 123) */
int extract_file_number(const char *filename);

/* Find the highest file number on camera */
int find_highest_file(void *camera, void *context, const char *folder);

/* Check if file exists locally */
int file_exists_locally(const char *filename, const char *dir);

/* Get file modification time */
time_t get_file_mtime(const char *filepath);

/* Photo entry for sorting */
struct photo_entry {
    char path[512];
    time_t mtime;
    unsigned long size;
};

/* Compare function for sorting photos by modification time */
int compare_photos(const void *a, const void *b);

#endif /* FILE_UTILS_H */
