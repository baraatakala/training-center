import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { SearchBar } from '../components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { CourseForm } from '../components/CourseForm';
import { BookReferencesManager } from '../components/BookReferencesManager';
import { courseService } from '../services/courseService';
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

  const loadCourses = async () => {
    setLoading(true);
    const { data } = await courseService.getAll();
    if (data) {
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
    if (!error) {
      setIsModalOpen(false);
      loadCourses();
    }
  };

  const handleUpdateCourse = async (data: CreateCourse) => {
    if (editingCourse) {
      const { error } = await courseService.update(editingCourse.course_id, data);
      if (!error) {
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

  return (
    <div className="space-y-4 md:space-y-6 p-4 md:p-0">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Courses Management</h1>
          <p className="text-sm md:text-base text-gray-600 mt-1">{courses.length} total courses</p>
        </div>
        <Button onClick={openAddModal} variant="primary" className="w-full sm:w-auto">
          <span className="mr-2">+</span> Add Course
        </Button>
      </div>

      <div className="bg-white p-4 md:p-6 rounded-lg shadow">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search courses..."
        />
      </div>

      {loading ? (
        <div className="text-center py-12">Loading courses...</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {filteredCourses.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              {searchQuery
                ? 'No courses found matching your search.'
                : 'No courses found. Click "Add Course" to get started.'}
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
                      <TableCell className="font-medium text-gray-900 min-w-[150px]">
                        <div className="flex flex-col">
                          <span>{course.course_name}</span>
                          <span className="text-xs text-gray-500 md:hidden">{course.teacher?.name || 'No instructor'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Badge variant="info">{course.category}</Badge>
                      </TableCell>
                      <TableCell className="text-gray-600 hidden md:table-cell min-w-[150px]">{course.teacher?.name || 'No instructor'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 md:gap-2 justify-end flex-nowrap">
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => openBookReferences(course)}
                            className="text-xs md:text-sm px-2 md:px-3"
                          >
                            📚
                          </Button>
                          <Button 
                            size="sm" 
                            variant="secondary" 
                            onClick={() => openEditModal(course)} 
                            className="text-xs md:text-sm px-2 md:px-3"
                          >
                            Edit
                          </Button>
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
        <CourseForm
          course={editingCourse}
          onSubmit={editingCourse ? handleUpdateCourse : handleAddCourse}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingCourse(undefined);
          }}
        />
      </Modal>
    </div>
  );
}
