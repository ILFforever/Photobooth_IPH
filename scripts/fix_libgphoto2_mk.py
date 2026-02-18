#!/usr/bin/env python3
"""Fix libgphoto2.mk for Buildroot cross-compilation with v2.5.33"""
import os, sys

path = os.path.expanduser('~/buildroot/package/libgphoto2/libgphoto2.mk')
with open(path) as f:
    content = f.read()

# Remove --disable-serial if we added it before
content = content.replace('LIBGPHOTO2_CONF_OPTS += --disable-serial\n', '')

# The hook: after configure, patch all libtool scripts to not embed host rpath
hook = """
# Fix libtool relink: patch out host rpath that breaks cross-compilation
# The libtool in libgphoto2_port embeds -rpath /usr/lib which Buildroot rejects
define LIBGPHOTO2_POST_CONFIGURE_FIX_LIBTOOL
\tfor lt in $$(find $$(@D) -name libtool -type f); do \\
\t\tsed -i 's|^hardcode_libdir_flag_spec=.*|hardcode_libdir_flag_spec=|' $$lt; \\
\t\tsed -i 's|^sys_lib_dlsearch_path_spec=.*|sys_lib_dlsearch_path_spec=|' $$lt; \\
\t\tsed -i '/^runpath_var=/s|.*|runpath_var=|' $$lt; \\
\tdone
endef
LIBGPHOTO2_POST_CONFIGURE_HOOKS += LIBGPHOTO2_POST_CONFIGURE_FIX_LIBTOOL

"""

eval_line = '$(eval $(autotools-package))'
if eval_line not in content:
    print("ERROR: Could not find eval line in mk file")
    sys.exit(1)

content = content.replace(eval_line, hook + eval_line)

with open(path, 'w') as f:
    f.write(content)
print("OK - patched libgphoto2.mk")
