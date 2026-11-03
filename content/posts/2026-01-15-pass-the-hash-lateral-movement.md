---
title: Lateral Movement via Pass-the-Hash: A Windows DFIR Case Study
date: 2026-01-15
difficulty: Intermediate
tools: Volatility3, Windows Event Logs, KAPE, Timeline Explorer
tags: Windows, Lateral Movement, Memory Forensics
killchain: A phished helpdesk credential gave initial access to a workstation; NTLM hash theft from memory enabled pass-the-hash lateral movement to a domain controller within 40 minutes of compromise.
summary: Reconstructing a pass-the-hash lateral movement chain from a phished workstation to a domain controller, using Windows Event Logs and memory forensics.
---

## Background

A SOC alert fired on anomalous Kerberos activity from a domain controller at 03:14 UTC — a
service account that had never authenticated interactively suddenly showed a Type 3 (network)
logon from a workstation in the finance VLAN. That single alert is the entire reason this
investigation exists; everything below is the process of turning it into a full timeline.

The finance workstation, `FIN-WKS-014`, was imaged with KAPE within the hour, and a memory
capture was taken before the box was powered off. Triage started from two angles at once:
disk artifacts on the workstation, and Windows Security event logs on the domain controller.

## Initial access

Pulling the browser and mail artifacts off `FIN-WKS-014` turned up a phishing email received
four days earlier, with a link to a credential-harvesting page styled as the internal helpdesk
portal. The user's Chrome history showed the link was clicked, and NTUSER.DAT registry hive
timestamps line up with a helpdesk password reset roughly 20 minutes later — consistent with
the user re-entering credentials into the fake portal, then "resetting" a password they
believed had leaked.

That gave the actor a valid, low-privilege domain credential. From there, the interesting part
starts: how a low-privilege account on one workstation escalated to a domain controller logon
in under an hour.

<figure>
  <img src="../assets/images/placeholder-screenshot.svg" alt="Annotated screenshot of Windows Event Viewer showing Event ID 4624 Type 3 logons with the anomalous service account highlighted in red">
  <figcaption>Fig. 1 — Security.evtx filtered to Event ID 4624, annotated: the highlighted row is the service account's first-ever network logon from FIN-WKS-014.</figcaption>
</figure>

## Credential theft in memory

The KAPE triage collection included a full memory image (`FIN-WKS-014.mem`, 16 GB). Volatility3
was used to enumerate LSASS handles and hunt for signs of credential dumping:

```powershell
# Identify processes holding a handle to lsass.exe
vol3 -f FIN-WKS-014.mem windows.handles --pid 692 | Select-String "lsass"

# Confirm process lineage for anything suspicious
vol3 -f FIN-WKS-014.mem windows.pstree
```

The process tree showed `rundll32.exe` spawned directly from `winword.exe` roughly two minutes
after the phishing email was opened — a classic macro-dropped-loader pattern — followed by an
open handle from that `rundll32.exe` process into `lsass.exe` with `PROCESS_VM_READ` rights.
That's consistent with an in-memory credential dumper reading LSASS to harvest NTLM hashes
without ever touching disk.

```
$ vol3 -f FIN-WKS-014.mem windows.handles --pid 4412
PID    Process       Handle   Type     Name
4412   rundll32.exe  0x2f4    Process  lsass.exe (PID 692) - PROCESS_VM_READ
```

No credential-dumping tool binary was ever written to disk — this was almost certainly a
reflectively-loaded module, which is why the disk timeline alone never would have surfaced it.

## Lateral movement

With the finance user's NTLM hash in hand, the actor didn't need the plaintext password. The
domain controller's Security log shows an NTLM (not Kerberos) Type 3 logon for the service
account 38 minutes after the LSASS read, immediately followed by that service account creating
a scheduled task — the actual pass-the-hash indicator, since this account had no prior history
of interactive or remote use.

```
EventID=4624 LogonType=3 AuthPackage=NTLM TargetUserName=svc-backup SourceIP=10.12.4.41
EventID=4698 TaskName=\Updater SubjectUserName=svc-backup Command=powershell.exe -enc <base64>
```

Decoding the base64 payload from Event ID 4698 revealed a short PowerShell downloader — the
actor's actual foothold on the domain controller, staged for follow-on tooling that,
fortunately, containment cut off before it executed.

## Reconstructed timeline

