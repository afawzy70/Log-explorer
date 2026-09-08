package com.logexplorer.source.loki;

import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;
import javax.net.ssl.X509TrustManager;

/**
 * Trusts a server certificate if <em>any</em> delegate trust manager does.
 * Used to add one extra trusted CA on top of the JVM's normal default
 * trust anchors ({@link LokiWebClientFactory}) — this still fully verifies
 * against a real, known set of CAs; it is not trust-all (which would
 * accept every certificate unconditionally, regardless of any CA).
 */
final class CompositeX509TrustManager implements X509TrustManager {

  private final List<X509TrustManager> delegates;

  CompositeX509TrustManager(List<X509TrustManager> delegates) {
    this.delegates = List.copyOf(delegates);
  }

  @Override
  public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
    CertificateException last = null;
    for (X509TrustManager delegate : delegates) {
      try {
        delegate.checkClientTrusted(chain, authType);
        return;
      } catch (CertificateException e) {
        last = e;
      }
    }
    throw last != null ? last : new CertificateException("No trust manager available");
  }

  @Override
  public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
    CertificateException last = null;
    for (X509TrustManager delegate : delegates) {
      try {
        delegate.checkServerTrusted(chain, authType);
        return;
      } catch (CertificateException e) {
        last = e;
      }
    }
    throw last != null ? last : new CertificateException("No trust manager available");
  }

  @Override
  public X509Certificate[] getAcceptedIssuers() {
    List<X509Certificate> all = new ArrayList<>();
    for (X509TrustManager delegate : delegates) {
      all.addAll(List.of(delegate.getAcceptedIssuers()));
    }
    return all.toArray(new X509Certificate[0]);
  }
}
