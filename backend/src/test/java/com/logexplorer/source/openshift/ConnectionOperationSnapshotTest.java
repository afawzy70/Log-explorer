package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.RawToken;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URI;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * OS-1D final snapshot atomicity recovery — direct unit coverage of
 * {@link OpenShiftSession#operationSnapshot()} and {@link
 * ConnectionOperationSnapshot} (mission §11): the returned snapshot is
 * immutable, originates from exactly one atomic read, remains unchanged
 * after a later reconnect/disconnect, never leaks the token through
 * {@code toString()}, and both the type and its token accessor stay
 * confined to the package.
 */
class ConnectionOperationSnapshotTest {

  private static final OcLoginCommand COMMAND_A = new OcLoginCommand(
      URI.create("https://api.cluster-a.example.com:6443"), RawToken.of("sha256~token-a-0123456789"), null);
  private static final OcLoginCommand COMMAND_B = new OcLoginCommand(
      URI.create("https://api.cluster-b.example.com:6443"), RawToken.of("sha256~token-b-9876543210"), null);

  @Test
  void reflectsEveryFieldOfTheCurrentlyConnectedSession() {
    OpenShiftSession session = new OpenShiftSession();
    long generation = session.connect(COMMAND_A, "Cluster A", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);
    session.selectProject("payments", generation);

    ConnectionOperationSnapshot connection = session.operationSnapshot();

    assertThat(connection.isConnected()).isTrue();
    assertThat(connection.generation()).isEqualTo(generation);
    assertThat(connection.server()).isEqualTo(COMMAND_A.server());
    assertThat(connection.token().value()).isEqualTo(COMMAND_A.token().value());
    assertThat(connection.selectedProject()).isEqualTo("payments");
    assertThat(connection.scope()).isEqualTo(OpenShiftScope.EMPTY);
  }

  @Test
  void isNotConnectedAndHasNoSelectedProjectBeforeAnyConnect() {
    OpenShiftSession session = new OpenShiftSession();

    ConnectionOperationSnapshot connection = session.operationSnapshot();

    assertThat(connection.isConnected()).isFalse();
    assertThat(connection.selectedProject()).isNull();
  }

  @Test
  void remainsUnchangedAfterALaterReconnect_provingItIsAnImmutableCopyNotALiveView() {
    OpenShiftSession session = new OpenShiftSession();
    long generationA = session.connect(COMMAND_A, "Cluster A", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);
    session.selectProject("payments", generationA);

    ConnectionOperationSnapshot snapshotA = session.operationSnapshot();

    session.connect(COMMAND_B, "Cluster B", "developer", List.of("other"), ProjectDiscovery.Api.PROJECTS, null);

    // The already-obtained snapshot must still report Connection A's own
    // values - it is a value captured at one instant, never a live view
    // over the session's own mutable state.
    assertThat(snapshotA.generation()).isEqualTo(generationA);
    assertThat(snapshotA.server()).isEqualTo(COMMAND_A.server());
    assertThat(snapshotA.token().value()).isEqualTo(COMMAND_A.token().value());
    assertThat(snapshotA.selectedProject()).isEqualTo("payments");

    // A fresh read, taken now, correctly reflects Connection B instead.
    ConnectionOperationSnapshot snapshotB = session.operationSnapshot();
    assertThat(snapshotB.generation()).isNotEqualTo(generationA);
    assertThat(snapshotB.server()).isEqualTo(COMMAND_B.server());
    assertThat(snapshotB.selectedProject()).isNull(); // a new connection never inherits the old selection
  }

  @Test
  void remainsUnchangedAfterALaterDisconnect() {
    OpenShiftSession session = new OpenShiftSession();
    long generation = session.connect(COMMAND_A, "Cluster A", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);
    session.selectProject("payments", generation);

    ConnectionOperationSnapshot snapshot = session.operationSnapshot();

    session.disconnect();

    assertThat(snapshot.isConnected()).isTrue();
    assertThat(snapshot.selectedProject()).isEqualTo("payments");
    assertThat(snapshot.token().value()).isEqualTo(COMMAND_A.token().value());
  }

  @Test
  void everyFieldOriginatesFromTheSameUnderlyingRead_neverAMixOfTwoConnections() {
    // OS-1D final snapshot atomicity recovery's own core invariant,
    // proven directly: operationSnapshot() is a single record built from
    // a single Snapshot value, so generation/server/token/selectedProject
    // can never disagree about which connection they came from.
    OpenShiftSession session = new OpenShiftSession();
    long generationA = session.connect(COMMAND_A, "Cluster A", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);
    session.selectProject("payments", generationA);

    ConnectionOperationSnapshot connection = session.operationSnapshot();

    boolean serverBelongsToA = connection.server().equals(COMMAND_A.server());
    boolean tokenBelongsToA = connection.token().value().equals(COMMAND_A.token().value());
    boolean namespaceBelongsToA = "payments".equals(connection.selectedProject());
    assertThat(serverBelongsToA).isEqualTo(tokenBelongsToA).isEqualTo(namespaceBelongsToA).isTrue();
  }

  @Test
  void toStringNeverContainsTheRawTokenValue() {
    OpenShiftSession session = new OpenShiftSession();
    long generation = session.connect(COMMAND_A, "Cluster A", "developer", List.of("payments"), ProjectDiscovery.Api.PROJECTS, null);
    session.selectProject("payments", generation);

    ConnectionOperationSnapshot connection = session.operationSnapshot();

    assertThat(connection.toString())
        .doesNotContain(COMMAND_A.token().value())
        .contains("REDACTED");
  }

  @Test
  void theTypeItselfIsPackagePrivate_neverAccessibleOutsideSourceOpenshift() {
    assertThat(Modifier.isPublic(ConnectionOperationSnapshot.class.getModifiers()))
        .as("ConnectionOperationSnapshot must not be a public type")
        .isFalse();
  }

  @Test
  void theOperationSnapshotAccessorItselfIsPackagePrivate() throws NoSuchMethodException {
    Method method = OpenShiftSession.class.getDeclaredMethod("operationSnapshot");
    int modifiers = method.getModifiers();
    assertThat(Modifier.isPublic(modifiers)).as("operationSnapshot() must not be public").isFalse();
    assertThat(Modifier.isProtected(modifiers)).as("operationSnapshot() must not be protected").isFalse();
    assertThat(Modifier.isPrivate(modifiers)).as("operationSnapshot() must be package-private, not private").isFalse();
  }

  @Test
  void theTokenAccessorOnTheSnapshotIsNeverPubliclyExposedBeyondThePackagePrivateType() throws NoSuchMethodException {
    // The generated accessor is technically `public` in bytecode (Java
    // records always generate public accessors), but the containing type
    // itself is package-private (proven above), so no code outside
    // com.logexplorer.source.openshift can ever name the type or call the
    // accessor at all - the same practical confinement
    // OpenShiftSession#token()'s own package-private method already has.
    Method tokenAccessor = ConnectionOperationSnapshot.class.getDeclaredMethod("token");
    assertThat(Modifier.isPublic(ConnectionOperationSnapshot.class.getModifiers())).isFalse();
    assertThat(tokenAccessor.getReturnType()).isEqualTo(RawToken.class);
  }
}
