#!/usr/bin/env bash
# Local SFTP server for test/sftp-file-transport.spec.ts.
#
# That suite runs against a real server on purpose. Its central claim is that a
# symlink inside the website resolves outside it and must be refused — and only
# a real filesystem can demonstrate that. A mock would assert the code does what
# it was written to do, which is not the same thing.
#
# Needs root (creates a user and binds a port). Development only.
set -euo pipefail

USER_NAME=wetest
ROOT=/home/${USER_NAME}/public_html
PORT=2222

id "${USER_NAME}" >/dev/null 2>&1 || useradd -m -d "/home/${USER_NAME}" -s /bin/bash "${USER_NAME}"
echo "${USER_NAME}:sftp-test-password" | chpasswd

mkdir -p "${ROOT}/wp-content/themes"
echo '<?php echo "hello"; ?>'     > "${ROOT}/index.php"
echo 'body { color: #0A7285; }'   > "${ROOT}/wp-content/themes/style.css"
echo 'Options -Indexes'           > "${ROOT}/.htaccess"

# The escape vector under test: a symlink inside the website pointing outside it.
# Its textual path is entirely legitimate, so it is caught only by resolving the
# real path.
ln -sfn /etc "${ROOT}/escape-hatch"
chown -R "${USER_NAME}:${USER_NAME}" "/home/${USER_NAME}"

mkdir -p /run/sshd /etc/ssh/test
[ -f /etc/ssh/test/host_ed25519 ] || ssh-keygen -q -t ed25519 -f /etc/ssh/test/host_ed25519 -N ''

cat > /etc/ssh/test/sshd_config <<CONF
Port ${PORT}
ListenAddress 127.0.0.1
HostKey /etc/ssh/test/host_ed25519
PasswordAuthentication yes
PermitRootLogin no
UsePAM no
Subsystem sftp internal-sftp
PidFile /run/sshd/test.pid
CONF

pkill -F /run/sshd/test.pid 2>/dev/null || true
/usr/sbin/sshd -f /etc/ssh/test/sshd_config -E /tmp/sshd-test.log

echo "SFTP test server listening on 127.0.0.1:${PORT}, root ${ROOT}"
