package com.logexplorer.source.openshift;

import com.logexplorer.core.model.RawToken;
import com.logexplorer.source.openshift.OcLoginParseException.Reason;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Parses a pasted {@code oc login} command into the three values OS-1A
 * needs, or rejects it.
 *
 * <p><b>This class never executes anything.</b> There is no {@code
 * ProcessBuilder}, no {@code Runtime.exec}, no shell, and the {@code oc}
 * binary is not required to be installed. The pasted text is a
 * <i>convenience input format</i> the user already has on their clipboard
 * (OS-A decision 3/4) - it is parsed as data and nothing more.
 *
 * <h2>Why this is a whitelist, and why it rejects rather than sanitizes</h2>
 *
 * <p>Sanitizing is the wrong instinct for this input. If the text contains
 * a shell metacharacter, the user's mental model and ours have already
 * diverged: they pasted something that, in a terminal, would have done
 * more than log in. Silently stripping it and proceeding would connect
 * them to something they did not ask for. So the rule is: <b>match the
 * narrow grammar exactly, or refuse and explain which rule was
 * violated</b> - never repair, never guess.
 *
 * <p>Unknown flags are <b>rejected, not ignored</b> (OS-1A owner decision
 * 5, an explicit reviewer correction). Ignoring an unrecognised flag would
 * mean quietly discarding a user's stated intent - and the flags that
 * matter most here are precisely the ones that change security posture
 * ({@code --insecure-skip-tls-verify}, {@code --certificate-authority},
 * proxy-ish options). A parser that shrugs at flags it does not understand
 * cannot promise anything about the connection it produces.
 *
 * <p>No rejection message ever contains any part of the input - see
 * {@link OcLoginParseException}.
 */
public final class OcLoginCommandParser {

  private OcLoginCommandParser() {}

  /**
   * Characters and sequences that mean something to a shell. Their mere
   * presence anywhere in the input is disqualifying - this parser makes no
   * attempt to decide whether a given occurrence "would have been
   * harmless", because that judgement is exactly what shell-injection bugs
   * are made of.
   *
   * <p>Backslash is included: it is the escape character, so allowing it
   * would mean reasoning about escaped quoting, which this grammar
   * deliberately does not support.
   */
  private static final List<String> SHELL_SEQUENCES =
      List.of(";", "&", "|", "`", "$(", "${", "$", "<", ">", "\\", "\n", "\r");

  /** Flags this parser understands. Anything else is {@link Reason#UNKNOWN_FLAG}. */
  private static final Set<String> KNOWN_VALUE_FLAGS = Set.of("--server", "--token", "--certificate-authority");

  /**
   * Present-and-refused rather than unknown: the user explicitly asked to
   * disable TLS verification, and they deserve to be told that is refused
   * rather than shown a generic "unknown flag" (OS-A §6, CLAUDE.md §2
   * rule 7).
   */
  private static final Set<String> REFUSED_FLAGS = Set.of("--insecure-skip-tls-verify", "--insecure-skip-tls-verify=true");

  /** Generous but finite - a real token is a JWT-ish string, not a file. */
  private static final int MAX_INPUT_LENGTH = 8192;

