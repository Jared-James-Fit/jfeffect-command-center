# Production database outage: what I found and how to recover

## What I found (read-only checks, nothing changed)
1. **Status:** The database is **DOWN**. The backend's health check reports "data plane responded 503", so the server is up but nothing behind it is answering.
2. **Crash loop:** The database has restarted **77 times** since it booted. It keeps starting, crashing and starting again. That's why connections are refused and the app sits on "Updating..." forever.
3. **Not disk, memory or connections:**
   - Data disk: 47% used, so it isn't full.
   - Memory: 33% used.
   - Connection pool: 1 of 200, so it isn't "too many connections".
   - No out-of-memory or other exhaustion alerts in the last 48 hours.
   - The last metrics check itself failed, because the database is unreachable.
4. **Logs:** The database log query came back completely empty. A crashing database often can't write logs, so the last error before the outage isn't visible from here. The cause is still unconfirmed.
5. **Not caused by app changes:** No migrations or database changes were run around this time. The only recent change was the coach day notes, which touched the app only.

## Recovery plan
1. **Restart the backend.** I can trigger this from here once you approve it. It may be unavailable for a few minutes. (Bigger disk or bigger instance won't help, because neither is under pressure.)
2. Re-check status and health until the database reports healthy and the restart count stops rising.
3. Confirm a client profile loads again in the live app.
4. If it crash-loops again after the restart, this isn't something you can fix yourself. Contact Lovable support with these facts: database down, 77 restarts, disk 47%, memory 33%, no exhaustion alerts, empty logs.

If you'd rather do it yourself, open Cloud settings and restart the backend.
