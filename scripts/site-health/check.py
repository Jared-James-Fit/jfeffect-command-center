#!/usr/bin/env python3
"""Checks that people can open jfeffect.com without a certificate warning.

Run by .github/workflows/site-health.yml every few hours from a GitHub server
(a clean network, nothing in between): every address the public DNS gives
jfeffect.com (and www.jfeffect.com) must serve a certificate a phone trusts for
that name, the certificate must not be close to running out, the domain itself
must not be close to expiring, and the home page must load. Anything wrong
fails the run, which opens (or updates) a GitHub issue and emails the owner.

Standard library only, plus `dig` and `openssl` (both on GitHub's Ubuntu image).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import ipaddress
import json
import os
import shutil
import socket
import ssl
import subprocess
import sys
import urllib.request

APEX = "jfeffect.com"
# Hosts that must work, and hosts that are checked only when they exist.
REQUIRED = ["jfeffect.com"]
OPTIONAL = ["www.jfeffect.com"]
# Public resolvers (Cloudflare, Google, Quad9, OpenDNS): different phones and
# networks ask different ones, so a stale or wrong answer in any of them counts.
RESOLVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9", "208.67.222.222"]
# Certificates are renewed about 30 days before they run out; under this many
# days left means renewal is failing and phones will start refusing the site.
CERT_MIN_DAYS = 14
# The domain registration: a registrar's auto-renew can run as late as the
# expiry date itself, so this only says so (WARN) and alerts (MIN) close to it.
DOMAIN_WARN_DAYS = 45
DOMAIN_MIN_DAYS = 14

failures: list[str] = []
warnings: list[str] = []
lines: list[str] = []


def say(text: str = "") -> None:
    print(text)
    lines.append(text)


def dig(name: str, rtype: str, server: str) -> list[str]:
    try:
        out = subprocess.run(
            ["dig", "+short", "+time=4", "+tries=2", f"@{server}", name, rtype],
            capture_output=True, text=True, timeout=30,
        ).stdout
    except Exception as e:  # noqa: BLE001
        warnings.append(f"`dig {name} {rtype} @{server}` failed: {e}")
        return []
    return [l.strip().rstrip(".") for l in out.splitlines() if l.strip() and not l.startswith(";")]


def is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def resolve(host: str) -> dict[str, set[str]]:
    """Every A / AAAA answer for `host`, keyed by who gave it."""
    answers: dict[str, set[str]] = {}
    if not shutil.which("dig"):
        # No dig: the system resolver only, rather than read "no address" off a missing tool.
        warnings.append("dig isn't installed: checked the system resolver only.")
        try:
            answers["system"] = {a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)}
        except socket.gaierror:
            answers["system"] = set()
        return answers
    servers = list(RESOLVERS)
    # The domain's own nameservers too: the source of truth, ahead of any cache.
    for ns in dig(APEX, "NS", RESOLVERS[0]):
        servers.append(ns)
    for server in servers:
        found: set[str] = set()
        for rtype in ("A", "AAAA"):
            found |= {a for a in dig(host, rtype, server) if is_ip(a)}
        answers[server] = found
    return answers


def describe_cert(der: bytes) -> str:
    try:
        pem = ssl.DER_cert_to_PEM_cert(der)
        out = subprocess.run(
            ["openssl", "x509", "-noout", "-subject", "-issuer", "-dates", "-ext", "subjectAltName"],
            input=pem, capture_output=True, text=True, timeout=15,
        ).stdout
        return " | ".join(l.strip() for l in out.splitlines() if l.strip())
    except Exception as e:  # noqa: BLE001
        return f"(couldn't read the certificate: {e})"


def check_address(host: str, ip: str) -> None:
    family = socket.AF_INET6 if ":" in ip else socket.AF_INET
    ctx = ssl.create_default_context()
    try:
        with socket.socket(family, socket.SOCK_STREAM) as raw:
            raw.settimeout(15)
            raw.connect((ip, 443))
            with ctx.wrap_socket(raw, server_hostname=host) as tls:
                cert = tls.getpeercert()
    except ssl.SSLCertVerificationError as e:
        served = served_cert(host, ip, family)
        failures.append(
            f"**{host} at {ip} serves a certificate phones refuse** ({e.verify_message}). "
            f"That's the \"This Connection Is Not Private\" screen. Served: {served}"
        )
        say(f"  {ip}: REFUSED ({e.verify_message}) · {served}")
        return
    except OSError as e:
        if family == socket.AF_INET6 and "unreachable" in str(e).lower():
            failures.append(
                f"**{host} has an IPv6 address ({ip}) this check can't reach.** The app's host "
                f"serves IPv4 only; an AAAA record sends iPhones on IPv6 networks (most cellular) "
                f"somewhere else. Remove the AAAA record at the domain's DNS unless the host asked for it."
            )
            say(f"  {ip}: IPv6 not reachable from this runner")
            return
        failures.append(f"**{host} at {ip} doesn't answer on HTTPS** ({e}).")
        say(f"  {ip}: NO ANSWER ({e})")
        return
    expires = dt.datetime.fromtimestamp(ssl.cert_time_to_seconds(cert["notAfter"]), dt.timezone.utc)
    days = (expires - dt.datetime.now(dt.timezone.utc)).days
    issuer = dict(x[0] for x in cert.get("issuer", ()))
    say(f"  {ip}: OK · valid until {expires:%Y-%m-%d} ({days} days) · issuer {issuer.get('organizationName', '?')} {issuer.get('commonName', '')}")
    if days < CERT_MIN_DAYS:
        failures.append(
            f"**{host}'s certificate at {ip} runs out in {days} days ({expires:%b %d}).** Renewal "
            f"isn't happening; once it runs out every phone shows \"This Connection Is Not Private\". "
            f"Check the custom domain in Lovable (Project settings → Domains)."
        )


def served_cert(host: str, ip: str, family: int) -> str:
    try:
        ctx = ssl._create_unverified_context()  # noqa: SLF001 — only to say what was served
        with socket.socket(family, socket.SOCK_STREAM) as raw:
            raw.settimeout(15)
            raw.connect((ip, 443))
            with ctx.wrap_socket(raw, server_hostname=host) as tls:
                return describe_cert(tls.getpeercert(binary_form=True) or b"")
    except Exception as e:  # noqa: BLE001
        return f"(couldn't fetch it: {e})"


def check_page(host: str) -> None:
    url = f"https://{host}/"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "jfeffect-site-health"})
        with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310 — fixed https URL
            say(f"  {url} → {res.status} ({res.geturl()})")
            if res.status >= 400:
                failures.append(f"**{url} answers {res.status}.**")
    except Exception as e:  # noqa: BLE001
        failures.append(f"**{url} doesn't load** ({e}).")
        say(f"  {url} → FAILED ({e})")


def check_host(host: str, required: bool) -> None:
    say(f"\n### {host}")
    answers = resolve(host)
    for server, found in answers.items():
        say(f"  DNS {server}: {', '.join(sorted(found)) or 'no address'}")
    every = set().union(*answers.values()) if answers else set()
    if not every:
        if required:
            failures.append(f"**{host} has no address in public DNS.** Nobody can open it.")
        else:
            warnings.append(
                f"{host} doesn't exist in DNS, so anyone who types it gets \"server can't be found\". "
                f"Optional: add it in Lovable (Project settings → Domains) with an A record to the same "
                f"address as {APEX}, so it redirects."
            )
        return
    sets = {frozenset(v) for v in answers.values() if v}
    if len(sets) > 1:
        warnings.append(f"Resolvers disagree on {host} ({'; '.join(', '.join(sorted(s)) for s in sets)}): a DNS change is still spreading or a record is stale.")
    for ip in sorted(every):
        check_address(host, ip)
    check_page(host)


def check_domain() -> None:
    say(f"\n### Domain registration")
    try:
        req = urllib.request.Request(
            f"https://rdap.verisign.com/com/v1/domain/{APEX}",
            headers={"Accept": "application/rdap+json", "User-Agent": "jfeffect-site-health"},
        )
        with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310
            data = json.load(res)
    except Exception as e:  # noqa: BLE001
        warnings.append(f"Couldn't read {APEX}'s registration ({e}).")
        say(f"  couldn't read it ({e})")
        return
    events = {e.get("eventAction"): e.get("eventDate") for e in data.get("events", [])}
    expiry = events.get("expiration")
    say(f"  expires {expiry} · status {', '.join(data.get('status', []))}")
    if expiry:
        when = dt.datetime.fromisoformat(expiry.replace("Z", "+00:00"))
        days = (when - dt.datetime.now(dt.timezone.utc)).days
        if days < DOMAIN_WARN_DAYS:
            warnings.append(f"{APEX} expires in {days} days ({when:%b %d, %Y}): check auto-renew is on at the registrar.")
        if days < DOMAIN_MIN_DAYS:
            failures.append(
                f"**{APEX} expires in {days} days ({when:%b %d, %Y}).** Make sure it auto-renews at the "
                f"registrar; an expired domain is parked and every link shows a warning or someone else's page."
            )


def main() -> int:
    say(f"# {APEX} health check · {dt.datetime.now(dt.timezone.utc):%Y-%m-%d %H:%M} UTC")
    for host in REQUIRED:
        check_host(host, required=True)
    for host in OPTIONAL:
        check_host(host, required=False)
    check_domain()

    # Marks what's wrong, so an open alert issue gets a new comment only when it changes.
    say(f"\n<!-- site-health:{hashlib.sha1(chr(10).join(failures).encode()).hexdigest()[:12]} -->")
    say("\n## Result")
    if failures:
        say("**Problems:**")
        for f in failures:
            say(f"- {f}")
    if warnings:
        say("**Worth a look:**")
        for w in dict.fromkeys(warnings):
            say(f"- {w}")
    if not failures:
        say("All good: every address serves a valid certificate and the site loads.")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    report = os.environ.get("SITE_HEALTH_REPORT")
    if report:
        with open(report, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
