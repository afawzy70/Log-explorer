package com.logexplorer.source.docker.security;

import java.net.InetAddress;
import java.net.UnknownHostException;

/**
 * DNS resolution, extracted to an interface (Legacy Remediation Slice 3)
 * purely so {@link RemoteHostGuard} can be tested deterministically against
 * a stub resolver — never a real network lookup in a unit test — while the
 * real {@link java.net.InetAddress#getAllByName(String)} is used in
 * production (see the {@code config} package's bean wiring).
 */
@FunctionalInterface
public interface HostResolver {
  InetAddress[] resolve(String host) throws UnknownHostException;
}