<div class="timeline-section">
<p>Every entry below names the artifact it rests on. If a line has no source, it's a guess and
doesn't belong in a timeline.</p>
<ol>
  <li>
    <span class="tl-time">14:02:07 UTC</span>
    <span class="tl-event">Phishing link is clicked, landing on a fake internal helpdesk portal.</span>
    <span class="tl-source">Chrome History, FIN-WKS-014</span>
  </li>
  <li>
    <span class="tl-time">14:03:41 UTC</span>
    <span class="tl-event">winword.exe spawns rundll32.exe two minutes after the email opens.</span>
    <span class="tl-source">Process tree, FIN-WKS-014.mem</span>
  </li>
  <li class="critical">
    <span class="tl-time">14:04:55 UTC</span>
    <span class="tl-event">rundll32.exe opens a PROCESS_VM_READ handle on lsass.exe.</span>
    <span class="tl-source">Handle table, FIN-WKS-014.mem</span>
  </li>
  <li>
    <span class="tl-time">14:21:03 UTC</span>
    <span class="tl-event">The account's helpdesk password is reset — a decoy, not remediation.</span>
    <span class="tl-source">NTUSER.DAT registry LastWrite</span>
  </li>
  <li>
    <span class="tl-time">14:43:18 UTC</span>
    <span class="tl-event">svc-backup authenticates to DC-01 via NTLM — its first-ever network logon.</span>
    <span class="tl-source">Security.evtx, Event ID 4624</span>
  </li>
  <li>
    <span class="tl-time">14:43:52 UTC</span>
    <span class="tl-event">svc-backup creates a scheduled task carrying an encoded PowerShell payload.</span>
    <span class="tl-source">Security.evtx, Event ID 4698</span>
  </li>
  <li class="critical">
    <span class="tl-time">14:44:10 UTC</span>
    <span class="tl-event">DC-01 attempts an outbound connection; the egress rule blocks it.</span>
    <span class="tl-source">Firewall log, DC-01</span>
  </li>
</ol>
</div>

## Artifact correlation

What each artifact establishes, and the limit of what it can establish on its own — search or
filter by confidence to explore it the way I did while building the case.

<div class="ev-controls">
  <label class="ev-search">
    <span>Search artifacts</span>
    <input type="search" id="ev-q" placeholder="lsass, svc-backup, 4624…">
  </label>
  <div class="filter-bar" role="group" aria-label="Filter by confidence">
    <button type="button" class="filter-chip active" data-conf="all">All</button>
    <button type="button" class="filter-chip" data-conf="high">High</button>
    <button type="button" class="filter-chip" data-conf="medium">Medium</button>
    <button type="button" class="filter-chip" data-conf="low">Low</button>
  </div>
</div>

<div class="ev-table-scroll">
  <table class="ev-table">
    <thead>
      <tr>
        <th>Artifact</th>
        <th>Source</th>
        <th>Establishes</th>
        <th>Does not establish</th>
        <th>Confidence</th>
      </tr>
    </thead>
    <tbody>
      <tr data-conf="high">
        <td class="mono">winword.exe → rundll32.exe process lineage</td>
        <td>Process tree, FIN-WKS-014.mem</td>
        <td>A macro-spawned loader process ran on FIN-WKS-014 two minutes after the phishing email was opened.</td>
        <td class="limit">Not that this process dumped credentials — only that the anomalous lineage exists.</td>
        <td><span class="conf conf-high">High</span></td>
      </tr>
      <tr data-conf="high">
        <td class="mono">rundll32.exe handle on lsass.exe (PROCESS_VM_READ)</td>
        <td>Handle table, FIN-WKS-014.mem</td>
        <td>rundll32.exe held a read handle into LSASS memory at 14:04:55.</td>
        <td class="limit">Not that hash extraction succeeded — no dumped credential blob was recovered to confirm it directly.</td>
        <td><span class="conf conf-high">High</span></td>
      </tr>
      <tr data-conf="high">
        <td class="mono">Event ID 4698, scheduled task "Updater"</td>
        <td>Security.evtx, DC-01</td>
        <td>svc-backup created a scheduled task with an encoded PowerShell payload immediately after logon.</td>
        <td class="limit">Not that the payload executed — containment cut off before that could be confirmed.</td>
        <td><span class="conf conf-high">High</span></td>
      </tr>
      <tr data-conf="medium">
        <td class="mono">Chrome History, URL visit</td>
        <td>FIN-WKS-014</td>
        <td>The phishing link was clicked in the browser.</td>
        <td class="limit">Not that credentials were actually entered on the fake portal.</td>
        <td><span class="conf conf-medium">Medium</span></td>
      </tr>
      <tr data-conf="medium">
        <td class="mono">NTUSER.DAT registry LastWrite</td>
        <td>FIN-WKS-014</td>
        <td>The account's password was reset roughly 20 minutes after the phishing click.</td>
        <td class="limit">Not that the reset happened through the fake portal rather than the real helpdesk.</td>
        <td><span class="conf conf-medium">Medium</span></td>
      </tr>
      <tr data-conf="medium">
        <td class="mono">Event ID 4624, NTLM Type 3 logon</td>
        <td>Security.evtx, DC-01</td>
        <td>svc-backup authenticated to DC-01 from FIN-WKS-014 for the first time ever recorded.</td>
        <td class="limit">Not, on its own, that the credential used was the one read from LSASS — the link is timing, not cryptographic proof.</td>
        <td><span class="conf conf-medium">Medium</span></td>
      </tr>
      <tr data-conf="low">
        <td class="mono">Firewall egress log, blocked outbound connection</td>
        <td>DC-01</td>
        <td>DC-01 attempted an outbound connection at 14:44:10 that the egress rule blocked.</td>
        <td class="limit">Not the destination or intent — could be the staged payload's callback, or unrelated traffic.</td>
        <td><span class="conf conf-low">Low</span></td>
      </tr>
    </tbody>
  </table>
  <p class="ev-empty" id="ev-none" hidden>No artifacts match that filter.</p>
