package com.logexplorer.config;

import com.logexplorer.source.docker.security.HostResolver;
import java.net.InetAddress;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Production {@link HostResolver} wiring (Legacy Remediation Slice 3): a
 * real, uncached DNS lookup via {@link InetAddress#getAllByName(String)} —
 * genuinely re-resolved on every call, never memoized, which is exactly
 * what {@code source.docker.security.RemoteHostGuard}'s DNS-rebinding
 * defense depends on. Tests construct {@code RemoteHostGuard} directly
 * with a stub {@link HostResolver} instead of going through this bean.
 */
@Configuration
public class DockerSecurityConfig {

  @Bean
  public HostResolver hostResolver() {
    return InetAddress::getAllByName;
  }
}
