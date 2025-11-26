# 🏫 Training Center Attendance Management System

A comprehensive, enterprise-grade attendance management system built with **React**, **TypeScript**, **Vite**, and **Supabase**. Features advanced GPS tracking, real-time analytics, bulk operations, and professional reporting.

## ✨ Features

### 🏫 Core Attendance Management
- **Smart Student Management** - Add, edit, remove, and organize students with full CRUD operations
- **Quick Attendance Recording** - One-click attendance marking with automatic timestamps
- **Bulk Operations** - Mark attendance for multiple students simultaneously (All Present/All Absent)
- **Attendance History** - Complete records with search and advanced filtering
- **Notes System** - Add detailed notes to each attendance record for documentation
- **Auto-Generation** - Automatically creates attendance records for enrolled students when viewing a session

### 📍 Advanced GPS & Location
- **Precise GPS Tracking** - Sub-meter accuracy location recording using HTML5 Geolocation API
- **Location Validation** - Verify attendance from designated geographic areas
- **Multi-Location Support** - Configure multiple valid attendance zones per location
- **Offline GPS Buffer** - Works even with poor connectivity (stores last 100 GPS readings)
- **Haversine Distance Calculation** - Accurate distance validation using Earth's curvature
- **GPS Zone Management** - Configure radius-based zones with activate/deactivate controls

### 📊 Analytics & Reporting

#### Real-Time Dashboard
- Live attendance statistics and insights
- 4 gradient stat cards: Total Students, Records, Average Attendance, Weighted Score
- Visual charts using Recharts library
- Date range filters (Last 7 days, Last 30 days, Custom range)
- Session-specific filtering

#### Professional PDF Export
- **AutoTable Pagination** - Smart page breaks ensuring all data is visible
- **Comprehensive Summary Statistics**:
  - Total Records, Students, Present/Absent counts
  - Raw vs Effective Attendance Rates (excludes vacation/excused absences)
  - Class Average Rate and Weighted Score calculations
  - Unexcused Absent tracking (Total Absent - Excused Absences)
  - Days Covered analysis
- **Landscape A4 Layout** - Professional enterprise-grade formatting
- **Color-Coded Rates** - Visual indicators for performance levels
- **Ranked Student Table** - Sortable by weighted score

#### Advanced Scoring System
- **Effective Days Methodology** - Accurate attendance calculation excluding vacation days
- **Weighted Score Formula** - Sophisticated scoring system:
  - 70% based on attendance rate
  - 20% based on effective days percentage
  - 10% based on excuse usage when applicable
- **Class Performance Metrics** - Comparative analysis and ranking

#### Data Visualization
- **Status Distribution Pie Chart** - Present, Absent, Late, Excused, Vacation breakdown
- **Daily Trends Line Chart** - Attendance patterns over time
- **Top Performers Bar Chart** - Top 5 students by weighted score (green)
- **Needs Attention Bar Chart** - Bottom 5 students requiring intervention (red)
- **Detailed Student Table** - Comprehensive performance metrics with color coding

#### Excel Export
- **Comprehensive Data Export** - All attendance records with notes included
- **Dual Sheets**:
  - Attendance Records: Date, Student, Session, Location, Status, GPS, Notes
  - Summary Statistics: Metrics overview, unique counts, export metadata
- **Auto-Column Sizing** - Optimized for readability
- **GPS Coordinates** - Latitude/Longitude with accuracy indicators

### 📈 Advanced Features
- **Session Management** - Create sessions with courses, teachers, days, times
- **Course Management** - Organize courses by category with teacher assignment
- **Enrollment System** - Enroll students in sessions with status tracking
- **Teacher Management** - Full CRUD for instructors with contact information
- **Student Search** - Search by name, email, phone, nationality
- **Responsive Design** - Works on desktop, tablet, and mobile devices
- **Professional UI** - Tailwind CSS with gradient cards and modern styling

