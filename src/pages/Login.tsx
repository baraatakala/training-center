import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  
  const returnUrl = searchParams.get('returnUrl') || '/';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      // Redirect to return URL or dashboard on successful login
      navigate(decodeURIComponent(returnUrl));
    } catch (err: any) {
      setError(err.message || 'An error occurred');
      setLoading(false);
    }
  };

  // If already signed in, redirect to return URL or dashboard
  useEffect(() => {
    if (!authLoading && user) {
      navigate(decodeURIComponent(returnUrl));
    }
  }, [authLoading, user, navigate, returnUrl]);

  const isCheckInFlow = returnUrl.includes('/checkin/');

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6 text-center text-gray-800">
          Training Center
        </h1>
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-700">Login</h2>

        {isCheckInFlow && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800 flex items-center gap-2">
              <span className="text-xl">📱</span>
              <span>Please log in to complete your attendance check-in</span>
            </p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4" aria-labelledby="login-heading">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              placeholder="Enter your email"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              required
              disabled={loading}
            />
          </div>

          {error && <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded-lg transition"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
          <div className="text-center mt-2">
            <a href="mailto:baraatakala2004@gmail.com" className="text-sm text-blue-600 hover:underline">Forgot password? Contact administrator</a>
          </div>
        </form>

        <p className="text-center text-gray-600 text-sm mt-4">
          Contact your administrator to create an account
        </p>
      </div>
    </div>
  );
};

export default Login;