  public static OcLoginCommand parse(String pasted) {
    if (pasted == null || pasted.isBlank()) {
      throw new OcLoginParseException(Reason.NOT_AN_OC_LOGIN_COMMAND, "Paste an 'oc login' command.");
    }
    if (pasted.length() > MAX_INPUT_LENGTH) {
      throw new OcLoginParseException(
          Reason.NOT_AN_OC_LOGIN_COMMAND, "That input is too long to be an 'oc login' command.");
    }

    // Shell syntax is checked on the RAW input, before any trimming or
    // tokenizing, so nothing can be hidden behind normalisation.
    for (String sequence : SHELL_SEQUENCES) {
      if (pasted.contains(sequence)) {
        throw new OcLoginParseException(
            Reason.SHELL_SYNTAX_PRESENT,
            "That command contains shell syntax. Paste only a plain 'oc login --token=... --server=...' command.");
      }
    }
    // Quoting is not supported by this grammar. Rejecting quotes outright
    // is safer than implementing a second, subtly-different tokenizer: a
    // real `oc login` line copied from the OpenShift console has none.
    if (pasted.indexOf('\'') >= 0 || pasted.indexOf('"') >= 0) {
      throw new OcLoginParseException(
          Reason.SHELL_SYNTAX_PRESENT, "Remove quotes from the command before pasting it.");
    }

    List<String> tokens = Arrays.stream(pasted.trim().split("\\s+")).filter(t -> !t.isEmpty()).toList();
    if (tokens.size() < 2 || !"oc".equals(tokens.get(0)) || !"login".equals(tokens.get(1))) {
      throw new OcLoginParseException(
          Reason.NOT_AN_OC_LOGIN_COMMAND, "That does not look like an 'oc login' command.");
    }

    String server = null;
    String token = null;
    String caPath = null;
    Set<String> seen = new LinkedHashSet<>();

    for (int i = 2; i < tokens.size(); i++) {
      String argument = tokens.get(i);

      if (REFUSED_FLAGS.contains(argument)) {
        throw new OcLoginParseException(
            Reason.INSECURE_TLS_REFUSED,
            "Log Explorer will not disable TLS verification. Remove --insecure-skip-tls-verify and supply the "
                + "cluster's CA certificate instead.");
      }

      if (!argument.startsWith("--")) {
        // A bare positional argument. Real `oc login` accepts the server
        // as a positional, but supporting two ways to say the same thing
        // widens the grammar for no benefit - the console's own copy
        // button emits --server.
        throw new OcLoginParseException(
            Reason.UNKNOWN_FLAG, "Unsupported argument in the command. Use --server=... and --token=... only.");
      }

      int equals = argument.indexOf('=');
      if (equals < 0) {
        // Space-separated values ("--token abc") are not supported: that
        // form makes the token a separate argv entry, which this grammar
        // deliberately does not join. Rejecting is honest and keeps the
        // parser trivial to reason about.
        throw new OcLoginParseException(
            Reason.UNKNOWN_FLAG, "Use the --flag=value form (for example --server=https://api.example.com:6443).");
      }

      String name = argument.substring(0, equals);
      String value = argument.substring(equals + 1);

      if (!KNOWN_VALUE_FLAGS.contains(name)) {
        throw new OcLoginParseException(
            Reason.UNKNOWN_FLAG,
            "That command contains a flag Log Explorer does not support. Only --server, --token and "
                + "--certificate-authority are accepted.");
      }
      if (!seen.add(name)) {
        throw new OcLoginParseException(
            Reason.DUPLICATE_FLAG, "That command sets the same option twice. Supply each option once.");
      }

      switch (name) {
        case "--server" -> server = value;
        case "--token" -> token = value;
        case "--certificate-authority" -> caPath = value;
        default -> throw new IllegalStateException("unreachable - flag whitelist already checked");
      }
    }

    if (server == null || server.isBlank()) {
      throw new OcLoginParseException(Reason.MISSING_SERVER, "The command is missing --server.");
    }
    if (token == null || token.isBlank()) {
      throw new OcLoginParseException(Reason.MISSING_TOKEN, "The command is missing --token.");
    }
    if (!isPlausibleToken(token)) {
      throw new OcLoginParseException(Reason.MALFORMED_TOKEN, "The --token value is not a valid bearer token.");
    }

    URI uri = parseServer(server);
    return new OcLoginCommand(uri, RawToken.of(token), caPath == null || caPath.isBlank() ? null : caPath);
  }

  private static URI parseServer(String raw) {
    URI uri;
    try {
      uri = new URI(raw);
    } catch (URISyntaxException e) {
      // The exception's own message can quote the offending input, so it
      // is deliberately not propagated or logged.
      throw new OcLoginParseException(Reason.MALFORMED_SERVER_URL, "The --server value is not a valid URL.");
    }
    if (uri.getScheme() == null || uri.getHost() == null) {
      throw new OcLoginParseException(Reason.MALFORMED_SERVER_URL, "The --server value is not a valid absolute URL.");
    }
    if (!"https".equalsIgnoreCase(uri.getScheme())) {
      throw new OcLoginParseException(
          Reason.SERVER_NOT_HTTPS, "The API server must be an https:// URL. Log Explorer will not send a token over "
              + "an unencrypted connection.");
    }
    return uri;
  }

  /**
   * A deliberately loose structural check - this is not token validation
   * (only the cluster can do that), just a guard against obviously-wrong
   * pastes. Bearer tokens are opaque, so anything beyond "no whitespace,
   * no control characters, plausible length, header-safe" would be
   * guessing at a format that is not ours to define.
   */
  private static boolean isPlausibleToken(String token) {
    if (token.length() < 8 || token.length() > 4096) {
      return false;
    }
    for (int i = 0; i < token.length(); i++) {
      char c = token.charAt(i);
      // Must be safe to place in an HTTP Authorization header.
      if (c <= 0x20 || c >= 0x7f) {
        return false;
      }
    }
    return true;
  }
}
