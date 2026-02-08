import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { SearchBar } from '../components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { CourseForm } from '../components/CourseForm';
import { BookReferencesManager } from '../components/BookReferencesManager';
import { courseService } from '../services/courseService';
import { toast } from '../components/ui/toastUtils';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useIsTeacher } from '../hooks/useIsTeacher';
import type { CreateCourse } from '../types/database.types';

interface CourseWithTeacher {
  course_id: string;
  teacher_id: string;
  course_name: string;
  category: string;
  teacher: {
    name: string;
  };
}

export function Courses() {
  const [courses, setCourses] = useState<CourseWithTeacher[]>([]);
  const [filteredCourses, setFilteredCourses] = useState<CourseWithTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<CourseWithTeacher | undefined>();
  const [isBookReferencesOpen, setIsBookReferencesOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<CourseWithTeacher | null>(null);
  const { isTeacher } = useIsTeacher();
  const [error, setError] = useState<string | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<CourseWithTeacher | null>(null);

  const loadCourses = async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await courseService.getAll();
    if (fetchError) {
      setError('Failed to load courses. Please try again.');
      console.error('Load courses error:', fetchError);
    } else if (data) {
      setCourses(data as CourseWithTeacher[]);
      setFilteredCourses(data as CourseWithTeacher[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadCourses();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      setFilteredCourses(
        courses.filter(
          (c) =>
            c.course_name.toLowerCase().includes(query) ||
            c.category.toLowerCase().includes(query) ||
            (c.teacher?.name && c.teacher.name.toLowerCase().includes(query))
        )
      );
    } else {
      setFilteredCourses(courses);
    }
  }, [searchQuery, courses]);

  const handleAddCourse = async (data: CreateCourse) => {
    const { error } = await courseService.create(data);
    if (error) {
      toast.error('Failed to add course: ' + error.message);
    } else {
      toast.success('Course added successfully');
      setIsModalOpen(false);
      loadCourses();
    }
  };

  const handleUpdateCourse = async (data: CreateCourse) => {
    if (editingCourse) {
      const { error } = await courseService.update(editingCourse.course_id, data);
      if (error) {
        toast.error('Failed to update course: ' + error.message);
      } else {
        toast.success('Course updated successfully');
        setIsModalOpen(false);
        setEditingCourse(undefined);
        loadCourses();
      }
    }
  };

  const openAddModal = () => {
    setEditingCourse(undefined);
    setIsModalOpen(true);
  };

  const openEditModal = (course: CourseWithTeacher) => {
    setEditingCourse(course);
    setIsModalOpen(true);
  };

  const openBookReferences = (course: CourseWithTeacher) => {
    setSelectedCourse(course);
    setIsBookReferencesOpen(true);
  };

  const handleDeleteCourse = async () => {
    if (!deletingCourse) return;
    const { error } = await courseService.delete(deletingCourse.course_id);
    if (error) {
      toast.error('Failed to delete course: ' + error.message);
    } else {
      toast.success(`"${deletingCourse.course_name}" deleted successfully`);
      loadCourses();
    }
    setDeletingCourse(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Courses Management</h1>
          <p className="text-sm md:text-base text-gray-500 dark:text-gray-400 mt-1">{courses.length} total courses</p>
        </div>
        {isTeacher && (
          <Button onClick={openAddModal} variant="primary" className="w-full sm:w-auto gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Course
          </Button>
        )}
      </div>

      {!isTeacher && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-xl p-4 flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
          <p className="text-amber-700 dark:text-amber-300 text-sm">
            You are viewing as a student. Edit and add functions are disabled.
          </p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-xl p-4 flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </div>
          <div className="flex-1">
            <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
            <button 
              onClick={loadCourses} 
              className="mt-1 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
            >
              Click to retry
            </button>
          </div>
        </div>
      )}

      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm p-4 md:p-5 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700/50">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search courses by name, category, or instructor..."
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Loading courses...
          </div>
        </div>
      ) : (
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700/50 overflow-hidden">
          {filteredCourses.length === 0 ? (
            <div className="py-16 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                </div>
                <p className="text-gray-500 dark:text-gray-400">
                  {searchQuery
                    ? 'No courses found matching your search.'
                    : 'No courses found. Click "Add Course" to get started.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Course Name</TableHead>
                    <TableHead className="whitespace-nowrap hidden lg:table-cell">Category</TableHead>
                    <TableHead className="whitespace-nowrap hidden md:table-cell">Instructor</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCourses.map((course) => (
                    <TableRow key={course.course_id}>
                      <TableCell className="font-medium text-gray-900 dark:text-white min-w-[150px]">
                        <div className="flex flex-col">
                          <span>{course.course_name}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 md:hidden">{course.teacher?.name || 'No instructor'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Badge variant="info">{course.category}</Badge>
                      </TableCell>
                      <TableCell className="text-gray-600 dark:text-gray-300 hidden md:table-cell min-w-[150px]">{course.teacher?.name || 'No instructor'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 md:gap-2 justify-end flex-nowrap">
                          {isTeacher && (
                            <>
                              <Button 
                                size="sm" 
                                variant="outline" 
                                onClick={() => openBookReferences(course)}
                                className="text-xs md:text-sm px-2 md:px-3"
                                aria-label="Manage book references"
                                title="Manage book references"
                              >
                                📚
                              </Button>
                              <Button 
                                size="sm" 
                                variant="secondary" 
                                onClick={() => openEditModal(course)} 
                                className="text-xs md:text-sm px-2 md:px-3"
                                aria-label="Edit course"
                              >
                                Edit
                              </Button>
                              <button
                                onClick={() => setDeletingCourse(course)}
                                className="px-2 md:px-3 py-1 text-xs md:text-sm rounded border text-red-600 border-red-300 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors"
                                title="Delete course"
                              >
                                Delete
                              </button>
                            </>
                          )}
                          {!isTeacher && (
                            <span className="text-xs text-gray-400 dark:text-gray-500 px-2">View only</span>
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
          setEditingCourse(undefined);
        }}
        title={editingCourse ? 'Edit Course' : 'Add New Course'}
      >
        <CourseForm
          course={editingCourse}
          onSubmit={editingCourse ? handleUpdateCourse : handleAddCourse}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingCourse(undefined);
          }}
        />
      </Modal>

      <Modal
        isOpen={isBookReferencesOpen}
        onClose={() => {
          setIsBookReferencesOpen(false);
          setSelectedCourse(null);
        }}
        title="Manage Book References"
        size="xl"
      >
        {selectedCourse && (
          <BookReferencesManager
            courseId={selectedCourse.course_id}
            courseName={selectedCourse.course_name}
            onClose={() => {
              setIsBookReferencesOpen(false);
              setSelectedCourse(null);
            }}
          />
        )}
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingCourse}
        title="Delete Course"
        message={`Are you sure you want to delete "${deletingCourse?.course_name}"? This will also remove all associated sessions and enrollments.`}
        confirmText="Delete"
        cancelText="Cancel"
        type="danger"
        onConfirm={handleDeleteCourse}
        onCancel={() => setDeletingCourse(null)}
      />
    </div>
  );
}
