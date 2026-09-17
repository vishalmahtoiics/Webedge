#!/usr/bin/env bash
# Brings up everything the test suite needs: PostgreSQL and the SFTP fixture.
#
# Several suites run against real services on purpose — tenant isolation and the
# append-only audit trail assert database behaviour, the file transport asserts
# that a symlink resolves somewhere its textual path does not reveal, and the
# mailbox password suite asserts that Dovecot accepts the hashes WebEdge writes.
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

# No daemon needed: the mailbox password suite shells out to `doveadm pw -t` to
# confirm that a hash written here is one Dovecot will actually accept. Without
# it that suite fails rather than passing quietly, because a green run that
# proved nothing is worse than a visible gap.
if ! command -v doveadm >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq dovecot-core >/dev/null 2>&1 || true
fi
echo "doveadm: $(command -v doveadm >/dev/null 2>&1 && echo 'available' || echo 'MISSING — mailbox password tests will fail')"

# Also no daemon: `postmap -q` runs the real Postfix lookup maps against the
# real database, which is how the queries that decide who receives mail are
# checked. Reading the SQL proves nothing — a query matching one row too many
# looks correct on the page.
if ! command -v postmap >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postfix postfix-pgsql >/dev/null 2>&1 || true
fi
echo "postmap: $(postconf -m 2>/dev/null | grep -qx pgsql && echo 'available with pgsql' || echo 'MISSING — lookup map tests will fail')"
