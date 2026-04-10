import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/shared/lib/supabase';
import type { User } from '@supabase/supabase-js';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_CHECK_INTERVAL_MS = 60 * 1000; // check every minute

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>;
  isPasswordRecovery: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const initialCheckDone = useRef(false);
  const userRef = useRef<User | null>(null);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Track user activity for idle timeout
  const handleActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;
    events.forEach(evt => window.addEventListener(evt, handleActivity, { passive: true }));
    return () => {
      events.forEach(evt => window.removeEventListener(evt, handleActivity));
    };
  }, [handleActivity]);

  // Idle timeout check
  useEffect(() => {
    const interval = setInterval(() => {
      if (!userRef.current) return;
      const rememberMe = localStorage.getItem('rememberMe') === 'true';
      if (rememberMe) return; // skip idle timeout when "remember me" is active

      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= IDLE_TIMEOUT_MS) {
        void supabase.auth.signOut().then(() => setUser(null));
      }
    }, IDLE_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const refreshSession = async (showLoader = false) => {
      try {
        if (showLoader) {
          setLoading(true);
        }

        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Session check timeout')), 15000)
        );
        
        const sessionPromise = supabase.auth.getSession();
        
        const { data, error } = await Promise.race([
          sessionPromise,
          timeoutPromise
        ]) as { data: { session: { user: User | null } | null } | null; error: Error | null };
        
        if (error) {
          console.error('Error getting session:', error);
          if (showLoader && !userRef.current) {
            setUser(null);
          }
        } else {
          const nextUser = data?.session?.user ?? null;
          if (nextUser || showLoader || !userRef.current) {
            setUser(nextUser);
          }
        }
      } catch (error) {
        console.error('Session check failed:', error);
        if (showLoader && !userRef.current) {
          setUser(null);
        }
      } finally {
        initialCheckDone.current = true;
        setLoading(false);
      }
    };

    refreshSession(true);

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      refreshSession(false);
    };

    // Listen for auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }
      setUser(session?.user ?? null);
      // Only update loading if initial check is done to prevent race condition
      if (initialCheckDone.current) {
        setLoading(false);
      }
    });

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      authListener?.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string): Promise<{ error: Error | null }> => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        return { error };
      }
      // Immediately update user state to avoid race conditions with navigation
      if (data?.user) {
        setUser(data.user);
        lastActivityRef.current = Date.now();
      }
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error signing out:', error);
      throw error;
    }
    setUser(null);
    setIsPasswordRecovery(false);
  };

  const resetPassword = async (email: string): Promise<{ error: Error | null }> => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) return { error };
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  const updatePassword = async (newPassword: string): Promise<{ error: Error | null }> => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { error };
      setIsPasswordRecovery(false);
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, resetPassword, updatePassword, isPasswordRecovery }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
