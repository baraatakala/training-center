import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { authService } from '@/shared/services/authService';

const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const sanitizeReturnUrl = (url: string | null): string => {
  if (!url) return '/';
  try {
    const decoded = decodeURIComponent(url);
    if (
      !decoded.startsWith('/') ||
      decoded.startsWith('//') ||
      decoded.includes(':') ||
      decoded.includes('\\') ||
      decoded.toLowerCase().includes('javascript') ||
      decoded.toLowerCase().includes('data')
    ) {
      return '/';
    }
    return decoded;
  } catch {
    return '/';
  }
};

export const Signup: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{ email?: string; password?: string; confirmPassword?: string }>({});
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const returnUrl = useMemo(() => sanitizeReturnUrl(searchParams.get('returnUrl')), [searchParams]);
  const isCheckInFlow = returnUrl.includes('/checkin/');

  // If already signed in, redirect
  useEffect(() => {
    if (!authLoading && user) {
      navigate(returnUrl);
    }
  }, [authLoading, user, navigate, returnUrl]);

  const validateForm = (): boolean => {
    const errors: { email?: string; password?: string; confirmPassword?: string } = {};

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      errors.email = 'Email is required';
    } else if (!isValidEmail(trimmedEmail)) {
      errors.email = 'Please enter a valid email address';
    }

    if (!password) {
      errors.password = 'Password is required';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Please confirm your password';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setValidationErrors({});

    if (!validateForm()) return;

    setLoading(true);
    try {
      const { error: regError } = await authService.registerUser(email.trim(), password);

      if (regError) {
        // Extract user-friendly message from RPC error
        const msg = regError.message || 'Registration failed.';
        if (msg.includes('Email not registered in the system')) {
          setError('Your email is not registered in the system. Contact your administrator to add your email first.');
        } else if (msg.includes('already exists')) {
          setError('An account with this email already exists. Please use the login form or reset your password.');
        } else if (msg.includes('at least 6 characters')) {
          setError('Password must be at least 6 characters.');
        } else {
          setError(msg);
        }
        setLoading(false);
        return;
      }

      setSuccess(true);
      setLoading(false);
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'An unexpected error occurred.');
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-slate-900 dark:to-indigo-950 transition-colors p-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-green-400/30 to-emerald-500/30 rounded-full blur-3xl"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-br from-blue-400/20 to-cyan-500/20 rounded-full blur-3xl"></div>
        </div>
        <div className="relative w-full max-w-md">
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl p-8 rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-700 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500 shadow-lg shadow-green-500/25 mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Account Created!</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">Your account has been created successfully. You can now sign in.</p>
            <Link
              to={`/login${returnUrl !== '/' ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ''}`}
              className="inline-block w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-3.5 px-4 rounded-xl transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 text-center"
            >
              Go to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-slate-900 dark:to-indigo-950 transition-colors p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-blue-400/30 to-purple-500/30 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-br from-emerald-400/20 to-cyan-500/20 rounded-full blur-3xl"></div>
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 shadow-lg shadow-purple-500/25 mb-4">
            <span className="text-3xl">📚</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Training Center</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Create your account</p>
        </div>

        {/* Card */}
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl p-8 rounded-3xl shadow-2xl shadow-gray-200/50 dark:shadow-gray-900/50 border border-gray-100 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-2 text-center text-gray-900 dark:text-white">Create Account</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-6">
            Your email must already be registered by your administrator.
          </p>

          {isCheckInFlow && (
            <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 border border-blue-200/50 dark:border-blue-700/50 rounded-2xl">
              <p className="text-sm text-blue-700 dark:text-blue-300 flex items-center gap-3">
                <span className="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-xl">📱</span>
                <span>Create an account to complete your attendance check-in</span>
              </p>
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-5" aria-labelledby="signup-heading">
            <div>
              <label htmlFor="signup-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Email address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                  </svg>
                </div>
                <input
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (validationErrors.email) setValidationErrors(prev => ({ ...prev, email: undefined }));
                  }}
                  autoFocus
                  placeholder="you@example.com"
                  className={`w-full pl-12 pr-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-0 bg-gray-50 dark:bg-gray-700/50 dark:text-white dark:placeholder-gray-400 transition-all ${
                    validationErrors.email
                      ? 'border-red-400 focus:border-red-500'
                      : 'border-gray-200 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400'
                  }`}
                  aria-invalid={!!validationErrors.email}
                  disabled={loading}
                />
              </div>
              {validationErrors.email && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400 flex items-center gap-1" role="alert">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                  {validationErrors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="signup-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  id="signup-password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (validationErrors.password) setValidationErrors(prev => ({ ...prev, password: undefined }));
                  }}
                  placeholder="Min. 6 characters"
                  className={`w-full pl-12 pr-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-0 bg-gray-50 dark:bg-gray-700/50 dark:text-white dark:placeholder-gray-400 transition-all ${
                    validationErrors.password
                      ? 'border-red-400 focus:border-red-500'
                      : 'border-gray-200 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400'
                  }`}
                  aria-invalid={!!validationErrors.password}
                  disabled={loading}
                />
              </div>
              {validationErrors.password && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400 flex items-center gap-1" role="alert">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                  {validationErrors.password}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="signup-confirm" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <input
                  id="signup-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (validationErrors.confirmPassword) setValidationErrors(prev => ({ ...prev, confirmPassword: undefined }));
                  }}
                  placeholder="Re-enter password"
                  className={`w-full pl-12 pr-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-0 bg-gray-50 dark:bg-gray-700/50 dark:text-white dark:placeholder-gray-400 transition-all ${
                    validationErrors.confirmPassword
                      ? 'border-red-400 focus:border-red-500'
                      : 'border-gray-200 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400'
                  }`}
                  aria-invalid={!!validationErrors.confirmPassword}
                  disabled={loading}
                />
              </div>
              {validationErrors.confirmPassword && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400 flex items-center gap-1" role="alert">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                  {validationErrors.confirmPassword}
                </p>
              )}
            </div>

            {error && (
              <div className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-300 rounded-xl" role="alert">
                <span className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">⚠️</span>
                  <span className="text-sm">{error}</span>
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-3.5 px-4 rounded-xl transition-all shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 disabled:shadow-none active:scale-[0.98]"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating account...
                </span>
              ) : 'Create Account'}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-500 dark:text-gray-400 text-sm mt-6">
          Already have an account?{' '}
          <Link
            to={`/login${returnUrl !== '/' ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ''}`}
            className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
};
