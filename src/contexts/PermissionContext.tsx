"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import type { CurrentUser } from "@/lib/types";
import { getUserSessionAction } from "@/lib/actions/server-helpers";
import { GENERIC_AUTH_ERROR } from "@/lib/security/messages";
import { useToast } from "@/hooks/use-toast";

interface PermissionContextType {
  currentUser: CurrentUser | null;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  isSuperAdmin: boolean;
  managesBuildings: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: (sessionExpired?: boolean) => Promise<void>;
  refreshUser: () => Promise<void>;
  handleApiCall: <T>(apiCall: () => Promise<T>) => Promise<T | undefined>;
}

const PermissionContext = createContext<PermissionContextType>({
  currentUser: null,
  hasPermission: () => false,
  hasAnyPermission: () => false,
  isSuperAdmin: false,
  managesBuildings: false,
  isLoading: true,
  isAuthenticated: false,
  logout: async () => {},
  refreshUser: async () => {},
  handleApiCall: async (apiCall) => apiCall(),
});

export const usePermissions = () => useContext(PermissionContext);

export const PermissionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { toast } = useToast();

  const logout = useCallback(async (sessionExpired = false) => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      console.error("Logout request failed:", error);
    } finally {
      setCurrentUser(null);
      setIsAuthenticated(false);
      setIsLoading(false); // Stop loading on logout
      const loginUrl = new URL("/login", window.location.origin);
      // Always redirect to plain /login (no query params) on logout/session expiry
      window.location.href = loginUrl.toString();
    }
  }, []);

  // Verify CSRF presence immediately when authenticated and on window focus.
  // Also check before any API call via `handleApiCall` below to ensure immediate
  // detection when the token is removed or altered.
  useEffect(() => {
    let mounted = true;

    const checkCsrfAndLogoutIfMissing = async () => {
      try {
        const res = await fetch("/api/auth/csrf-check");
        const data = await res.json();
        if (!mounted) return;
        if (data && data.csrfPresent === false) {
          await logout(true);
        }
      } catch (err) {
        // network errors - do not logout automatically
      }
    };

    if (isAuthenticated) {
      const onFocus = () => {
        checkCsrfAndLogoutIfMissing();
      };

      // Run an immediate check and also check on window focus.
      window.addEventListener("focus", onFocus);

      // Add short polling (5s) in addition to focus checks so tampering
      // is detected even if the user doesn't refocus the window.
      let pollId: number | undefined;
      pollId = window.setInterval(() => {
        checkCsrfAndLogoutIfMissing();
      }, 5000);

      return () => {
        window.removeEventListener("focus", onFocus);
        if (pollId) {
          clearInterval(pollId);
        }
      };
    }

    return () => {
      mounted = false;
      window.removeEventListener("focus", checkCsrfAndLogoutIfMissing);
    };
  }, [isAuthenticated, logout]);

  const handleApiCall = useCallback(
    async <T,>(apiCall: () => Promise<T>): Promise<T | undefined> => {
      // Before making the API call, ensure the CSRF token is present and valid.
      try {
        const res = await fetch("/api/auth/csrf-check");
        const data = await res.json();
        if (data && data.csrfPresent === false) {
          await logout(true);
          return undefined;
        }
      } catch (err) {
        // network errors: proceed to call the API (the API itself will reject if unauthenticated)
      }

      try {
        return await apiCall();
      } catch (error: any) {
        if (
          error.message?.includes("Authentication") ||
          error.message?.includes("Session expired") ||
          error.message === GENERIC_AUTH_ERROR
        ) {
          await logout(true);
          return undefined;
        }
        // Re-throw other errors to be handled by the component
        throw error;
      }
    },
    [logout],
  );

  const refreshUser = useCallback(async () => {
    // No need to set loading to true here, as it's for background refreshes or initial load.
    // The initial `isLoading` state is true by default.
    try {
      const { isSuccess, user } = await getUserSessionAction();
      if (isSuccess && user) {
        setCurrentUser(user);
        setIsAuthenticated(true);
      } else {
        setCurrentUser(null);
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error("Error refreshing user session:", error);
      setCurrentUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();

    // Install a global fetch wrapper that logs out on 401/403 responses.
    // This ensures any client-side fetch using the browser `fetch` will trigger
    // an immediate logout/navigation to the login page when the server rejects
    // the request due to a revoked or expired token.
    const origFetch = window.fetch.bind(window);
    const wrappedFetch = async (...args: Parameters<typeof fetch>) => {
      try {
        const res = await origFetch(...args);
        if (res && (res.status === 401 || res.status === 403)) {
          // Trigger logout flow once
          await logout(true);
        }
        return res;
      } catch (err) {
        // network error - just rethrow
        throw err;
      }
    };
    (window as any).fetch = wrappedFetch;
    return () => {
      (window as any).fetch = origFetch;
    };
  }, [refreshUser]);

  const effectivePermissions = useMemo(() => {
    if (!currentUser) return new Set<string>();
    return new Set(currentUser.effectivePermissions);
  }, [currentUser]);

  const isSuperAdmin = useMemo(() => {
    if (!currentUser) return false;
    return currentUser.roles.some((role) => role.name === "SUPER_ADMIN");
  }, [currentUser]);

  const managesBuildings = useMemo(() => {
    if (!currentUser) return false;
    return (
      !!currentUser.showAllBuildings ||
      (currentUser.managedBuildingIds ?? []).length > 0
    );
  }, [currentUser]);

  const hasPermission = useCallback(
    (permission: string): boolean => {
      if (!currentUser) return false;
      if (isSuperAdmin) return true;
      return effectivePermissions.has(permission);
    },
    [currentUser, isSuperAdmin, effectivePermissions],
  );

  const hasAnyPermission = useCallback(
    (permissions: string[]): boolean => {
      if (!currentUser) return false;
      if (isSuperAdmin) return true;
      return permissions.some((p) => effectivePermissions.has(p));
    },
    [currentUser, isSuperAdmin, effectivePermissions],
  );

  const value = {
    currentUser,
    hasPermission,
    hasAnyPermission,
    isSuperAdmin,
    managesBuildings,
    isLoading,
    isAuthenticated,
    logout,
    refreshUser,
    handleApiCall,
  };

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
};
