package com.logexplorer.source.openshift;

import java.util.List;

/**
 * The outcome of a successful project-discovery call.
 *
 * <p>Note what this type deliberately cannot express: failure. A
 * {@code 401} and a {@code 403} are {@link OpenShiftApiException}s with
 * their own kinds, never a {@code ProjectDiscovery} with an empty list
 * (OS-1A §15). Making "no projects" and "not allowed to ask" different
 * *types* rather than different values of one type is what stops them
 * being accidentally collapsed later.
 *
 * @param projects names the authenticated user can actually see - possibly
 *     empty, which genuinely means "this user has no projects"
 * @param api which API answered, so the UI can stay truthful about what it
 *     is showing (OS-1A §16)
 */
public record ProjectDiscovery(List<String> projects, Api api) {

  public enum Api {
    /** OpenShift's own RBAC-filtered Projects API - the preferred path. */
    PROJECTS,
    /**
     * Kubernetes namespaces. Only used when the cluster genuinely has no
     * OpenShift Projects API. The UI must not call these "Projects"
     * without qualification, and must not invent Project metadata the
     * namespaces API never returned.
     */
    NAMESPACES
  }

  public boolean isEmpty() {
    return projects.isEmpty();
  }

  public int count() {
    return projects.size();
  }
}
