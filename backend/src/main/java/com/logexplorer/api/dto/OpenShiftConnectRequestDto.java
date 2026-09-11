package com.logexplorer.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The connect request body (OS-1A §6).
 *
 * <p>{@code loginCommand} is the raw pasted `oc login` text. It is
 * <b>untrusted input</b>: it is parsed by {@code OcLoginCommandParser},
 * never executed, and never echoed back - not in a success response, not
 * in an error, and not in a log line.
 *
 * <p>{@link #toString()} is redacted because a request DTO is exactly the
 * kind of object that ends up in a debug log or a validation-failure
 * message, and this one carries a bearer token.
 */
public record OpenShiftConnectRequestDto(
    @NotBlank @Size(max = 8192) String loginCommand, @Size(max = 120) String connectionName) {

  @Override
  public String toString() {
    return "OpenShiftConnectRequestDto[loginCommand=[REDACTED], connectionName=" + connectionName + "]";
  }
}