## 🚀 Technology Stack

### Frontend
- **React 19.2.0** - Latest React with modern hooks
- **TypeScript 5.9.3** - Type-safe development
- **Vite 7.2.4** - Lightning-fast build tool
- **React Router** - Client-side routing
- **Tailwind CSS 3.4.1** - Utility-first styling
- **Recharts** - Interactive data visualization
- **date-fns** - Modern date formatting

### Backend & Database
- **Supabase** - PostgreSQL database with real-time capabilities
- **Row Level Security** - Configurable access control
- **UUID Primary Keys** - Distributed-friendly identifiers
- **Foreign Key Constraints** - Data integrity enforcement
- **Automatic Timestamps** - Created_at/Updated_at triggers

### Export Libraries
- **jsPDF** - PDF generation
- **jspdf-autotable** - Professional table pagination in PDFs
- **xlsx** - Excel file generation

## 📁 Project Structure

```
training-center-app/
├── src/
│   ├── components/
│   │   ├── Layout.tsx              # Navigation & app shell
│   │   └── ui/                     # Reusable UI components
│   │       ├── Badge.tsx
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Input.tsx
│   │       ├── Modal.tsx
│   │       ├── SearchBar.tsx
│   │       ├── Select.tsx
│   │       └── Table.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx           # Home with stats
│   │   ├── Teachers.tsx            # Teacher management
│   │   ├── Students.tsx            # Student management
│   │   ├── Courses.tsx             # Course management
│   │   ├── Sessions.tsx            # Session scheduling
│   │   ├── Enrollments.tsx         # Student enrollment
│   │   ├── Attendance.tsx          # Mark attendance with GPS
│   │   ├── Analytics.tsx           # Comprehensive analytics & reports
│   │   └── Locations.tsx           # GPS zone management
│   ├── services/
│   │   ├── studentService.ts       # Student CRUD operations
│   │   ├── teacherService.ts       # Teacher CRUD operations
│   │   ├── courseService.ts        # Course CRUD operations
│   │   ├── enrollmentService.ts    # Enrollment operations
│   │   ├── attendanceService.ts    # Attendance operations
│   │   ├── gpsService.ts           # GPS tracking & validation
│   │   ├── pdfExportService.ts     # PDF report generation
│   │   └── excelExportService.ts   # Excel export functionality
│   ├── types/
│   │   └── database.types.ts       # TypeScript interfaces
│   ├── lib/
│   │   └── supabase.ts             # Supabase client
│   ├── App.tsx                      # Main app with routes
│   └── main.tsx                     # Entry point
├── database/
│   ├── supabase-schema.sql         # Complete database schema
│   ├── sample-data.sql             # Test data
│   ├── database-updates.sql        # GPS & notes columns
│   └── DISABLE_RLS.sql             # Development security fix
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

## 🛠️ Installation & Setup

### Prerequisites
- Node.js 18+ and npm
- Supabase account (free tier available)

### 1. Clone & Install
```bash
cd training-center-app
npm install
```

### 2. Configure Supabase
1. Create a new Supabase project at https://supabase.com
2. Copy your project URL and anon key
3. Create `src/lib/supabase.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(supabaseUrl, supabaseKey);
```

### 3. Set Up Database
1. Open Supabase SQL Editor
2. Run these scripts in order:
   - `supabase-schema.sql` - Creates all tables, indexes, triggers
   - `database-updates.sql` - Adds GPS & notes columns
   - `sample-data.sql` - (Optional) Adds test data
   - `DISABLE_RLS.sql` - (Development only) Disables row-level security

### 4. Run Development Server
```bash
npm run dev
```

Visit `http://localhost:5173`

## 📊 Database Schema

### Core Tables
- **teacher** - Instructor information
- **student** - Student profiles with contact details
- **course** - Course catalog with categories
- **session** - Class sessions with scheduling
- **location** - Physical training locations
- **session_location** - Specific session dates/times/locations
- **enrollment** - Student-session relationships
- **attendance** - Attendance records with GPS & notes
- **location_zone** - GPS validation zones

