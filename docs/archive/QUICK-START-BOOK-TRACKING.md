# 🚀 Quick Start - Book Tracking Feature

## 📋 Installation (2 minutes)

### 1️⃣ Run Migration
Open Supabase SQL Editor and execute:
```sql
ALTER TABLE session
ADD COLUMN IF NOT EXISTS book_topic TEXT,
ADD COLUMN IF NOT EXISTS book_start_page INTEGER,
ADD COLUMN IF NOT EXISTS book_end_page INTEGER;

ALTER TABLE session
ADD CONSTRAINT book_pages_valid 
CHECK (
  (book_start_page IS NULL AND book_end_page IS NULL) OR
  (book_start_page IS NOT NULL AND book_end_page IS NOT NULL AND book_end_page >= book_start_page)
);
```

### 2️⃣ Restart Server
```bash
npm run dev
```

### 3️⃣ Test It
1. Go to Sessions page
2. Create/edit a session
3. Fill book fields
4. Mark attendance
5. View in analytics ✅

---

## 💡 Quick Usage

### Adding Book Info
```
Sessions → Create/Edit → Scroll to "📚 Book Progress"
Topic: "Chapter 3: Functions"
Start: 45
End: 67
Save!
```

### Viewing Book Info
- **Attendance Page**: Shown at top automatically
- **Analytics**: "Book Progress" column
- **Reports**: Included in Excel & PDF

---

## 🎯 Examples

**Language Class:**
```
Topic: Unit 5: Past Tense
Pages: 78-92
```

**Math Class:**
```
Topic: Ch 12: Trigonometry  
Pages: 245-268
```

**Programming:**
```
Topic: OOP Basics
Pages: 120-145
```

---

## ✅ Features

- ✅ Optional (use it or don't)
- ✅ Auto page count
- ✅ Works in all views
- ✅ Included in exports
- ✅ Clean UI with 📚 emoji

---

## 📞 Need Help?

**Problem?** Check [BOOK-TRACKING-FEATURE-GUIDE.md](./BOOK-TRACKING-FEATURE-GUIDE.md)

**Questions?** Just ask! 😊

---

That's it! Start tracking your book progress now! 📚✨
