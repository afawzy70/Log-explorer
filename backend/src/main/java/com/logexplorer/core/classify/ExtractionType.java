package com.logexplorer.core.classify;

/**
 * How an extraction definition reads a value: a capture group of an RE2
 * regular expression, or an RFC 6901 JSON Pointer into a field whose value
 * is JSON (a JSON text or an already-structured unknown field).
 */
public enum ExtractionType { REGEX, JSON_POINTER }
