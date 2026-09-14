package com.logexplorer.core.mapping.scan;

/**
 * The JSON value shape observed at a discovered path (owner mission §A7 —
 * "observed type(s)"). Deliberately structural only — never a business
 * semantic guess (mission §A2: "Do NOT infer unsupported business
 * semantics").
 */
public enum ObservedType {
  STRING,
  NUMBER,
  BOOLEAN,
  OBJECT,
  ARRAY,
  NULL
}
