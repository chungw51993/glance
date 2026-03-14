import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

let cachedLogin: string | null = null;

/**
 * Fetches and caches the authenticated GitHub user's login.
 * The login is cached globally so it only fetches once per session.
 */
export function useCurrentUser() {
  const [login, setLogin] = useState<string | null>(cachedLogin);

  useEffect(() => {
    if (cachedLogin) return;

    invoke<string>("get_authenticated_user")
      .then((user) => {
        cachedLogin = user;
        setLogin(user);
      })
      .catch(() => {
        // If token is missing or invalid, login stays null
      });
  }, []);

  return login;
}
