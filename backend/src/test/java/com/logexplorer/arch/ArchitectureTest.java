package com.logexplorer.arch;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

/**
 * Architectural enforcement of the masking boundary (IMPLEMENTATION_PLAN.md
 * "Phase B" automated tests: "classes in api.dto must not expose the raw
 * canonical type; web layer must not reference raw MDC maps directly").
 *
 * <p>These are the concrete rules that wording resolves to in this
 * codebase — see {@code core.mask.MaskingService}, {@code api.EventMapper},
 * and {@code core.model.SearchRequest.Builder#sensitiveFilters} for how the
 * production code satisfies them without ever naming the restricted types
 * in {@code api}.
 */
@AnalyzeClasses(packages = "com.logexplorer", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {

  @ArchTest
  static final ArchRule dtosMustNotDependOnTheRawCanonicalEventType = noClasses()
      .that().resideInAPackage("..api.dto..")
      .should().dependOnClassesThat().haveFullyQualifiedName("com.logexplorer.core.model.CanonicalLogEvent")
      .because("DTOs must be built from already-safe values only, never hold the raw canonical event");

  @ArchTest
  static final ArchRule onlyMaskingServiceMayTouchRawSensitiveFields = noClasses()
      .that().resideInAPackage("..api..")
      .should().dependOnClassesThat().haveFullyQualifiedName("com.logexplorer.core.model.RawSensitiveFields")
      .because("the masking boundary must be architectural: only core.mask.MaskingService may read raw sensitive values");

  @ArchTest
  static final ArchRule apiLayerMustNotBypassTheParser = noClasses()
      .that().resideInAPackage("..api..")
      .should().dependOnClassesThat().resideInAPackage("..core.parse..")
      .because("the web layer must not reference raw parsed structures directly - parsing is core.parse's job alone, "
          + "and the api layer only ever consumes an already-built CanonicalLogEvent");
}
