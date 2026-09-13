package com.logexplorer.source.loki;

import com.logexplorer.config.LokiProperties;
import com.logexplorer.core.tls.CompositeX509TrustManager;
import com.logexplorer.source.openshift.OpenShiftProxyConfigService;
import com.logexplorer.source.openshift.ProxyRoute;
import io.netty.handler.ssl.SslContext;
import io.netty.handler.ssl.SslContextBuilder;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;
import reactor.netty.http.client.HttpClient;
import reactor.netty.transport.ProxyProvider;

/**
 * Builds the {@link WebClient} used to call the Loki gateway.
 *
 * <p>TLS verification always stays on (CLAUDE.md §2 rule 7: no trust-all,
 * ever). {@code caCertPath} adds exactly one more trusted CA — e.g. an
 * OpenShift cluster's internal CA — on top of the JVM's normal default
 * trust anchors via {@link CompositeX509TrustManager}; it never replaces
 * or bypasses verification. Without {@code caCertPath} set, this uses
 * WebClient's own default (fully verifying) transport, unmodified.
 *
 * <p><b>Pre-closure functional recovery (§25/§45) — enterprise proxy.</b>
 * The LokiStack gateway this calls is, per {@link LokiProperties}' own
 * javadoc, "every segment of the OpenShift LokiStack" — a live, retained
 * source (see {@code docs/verification/OS_1G_AGGREGATED_PROVIDER_DECISION_REPORT.md}
 * §8, "why openshift-loki is retained"), not a deferred or dead path. An
 * audit for this recovery found it was the one OpenShift-cluster-adjacent
 * network call in the backend that did NOT honour {@code HTTPS_PROXY}/
 * {@code HTTP_PROXY}/{@code NO_PROXY} at all — {@link
 * com.logexplorer.source.openshift.OpenShiftApiClient#build} already
 * does, via the exact same {@link ProxyRoute#resolve} this now reuses.
 * Resolved once, at construction, rather than per-request like {@code
 * OpenShiftApiClient.build()} — unlike OpenShift, where {@code server}
 * varies per connection attempt, Loki has exactly one fixed {@code
 * baseUrl} per deployment (see {@link LokiProperties#getNamespace}'s own
 * "fixed per deployment" note), so there is nothing to re-resolve on a
 * later request.
 *
 * <p><b>Pre-closure functional recovery 2 (§B5/§B6) - one authoritative
 * proxy configuration.</b> {@code proxyConfigService} is the exact same
 * shared {@link OpenShiftProxyConfigService} bean {@link
 * com.logexplorer.source.openshift.OpenShiftApiClient} is also injected
 * with - a mode/host/port change made through the settings UI takes
 * effect for OpenShift API calls and Loki calls at once, from the one
 * place that value lives. There is no second, Loki-specific proxy
 * configuration anywhere.
 */
@Component
public class LokiWebClientFactory {

  private final OpenShiftProxyConfigService proxyConfigService;
  private final Map<String, String> environment;

  /** {@code @Autowired} required - see {@code OpenShiftApiClient}'s identical constructor doc comment for why. */
  @Autowired
  public LokiWebClientFactory(OpenShiftProxyConfigService proxyConfigService) {
    this(proxyConfigService, System.getenv());
  }

  /** Test seam: real environment, SYSTEM-only proxy behavior via a fresh, never-mutated {@link OpenShiftProxyConfigService} - the pre-existing no-arg shape every test predating this recovery already uses. */
  LokiWebClientFactory() {
    this(new OpenShiftProxyConfigService(), System.getenv());
  }

  /** Test seam: SYSTEM-only proxy behavior via a fresh, never-mutated {@link OpenShiftProxyConfigService}. */
  LokiWebClientFactory(Map<String, String> environment) {
    this(new OpenShiftProxyConfigService(), environment);
  }

  /** Test seam: both the proxy config and the environment are injected, for DIRECT/CUSTOM-mode tests. */
  LokiWebClientFactory(OpenShiftProxyConfigService proxyConfigService, Map<String, String> environment) {
    this.proxyConfigService = proxyConfigService;
    this.environment = environment;
  }

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
    Optional<ProxyRoute> route = proxyFor(properties);
    if (notBlank(properties.getCaCertPath()) || route.isPresent()) {
      HttpClient httpClient = HttpClient.create();
      if (notBlank(properties.getCaCertPath())) {
        httpClient = httpClient.secure(spec -> spec.sslContext(buildSslContext(properties.getCaCertPath())));
      }
      if (route.isPresent()) {
        ProxyRoute proxy = route.get();
        httpClient = httpClient.proxy(spec -> {
          var typeSpec = spec.type(ProxyProvider.Proxy.HTTP).host(proxy.host()).port(proxy.port());
          if (proxy.hasCredentials()) {
            typeSpec.username(proxy.username());
            if (proxy.password() != null) {
              typeSpec.password(user -> proxy.password());
            }
          }
        });
      }
      builder.clientConnector(new ReactorClientHttpConnector(httpClient));
    }
    return builder.build();
  }

  /**
   * The proxy route that would be used for {@code properties}' configured
   * gateway, {@code NO_PROXY}-aware, exactly like {@link
   * com.logexplorer.source.openshift.OpenShiftApiClient#build} - empty
   * when {@code baseUrl} is unset/unparseable rather than throwing (a
   * malformed gateway URL is reported elsewhere, not here). Exposed
   * (not just used internally by {@link #create}) so {@link
   * LokiQueryClient} can classify a connect failure as proxy-specific
   * without duplicating this resolution.
   */
  public Optional<ProxyRoute> proxyFor(LokiProperties properties) {
    String baseUrl = properties.getBaseUrl();
    if (!notBlank(baseUrl)) {
      return Optional.empty();
    }
    try {
      String host = new URI(baseUrl).getHost();
      return host == null ? Optional.empty() : ProxyRoute.resolve(proxyConfigService.current(), environment, host);
    } catch (URISyntaxException e) {
      return Optional.empty();
    }
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
