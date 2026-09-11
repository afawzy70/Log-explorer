package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import com.logexplorer.source.openshift.OcLoginParseException.Reason;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * OS-1A §7/§8 - the safe {@code oc login} parser.
 *
 * <p>This is the security boundary for the product's first runtime
 * credential intake, so the tests are written as a hostile-input matrix
 * rather than a happy path with a few negatives bolted on.
 *
 * <p>Two invariants matter as much as the accept/reject decision itself:
 * every rejection must carry a <b>specific</b> reason (so the UI can say
 * something true instead of "connection failed"), and no rejection message
 * may ever echo any part of the input - the input contains a bearer token.
 */
class OcLoginCommandParserTest {

  private static final String VALID_TOKEN = "sha256~AbCdEf0123456789AbCdEf0123456789";
  private static final String VALID =
      "oc login --token=" + VALID_TOKEN + " --server=https://api.example.com:6443";

  // ---------------------------------------------------------------- happy path

  @Test
  void parsesAWellFormedCommand() {
    OcLoginCommand command = OcLoginCommandParser.parse(VALID);

    assertThat(command.server().toString()).isEqualTo("https://api.example.com:6443");
    assertThat(command.serverDisplay()).isEqualTo("api.example.com:6443");
    assertThat(command.token().value()).isEqualTo(VALID_TOKEN);
    assertThat(command.hasCertificateAuthority()).isFalse();
  }

  @Test
  void acceptsFlagsInEitherOrder_andToleratesSurroundingWhitespace() {
    OcLoginCommand command = OcLoginCommandParser.parse(
        "   oc login --server=https://api.example.com:6443 --token=" + VALID_TOKEN + "  ");
    assertThat(command.token().value()).isEqualTo(VALID_TOKEN);
  }

  @Test
  void acceptsAnExplicitCertificateAuthorityPath() {
    OcLoginCommand command = OcLoginCommandParser.parse(VALID + " --certificate-authority=/etc/pki/ca.crt");
    assertThat(command.certificateAuthorityPath()).isEqualTo("/etc/pki/ca.crt");
    assertThat(command.hasCertificateAuthority()).isTrue();
  }

  // ------------------------------------------------------- the token never leaks

  @Test
  void theParseResultNeverPrintsTheToken() {
    OcLoginCommand command = OcLoginCommandParser.parse(VALID);
    assertThat(command.toString()).doesNotContain(VALID_TOKEN).contains("REDACTED");
    assertThat(command.token().toString()).doesNotContain(VALID_TOKEN);
  }

  @Test
  void noRejectionMessageEverEchoesTheInput() {
    // Every hostile input below carries a recognisable marker; none of the
    // resulting messages may contain it. This is the property that keeps a
    // pasted token out of logs, API error bodies and UI toasts.
    String[] hostile = {
      "oc login --token=MARKER1234567890 --server=https://a.example.com ; rm -rf /",
      "oc login --token=$(cat /etc/passwd) --server=https://a.example.com",
      "oc login --token=MARKER1234567890 --server=https://a.example.com --unknown=MARKER1234567890",
      "oc login --token=MARKER1234567890 --server=notaurl",
      "oc login --token=MARKER1234567890 --server=http://a.example.com",
      "curl MARKER1234567890",
    };
    for (String input : hostile) {
      OcLoginParseException e =
          catchThrowableOfType(() -> OcLoginCommandParser.parse(input), OcLoginParseException.class);
      assertThat(e).as("input must be rejected: %s", input).isNotNull();
      assertThat(e.getMessage())
          .as("rejection message must not echo the input")
          .doesNotContain("MARKER1234567890")
          .doesNotContain("/etc/passwd")
          .doesNotContain("rm -rf");
    }
  }

  // -------------------------------------------------------------- shell syntax

