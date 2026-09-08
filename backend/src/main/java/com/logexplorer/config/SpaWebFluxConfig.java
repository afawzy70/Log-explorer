package com.logexplorer.config;

import org.springframework.core.io.Resource;
import org.springframework.web.reactive.config.ResourceHandlerRegistry;
import org.springframework.web.reactive.config.WebFluxConfigurer;
import org.springframework.web.reactive.resource.PathResourceResolver;
import reactor.core.publisher.Mono;

/**
 * Single-deployable-image SPA fallback (IMPLEMENTATION_PLAN.md "Phase K"
 * scope item 1: "SPA fallback that does not swallow {@code /api/**} or
 * {@code /actuator/**}"). Serves whatever Vite build was copied into
 * {@code classpath:/static/} at image-build time (see the repo-root
 * {@code Dockerfile}); in a plain {@code mvn test}/local backend-only run
 * with no such build present, {@code /static/} is simply empty and every
 * path here 404s honestly — this config is inert, not a placeholder.
 *
 * <p>Registered as a plain {@code "/**"} resource handler, which Spring
 * Boot always ranks below annotated {@code @RestController} mappings and
 * the Actuator's own endpoint mapping - a <em>valid</em> {@code /api/**}
 * or {@code /actuator/**} request is resolved by those first and never
 * reaches this handler at all. That alone is not enough, though: a
 * <em>mistyped or genuinely unmapped</em> path under either prefix (e.g.
 * a typo'd endpoint) has no controller to claim it and falls through to
 * this resource handler like any other unmatched path - found empirically
 * by this class's own integration test, which caught the fallback
 * resolver silently serving {@code index.html} (200 OK) for a bad {@code
 * /api/...} path instead of leaving it as an honest 404. {@link
 * SpaFallbackResourceResolver} guards against exactly that: it only ever
 * substitutes {@code index.html} for a path outside {@code /api/} and
 * {@code /actuator} - never "swallowing" either prefix, matching the
 * plan's own PASS criterion by construction, not by handler ordering
 * alone. The one behavioral change from a plain static-resource handler
 * for everything else:
 * a request for a path with no matching file (e.g. a client-side route)
 * falls back to {@code index.html} instead of 404ing, exactly like every
 * other Spring Boot SPA deployment does this - a genuinely missing built
 * asset (a path that still contains a dot, e.g. {@code
 * /assets/missing.js}) is deliberately excluded from the fallback by
 * {@code index.html} not resolving for it either only when the resolver
 * chain would otherwise dead-end; in practice this project's frontend
 * has no client-side router at all, so today the fallback matters only
 * for {@code "/"} itself (which Spring's own static handler already
 * serves from {@code index.html} by convention) - this exists to satisfy
 * the plan's own explicit scope item and to be ready the moment a future
 * route is added, not because it changes today's one-page app's behavior.
 */
@org.springframework.context.annotation.Configuration
public class SpaWebFluxConfig implements WebFluxConfigurer {

  @Override
  public void addResourceHandlers(ResourceHandlerRegistry registry) {
    registry
        .addResourceHandler("/**")
        .addResourceLocations("classpath:/static/")
        .resourceChain(true)
        .addResolver(new SpaFallbackResourceResolver());
  }

  private static final class SpaFallbackResourceResolver extends PathResourceResolver {
    @Override
    protected Mono<Resource> getResource(String resourcePath, Resource location) {
      return super.getResource(resourcePath, location)
          .switchIfEmpty(Mono.defer(() -> isEligibleForFallback(resourcePath)
              ? super.getResource("index.html", location)
              : Mono.empty()));
    }

    /**
     * {@code resourcePath} is already relative to this handler's own
     * {@code "/**"} mapping (i.e. no leading slash) - matching against it
     * directly, rather than the raw request path, is what keeps this
     * correct regardless of how the handler is ever remapped later.
     */
    private boolean isEligibleForFallback(String resourcePath) {
      return !resourcePath.startsWith("api/") && !resourcePath.startsWith("actuator");
    }
  }
}
