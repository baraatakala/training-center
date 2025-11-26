import { Link, useLocation } from 'react-router-dom';

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

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
    { path: '/analytics', label: 'Analytics', icon: '📈' },
  ];

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Top Navigation */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-2xl font-bold text-blue-600">Training Center</h1>
              </div>
              <div className="hidden sm:ml-8 sm:flex sm:space-x-4">
                {navLinks.map((link) => (
                  <Link
                    key={link.path}
                    to={link.path}
                    className={`inline-flex items-center px-4 py-2 border-b-2 text-sm font-medium transition-colors ${
                      isActive(link.path)
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                    }`}
                  >
                    <span className="mr-2">{link.icon}</span>
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-gray-500">
            Training Center Management System © 2025
          </p>
        </div>
      </footer>
    </div>
  );
}
