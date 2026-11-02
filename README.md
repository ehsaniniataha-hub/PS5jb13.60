# PS5 Relapse Jailbreak

**Supported firmware:** 7.00 — 13.60

## How to Use

### Online (GitHub Pages)
Open this link on your PS5 browser:

**https://manos555555.github.io/Relapse-Exploit/**

Press **Jailbreak** and wait for the exploit to complete. Once done, the payload menu will appear.

### Self-hosted (PC Server)
If you prefer to host locally:
```
python serve.py
```
Then open `http://<your-pc-ip>:8000/` on the PS5 browser.

## Included Payloads
| Payload | Version | Description |
|---------|---------|-------------|
| etaHEN | 13.60 build | AIO Homebrew enabler with Toolbox, plugins, Kstuff, FTP and payload support |
| onionHEN | v0.9.0 | Homebrew enabler and Toolbox built on etaHEN |
| ps5upload | v9.4.1 | Fast transfers from PC to PS5 |
| WebKit Autoloader Installer | v0.6.2 | Installs WebKit Autoloader on homescreen |
| ps5debug-NG | 1.3.2 | Debugger with TCP wire-protocol server |
| zftpd | v1.7.0 | Zero-copy FTP/HTTP server |
| CheatRunner | v0.18 | Web-based game cheat trainer |
| ftpsrv-drakmor | 1.16-ng-stable | drakmor's fork of ftpsrv |
| garlic-savemgr | v1.14 | Save decrypt/encrypt/browse utility |
| kstuff-lite | v1.11 | Lite version of kstuff |
| Lapy-JB-Daemon | v1.2 | Standalone homebrew jailbreak daemon |
| PKG-Manager | v1.5.1 | Install PKGs from USB, disc, or SMB shares |
| pldmgr | v0.6.3 | Web dashboard for payload management |
| ps5-app-dumper | v2.10 | Dumps app files to USB storage |
| ShadowMountPlus | 1.7beta11 | Automated background Auto-Mounter |

Payload versions are checked against upstream releases and the [ps5-payloads-mirror](https://github.com/itsPLK/ps5-payloads-mirror) catalog.

## Exploit Chain
Browser stage uses JSC info leaks and a structured clone object pool mismatch to corrupt a typedarray. The kernel stage combines an address leak with an `aio_multi_wait` UAF race to establish kernel R/W.

## Reliability Improvements

This fork includes a set of hardening changes on top of the stock exploit flow, aimed at making the jailbreak safer to use repeatedly and far more debuggable when it fails.

### Safe re-entry (the critical fix)
Previously, if you left the exploit page and came back, the loader could not tell that the console was already jailbroken. The page would either fail to send a payload or re-run the entire kernel exploit on a live system — the most dangerous path, since racing the kernel twice drastically raises the chance of a panic.

The page now probes the ELF loader directly (a real syscall against TCP port `9021`) before doing anything else:

- **elfldr alive** → skips the kernel stage entirely and goes straight to the payload menu. Re-entering the page is now safe.
- **elfldr down** → runs the full jailbreak as normal.

The check works on static hosting (GitHub Pages) where no server-side probe is possible — it is done entirely from inside the browser via the exploit's own primitives.

### Race hardening
The `aio_multi_wait` UAF is a probabilistic race — it cannot be made 100% reliable, but it can fail *safely* instead of hanging or crashing blindly:

- **Pre-flight offset verification** — before arming anything, the exploit reads the walk counter, confirms it is stable, resolves the SMP sysctls, and checks the OID kind. If the offsets do not match the running kernel, it stops cleanly instead of racing blind.
- **UMA zone check** — verifies that the waiter array and the reclaim buffer land in the same allocator zone. If not, the reclaim can never succeed, so it aborts before touching the heap.
- **Fail-fast on a dead ROP worker** — if the chain worker wedges, every subsequent syscall errors immediately instead of queueing 10-second waits.
- **Quiet window during the race** — remote logging and DOM writes are deferred while the reclaim runs, so network traffic can't churn the kernel heap mid-race. Deferred logs always flush afterward via `finally`, even on failure.
- **Post-race diagnostics** — on failure, the exploit dumps an AIO state histogram and pending-request report, so a miss tells you *why* it missed.
- **Auto-recovery** — failed attempts reload and retry automatically (up to a bounded budget), in both jailbreak and payload-sender modes. A miss retries silently; you only intervene if the console actually panics.

### Measured result
With these changes the chain completed **5 out of 5 consecutive fresh-boot attempts** on firmware 13.60 without a panic or a manual retry. Kernel races remain inherently probabilistic — a panic is still possible — but recoverable failures now recover, and unrecoverable ones no longer present as silent hangs.

### Tuning via URL
Race parameters can be overridden from the query string without rebuilding, e.g. `?spray=64&block=24&tmo=10000` for a gentler race. The defaults below are the ones used in the 5/5 run:

| Parameter | Default | Effect |
|-----------|---------|--------|
| `numw` | 18 | AIO waiters per armed group |
| `numr` | 13 | Requests per group |
| `pre` | 32 | Heap churn before the race |
| `churn` | 256 | Heap churn after arming |
| `spray` | 96 | Reclaim submissions per batch |
| `block` | 48 | Parked AIO workers |
| `tmo` | 15000 | Wait timeout (µs) |

## Credits
- **Sonic_Iso** — Kernel Exploit
- **Jordy** — WebKit Exploit and Kernel Bug
- **ntfargo** — Exploit Dev
- **ufm42** — Exploit Dev
- **Dr. Yenyen** — Testing

Other contributors: TheFlow, SlidyBat, Flatz, cow, nhk, bollarz, Sleirsgoevy, EchoStretch, EarthOnion.

## Disclaimer
This project is intended for **educational and security research purposes only**. It does not endorse piracy, unauthorized access, or misuse of commercial devices. Use it only on devices you own or are authorized to test, and comply with applicable laws and regulations.

The software is provided as-is, without warranty. You assume the risks of using it, including system instability, data loss, and account bans. The maintainers accept no liability for resulting damage.
