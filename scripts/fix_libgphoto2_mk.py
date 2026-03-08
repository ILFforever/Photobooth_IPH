#!/usr/bin/env python3
"""Fix libgphoto2.mk for Buildroot cross-compilation with v2.5.33+

Patches libtool to remove host rpath and disable relinking during install.
"""
import os, sys, re

path = os.path.expanduser('~/buildroot/package/libgphoto2/libgphoto2.mk')
with open(path) as f:
    content = f.read()

# Remove ALL existing patches (could be duplicated from previous runs)
content = re.sub(
    r'\n# Fix libtool.*?LIBGPHOTO2_POST_CONFIGURE_HOOKS \+= LIBGPHOTO2_POST_CONFIGURE_FIX_LIBTOOL\n',
    '\n', content, flags=re.DOTALL
)
content = re.sub(
    r'\n# Also patch \.la.*?LIBGPHOTO2_POST_BUILD_HOOKS \+= LIBGPHOTO2_POST_BUILD_FIX_LA\n',
    '\n', content, flags=re.DOTALL
)

eval_line = '$(eval $(autotools-package))'
if eval_line not in content:
    print("ERROR: Could not find eval line in mk file")
    sys.exit(1)

hook = """
# Fix libtool cross-compilation: patch out host rpath and disable relink
# libgphoto2 libtool embeds -rpath /usr/lib which Buildroot safety checks reject
define LIBGPHOTO2_POST_CONFIGURE_FIX_LIBTOOL
\tfor lt in $$(find $$(@D) -name libtool -type f); do \\
\t\tsed -i 's|^hardcode_libdir_flag_spec=.*|hardcode_libdir_flag_spec=|' $$lt; \\
\t\tsed -i 's|^sys_lib_dlsearch_path_spec=.*|sys_lib_dlsearch_path_spec=|' $$lt; \\
\t\tsed -i '/^runpath_var=/s|.*|runpath_var=|' $$lt; \\
\t\tsed -i 's|^need_relink=yes|need_relink=no|' $$lt; \\
\tdone
endef
LIBGPHOTO2_POST_CONFIGURE_HOOKS += LIBGPHOTO2_POST_CONFIGURE_FIX_LIBTOOL

# Also patch .la files after build to prevent relink during install
define LIBGPHOTO2_POST_BUILD_FIX_LA
\tfor la in $$(find $$(@D) -name '*.la' -type f); do \\
\t\tsed -i 's|^relink_command=.*|relink_command=|' $$la; \\
\t\tsed -i 's|need_relink=yes|need_relink=no|g' $$la; \\
\tdone
endef
LIBGPHOTO2_POST_BUILD_HOOKS += LIBGPHOTO2_POST_BUILD_FIX_LA

"""

content = content.replace(eval_line, hook + eval_line)

with open(path, 'w') as f:
    f.write(content)
print("OK - patched libgphoto2.mk with comprehensive libtool fix")