  @ParameterizedTest
  @ValueSource(
      strings = {
        "oc login --token=T0kenValue123 --server=https://a.example.com ; rm -rf /",
        "oc login --token=T0kenValue123 --server=https://a.example.com && curl evil.example.com",
        "oc login --token=T0kenValue123 --server=https://a.example.com | sh",
        "oc login --token=T0kenValue123 --server=https://a.example.com > /tmp/x",
        "oc login --token=T0kenValue123 --server=https://a.example.com < /tmp/x",
        "oc login --token=$(cat /etc/passwd) --server=https://a.example.com",
        "oc login --token=${SECRET} --server=https://a.example.com",
        "oc login --token=`whoami` --server=https://a.example.com",
        "oc login --token=T0kenValue123 --server=https://a.example.com\nrm -rf /",
        "oc login --token=T0kenValue123 --server=https://a.example.com\rrm -rf /",
        "oc login --token=T0ken\\Value --server=https://a.example.com",
      })
  void rejectsAnyShellSyntaxAnywhere(String hostile) {
    assertThatThrownBy(() -> OcLoginCommandParser.parse(hostile))
        .isInstanceOf(OcLoginParseException.class)
        .extracting(e -> ((OcLoginParseException) e).reason())
        .isEqualTo(Reason.SHELL_SYNTAX_PRESENT);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "oc login --token='T0kenValue123; evil' --server=https://a.example.com",
        "oc login --token=\"T0kenValue123\" --server=https://a.example.com",
      })
  void rejectsQuotingRatherThanImplementingASecondTokenizer(String quoted) {
    assertThatThrownBy(() -> OcLoginCommandParser.parse(quoted))
        .isInstanceOf(OcLoginParseException.class)
        .extracting(e -> ((OcLoginParseException) e).reason())
        .isEqualTo(Reason.SHELL_SYNTAX_PRESENT);
  }

  // ---------------------------------------------------------------- the grammar

  @ParameterizedTest
  @ValueSource(
      strings = {
        "curl https://a.example.com",
        "oc get pods",
        "oc",
        "kubectl login --token=T0kenValue123 --server=https://a.example.com",
        "",
        "   ",
      })
  void rejectsAnythingThatIsNotAnOcLoginCommand(String notOcLogin) {
    assertThatThrownBy(() -> OcLoginCommandParser.parse(notOcLogin))
        .isInstanceOf(OcLoginParseException.class)
        .extracting(e -> ((OcLoginParseException) e).reason())
        .isEqualTo(Reason.NOT_AN_OC_LOGIN_COMMAND);
  }

  @Test
  void rejectsNullInput() {
    assertThatThrownBy(() -> OcLoginCommandParser.parse(null)).isInstanceOf(OcLoginParseException.class);
  }

  /**
   * OS-1A owner decision 5 (an explicit reviewer correction): unknown flags
   * are <b>rejected, not silently ignored</b>. Ignoring one would mean
   * quietly discarding something the user asked for - and in this command
   * the unfamiliar flags are exactly the ones that change security posture.
   */
  @ParameterizedTest
  @ValueSource(
      strings = {
        "oc login --token=T0kenValue123 --server=https://a.example.com --unknown=x",
        "oc login --token=T0kenValue123 --server=https://a.example.com --namespace=payments",
        "oc login --token=T0kenValue123 --server=https://a.example.com --kubeconfig=/tmp/kc",
        "oc login --token=T0kenValue123 --server=https://a.example.com --loglevel=9",
        "oc login --token=T0kenValue123 --server=https://a.example.com extra-positional",
        "oc login --token T0kenValue123 --server=https://a.example.com",
      })
  void rejectsUnknownFlagsRatherThanIgnoringThem(String withUnknownFlag) {
    assertThatThrownBy(() -> OcLoginCommandParser.parse(withUnknownFlag))
        .isInstanceOf(OcLoginParseException.class)
        .extracting(e -> ((OcLoginParseException) e).reason())
        .isEqualTo(Reason.UNKNOWN_FLAG);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "oc login --token=T0kenValue123 --token=T0kenValue456 --server=https://a.example.com",
        "oc login --token=T0kenValue123 --server=https://a.example.com --server=https://b.example.com",
      })
  void rejectsDuplicateCriticalFlags(String duplicated) {
    assertThatThrownBy(() -> OcLoginCommandParser.parse(duplicated))
        .isInstanceOf(OcLoginParseException.class)
        .extracting(e -> ((OcLoginParseException) e).reason())
        .isEqualTo(Reason.DUPLICATE_FLAG);
  }

  @Test
  void rejectsAMissingServer() {
    assertThatThrownBy(() -> OcLoginCommandParser.parse("oc login --token=T0kenValue123"))
        .isInstanceOf(OcLoginParseException.class)
        .extracting(e -> ((OcLoginParseException) e).reason())
        .isEqualTo(Reason.MISSING_SERVER);
  }

  @Test
  void rejectsAMissingToken() {
    assertThatThrownBy(() -> OcLoginCommandParser.parse("oc login --server=https://a.example.com"))
        .isInstanceOf(OcLoginParseException.class)
        .extracting(e -> ((OcLoginParseException) e).reason())
        .isEqualTo(Reason.MISSING_TOKEN);
  }

  // ------------------------------------------------------------------- the URL

  @Test
  void rejectsAPlainHttpServer() {
    assertThatThrownBy(
            () -> OcLoginCommandParser.parse("oc login --token=T0kenValue123 --server=http://a.example.com"))
        .isInstanceOf(OcLoginParseException.class)
        .extracting(e -> ((OcLoginParseException) e).reason())
        .isEqualTo(Reason.SERVER_NOT_HTTPS);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "oc login --token=T0kenValue123 --server=file:///tmp/x",
        "oc login --token=T0kenValue123 --server=ftp://a.example.com",
      })
  void rejectsNonHttpsSchemes(String badScheme) {
    assertThatThrownBy(() -> OcLoginCommandParser.parse(badScheme))
        .isInstanceOf(OcLoginParseException.class)
        .extracting(e -> ((OcLoginParseException) e).reason())
        .isIn(Reason.SERVER_NOT_HTTPS, Reason.MALFORMED_SERVER_URL);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "oc login --token=T0kenValue123 --server=notaurl",
        "oc login --token=T0kenValue123 --server=https://",
        "oc login --token=T0kenValue123 --server=:::::",
      })
  void rejectsMalformedServerUrls(String malformed) {
    assertThatThrownBy(() -> OcLoginCommandParser.parse(malformed))
        .isInstanceOf(OcLoginParseException.class)
        .extracting(e -> ((OcLoginParseException) e).reason())
        .isEqualTo(Reason.MALFORMED_SERVER_URL);
  }

  // ------------------------------------------------------------- insecure TLS

  @ParameterizedTest
  @ValueSource(
      strings = {
        "oc login --token=T0kenValue123 --server=https://a.example.com --insecure-skip-tls-verify",
        "oc login --token=T0kenValue123 --server=https://a.example.com --insecure-skip-tls-verify=true",
      })
  void refusesInsecureTlsExplicitlyRatherThanAsAnUnknownFlag(String insecure) {
    OcLoginParseException e =
        catchThrowableOfType(() -> OcLoginCommandParser.parse(insecure), OcLoginParseException.class);

    // A distinct reason, not UNKNOWN_FLAG: the user asked for something
    // specific and deserves to be told it is refused, not that it was
    // unrecognised (CLAUDE.md §2 rule 7).
    assertThat(e.reason()).isEqualTo(Reason.INSECURE_TLS_REFUSED);
    assertThat(e.getMessage()).contains("TLS");
  }

  // ----------------------------------------------------------------- the token

  @ParameterizedTest
  @ValueSource(
      strings = {
        "oc login --token=short --server=https://a.example.com",
        "oc login --token=hasÜnicode0123456 --server=https://a.example.com",
      })
  void rejectsStructurallyImplausibleTokens(String badToken) {
    assertThatThrownBy(() -> OcLoginCommandParser.parse(badToken))
        .isInstanceOf(OcLoginParseException.class)
        .extracting(e -> ((OcLoginParseException) e).reason())
        .isEqualTo(Reason.MALFORMED_TOKEN);
  }

  @Test
  void rejectsAbsurdlyLongInputWithoutAttemptingToParseIt() {
    String huge = "oc login --server=https://a.example.com --token=" + "A".repeat(20_000);
    assertThatThrownBy(() -> OcLoginCommandParser.parse(huge)).isInstanceOf(OcLoginParseException.class);
  }
}
