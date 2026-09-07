# Phase A2a verification-harness entry points. See IMPLEMENTATION_PLAN.md
# "Phase A2a" and each tool's own README.md for details.
#
# Deliberately not tied to backend/ or frontend/, neither of which exists
# yet (Phase B scaffolds them) — every target here is self-contained.

.PHONY: demo-log-generator-selftest demo-log-generator-run \
        mock-loki-contract-test mock-loki-run \
        playwright-harness-install playwright-harness-test playwright-harness-typecheck \
        a2a-selftest

demo-log-generator-selftest:
	node tools/demo-log-generator/generate.js --selftest

demo-log-generator-run:
	node tools/demo-log-generator/generate.js --seed 42

mock-loki-contract-test:
	node tools/mock-loki/contract-test.js

mock-loki-run:
	node tools/mock-loki/server.js

playwright-harness-install:
	cd tools/playwright-harness && npm install

playwright-harness-test:
	cd tools/playwright-harness && npx playwright test

playwright-harness-typecheck:
	cd tools/playwright-harness && npm run typecheck

# Runs every Phase A2a self-test/contract-test/meta-test in one command.
a2a-selftest: demo-log-generator-selftest mock-loki-contract-test playwright-harness-test
