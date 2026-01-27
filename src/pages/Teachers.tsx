import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SearchBar } from '../components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { TeacherForm } from '../components/TeacherForm';
import { teacherService } from '../services/teacherService';
import type { Teacher, CreateTeacher } from '../types/database.types';

export function Teachers() {
  const navigate = useNavigate();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [filteredTeachers, setFilteredTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | undefined>();

  const loadTeachers = async () => {
    setLoading(true);
    const { data } = await teacherService.getAll();
    if (data) {
      setTeachers(data as Teacher[]);
      setFilteredTeachers(data as Teacher[]);
    }
    setLoading(false);
  };

  useEffect(() => {
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
        <Button onClick={openAddModal} variant="primary" className="w-full sm:w-auto">
          <span className="mr-2">+</span> Add Teacher
        </Button>
      </div>

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
                    <TableHead className="whitespace-nowrap hidden lg:table-cell">Assigned Students</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTeachers.map((teacher: any) => (
                    <TableRow key={teacher.teacher_id}>
                      <TableCell className="font-medium text-gray-900 min-w-[150px]">
                        <div className="flex flex-col">
                          <span>{teacher.name}</span>
                          <span className="text-xs text-gray-500 md:hidden">{teacher.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-600 hidden md:table-cell min-w-[200px]">{teacher.email}</TableCell>
                      <TableCell className="text-gray-600 hidden lg:table-cell whitespace-nowrap">{teacher.phone || '-'}</TableCell>
                      <TableCell className="text-gray-600 hidden lg:table-cell whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">
                            {teacher.assigned_students?.[0]?.count || 0} students
                          </span>
                          {(teacher.assigned_students?.[0]?.count || 0) > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => navigate(`/students?teacher=${teacher.teacher_id}`)}
                              className="text-xs"
                            >
                              View
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 md:gap-2 justify-end flex-nowrap">
                          <Button 
                            size="sm" 
                            variant="secondary" 
                            onClick={() => {
                              const password = prompt('Enter password to edit:');
                              if (password === '2021') {
                                openEditModal(teacher);
                              } else if (password !== null) {
                                alert('Incorrect password');
                              }
                            }} 
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
