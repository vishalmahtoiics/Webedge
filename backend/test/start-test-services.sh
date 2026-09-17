#!/usr/bin/env bash
# Brings up everything the test suite needs: PostgreSQL and the SFTP fixture.
#
# Several suites run against real services on purpose — tenant isolation and the
# append-only audit trail assert database behaviour, and the file transport
# asserts that a symlink resolves somewhere its textual path does not reveal.
# None of that can be shown with a mock.
#
# Needs root. Development only.
set -euo pipefail

PG_BIN=/usr/lib/postgresql/16/bin

if ! pg_isready -h 127.0.0.1 -q 2>/dev/null; then
  su postgres -c "${PG_BIN}/pg_ctl -D /var/lib/postgresql/16/main -l /tmp/pg.log \
    -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' start" >/dev/null
  # pg_ctl returns before the socket accepts connections.
  for _ in $(seq 1 20); do pg_isready -h 127.0.0.1 -q && break; sleep 0.5; done
fi
echo "postgres: $(pg_isready -h 127.0.0.1 2>&1 | tail -1)"

if ! (exec 3<>/dev/tcp/127.0.0.1/2222) 2>/dev/null; then
  "$(dirname "$0")/sftp-fixture.sh" >/dev/null
fi
echo "sftp: $( (exec 3<>/dev/tcp/127.0.0.1/2222) 2>/dev/null && echo 'listening on 2222' || echo 'DOWN' )"
