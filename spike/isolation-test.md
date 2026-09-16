# Isolation test runbook

**Spec reference:** §5.3 deliverable 3, §5.4
**Answers:** open question 1 in `docs/PROVIDER-INTEGRATION.md` §7
**Decides:** whether ADR-001's recommendation stands

---

## Why this is the first thing to run

ADR-001 recommends Agency Hosting because its API scopes databases, cron jobs and system users **per
website**, where shared hosting scopes them per account. That is documentary evidence: it proves the *API*
is website-scoped. It does not prove the *filesystem* is.

§5.4 is a MUST:

> Websites of different customers MUST NOT share an isolation unit unless M0 proves the provider isolates
> websites from each other.

"Proves" means a test, not an inference from URL shapes. If website A can read website B's files, Agency
Hosting fails §5.4 exactly as shared hosting does, and the only remaining compliant option is the VPS fleet
— which the budget cannot carry. **The entire architecture rests on this result, so run it before anything
else in the spike.**

## Before you start

- [ ] Owner has given explicit go-ahead for writes (§5.3.2). This runbook writes files.
- [ ] A **staging** Hostinger account, not production. There is no sandbox: these are real websites.
- [ ] Two websites on the **same Agency Hosting order**, named `wetest-a` and `wetest-b`. Same order matters
      — that is the co-tenancy case WebEdge would actually create.
- [ ] SFTP access to both.

Everything created here is disposable and gets deleted in step 6.

## Step 1 — record the system users

```bash
GET /api/agency-hosting/v1/websites/{uid_a}
GET /api/agency-hosting/v1/websites/{uid_b}
```

Record for each: `user.username`, `remote_access.sftp.username`, `remote_access.sftp.host`, `server.hostname`.

**If both websites report the same `user.username`, stop.** They share an OS user, isolation has already
failed, and there is no need to run the rest.

## Step 2 — plant a marker in website B

Over SFTP to `wetest-b`, write a file containing a string that is unique and searchable:

```
<website B root>/private-marker.txt
    ISOLATION-TEST-MARKER-B-<random string>
```

Also note the absolute path of B's home directory from step 1's username.

## Step 3 — try to read it from website A

Upload this to website A's document root as `isolation-probe.php`, then request it over HTTPS.

```php
<?php
header('Content-Type: text/plain');

// Substitute B's real home directory, discovered in step 1.
$targets = [
    '/home/<username_b>/',
    '/home/<username_b>/public_html/',
    '/home/<username_b>/public_html/private-marker.txt',
    '/home/',
    '/etc/passwd',
];

foreach ($targets as $t) {
    echo "== $t\n";
    if (is_dir($t)) {
        $entries = @scandir($t);
        echo $entries === false ? "  dir: DENIED\n" : "  dir: READABLE (" . count($entries) . " entries)\n";
    } elseif (is_file($t)) {
        $content = @file_get_contents($t);
        echo $content === false ? "  file: DENIED\n" : "  file: READABLE (" . strlen($content) . " bytes)\n";
    } else {
        echo "  not visible\n";
    }
}

echo "== whoami\n  " . (function_exists('posix_getpwuid')
    ? posix_getpwuid(posix_geteuid())['name'] : get_current_user()) . "\n";
echo "== open_basedir\n  " . (ini_get('open_basedir') ?: '(not set)') . "\n";
```

`open_basedir` matters: if it is set and confines PHP to the website root, that is a real control — but note
it is a *PHP* control, not a filesystem one. It does not constrain cron jobs or SSH. Record it either way.

## Step 4 — try the same over SFTP and cron

PHP is only one execution path. Repeat from the other two:

**SFTP** — connect as website A's SFTP user and attempt:
```
ls /home/<username_b>/
get /home/<username_b>/public_html/private-marker.txt
ls /home/
```

**Cron** — create a cron job on website A (`POST /api/agency-hosting/v1/websites/{uid_a}/cron-jobs`) running:
```sh
cat /home/<username_b>/public_html/private-marker.txt > /home/<username_a>/public_html/cron-result.txt 2>&1
```
Then fetch `cron-result.txt`. Cron is the path that failed on shared hosting, so it is the one that matters
most here.

## Step 5 — record the result

| Path | Directory listing | Marker file contents | Notes |
|---|---|---|---|
| PHP from website A | | | `open_basedir`: |
| SFTP as website A | | | |
| Cron on website A | | | |

**Isolation holds** only if all three deny access to B's marker. Anything else is a failure.

A partial result is a failure. "PHP is confined by `open_basedir` but cron can read everything" means a
customer who can create a cron job — which §8.4 offers them — can read another customer's files.

## Step 6 — clean up

Delete `isolation-probe.php`, `private-marker.txt`, `cron-result.txt`, and the cron job. Then delete both
`wetest-` websites if they were created for this test.

## Recording the outcome

| Outcome | What it means | Action |
|---|---|---|
| **All three denied** | Agency Hosting isolates websites. §5.4 is satisfied. | Mark ADR-001 **Accepted**. Update `docs/PROVIDER-INTEGRATION.md` §2 from "[?] needs live confirmation" to verified, citing this test and its date. M2 can start. |
| **Any path readable** | Agency Hosting does **not** isolate websites. ADR-001's recommendation is void. | Stop. Do not start M2. Tell the owner immediately: the only §5.4-compliant option left is the VPS fleet, which needs a budget and timeline renegotiation before any further work. |

Either way, record the result in `docs/PROGRESS.md` under M0 and attach the step 5 table. This is the single
most consequential finding in the project — it should be easy for anyone to find later and see how it was
established.

## A note on what this does not prove

A pass means WebEdge's *own* two websites could not reach each other on one order, on one day, with these
three execution paths. It does not prove the provider guarantees isolation contractually, nor that it will
hold after a provider platform change. Two follow-ups:

- Ask Hostinger to confirm the isolation guarantee **in writing**, alongside the white-label resale
  confirmation the owner is already seeking (§2.3).
- Re-run this runbook before launch (M7) and after any provider-announced platform change.
