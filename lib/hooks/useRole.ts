"use client";

import { useEffect, useState } from "react";
import { supabase } from "../supabase";

export type AppRole = "admin" | "implementation" | "sales" | "user";

export interface UseRoleResult {
  role: AppRole | null;
  isAdmin: boolean;
  isImplementation: boolean;
  isSales: boolean;
  isLoading: boolean;
  userId: string | null;
  userEmail: string | null;
  displayName: string | null;
  accessToken: string | null;
  mustChangePassword: boolean;
}

const PRIORITY: AppRole[] = ["admin", "implementation", "sales", "user"];

function clearRoleCookie() {
  document.cookie = "adfl-role=; path=/; max-age=0; SameSite=Lax";
}

export function useRole(): UseRoleResult {
  const [role, setRole]                             = useState<AppRole | null>(null);
  const [isLoading, setIsLoading]                   = useState(true);
  const [userId, setUserId]                         = useState<string | null>(null);
  const [userEmail, setUserEmail]                   = useState<string | null>(null);
  const [displayName, setDisplayName]               = useState<string | null>(null);
  const [accessToken, setAccessToken]               = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    async function loadForSession(sessionUserId: string, sessionEmail: string | undefined, token: string, mustChange: boolean) {
      setUserId(sessionUserId);
      setUserEmail(sessionEmail ?? null);
      setAccessToken(token);
      setMustChangePassword(mustChange);

      const [roleRes, profileRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", sessionUserId),
        supabase.from("profiles").select("display_name").eq("id", sessionUserId).single(),
      ]);

      const rows = (roleRes.data ?? []) as { role: string }[];
      const resolvedRole: AppRole | null = PRIORITY.find((r) => rows.some((row) => row.role === r)) ?? null;
      setRole(resolvedRole);
      setDisplayName(profileRes.data?.display_name ?? null);

      if (resolvedRole) {
        document.cookie = `adfl-role=${resolvedRole}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
      }

      setIsLoading(false);
    }

    function resetState() {
      setRole(null);
      setUserId(null);
      setUserEmail(null);
      setDisplayName(null);
      setAccessToken(null);
      setMustChangePassword(false);
      clearRoleCookie();
    }

    // Initial load from current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        setIsLoading(false);
        return;
      }
      loadForSession(
        session.user.id,
        session.user.email,
        session.access_token,
        session.user.user_metadata?.must_change_password === true,
      );
    });

    // Keep state in sync with auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        resetState();
        setIsLoading(false);
        return;
      }
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.user) {
        setIsLoading(true);
        loadForSession(
          session.user.id,
          session.user.email,
          session.access_token,
          session.user.user_metadata?.must_change_password === true,
        );
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return {
    role,
    isAdmin: role === "admin",
    isImplementation: role === "implementation",
    isSales: role === "sales" || role === "user",
    isLoading,
    userId,
    userEmail,
    displayName,
    accessToken,
    mustChangePassword,
  };
}
