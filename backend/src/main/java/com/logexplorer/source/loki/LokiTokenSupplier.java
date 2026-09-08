package com.logexplorer.source.loki;

import com.logexplorer.config.LokiProperties;
import com.logexplorer.core.model.RawToken;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Reads the bearer token fresh at request time, from an env var or a file
 * (e.g. the standard OpenShift/Kubernetes service-account token mount) -
 * whichever {@link LokiProperties} configures - and wraps it in {@link
 * RawToken} immediately, so the raw string never exists un-wrapped outside
 * this class (HANDOVER.md §6.5: "Token from env/secret only, never
 * logged").
 */
@Component
public class LokiTokenSupplier {

  private static final Logger log = LoggerFactory.getLogger(LokiTokenSupplier.class);

  private final LokiProperties properties;

  public LokiTokenSupplier(LokiProperties properties) {
    this.properties = properties;
  }

  public RawToken get() {
    String envVar = properties.getTokenEnvVar();
    if (envVar != null && !envVar.isBlank()) {
      String fromEnv = System.getenv(envVar);
      if (fromEnv != null && !fromEnv.isBlank()) {
        return RawToken.of(fromEnv);
      }
    }
    String filePath = properties.getTokenFilePath();
    if (filePath != null && !filePath.isBlank()) {
      try {
        String fromFile = Files.readString(Path.of(filePath)).trim();
        return RawToken.of(fromFile);
      } catch (IOException e) {
        // Never log the path's content or the exception's raw text in a way
        // that could include partial file content; the message itself here
        // is fixed and safe.
        log.warn("Could not read Loki token file - proceeding without a token");
      }
    }
    return RawToken.empty();
  }
}