</div>

## Attack flow

<div class="diagram-wrap">
<svg viewBox="0 0 900 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Attack flow diagram from phishing email to domain controller compromise">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#39d98a"/>
    </marker>
  </defs>
  <style>
    .node rect { fill: #131a24; stroke: #1f2a38; stroke-width: 1.5; }
    .node text { fill: #c9d1d9; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
    .node .title { fill: #f0f3f6; font-weight: 600; font-size: 13px; }
    .edge { stroke: #39d98a; stroke-width: 1.5; fill: none; marker-end: url(#arrow); }
    .edge-label { fill: #8b949e; font-family: ui-monospace, Consolas, monospace; font-size: 10px; }
  </style>

  <g class="node"><rect x="10" y="90" width="150" height="70" rx="6"/>
    <text class="title" x="24" y="118">Phishing Email</text>
    <text x="24" y="138">Fake helpdesk portal</text></g>

  <g class="node"><rect x="220" y="90" width="150" height="70" rx="6"/>
    <text class="title" x="234" y="118">FIN-WKS-014</text>
    <text x="234" y="138">winword → rundll32</text></g>

  <g class="node"><rect x="430" y="10" width="150" height="70" rx="6"/>
    <text class="title" x="444" y="38">LSASS Memory</text>
    <text x="444" y="58">NTLM hash harvested</text></g>

  <g class="node"><rect x="430" y="170" width="150" height="70" rx="6"/>
    <text class="title" x="444" y="198">Password Reset</text>
    <text x="444" y="218">Decoy / false trail</text></g>

  <g class="node"><rect x="640" y="90" width="150" height="70" rx="6"/>
    <text class="title" x="654" y="118">DC-01</text>
    <text x="654" y="138">Pass-the-hash logon</text></g>

  <path class="edge" d="M160,125 L220,125"/>
  <path class="edge" d="M370,110 L430,65"/>
  <path class="edge" d="M370,140 L430,195"/>
  <path class="edge" d="M580,55 L680,90"/>
  <text class="edge-label" x="580" y="100">NTLM hash, +38min</text>
</svg>
</div>

## Key learnings

- **Memory-only credential theft leaves no disk artifact.** The LSASS read never touched disk;
  only a live/recent memory capture surfaced it. If KAPE triage hadn't included a `.mem` dump,
  this pivot point would have been invisible.
- **A never-before-seen NTLM logon on a service account is a strong signal.** Baselining "this
  account has never logged on this way before" caught the lateral movement faster than any
  static signature would have.
- **The password reset was a decoy, not remediation.** Analysts should treat any credential
  change shortly after suspected compromise as a data point to timeline, not evidence the
  issue is closed.

### Artifacts referenced

<div class="artifact-ref-grid">
  <div class="ref-item"><strong>Security.evtx</strong>Windows Security event log, DC-01 &amp; FIN-WKS-014</div>
  <div class="ref-item"><strong>FIN-WKS-014.mem</strong>Full memory capture, KAPE + WinPMem</div>
  <div class="ref-item"><strong>NTUSER.DAT</strong>User registry hive, password reset timestamp</div>
  <div class="ref-item"><strong>Event ID 4624</strong>Successful logon, Type 3 / NTLM</div>
  <div class="ref-item"><strong>Event ID 4698</strong>Scheduled task creation</div>
  <div class="ref-item"><strong>Firewall egress log</strong>DC-01 outbound connection attempt</div>
</div>
