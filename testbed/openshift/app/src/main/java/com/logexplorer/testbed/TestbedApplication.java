package com.logexplorer.testbed;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * OS-1F real-Sandbox testbed - one tiny, reusable Spring Boot log
 * generator, deployed ~10 times under different {@code SERVICE_NAME}/
 * {@code SERVICE_ROLE} identities (one Deployment each, same image) to
 * produce realistic OpenShift workload/log diversity for real-cluster
 * Log Explorer verification.
 *
 * <p>TEST INFRASTRUCTURE ONLY - never referenced by, or a dependency of,
 * the actual Log Explorer product (`backend/`, `frontend/`). No real
 * personal information anywhere in this module; every generated MDC
 * value is an obviously-fake, deterministic-shaped placeholder.
 */
@SpringBootApplication
@EnableScheduling
public class TestbedApplication {
  public static void main(String[] args) {
    SpringApplication.run(TestbedApplication.class, args);
  }
}
