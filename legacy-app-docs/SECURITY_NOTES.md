# Security Notes — Multi-Source Log Explorer MVP

This document summarizes the security posture and known risks of the MVP.

## Sensitive Field Masking

The following fields containing banking data are **masked server-side** before any
response reaches the browser:

| Field | Masking Rule |
|-------|-------------|
| `cif` | Fully masked: `***` |
| `UserName` | Partial: first 1/4 visible + `***` |
| `CustomerId` | Partial: first 1/4 visible + `***` |
| `deviceId` | First 2 characters + `***` |
| `deviceIp` | IPv4: `x.x.*.*` format; otherwise partial mask |

Masking is applied in two places:
- `maskedMdc` within the `LogEvent` response object
- `rawFields` snapshot where these keys may appear

The frontend renders masked values exactly as received from the backend; it never
attempts to reconstruct or display raw sensitive values.

## Docker Socket Mount — Privilege Risk

When using `docker-compose.mvp.yml` with `--profile docker-access`, the Docker socket
(`/var/run/docker.sock`) is mounted into the container. This grants the container
**full administrative access** to the host Docker daemon, equivalent to root on the host:

- Containers can create/destroy other containers
- Containers can access host filesystems via volume mounts
- The container can pivot to any network namespace

**This should only be used in local development environments.** Never enable in
staging or production. The Docker socket mount is **disabled by default** in
`docker-compose.mvp.yml`.

## Bearer Token Handling

The OpenShift Loki bearer token:
- Is read **only** from environment variables (`OPENSHIFT_LOKI_TOKEN`)
- Is **never** exposed in URLs, query strings, or browser history
- Is **never** logged by the backend
- Is sanitized from error responses via `sanitizeError()` which strips
  `Bearer <token>`, password-like values, and other sensitive patterns
- Is scoped to internal API calls only; the frontend has no access to this token

## TLS Verification

TLS certificate verification remains **enabled** in all modes. The application never
disables hostname verification or accepts self-signed certificates without explicit
configuration. This is enforced both in the WebFlux `WebClient` configuration and
in the Docker Java HTTP client configuration.

## Authentication & Authorization

- No application-level authentication is implemented in the MVP.
- Deployments rely on external access control (e.g., OpenShift Route auth, network policies).
- Actuator endpoints are limited to health and info; sensitive actuator endpoints are disabled.

## No Production Readiness Claim

This is an **MVP** intended to validate user experience and core functionality. It is
**not** hardened for production deployment. Security gaps that exist by design:

| Gap | Status |
|-----|--------|
| Single Sign-On (SSO) / OIDC | Outside MVP scope |
| Role-Based Access Control (RBAC) | Outside MVP scope |
| Audit logging of user queries | Outside MVP scope |
| Persistent storage of preferences | Uses browser `localStorage` only |
| Rate limiting at application level | Outside MVP scope |
| Network policy enforcement | Deployment concern |
| Container image signing / signing verification | Deployment concern |
| Secrets rotation mechanism | Manual, via OpenShift Secret updates |

## Safe Defaults

The following safe defaults are enforced:
- Queries never placed in browser URL (`window.location` is never modified)
- `localStorage` never stores queries containing sensitive field names (`cif`, `UserName`, `CustomerId`)
- Raw query mode (`rawLogQl`) disabled by default in configuration
- Maximum result limits enforced (5,000 for search, 1,000 for live tail display)
- Log text rendered as text, never as HTML on the frontend

## Client-Side Safety

The React frontend follows these rules:
- Zero `dangerouslySetInnerHTML` usage — all content is rendered as text
- Copy buttons only available on non-sensitive fields (message, traceId, correlationId)
- Find buttons not available on sensitive MDC fields in EventDetail

## Recommendations for Production

Before deploying beyond MVP:
1. Implement SSO integration (OpenShift OAuth, Keycloak, or corporate IdP)
2. Add RBAC for multi-tenant environments
3. Implement query audit logging
4. Add network policies to restrict container-to-host communication
5. Review and harden resource limits per environment
6. Set up automated secrets rotation
7. Enable HPA for resilience (multiple replicas)
8. Conduct a security assessment against your organization's threat model
