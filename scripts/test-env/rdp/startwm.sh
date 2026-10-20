#!/bin/sh
# The session xrdp starts after login: IceWM with an xterm, so the desktop shows who is connected.
xterm -geometry 100x30+40+40 -e sh -c 'echo "TunL RDP test server: $(hostname), user $(id -un)"; exec bash' &
exec icewm-session
