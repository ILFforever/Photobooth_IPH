#ifndef CAMERA_STORAGE_H
#define CAMERA_STORAGE_H

#include <sys/types.h>

/* Check available disk space in bytes for a given path */
unsigned long long get_available_space(const char *path);

/* Helper to get file modification time */
time_t get_file_mtime(const char *filepath);

/* Clean up old photos to free space. Returns number of files deleted. */
int cleanup_old_photos(unsigned long long target_free_bytes);

/* Ensure sufficient storage space before saving a file */
void ensure_storage_space(unsigned long long file_size_estimate);

#endif /* CAMERA_STORAGE_H */
