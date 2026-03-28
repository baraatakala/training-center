import type { AnnouncementPriority, Announcement } from '@/features/communication/services/communicationService';

// Available reaction emojis
export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😮', '🙏', '💡'];

// Category configurations with icons and colors
export const CATEGORIES = {
  general: { icon: '📋', label: 'General', color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' },
  homework: { icon: '📚', label: 'Homework', color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
  exam: { icon: '📝', label: 'Exam', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
  event: { icon: '🎊', label: 'Event', color: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
  reminder: { icon: '⏰', label: 'Reminder', color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' },
  urgent: { icon: '🚨', label: 'Urgent', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
  celebration: { icon: '🎉', label: 'Celebration', color: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
} as const;

export type CategoryType = keyof typeof CATEGORIES;

// Announcement Templates — pre-built for common scenarios
export const ANNOUNCEMENT_TEMPLATES = [
  {
    id: 'class_cancelled',
    icon: '🚫',
    label: 'Class Cancelled',
    labelAr: 'إلغاء الحصة',
    category: 'urgent' as CategoryType,
    priority: 'high' as AnnouncementPriority,
    title: 'Class Cancelled - [Date]',
    content: `Dear Students,

Please be informed that the class scheduled for [Date] has been cancelled due to [Reason].

📌 Key Information:
• Original Date: [Date]
• Makeup Class: [TBD / Date]
• Affected Course: [Course Name]

Please check back for updates on the rescheduled session. If you have any questions, contact the administration.

الطلاب الأعزاء،
نود إبلاغكم بأن الحصة المقررة في [التاريخ] قد تم إلغاؤها بسبب [السبب].
يرجى متابعة التحديثات بخصوص الموعد البديل.

Best regards / مع أطيب التحيات`,
  },
  {
    id: 'location_change',
    icon: '📍',
    label: 'Location Change',
    labelAr: 'تغيير المكان',
    category: 'reminder' as CategoryType,
    priority: 'high' as AnnouncementPriority,
    title: 'Location Change - [Date]',
    content: `Dear Students,

The session on [Date] will be held at a DIFFERENT location:

📍 New Location: [Address / Host Name]
🕐 Time: [Same / Updated Time]
📅 Date: [Date]

⚠️ Please update your plans accordingly and arrive on time.

Previous Location: [Old Address]
Reason for Change: [Reason]

الطلاب الأعزاء،
سيتم عقد جلسة [التاريخ] في موقع مختلف:
📍 الموقع الجديد: [العنوان]
يرجى تحديث خططكم والحضور في الوقت المحدد.

Best regards / مع أطيب التحيات`,
  },
  {
    id: 'schedule_change',
    icon: '📅',
    label: 'Schedule Change',
    labelAr: 'تغيير الجدول',
    category: 'reminder' as CategoryType,
    priority: 'normal' as AnnouncementPriority,
    title: 'Schedule Update - Effective [Date]',
    content: `Dear Students,

We would like to inform you of the following schedule change:

📅 Previous Schedule: [Day] at [Time]
📅 New Schedule: [Day] at [Time]
📅 Effective From: [Date]

This change applies to: [Course Name / All Courses]

Please adjust your plans accordingly. If you have conflicts with the new schedule, please contact us immediately.

الطلاب الأعزاء،
نود إعلامكم بتغيير الجدول كالتالي:
الجدول السابق: [اليوم] الساعة [الوقت]
الجدول الجديد: [اليوم] الساعة [الوقت]
يبدأ من: [التاريخ]

يرجى التواصل معنا في حال وجود أي تعارض.

Best regards / مع أطيب التحيات`,
  },
  {
    id: 'holiday_notice',
    icon: '🏖️',
    label: 'Holiday / Break Notice',
    labelAr: 'إشعار إجازة',
    category: 'general' as CategoryType,
    priority: 'normal' as AnnouncementPriority,
    title: 'Holiday Break Notice - [Holiday Name]',
    content: `Dear Students,

Please note that classes will be suspended during the upcoming holiday period:

🗓 Holiday: [Holiday Name]
📅 Break Period: [Start Date] — [End Date]
📅 Classes Resume: [Resume Date]

During this period:
• No sessions will be held
• Homework/assignments are still due as scheduled
• For emergencies, contact [Phone/Email]

Wishing you a wonderful break! 🎉

الطلاب الأعزاء،
نود إعلامكم بتعليق الدروس خلال فترة إجازة [اسم الإجازة]:
من [تاريخ البداية] إلى [تاريخ النهاية]
تستأنف الدروس في: [تاريخ الاستئناف]

نتمنى لكم إجازة سعيدة! 🎉

Best regards / مع أطيب التحيات`,
  },
  {
    id: 'exam_notice',
    icon: '📝',
    label: 'Exam / Test Notice',
    labelAr: 'إشعار اختبار',
    category: 'exam' as CategoryType,
    priority: 'high' as AnnouncementPriority,
    title: 'Upcoming Exam - [Subject] - [Date]',
    content: `Dear Students,

An exam has been scheduled:

📝 Subject: [Subject / Topic]
📅 Date: [Date]
🕐 Time: [Time]
📍 Location: [Location]
⏱ Duration: [Duration] minutes

📚 Topics Covered:
• [Topic 1]
• [Topic 2]
• [Topic 3]

📋 Preparation Tips:
• Review chapters [X-Y] thoroughly
• Practice exercises from [Resource]
• Bring required materials: [Materials List]

⚠️ Important: Students who are absent without a valid excuse will receive a zero.

الطلاب الأعزاء،
تم تحديد موعد اختبار:
المادة: [المادة]
التاريخ: [التاريخ]
الوقت: [الوقت]

يرجى المراجعة والتحضير جيداً.

Good luck! / بالتوفيق! 🍀`,
  },
  {
    id: 'homework',
    icon: '📚',
    label: 'Homework Assignment',
    labelAr: 'واجب منزلي',
    category: 'homework' as CategoryType,
    priority: 'normal' as AnnouncementPriority,
    title: 'Homework: [Topic] - Due [Date]',
    content: `Dear Students,

A new homework assignment has been posted:

📚 Subject: [Subject]
📖 Topic: [Topic / Chapter]
📅 Due Date: [Date]
📝 Requirements: [Brief Description]

Instructions:
1. [Step 1]
2. [Step 2]
3. [Step 3]

⚠️ Late submissions: [Policy]
📧 Questions? Contact: [Teacher Email / Phone]

الطلاب الأعزاء،
تم نشر واجب منزلي جديد:
الموضوع: [الموضوع]
موعد التسليم: [التاريخ]

يرجى الالتزام بالموعد النهائي.

Best regards / مع أطيب التحيات`,
  },
  {
    id: 'welcome',
    icon: '👋',
    label: 'Welcome New Students',
    labelAr: 'ترحيب بالطلاب الجدد',
    category: 'celebration' as CategoryType,
    priority: 'normal' as AnnouncementPriority,
    title: 'Welcome to [Course Name]! 🎉',
    content: `Welcome to all new students! 🎉

We're thrilled to have you join us. Here's everything you need to know:

📅 Schedule: [Day(s)] at [Time]
📍 Location: [Location]
👨‍🏫 Instructor: [Instructor Name]

📋 What to Bring:
• [Item 1]
• [Item 2]
• Notebook and pen

📱 Stay Connected:
• Download [App/Platform] for updates
• Check announcements regularly
• Contact: [Email / Phone]

We look forward to an amazing learning journey together!

أهلاً وسهلاً بجميع الطلاب الجدد! 🎉
نحن سعداء بانضمامكم إلينا.
نتطلع إلى رحلة تعلّم رائعة معاً!

Best regards / مع أطيب التحيات`,
  },
  {
    id: 'achievement',
    icon: '🏆',
    label: 'Student Achievement',
    labelAr: 'إنجاز طلابي',
    category: 'celebration' as CategoryType,
    priority: 'normal' as AnnouncementPriority,
    title: '🏆 Congratulations to Our Outstanding Students!',
    content: `🎊 Student Achievement Recognition 🎊

We are proud to recognize the following students for their outstanding performance:

🥇 [Student Name] — [Achievement]
🥈 [Student Name] — [Achievement]
🥉 [Student Name] — [Achievement]

📊 This Period's Highlights:
• Average Class Attendance: [X]%
• Top Performer Score: [X]
• Most Improved: [Student Name]

Keep up the excellent work! Your dedication inspires everyone.

نفخر بتكريم الطلاب المتميزين التالية أسماؤهم:
[أسماء الطلاب]

استمروا في التميز! 🌟

Best regards / مع أطيب التحيات`,
  },
  {
    id: 'event',
    icon: '🎊',
    label: 'Special Event',
    labelAr: 'فعالية خاصة',
    category: 'event' as CategoryType,
    priority: 'normal' as AnnouncementPriority,
    title: '🎊 [Event Name] - [Date]',
    content: `Dear Students,

You're invited to an upcoming special event!

🎊 Event: [Event Name]
📅 Date: [Date]
🕐 Time: [Start Time] - [End Time]
📍 Location: [Location]

📋 Event Details:
[Brief description of the event]

🎯 Agenda:
• [Activity 1]
• [Activity 2]
• [Activity 3]

⚠️ Registration: [Required / Optional]
📧 RSVP by: [Date]

Don't miss it! / لا تفوتوها! 🎉

Best regards / مع أطيب التحيات`,
  },
] as const;


// Extended Announcement type with reactions and comments
export interface ExtendedAnnouncement extends Announcement {
  reactions?: { emoji: string; count: number; hasReacted: boolean; reactors?: { id: string; name: string }[] }[];
  commentCount?: number;
}
