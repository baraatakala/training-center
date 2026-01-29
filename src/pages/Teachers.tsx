import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SearchBar } from '../components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { TeacherForm } from '../components/TeacherForm';
import { Badge } from '../components/ui/Badge';
import { teacherService } from '../services/teacherService';
import { supabase } from '../lib/supabase';
import type { Teacher, CreateTeacher } from '../types/database.types';

interface TeacherWithCount extends Teacher {
  enrolledCount?: number;
}

export function Teachers() {
  const [teachers, setTeachers] = useState<TeacherWithCount[]>([]);
  const [filteredTeachers, setFilteredTeachers] = useState<TeacherWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | undefined>();
  const [isTeacher, setIsTeacher] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTeachers = async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await teacherService.getAll();
    if (fetchError) {
      setError('Failed to load teachers. Please try again.');
      console.error('Load teachers error:', fetchError);
      setLoading(false);
      return;
    }
    if (data) {
      // Fetch enrolled student counts for each teacher
      const teachersWithCounts = await Promise.all(
        data.map(async (teacher) => {
          const { count } = await teacherService.getEnrolledStudentsCount(teacher.teacher_id);
          return { ...teacher, enrolledCount: count };
        })
      );
      setTeachers(teachersWithCounts);
      setFilteredTeachers(teachersWithCounts);
    }
    setLoading(false);
  };

  useEffect(() => {
    const checkTeacherAccess = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        const { data: teacher } = await supabase
          .from('teacher')
          .select('teacher_id')
          .ilike('email', user.email)
          .single();
        setIsTeacher(!!teacher);
      }
    };
    checkTeacherAccess();
    loadTeachers();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      setFilteredTeachers(
        teachers.filter(
          (t) =>
            t.name.toLowerCase().includes(query) ||
            t.email.toLowerCase().includes(query) ||
            t.phone?.toLowerCase().includes(query)
        )
      );
    } else {
      setFilteredTeachers(teachers);
    }
  }, [searchQuery, teachers]);

  const handleAddTeacher = async (data: CreateTeacher) => {
    const { error } = await teacherService.create(data);
    if (!error) {
      setIsModalOpen(false);
      loadTeachers();
    }
  };

  const handleUpdateTeacher = async (data: CreateTeacher) => {
    if (editingTeacher) {
      const { error } = await teacherService.update(editingTeacher.teacher_id, data);
      if (!error) {
        setIsModalOpen(false);
        setEditingTeacher(undefined);
        loadTeachers();
      }
    }
  };

  const openAddModal = () => {
    setEditingTeacher(undefined);
    setIsModalOpen(true);
  };

  const openEditModal = (teacher: Teacher) => {
    setEditingTeacher(teacher);
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-4 md:space-y-6 p-4 md:p-0">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Teachers Management</h1>
          <p className="text-sm md:text-base text-gray-600 mt-1">{teachers.length} total teachers</p>
        </div>
        {isTeacher && (
          <Button onClick={openAddModal} variant="primary" className="w-full sm:w-auto">
            <span className="mr-2">+</span> Add Teacher
          </Button>
        )}
      </div>

      {!isTeacher && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800 text-sm">
            ⚠️ You are viewing as a student. Edit and add functions are disabled.
          </p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 text-sm">❌ {error}</p>
          <button 
            onClick={loadTeachers} 
            className="mt-2 text-sm text-red-600 underline hover:text-red-800"
          >
            Retry
          </button>
        </div>
      )}

      <div className="bg-white p-4 md:p-6 rounded-lg shadow">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search teachers..."
        />
      </div>

      {loading ? (
        <div className="text-center py-12">Loading teachers...</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {filteredTeachers.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              {searchQuery
                ? 'No teachers found matching your search.'
                : 'No teachers found. Click "Add Teacher" to get started.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Name</TableHead>
                    <TableHead className="whitespace-nowrap hidden md:table-cell">Email</TableHead>
                    <TableHead className="whitespace-nowrap hidden lg:table-cell">Phone</TableHead>
                    <TableHead className="whitespace-nowrap hidden sm:table-cell">Enrolled Students</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTeachers.map((teacher) => (
                    <TableRow key={teacher.teacher_id}>
                      <TableCell className="font-medium text-gray-900 min-w-[150px]">
                        <div className="flex flex-col">
                          <span>{teacher.name}</span>
                          <span className="text-xs text-gray-500 md:hidden">{teacher.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-600 hidden md:table-cell min-w-[200px]">{teacher.email}</TableCell>
                      <TableCell className="text-gray-600 hidden lg:table-cell whitespace-nowrap">{teacher.phone || '-'}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="info">
                          {teacher.enrolledCount || 0} students
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 md:gap-2 justify-end flex-nowrap">
                          {isTeacher && (
                            <Button 
                              size="sm" 
                              variant="secondary" 
                              onClick={() => openEditModal(teacher)} 
                              className="text-xs md:text-sm px-2 md:px-3"
                            >
                              Edit
                            </Button>
                          )}
                          {!isTeacher && (
                            <span className="text-xs text-gray-400 px-2">View only</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingTeacher(undefined);
        }}
        title={editingTeacher ? 'Edit Teacher' : 'Add New Teacher'}
      >
        <TeacherForm
          teacher={editingTeacher}
          onSubmit={editingTeacher ? handleUpdateTeacher : handleAddTeacher}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingTeacher(undefined);
          }}
        />
      </Modal>
    </div>
  );
}
