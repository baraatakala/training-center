import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { SearchBar } from '../components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { CourseForm } from '../components/CourseForm';
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

  const handleDeleteCourse = async (courseId: string) => {
    if (confirm('Are you sure you want to delete this course?')) {
      const { error } = await courseService.delete(courseId);
      if (!error) {
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Courses Management</h1>
          <p className="text-gray-600 mt-1">{courses.length} total courses</p>
        </div>
        <Button onClick={openAddModal} variant="primary">
          <span className="mr-2">+</span> Add Course
        </Button>
      </div>

      <div className="bg-white p-6 rounded-lg shadow">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by course name, category, or instructor..."
        />
      </div>

      {loading ? (
        <div className="text-center py-12">Loading courses...</div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {filteredCourses.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              {searchQuery
                ? 'No courses found matching your search.'
                : 'No courses found. Click "Add Course" to get started.'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Instructor</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCourses.map((course) => (
                  <TableRow key={course.course_id}>
                    <TableCell className="font-medium text-gray-900">{course.course_name}</TableCell>
                    <TableCell>
                      <Badge variant="info">{course.category}</Badge>
                    </TableCell>
                    <TableCell className="text-gray-600">{course.teacher?.name || 'No instructor'}</TableCell>
                    <TableCell>
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="secondary" onClick={() => openEditModal(course)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDeleteCourse(course.course_id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
    </div>
  );
}
