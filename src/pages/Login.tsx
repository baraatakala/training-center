import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Validate email format
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Sanitize returnUrl to prevent XSS - only allow relative paths
const sanitizeReturnUrl = (url: string | null): string => {
  if (!url) return '/';
  
  try {
    const decoded = decodeURIComponent(url);
    // Only allow relative paths starting with /
    // Reject absolute URLs, javascript:, data:, or any protocol
    if (
      !decoded.startsWith('/') ||
      decoded.startsWith('//') ||
      decoded.includes(':') ||
      decoded.includes('\\') ||
      decoded.toLowerCase().includes('javascript') ||
      decoded.toLowerCase().includes('data')
    ) {
      console.warn('Invalid returnUrl detected, redirecting to home');
      return '/';
    }
    return decoded;
  } catch {
    return '/';
  }
};

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<{ email?: string; password?: string }>({});
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading, signIn } = useAuth();
  
  // Sanitize returnUrl to prevent XSS attacks
  const returnUrl = useMemo(() => sanitizeReturnUrl(searchParams.get('returnUrl')), [searchParams]);

  const validateForm = (): boolean => {
    const errors: { email?: string; password?: string } = {};
    
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
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setValidationErrors({});
    
    // Validate before submitting
    if (!validateForm()) {
      return;
    }
    
    setLoading(true);

    try {
      const { error: signInError } = await signIn(email.trim(), password);

      if (signInError) {
        // Provide user-friendly error messages
        const errorMessage = signInError.message.toLowerCase();
        if (errorMessage.includes('invalid login credentials')) {
          setError('Invalid email or password. Please try again.');
        } else if (errorMessage.includes('email not confirmed')) {
          setError('Please verify your email address before logging in.');
        } else if (errorMessage.includes('too many requests')) {
          setError('Too many login attempts. Please wait a few minutes and try again.');
        } else {
          setError(signInError.message);
        }
        setLoading(false);
        return;
      }

      // Redirect to sanitized return URL or dashboard on successful login
      navigate(returnUrl);
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  // If already signed in, redirect to return URL or dashboard
  useEffect(() => {
    if (!authLoading && user) {
      navigate(returnUrl);
    }
  }, [authLoading, user, navigate, returnUrl]);

  const isCheckInFlow = returnUrl.includes('/checkin/');

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-800 transition-colors">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg dark:shadow-2xl w-full max-w-md border border-gray-200 dark:border-gray-700">
        <h1 className="text-3xl font-bold mb-6 text-center text-gray-800 dark:text-white">
          Training Center
        </h1>
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-700 dark:text-gray-200">Login</h2>

        {isCheckInFlow && (
          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-300 flex items-center gap-2">
              <span className="text-xl">📱</span>
              <span>Please log in to complete your attendance check-in</span>
            </p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4" aria-labelledby="login-heading">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (validationErrors.email) {
                  setValidationErrors(prev => ({ ...prev, email: undefined }));
                }
              }}
              autoFocus
              placeholder="Enter your email"
              className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 bg-white dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 transition-colors ${
                validationErrors.email 
                  ? 'border-red-400 focus:border-red-500 focus:ring-red-200 dark:focus:ring-red-800' 
                  : 'border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-200 dark:focus:ring-blue-800'
              }`}
              aria-invalid={!!validationErrors.email}
              aria-describedby={validationErrors.email ? 'email-error' : undefined}
              disabled={loading}
            />
            {validationErrors.email && (
              <p id="email-error" className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
                {validationErrors.email}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (validationErrors.password) {
                  setValidationErrors(prev => ({ ...prev, password: undefined }));
                }
              }}
              placeholder="Enter your password"
              className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 bg-white dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 transition-colors ${
                validationErrors.password 
                  ? 'border-red-400 focus:border-red-500 focus:ring-red-200 dark:focus:ring-red-800' 
                  : 'border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-200 dark:focus:ring-blue-800'
              }`}
              aria-invalid={!!validationErrors.password}
              aria-describedby={validationErrors.password ? 'password-error' : undefined}
              disabled={loading}
            />
            {validationErrors.password && (
              <p id="password-error" className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
                {validationErrors.password}
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/40 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-300 rounded" role="alert">
              <span className="flex items-center gap-2">
                <span>⚠️</span>
                {error}
              </span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white font-bold py-2.5 px-4 rounded-lg transition-colors shadow-md"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
          <div className="text-center mt-2">
            <a href="mailto:baraatakala2004@gmail.com" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Forgot password? Contact administrator</a>
          </div>
        </form>

        <p className="text-center text-gray-600 dark:text-gray-400 text-sm mt-4">
          Contact your administrator to create an account
        </p>
      </div>
    </div>
  );
};

export default Login;
