package com.logexplorer.source.loki;

import com.logexplorer.config.LokiProperties;
import io.netty.handler.ssl.SslContext;
import io.netty.handler.ssl.SslContextBuilder;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.List;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;
import reactor.netty.http.client.HttpClient;

/**
 * Builds the {@link WebClient} used to call the Loki gateway.
 *
 * <p>TLS verification always stays on (CLAUDE.md §2 rule 7: no trust-all,
 * ever). {@code caCertPath} adds exactly one more trusted CA — e.g. an
 * OpenShift cluster's internal CA — on top of the JVM's normal default
 * trust anchors via {@link CompositeX509TrustManager}; it never replaces
 * or bypasses verification. Without {@code caCertPath} set, this uses
 * WebClient's own default (fully verifying) transport, unmodified.
 */
@Component
public class LokiWebClientFactory {

  public WebClient create(LokiProperties properties) {
    // A LogQL selector is literally "{label=\"value\"}" - Spring's default
    // URI template parser treats bare {...} in ANY part of a built URI
    // (including query param values) as a template variable placeholder,
    // which breaks on a real selector value. VALUES_ONLY encodes each
    // component value directly instead of parsing the whole URI as a
    // template - the standard fix for values containing curly braces.
    // Base URI goes into the factory's constructor, not a separate
    // .baseUrl(...) call - uriBuilderFactory(...) takes precedence over
    // .baseUrl(...) on the builder, so setting both is ambiguous.
    DefaultUriBuilderFactory uriBuilderFactory = notBlank(properties.getBaseUrl())
        ? new DefaultUriBuilderFactory(properties.getBaseUrl())
        : new DefaultUriBuilderFactory();
    uriBuilderFactory.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.VALUES_ONLY);

    WebClient.Builder builder = WebClient.builder().uriBuilderFactory(uriBuilderFactory);
    if (notBlank(properties.getCaCertPath())) {
      HttpClient httpClient = HttpClient.create()
          .secure(spec -> spec.sslContext(buildSslContext(properties.getCaCertPath())));
      builder.clientConnector(new ReactorClientHttpConnector(httpClient));
    }
    return builder.build();
  }

  private SslContext buildSslContext(String caCertPath) {
    try {
      X509Certificate extraCa = loadCertificate(caCertPath);

      KeyStore extraKeyStore = KeyStore.getInstance(KeyStore.getDefaultType());
      extraKeyStore.load(null, null);
      extraKeyStore.setCertificateEntry("logexplorer-extra-ca", extraCa);
      TrustManagerFactory extraTmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
      extraTmf.init(extraKeyStore);

      TrustManagerFactory defaultTmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
      defaultTmf.init((KeyStore) null);

      X509TrustManager composite = new CompositeX509TrustManager(
          List.of(findX509TrustManager(defaultTmf), findX509TrustManager(extraTmf)));

      return SslContextBuilder.forClient().trustManager(composite).build();
    } catch (Exception e) {
      throw new IllegalStateException(
          "Failed to load logexplorer.loki.ca-cert-path - confirm it points to a valid PEM certificate", e);
    }
  }

  private X509Certificate loadCertificate(String path) throws Exception {
    CertificateFactory cf = CertificateFactory.getInstance("X.509");
    try (InputStream in = Files.newInputStream(Path.of(path))) {
      return (X509Certificate) cf.generateCertificate(in);
    }
  }

  private X509TrustManager findX509TrustManager(TrustManagerFactory tmf) {
    for (var tm : tmf.getTrustManagers()) {
      if (tm instanceof X509TrustManager x509) {
        return x509;
      }
    }
    throw new IllegalStateException("No X509TrustManager available from " + tmf.getAlgorithm());
  }

  private boolean notBlank(String s) {
    return s != null && !s.isBlank();
  }
}
