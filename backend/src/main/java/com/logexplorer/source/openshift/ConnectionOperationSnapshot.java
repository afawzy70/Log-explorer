package com.logexplorer.source.openshift;

import com.logexplorer.core.model.RawToken;
import java.net.URI;

/**
 * OS-1D final snapshot atomicity recovery — the minimal, immutable,
 * read-only projection of exactly one atomic {@link OpenShiftSession}
 * read, carrying every connection-sensitive field one authenticated
 * OpenShift operation (search, context authorization, workload/pod/
 * container discovery, project refresh) needs: connection state,
 * generation, server, token, CA path, the selected project, and the
 * workload/pod/container scope.
 *
 * <p>Obtained exclusively via {@link OpenShiftSession#operationSnapshot()},
 * which reads the session's internal {@code AtomicReference<Snapshot>}
 * exactly once and projects every field of this record from that SAME
 * underlying value — never through several independent getter calls
 * (the pre-recovery shape: {@code session.generation()}, {@code
 * session.server()}, {@code session.token()}, ... each its own {@code
 * current.get()}), each of which could observe a <em>different</em>
 * generation of session state if a reconnect landed in between. One
 * logical OpenShift operation must correspond to exactly one atomic
 * session read; this type is what makes that structurally true rather
 * than merely a coding convention callers have to remember.
 *
 * <p><b>Package-private</b> — not merely narrow-by-convention, but
 * actually inaccessible outside {@code com.logexplorer.source.openshift}
 * — matching {@link OpenShiftSession#token()}'s own existing narrow
 * visibility. Nothing outside this package has any business holding a
 * connection snapshot (or, especially, its bearer token); keeping both
 * the type and this accessor confined to the package is what makes "no
 * token readback" reviewable rather than merely intended. {@link
 * RawToken#toString()} is itself already a fixed redacted string as a
 * second layer of defense, but this record adds no serialization/logging
 * surface of its own (no custom {@code toString()} is needed precisely
 * because nothing outside this package can ever print one).
 */
record ConnectionOperationSnapshot(
    OpenShiftConnectionState state,
    long generation,
    URI server,
    RawToken token,
    String certificateAuthorityPath,
    String selectedProject,
    OpenShiftScope scope) {

  boolean isConnected() {
    return state == OpenShiftConnectionState.CONNECTED;
  }
}
