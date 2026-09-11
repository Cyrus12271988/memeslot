"use client";

import { createContext, useContext, useState, ReactNode } from "react";

type AuthContextType = {
  authenticated: boolean;
  setAuthenticated: (value: boolean) => void;
};

const AuthContext = createContext<AuthContextType>({
  authenticated: false,
  setAuthenticated: () => {},
});

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [authenticated, setAuthenticated] = useState(false);

  return (
    <AuthContext.Provider value={{ authenticated, setAuthenticated }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}