### Key Features
- UUID primary keys for all tables
- Foreign key constraints with CASCADE deletes
- Automatic `created_at` and `updated_at` timestamps
- Indexes on frequently queried columns
- Row Level Security (RLS) policies

## 🎯 Usage Guide

### Managing Students
1. Navigate to **Students** page
2. Click "Add Student" to create new records
3. Use search bar to find students by name/email/phone
4. Edit or delete using action buttons

### Enrolling Students
1. Go to **Enrollments** page
2. Click "Enroll Student"
3. Select student and session
4. System tracks enrollment status (active/completed/dropped)

### Marking Attendance
1. Go to **Sessions** page
2. Click "View Attendance" on any session
3. Select date from dropdown
4. System auto-creates attendance records for enrolled students
5. Mark students as Present/Absent/Late/Excused
6. (Optional) Enable GPS tracking for location validation
7. (Optional) Add notes to individual records
8. Use bulk operations to mark multiple students at once

### Viewing Analytics
1. Navigate to **Analytics** page
2. Select date range and session filter
3. View real-time charts and statistics
4. Click "Export PDF" for professional reports
5. Click "Export Excel" for detailed data spreadsheets

### Configuring GPS Zones
1. Go to **Locations** page
2. Click "Add GPS Zone"
3. Enter zone name and select location
4. Click "Use My Current Location" or enter coordinates manually
5. Set radius (meters) for validation
6. Activate/deactivate zones as needed

## 🔧 Configuration

### Tailwind CSS
The project uses Tailwind CSS v3.4.1. Configuration in `tailwind.config.js`:
```javascript
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

### TypeScript
Strict mode enabled in `tsconfig.json` for type safety.

### Vite
Hot Module Replacement (HMR) configured for fast development.

## 📱 Features in Detail

### GPS Tracking Service
```typescript
- getCurrentPosition() - Get current GPS with high accuracy
- startWatching() - Continuous position monitoring
- calculateDistance() - Haversine formula for distance
- validateLocation() - Check if within zone radius
- isAccuracyAcceptable() - Quality control for GPS readings
- Offline buffer - Stores last 100 readings for poor connectivity
```

### PDF Export Features
- Landscape A4 format for maximum data visibility
- AutoTable handles pagination automatically
- Summary box with comprehensive statistics
- Color-coded attendance rates:
  - Green: ≥90%
  - Yellow: 75-89%
  - Orange: 60-74%
  - Red: <60%
- Page numbering in footer
- Generated timestamp

### Excel Export Features
- Two worksheets: Records + Summary
- All fields included (GPS, notes, timestamps)
- Auto-sized columns for readability
- Professional formatting
- Summary metrics and metadata

## 🚧 Development Notes

### Known Issues
- RLS must be disabled for development (use DISABLE_RLS.sql)
- GPS requires HTTPS in production
- Browser geolocation permission required

### Future Enhancements
- [ ] Mobile app (React Native)
- [ ] Real-time notifications
- [ ] QR code check-in
- [ ] Face recognition integration
- [ ] Multi-language support
- [ ] Dark mode
- [ ] Attendance reminders via email/SMS
- [ ] Parent portal
- [ ] Integration with learning management systems

## 📄 License

MIT License - feel free to use for personal or commercial projects

## 🤝 Contributing

Contributions welcome! Please open issues and pull requests.

## 📞 Support

For issues or questions, please check:
1. Database schema is properly executed
2. RLS is disabled for development
3. Supabase credentials are correct
4. All npm packages are installed

## 🎉 Credits

Built with modern web technologies and best practices for enterprise-level attendance management.

---

**Version**: 1.0.0  
**Last Updated**: November 2025  
**Status**: Production Ready ✅
