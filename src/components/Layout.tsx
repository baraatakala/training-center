import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const navLinks = [
    { path: '/', label: 'Dashboard', icon: '📊' },
    { path: '/teachers', label: 'Teachers', icon: '👩‍🏫' },
    { path: '/students', label: 'Students', icon: '👥' },
    { path: '/courses', label: 'Courses', icon: '📖' },
    { path: '/sessions', label: 'Sessions', icon: '📚' },
    { path: '/enrollments', label: 'Enrollments', icon: '✍️' },
    { path: '/attendance-records', label: 'Attendance Records', icon: '📋' },
    { path: '/audit-logs', label: 'Audit Logs', icon: '🔍' },
  ];

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Top Navigation */}
      <nav className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl sm:text-2xl font-bold text-blue-600">Training Center</h1>
            </div>
            
            {/* Desktop Navigation */}
            <div className="hidden lg:flex lg:space-x-2 lg:items-center">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`inline-flex items-center px-3 py-2 border-b-2 text-sm font-medium transition-colors ${
                    isActive(link.path)
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                  }`}
                >
                  <span className="mr-1">{link.icon}</span>
                  <span className="hidden xl:inline">{link.label}</span>
                </Link>
              ))}
              <div className="ml-4 pl-4 border-l border-gray-300 flex items-center space-x-3">
                <span className="text-sm text-gray-600">{user?.email}</span>
                <button
                  onClick={handleLogout}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>

            {/* Mobile menu button */}
            <div className="flex items-center lg:hidden space-x-2">
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="inline-flex items-center justify-center p-2 rounded-md text-gray-700 hover:text-gray-900 hover:bg-gray-100 focus:outline-none"
              >
                <span className="sr-only">Open main menu</span>
                {mobileMenuOpen ? (
                  <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-gray-200">
            <div className="px-2 pt-2 pb-3 space-y-1">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-colors ${
                    isActive(link.path)
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <span className="mr-2">{link.icon}</span>
                  {link.label}
                </Link>
              ))}
              <div className="border-t border-gray-200 pt-3 mt-3">
                <div className="px-3 py-2 text-sm text-gray-600 mb-2">
                  {user?.email}
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-4 sm:py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-8 sm:mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <p className="text-center text-xs sm:text-sm text-gray-500">
            Training Center Management System © 2025
          </p>
        </div>
      </footer>
    </div>
  );
}
