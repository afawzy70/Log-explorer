import type { OpenShiftWorkloadKind } from '../../../shared/api/types';

/**
 * SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - moved out of
 * `OpenShiftSettingsPanel.tsx` (which no longer owns workload selection;
 * see `OpenShiftScopeSelect.tsx`) into its own module so every consumer -
 * `Shell`'s `ScopeTrail`, the Search toolbar's scope controls, and
 * Settings' own now-read-only scope summary - shares one label set rather
 * than each keeping a driftable copy. A workload kind's own display name
 * (OS-1B §6/§21). Jobs/CronJobs are deferred, not offered.
 */
export const WORKLOAD_KIND_LABELS: Record<OpenShiftWorkloadKind, string> = {
  DEPLOYMENT: 'Deployment',
  DEPLOYMENT_CONFIG: 'DeploymentConfig',
  STATEFUL_SET: 'StatefulSet',
  DAEMON_SET: 'DaemonSet',
};

/** Encodes a workload selection into a `<select>` control's single value. */
export function workloadOptionValue(kind: OpenShiftWorkloadKind, name: string): string {
  return `${kind}::${name}`;
}

/** Inverse of {@link workloadOptionValue}. */
export function parseWorkloadOptionValue(value: string): { kind: OpenShiftWorkloadKind; name: string } | null {
  if (!value) {
    return null;
  }
  const [kind, name] = value.split('::') as [OpenShiftWorkloadKind, string];
  return { kind, name };
}
