import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';

export const ResetPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const { updatePassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await updatePassword(password);
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-slate-900 dark:to-indigo-950 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 shadow-lg shadow-purple-500/25 mb-4">
            <span className="text-3xl">🔑</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Set New Password</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Enter your new password below</p>
        </div>

        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl p-8 rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-700">
          {success ? (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/40">
                <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Password Updated!</h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm">Redirecting to login...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  New Password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 border-2 rounded-xl bg-gray-50 dark:bg-gray-700/50 dark:text-white border-gray-200 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none"
                  disabled={loading}
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 border-2 rounded-xl bg-gray-50 dark:bg-gray-700/50 dark:text-white border-gray-200 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none"
                  disabled={loading}
                />
              </div>
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-300 rounded-xl text-sm">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-3.5 px-4 rounded-xl transition-all shadow-lg"
              >
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
