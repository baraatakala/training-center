// Script to generate unique emails for each student
import { readFileSync, writeFileSync } from 'fs';

// Read the CSV file
const csvContent = readFileSync('c:\\Users\\isc\\OneDrive\\Downloads\\Student Name student_email student_phone.csv', 'utf-8');
const lines = csvContent.split('\n');

// Track unique students
const studentEmails = new Map();
let emailCounter = 1;

// Process each line
const fixedLines = lines.map((line, index) => {
  if (index === 0) return line; // Keep header
  if (!line.trim()) return line; // Keep empty lines
  
  const parts = line.split('\t');
  if (parts.length < 2) return line;
  
  const studentName = parts[0].trim();
  
  // Generate unique email if not already created for this student
  if (!studentEmails.has(studentName)) {
    // Create email from student name (remove spaces, lowercase, add number)
    const emailName = studentName.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '');
    const uniqueEmail = `${emailName}${emailCounter}@student.com`;
    studentEmails.set(studentName, uniqueEmail);
    emailCounter++;
  }
  
  // Replace the email in the line
  parts[1] = studentEmails.get(studentName);
  
  return parts.join('\t');
});

// Write fixed CSV
const fixedContent = fixedLines.join('\n');
writeFileSync('c:\\Users\\isc\\OneDrive\\Downloads\\fixed-attendance.csv', fixedContent);

console.log(`✅ Fixed CSV created with ${studentEmails.size} unique students`);
console.log('\nUnique students and their emails:');
for (const [name, email] of studentEmails) {
  console.log(`  ${name} → ${email}`);
}
