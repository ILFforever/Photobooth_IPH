#!/usr/bin/env python3
"""Patch libgphoto2.mk to fix libtool relink issue in cross-compilation"""
import os

path = os.path.expanduser('~/buildroot/package/libgphoto2/libgphoto2.mk')
with open(path) as f:
    content = f.read()

# Remove any previous hook we may have added
for marker in ['LIBGPHOTO2_POST_CONFIGURE_FIX_LIBTOOL', 'LIBGPHOTO2_POST_BUILD_FIX_LIBTOOL']:
    if marker in content:
        # Remove from the comment above through the HOOKS line
        lines = content.split('\n')
        new_lines = []
        skip = False
        for line in lines:
            if 'Fix libtool relink' in line:
                skip = True
                continue
            if skip and marker in line:
                skip = False
                continue
            if skip and (line.startswith('define ') or line.startswith('\t') or line == 'endef' or line == ''):
                continue
            skip = False
            new_lines.append(line)
        content = '\n'.join(new_lines)

# POST_BUILD hook: clear relink_command from all .la files after build, before install
# This prevents libtool from relinking with host -L/usr/lib paths
hook_text = (
    '\n'
    '# Fix libtool relink: clear relink_command from .la files to prevent\n'
    '# host -L/usr/lib paths in cross-compilation (affects libgphoto2 >= 2.5.32)\n'
    'define LIBGPHOTO2_POST_BUILD_FIX_LIBTOOL\n'
    "\tsed -i 's|^relink_command=.*|relink_command=\"\"|' $$(find $$(@D) -name '*.la' -type f)\n"
    'endef\n'
    'LIBGPHOTO2_POST_BUILD_HOOKS += LIBGPHOTO2_POST_BUILD_FIX_LIBTOOL\n'
    '\n'
)

target = '$(eval $(autotools-package))'
if target not in content:
    print("ERROR: eval line not found")
    exit(1)

content = content.replace(target, hook_text + target)

with open(path, 'w') as f:
    f.write(content)
print("Patched OK")
