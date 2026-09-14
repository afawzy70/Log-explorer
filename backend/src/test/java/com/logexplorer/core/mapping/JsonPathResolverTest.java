package com.logexplorer.core.mapping;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class JsonPathResolverTest {

  @Test
  void resolvesTopLevelField() {
    Map<String, Object> root = Map.of("cif", "2449");
    assertThat(JsonPathResolver.resolveAsString(root, JsonPath.parse("cif"))).isEqualTo("2449");
  }

  @Test
  void resolvesNestedField() {
    Map<String, Object> root = mapOf("mdc", mapOf("cif", "2449"));
    assertThat(JsonPathResolver.resolveAsString(root, JsonPath.parse("mdc.cif"))).isEqualTo("2449");
  }

  @Test
  void resolvesDeeplyNestedField() {
    Map<String, Object> root = mapOf("context", mapOf("customer", mapOf("cif", "2449")));
    assertThat(JsonPathResolver.resolveAsString(root, JsonPath.parse("context.customer.cif"))).isEqualTo("2449");
  }

  @Test
  void resolvesLiteralDottedKey() {
    Map<String, Object> root = mapOf("mdc", mapOf("event.correlationId", "corr-1"));
    assertThat(JsonPathResolver.resolveAsString(root, JsonPath.parse("mdc[\"event.correlationId\"]"))).isEqualTo("corr-1");
  }

  @Test
  void missingTopLevelKeyResolvesToNull() {
    Map<String, Object> root = Map.of("other", "x");
    assertThat(JsonPathResolver.resolveAsString(root, JsonPath.parse("cif"))).isNull();
  }

  @Test
  void missingIntermediateKeyResolvesToNullNotThrows() {
    Map<String, Object> root = Map.of("other", "x");
    assertThat(JsonPathResolver.resolveAsString(root, JsonPath.parse("mdc.cif"))).isNull();
  }

  @Test
  void intermediateValueNotAMapResolvesToNullNotThrows() {
    // mdc is a plain string, not an object - descending into it must not crash.
    Map<String, Object> root = Map.of("mdc", "not-an-object");
    assertThat(JsonPathResolver.resolveAsString(root, JsonPath.parse("mdc.cif"))).isNull();
  }

  @Test
  void nullIntermediateValueResolvesToNull() {
    Map<String, Object> root = new LinkedHashMap<>();
    root.put("mdc", null);
    assertThat(JsonPathResolver.resolveAsString(root, JsonPath.parse("mdc.cif"))).isNull();
  }

  @Test
  void explicitEmptyStringValueIsPreservedNotTreatedAsNull() {
    Map<String, Object> root = Map.of("message", "");
    assertThat(JsonPathResolver.resolveAsString(root, JsonPath.parse("message"))).isEmpty();
  }

  @Test
  void explicitJsonNullValueResolvesToNull() {
    Map<String, Object> root = new LinkedHashMap<>();
    root.put("cif", null);
    assertThat(JsonPathResolver.resolveAsString(root, JsonPath.parse("cif"))).isNull();
  }

  @Test
  void numericValueIsStringified() {
    Map<String, Object> root = Map.of("level_value", 40000);
    assertThat(JsonPathResolver.resolveAsString(root, JsonPath.parse("level_value"))).isEqualTo("40000");
  }

  @Test
  void resolvedObjectValueIsStringifiedNotDiscarded() {
    Map<String, Object> root = mapOf("customer", mapOf("cif", "2449", "name", "Jane"));
    String resolved = JsonPathResolver.resolveAsString(root, JsonPath.parse("customer"));
    assertThat(resolved).isNotNull().contains("2449");
  }

  @Test
  void isStructuredValueDetectsNestedObject() {
    Map<String, Object> root = mapOf("customer", mapOf("cif", "2449"));
    assertThat(JsonPathResolver.isStructuredValue(root, JsonPath.parse("customer"))).isTrue();
    assertThat(JsonPathResolver.isStructuredValue(root, JsonPath.parse("customer.cif"))).isFalse();
  }

  @Test
  void isStructuredValueDetectsArray() {
    Map<String, Object> root = Map.of("tags", List.of("a", "b"));
    assertThat(JsonPathResolver.isStructuredValue(root, JsonPath.parse("tags"))).isTrue();
  }

  @Test
  void nullRootOrPathNeverThrows() {
    assertThat(JsonPathResolver.resolveRaw(null, JsonPath.parse("cif"))).isNull();
    assertThat(JsonPathResolver.resolveRaw(Map.of("cif", "x"), null)).isNull();
  }

  @SafeVarargs
  private static Map<String, Object> mapOf(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < kv.length; i += 2) {
      m.put((String) kv[i], kv[i + 1]);
    }
    return m;
  }
}
