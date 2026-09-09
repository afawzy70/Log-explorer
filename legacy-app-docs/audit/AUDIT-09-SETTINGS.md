# Audit 09 — Settings

**Scope:** The OLD app's Settings view (`SettingsPage` + `DockerConnectionPanel`), the masking/unmasking model, per-field toggles, and Docker connection configuration, with the backend security gates.

> **Provenance status:** OLD = verified from source (this repo). NEW = **UNVERIFIED** (NEW app unreachable).

---

## 1. Masking settings (`SettingsPage` + `SettingsController`)

### Status surface (`MaskingStatus`)
| Field | Meaning |
|-------|---------|
| `enabled` | global masking enabled. |
| `maskingActive` | masking currently active for this session (= `enabled && !unmaskActive`). |
| `unmaskAvailable` | whether session-unmask is permitted (`logexplorer.security.unmask.enabled`, default **false**). |
| `unmaskActive` | whether an unmask grant is currently active. |
| `unmaskRemainingSeconds` | TTL remaining (default 300s after grant). |
| `protectedCategories` | which sensitive categories are protected. |
| `whyUnmaskUnavailable` | reason (e.g. NO_AUTH reason). |
| `fields` | per-field on/off status (never contains sensitive values). |

### Actions
| Action | Endpoint | Effect |
|--------|----------|--------|
| View status | `GET /settings/masking` | current status for session. |
| Unmask (session) | `POST /settings/masking/unmask` `{sessionId, confirm}` | grants session-scoped unmask (needs `confirm:true`; 400 if no confirm, 403 if not permitted). |
| Mask (revoke) | `POST /settings/masking/mask` `{sessionId}` | revokes unmask + clears per-field overrides. |
| Toggle a field | `POST /settings/masking/fields` `{sessionId,field,enabled}` | enables/disables masking for one sensitive field (e.g. `cif`) for the session. |

### Backend security (`security/`)
- **`UnmaskCapabilityService`** — global unmask gated by config (default off). No auth/RBAC → unmask is a **local-development-only preview**; grants expire by TTL.
- **`PerFieldMaskingService`** — session-scoped map of unmasked fields (cap 10,000 sessions); audits FIELD_UNMASK_ON/OFF; when on, original values are served for that field in both historical and live-tail.
- **`MaskingAuditService`** — in-memory audit trail (sanitized; not a production persistence layer); records UNMASK_REJECTED/GRANTED/EXPIRED, FIELD_UNMASK_*.

### Security notes (per `SECURITY_NOTES.md`)
- Sensitive values never in URLs/query strings/browser history; never logged.
- Frontend renders masked values only; no `dangerouslySetInnerHTML`.
- localStorage never stores sensitive field values or sensitive queries.

## 2. Docker connection settings (`DockerConnectionPanel` + `DockerConnectionController`)

### Form state (`utils/dockerConnection.ts`)
| Field | Options |
|-------|---------|
| mode | `LOCAL` / `REMOTE`. |
| name | display name. |
| host | REMOTE only; required, ≤253 chars. |
| port | `AUTO` (2375 no-TLS / 2376 TLS) or `CUSTOM` (integer 1–65535). |
| tlsEnabled | boolean. |
| tlsProfile | required when TLS; must be in `view.availableTlsProfiles`. |

> **Note:** There is **no project-filter / exclusion-label field** in the frontend `DockerConnectionPanel` even though the backend supports `logexplorer.docker.project-filter` and `exclusion-label-key` (see Audit 14).

### Actions
| Action | Endpoint | Effect |
|--------|----------|--------|
| View | `GET /docker-connection` | secret-free `DockerConnectionView`. |
| Save | `POST /docker-connection` | persist per-session connection (runs `security.validateForSave` + audit). |
| Reset | `DELETE /docker-connection` | reset to local. |
| Test | `POST /docker-connection/test` | connectivity test (re-resolves, security-validated). |

### Per-user/session model
- Session scoped via `X-LogExplorer-Session` header (anonymous browser token; no auth/RBAC).
- `DockerConnectionStore` per-session map; default `DockerConnection.local()` for anonymous/new.
- `DockerConnectionService.gatewayForSession` caches a gateway per session, rebuilding/closing when the connection `key()` changes; live-tail resolves gateway **once on the request thread** (reactive scheduler lacks SessionContext).

### Security gates (`DockerConnectionSecurity`)
- Remote host: name/IP syntax only, never a URL; port range 1–65535.
- **Insecure (non-TLS) remote** requires `allowInsecureRemoteDocker=true` AND endpoint on admin allowlist (hosts/CIDRs).
- **SSRF + DNS-rebinding:** re-resolves at connect/test; rejects metadata (169.254.169.254), link-local, multicast, broadcast, unspecified regardless of TLS; loopback allowed (127/8).
- TLS profiles are server-managed (PEM in memory, never leaves backend); `tls-profiles` config is **commented out** in this environment → no TLS profiles available, so REMOTE+TLS would be rejected as `tls-profile-unknown`.

### Environment hardening (`application-prod.properties`)
- `allow-insecure-remote-docker=false`; `allowed-hosts`/`allowed-cidrs` cleared → **no non-TLS remote engine allowed in prod**.

---

## 3. What is persisted (preferences)

`SavedPreferences{sourceId, timePreset, levels, queryMode}` under `logexplorer.preferences` — **no query text, no sensitive values**. Table prefs separately under `logexplorer.table`. See Audit 13 Productivity.

---

## Gaps / notes (OLD)

1. **Unmask disabled by default** (no auth) — masking cannot be lifted in a normal local run without flipping config.
2. **No project-filter / exclusion-label UI** in `DockerConnectionPanel`.
3. **No TLS profiles configured** in this environment (commented out) → remote+TLS unusable here.
4. **Audit logs are in-memory only** (no durable audit trail).
5. **No auth/RBAC** anywhere (external access control assumed).
