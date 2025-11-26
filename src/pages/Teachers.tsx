import { useEffect, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SearchBar } from '../components/ui/SearchBar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { TeacherForm } from '../components/TeacherForm';
import { teacherService } from '../services/teacherService';
import type { Teacher, CreateTeacher } from '../types/database.types';

export function Teachers() {
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

  const handleDeleteTeacher = async (teacherId: string) => {
    if (confirm('Are you sure you want to delete this teacher?')) {
      const { error } = await teacherService.delete(teacherId);
      if (!error) {
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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Teachers Management</h1>
          <p className="text-gray-600 mt-1">{teachers.length} total teachers</p>
        </div>
        <Button onClick={openAddModal} variant="primary">
          <span className="mr-2">+</span> Add Teacher
        </Button>
      </div>

      <div className="bg-white p-6 rounded-lg shadow">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by name, email, or phone..."
        />
      </div>

      {loading ? (
        <div className="text-center py-12">Loading teachers...</div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {filteredTeachers.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              {searchQuery
                ? 'No teachers found matching your search.'
                : 'No teachers found. Click "Add Teacher" to get started.'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTeachers.map((teacher) => (
                  <TableRow key={teacher.teacher_id}>
                    <TableCell className="font-medium text-gray-900">{teacher.name}</TableCell>
                    <TableCell className="text-gray-600">{teacher.email}</TableCell>
                    <TableCell className="text-gray-600">{teacher.phone || '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="secondary" onClick={() => openEditModal(teacher)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDeleteTeacher(teacher.teacher_id)}
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
