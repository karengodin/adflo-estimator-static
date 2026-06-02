"use client";

import { useEffect, useState } from "react";
import { supabase } from "../supabase";

export type AppRole = "admin" | "implementation" | "sales";

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

export function useRole(): UseRoleResult {
  const [role, setRole]                         = useState<AppRole | null>(null);
  const [isLoading, setIsLoading]               = useState(true);
  const [userId, setUserId]                     = useState<string | null>(null);
  const [userEmail, setUserEmail]               = useState<string | null>(null);
  const [displayName, setDisplayName]           = useState<string | null>(null);
  const [accessToken, setAccessToken]           = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { setIsLoading(false); return; }

        setUserId(session.user.id);
        setUserEmail(session.user.email ?? null);
        setAccessToken(session.access_token);
        setMustChangePassword(session.user.user_metadata?.must_change_password === true);

        const [roleRes, profileRes] = await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", session.user.id).single(),
          supabase.from("profiles").select("display_name").eq("id", session.user.id).single(),
        ]);

        setRole((roleRes.data?.role as AppRole) ?? null);
        setDisplayName(profileRes.data?.display_name ?? null);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  return {
    role,
    isAdmin: role === "admin",
    isImplementation: role === "implementation",
    isSales: role === "sales",
    isLoading,
    userId,
    userEmail,
    displayName,
    accessToken,
    mustChangePassword,
  };
}
