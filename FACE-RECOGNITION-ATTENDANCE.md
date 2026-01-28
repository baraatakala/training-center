# Face Recognition Attendance System

## Overview
Students can check in to sessions by verifying their face against their profile photo. This uses **face-api.js** for browser-based face recognition - no cloud services needed!

## Features

### 1. Photo Upload (Student Profile)
- Students upload or capture a reference photo
- Photo stored in Supabase Storage (`student-photos` bucket)
- URL saved in `student.photo_url` field

### 2. Face Check-In Page
- **Route**: `/photo-checkin/:token`
- Students open camera and take live photo
- AI compares live photo with reference photo
- If match > 40% confidence → attendance recorded
- GPS location captured for verification

### 3. Teacher Side (Attendance Page)
- **Face Check-In Button**: Purple button next to QR button
- Opens modal with shareable link
- Live attendance counter
- 2-hour expiration timer

## How It Works

### Teacher Workflow:
1. Go to Attendance page for a session
2. Select the date
3. Click **"📸 Face Check-In"** button
4. Share the link with students (copy/share button)
5. Watch live counter as students check in

### Student Workflow:
1. Open the shared link
2. Log in if needed
3. Click "Open Camera"
4. Position face in camera
5. Click "Capture"
6. AI verifies face (1-3 seconds)
7. If matched, click "Confirm Check-In"
8. Done! GPS captured automatically

## Technical Details

### Face Recognition Library
- **face-api.js**: TensorFlow.js-based face recognition
- Runs entirely in browser (no cloud costs)
- Models loaded from `/public/models/`
- ~12MB total model files

### Models Used:
1. **SSD MobileNet v1**: Face detection
2. **Face Landmark 68**: Face landmark detection
3. **Face Recognition**: Face descriptor extraction

### Match Threshold:
- Distance < 0.6 = Match (~40%+ confidence)
- Distance calculated using Euclidean distance between face descriptors

## Database Schema

### Student Table (Updated)
```sql
ALTER TABLE student 
ADD COLUMN photo_url TEXT DEFAULT NULL;
```

### Photo Check-In Sessions Table (New)
```sql
CREATE TABLE photo_checkin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES session(session_id),
  attendance_date DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_valid BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Supabase Storage Bucket
- **Bucket name**: `student-photos`
- **Public**: No (authenticated access)
- **Max file size**: 5MB
- **Allowed types**: image/jpeg, image/png, image/webp

## Files Created/Modified

### New Files:
- `src/components/PhotoUpload.tsx` - Photo upload/capture component
- `src/components/PhotoCheckInModal.tsx` - Teacher modal for sharing link
- `src/pages/PhotoCheckIn.tsx` - Student face check-in page
- `public/models/*` - Face-api.js model files
- `ADD-PHOTO-URL-TO-STUDENT.sql` - Database migration
- `ADD-PHOTO-CHECKIN-SESSIONS-TABLE.sql` - Database migration

### Modified Files:
- `src/App.tsx` - Added `/photo-checkin/:token` route
- `src/pages/Attendance.tsx` - Added Face Check-In button
- `src/types/database.types.ts` - Added `photo_url` to Student type
- `src/components/StudentForm.tsx` - Added `photo_url` field

## Setup Instructions

### 1. Run Database Migrations
Execute these SQL files in Supabase SQL Editor:
```sql
-- Run ADD-PHOTO-URL-TO-STUDENT.sql first
-- Then run ADD-PHOTO-CHECKIN-SESSIONS-TABLE.sql
```

### 2. Create Storage Bucket
In Supabase Dashboard > Storage:
1. Create bucket: `student-photos`
2. Set to private (not public)
3. Set max file size: 5MB

### 3. Storage Policies
Add these RLS policies for the `student-photos` bucket:
- INSERT: Authenticated users can upload
- SELECT: Authenticated users can view
- UPDATE: Users can update own photos
- DELETE: Users can delete own photos

## Security Features

1. **Token-based URLs**: 2-hour expiration
2. **Authentication Required**: Must be logged in
3. **Enrollment Check**: Only enrolled students
4. **Face Verification**: Must match reference photo
5. **GPS Capture**: Location recorded for audit
6. **Audit Trail**: `marked_by` includes face match confidence

## Troubleshooting

### Face not detected in reference photo
- Ensure photo has clear, front-facing view
- Good lighting required
- Face should fill most of the frame

### Face not detected in live capture
- Allow camera permissions
- Position face within guide circle
- Ensure good lighting

### Models not loading
- Check `/models/` folder exists in public
- Verify all 8 model files present
- Clear browser cache and reload

### Low confidence match
- Take clearer reference photo
- Face camera directly
- Remove glasses/hats if possible

## Performance

- **Model Loading**: ~2-5 seconds (cached after first load)
- **Face Detection**: ~100-500ms
- **Face Comparison**: ~100-300ms
- **Total Verification**: 1-3 seconds

## Future Enhancements

- [ ] Anti-spoofing (prevent photo of photo)
- [ ] Multiple reference photos per student
- [ ] Admin panel to view match scores
- [ ] Offline mode with cached models
- [ ] Face detection preview while capturing

---

**Implementation Date**: January 2026
**Version**: 1.0.0
**Status**: Ready for Testing ✅
