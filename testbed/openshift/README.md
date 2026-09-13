# OS-1F Real-Sandbox Testbed

**Test infrastructure only.** Not a Log Explorer product feature, not a
dependency of `backend/` or `frontend/`. Exists to produce realistic
OpenShift workload/log diversity for real-cluster Log Explorer
verification (OS-1F), against a real Red Hat Developer Sandbox project.

## What this is

One tiny, reusable Spring Boot application (`app/`), deployed ~10 times
as logically distinct microservices — all the SAME image, differentiated
only by `SERVICE_NAME`/`SERVICE_ROLE` environment variables:

| Service | Role |
|---|---|
| `logexp-test-edge` | EDGE (2 replicas, + a metrics sidecar container) |
| `logexp-test-profile` | PROFILE (2 replicas) |
| `logexp-test-catalog` | CATALOG |
| `logexp-test-orders` | ORDERS (2 replicas, used for the rolling-update test) |
| `logexp-test-workflow` | WORKFLOW |
| `logexp-test-directory` | DIRECTORY |
| `logexp-test-message` | MESSAGE |
| `logexp-test-rules` | RULES |
| `logexp-test-activity` | ACTIVITY |
| `logexp-test-report` | REPORT |

Every name is the generic `logexp-test-<noun>` pattern (deliberately not
a banking/business-domain name) — used identically as the OpenShift
Deployment/Service/Route resource name AND the in-app `SERVICE_NAME`
identity (the `application` field in every generated log line).

Each pod continuously emits structured JSON logs to stdout (captured by
OpenShift/`oc logs` automatically), in the exact field shape the real
Log Explorer parser (`backend/.../core/parse/LogLineParser.java`)
expects — verified directly against a real parser round-trip, not
assumed. No real personal information anywhere; every MDC value is an
obviously-fake, deterministic-shaped placeholder (`FAKE-CIF-...`,
`DEMO-CUST-...`, etc.).

## Security — read this before doing anything else

- **Never** put a Sandbox token in this directory, in any script's
  arguments as committed here, in a commit message, or in any file under
  `docs/verification/`.
- Every script below reads credentials from environment variables
  (`OPENSHIFT_LOGIN_COMMAND`, or `OPENSHIFT_API_SERVER` +
  `OPENSHIFT_TOKEN`) that you set in your own shell immediately before
  running it — never as a script argument, never echoed by the script.
- A token that has ever appeared in a chat, screenshot, or document must
  be treated as already exposed. Get a fresh one from the Sandbox console
  before using any of this.
- `oc login`'s own process arguments are visible to local `ps` on the
  machine you run it on for the brief duration of the call — this is an
  inherent property of the `oc` CLI itself, not something these scripts
  can fully hide. Run these scripts on a machine you trust.

## Layout

```
testbed/openshift/
  README.md                          - this file
  app/                                - the one shared Spring Boot log generator
    pom.xml
    Dockerfile
    src/main/java/com/logexplorer/testbed/
      TestbedApplication.java
      ServiceIdentity.java            - reads SERVICE_NAME/SERVICE_ROLE
      LogEvent.java                   - the JSON log writer (stdout)
      TestController.java             - /test/* deterministic scenarios
      BackgroundTrafficGenerator.java - bounded continuous background traffic
      HealthController.java           - /healthz
  manifests/
    services.yaml                     - the 10 services + roles + replicas + sizing
    deployment-template.yaml          - rendered once per service (envsubst)
    edge-with-sidecar-template.yaml   - logexp-test-edge's own variant (+ sidecar, + Route)
  scripts/
    connect-check.sh                  - verify credential, print safe metadata only
    build-and-push.sh                 - builds the image via an OpenShift binary BuildConfig
    deploy.sh                         - renders + applies every service
    generate-traffic.sh               - drives the deterministic /test/* scenarios
    rolling-update-demo.sh            - mission §11 rolling-update test (logexp-test-orders)
    cleanup.sh                        - removes ONLY label-selected testbed resources
```

## Usage

```bash
# 1. Set credentials in your OWN shell (never as a script argument):
export OPENSHIFT_LOGIN_COMMAND='oc login --token=... --server=...'
# or: export OPENSHIFT_API_SERVER=... OPENSHIFT_TOKEN=...

export TESTBED_NAMESPACE=log-explorer-test   # or your pre-created Sandbox namespace

# 2. Verify the credential and inspect quota (prints no secrets):
./scripts/connect-check.sh

# 3. Build the shared image (uses OpenShift's own build mechanism - no
#    external registry needed):
eval "$(./scripts/build-and-push.sh | tee /dev/stderr | grep TESTBED_IMAGE)"

# 4. Deploy all ~10 services + the sidecar + Route:
./scripts/deploy.sh v1

# 5. Generate deterministic investigation scenarios:
./scripts/generate-traffic.sh all

# 6. (optional) Exercise the rolling-update test on logexp-test-orders:
./scripts/rolling-update-demo.sh

# 7. When done, clean up ONLY what this testbed created:
./scripts/cleanup.sh
```

Then use the REAL Log Explorer app (PR #45) — paste the same
`oc login` command into its Settings UI (parsed, never executed) and
verify Settings/discovery/search/context/correlation/Live against this
real, running testbed.

## Resource footprint

Tuned for Red Hat Developer Sandbox's limited quota (mission §5):
~12 pods total (10 services, 3 of which run 2 replicas, plus one extra
sidecar container on `logexp-test-edge`), each requesting `15m`
CPU / `80Mi` memory, limited to `150m` / `160Mi`. Adjust
`manifests/services.yaml`'s `resources:` block if your actual quota
(printed by `connect-check.sh`) needs it smaller.

## Cleanup guarantee

Every resource this testbed creates carries
`log-explorer-testbed=true` and
`app.kubernetes.io/part-of=log-explorer-sandbox-testbed`.
`scripts/cleanup.sh` deletes only resources carrying that label — never
the project/namespace itself, never anything else in it.
