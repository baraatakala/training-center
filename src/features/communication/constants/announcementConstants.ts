import type { AnnouncementPriority, Announcement } from '@/features/communication/services/communicationService';

// Available reaction emojis
export const REACTION_EMOJIS = ['Ã°Å¸â€˜Â', 'Ã¢ÂÂ¤Ã¯Â¸Â', 'Ã°Å¸Å½â€°', 'Ã°Å¸ËœÂ®', 'Ã°Å¸â„¢Â', 'Ã°Å¸â€™Â¡'];

// Category configurations with icons and colors
export const CATEGORIES = {
  general: { icon: 'Ã°Å¸â€œâ€¹', label: 'General', color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' },
  homework: { icon: 'Ã°Å¸â€œÅ¡', label: 'Homework', color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
  exam: { icon: 'Ã°Å¸â€œÂ', label: 'Exam', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
  event: { icon: 'Ã°Å¸Å½Å ', label: 'Event', color: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
  reminder: { icon: 'Ã¢ÂÂ°', label: 'Reminder', color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' },
  urgent: { icon: 'Ã°Å¸Å¡Â¨', label: 'Urgent', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
  celebration: { icon: 'Ã°Å¸Å½â€°', label: 'Celebration', color: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
} as const;

export type CategoryType = keyof typeof CATEGORIES;

// Announcement Templates Ã¢â‚¬â€ pre-built for common scenarios
export const ANNOUNCEMENT_TEMPLATES = [
  {
    id: 'class_cancelled',
    icon: 'Ã°Å¸Å¡Â«',
    label: 'Class Cancelled',
    labelAr: 'Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡ Ã˜Â§Ã™â€žÃ˜Â­Ã˜ÂµÃ˜Â©',
    category: 'urgent' as CategoryType,
    priority: 'high' as AnnouncementPriority,
    title: 'Class Cancelled - [Date]',
    content: `Dear Students,

Please be informed that the class scheduled for [Date] has been cancelled due to [Reason].

Ã°Å¸â€œÅ’ Key Information:
Ã¢â‚¬Â¢ Original Date: [Date]
Ã¢â‚¬Â¢ Makeup Class: [TBD / Date]
Ã¢â‚¬Â¢ Affected Course: [Course Name]

Please check back for updates on the rescheduled session. If you have any questions, contact the administration.

Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¹Ã˜Â²Ã˜Â§Ã˜Â¡Ã˜Å’
Ã™â€ Ã™Ë†Ã˜Â¯ Ã˜Â¥Ã˜Â¨Ã™â€žÃ˜Â§Ã˜ÂºÃ™Æ’Ã™â€¦ Ã˜Â¨Ã˜Â£Ã™â€  Ã˜Â§Ã™â€žÃ˜Â­Ã˜ÂµÃ˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã™â€šÃ˜Â±Ã˜Â±Ã˜Â© Ã™ÂÃ™Å  [Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â®] Ã™â€šÃ˜Â¯ Ã˜ÂªÃ™â€¦ Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¤Ã™â€¡Ã˜Â§ Ã˜Â¨Ã˜Â³Ã˜Â¨Ã˜Â¨ [Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â¨Ã˜Â¨].
Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã™â€¦Ã˜ÂªÃ˜Â§Ã˜Â¨Ã˜Â¹Ã˜Â© Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â«Ã˜Â§Ã˜Âª Ã˜Â¨Ã˜Â®Ã˜ÂµÃ™Ë†Ã˜Âµ Ã˜Â§Ã™â€žÃ™â€¦Ã™Ë†Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â¨Ã˜Â¯Ã™Å Ã™â€ž.

Best regards / Ã™â€¦Ã˜Â¹ Ã˜Â£Ã˜Â·Ã™Å Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Å Ã˜Â§Ã˜Âª`,
  },
  {
    id: 'location_change',
    icon: 'Ã°Å¸â€œÂ',
    label: 'Location Change',
    labelAr: 'Ã˜ÂªÃ˜ÂºÃ™Å Ã™Å Ã˜Â± Ã˜Â§Ã™â€žÃ™â€¦Ã™Æ’Ã˜Â§Ã™â€ ',
    category: 'reminder' as CategoryType,
    priority: 'high' as AnnouncementPriority,
    title: 'Location Change - [Date]',
    content: `Dear Students,

The session on [Date] will be held at a DIFFERENT location:

Ã°Å¸â€œÂ New Location: [Address / Host Name]
Ã°Å¸â€¢Â Time: [Same / Updated Time]
Ã°Å¸â€œâ€¦ Date: [Date]

Ã¢Å¡Â Ã¯Â¸Â Please update your plans accordingly and arrive on time.

Previous Location: [Old Address]
Reason for Change: [Reason]

Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¹Ã˜Â²Ã˜Â§Ã˜Â¡Ã˜Å’
Ã˜Â³Ã™Å Ã˜ÂªÃ™â€¦ Ã˜Â¹Ã™â€šÃ˜Â¯ Ã˜Â¬Ã™â€žÃ˜Â³Ã˜Â© [Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â®] Ã™ÂÃ™Å  Ã™â€¦Ã™Ë†Ã™â€šÃ˜Â¹ Ã™â€¦Ã˜Â®Ã˜ÂªÃ™â€žÃ™Â:
Ã°Å¸â€œÂ Ã˜Â§Ã™â€žÃ™â€¦Ã™Ë†Ã™â€šÃ˜Â¹ Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â¯Ã™Å Ã˜Â¯: [Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€ Ã™Ë†Ã˜Â§Ã™â€ ]
Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜ÂªÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â« Ã˜Â®Ã˜Â·Ã˜Â·Ã™Æ’Ã™â€¦ Ã™Ë†Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã™ÂÃ™Å  Ã˜Â§Ã™â€žÃ™Ë†Ã™â€šÃ˜Âª Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â­Ã˜Â¯Ã˜Â¯.

Best regards / Ã™â€¦Ã˜Â¹ Ã˜Â£Ã˜Â·Ã™Å Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Å Ã˜Â§Ã˜Âª`,
  },
  {
    id: 'schedule_change',
    icon: 'Ã°Å¸â€œâ€¦',
    label: 'Schedule Change',
    labelAr: 'Ã˜ÂªÃ˜ÂºÃ™Å Ã™Å Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â¯Ã™Ë†Ã™â€ž',
    category: 'reminder' as CategoryType,
    priority: 'normal' as AnnouncementPriority,
    title: 'Schedule Update - Effective [Date]',
    content: `Dear Students,

We would like to inform you of the following schedule change:

Ã°Å¸â€œâ€¦ Previous Schedule: [Day] at [Time]
Ã°Å¸â€œâ€¦ New Schedule: [Day] at [Time]
Ã°Å¸â€œâ€¦ Effective From: [Date]

This change applies to: [Course Name / All Courses]

Please adjust your plans accordingly. If you have conflicts with the new schedule, please contact us immediately.

Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¹Ã˜Â²Ã˜Â§Ã˜Â¡Ã˜Å’
Ã™â€ Ã™Ë†Ã˜Â¯ Ã˜Â¥Ã˜Â¹Ã™â€žÃ˜Â§Ã™â€¦Ã™Æ’Ã™â€¦ Ã˜Â¨Ã˜ÂªÃ˜ÂºÃ™Å Ã™Å Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â¯Ã™Ë†Ã™â€ž Ã™Æ’Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å :
Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â¯Ã™Ë†Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â§Ã˜Â¨Ã™â€š: [Ã˜Â§Ã™â€žÃ™Å Ã™Ë†Ã™â€¦] Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â§Ã˜Â¹Ã˜Â© [Ã˜Â§Ã™â€žÃ™Ë†Ã™â€šÃ˜Âª]
Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â¯Ã™Ë†Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â¯Ã™Å Ã˜Â¯: [Ã˜Â§Ã™â€žÃ™Å Ã™Ë†Ã™â€¦] Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â§Ã˜Â¹Ã˜Â© [Ã˜Â§Ã™â€žÃ™Ë†Ã™â€šÃ˜Âª]
Ã™Å Ã˜Â¨Ã˜Â¯Ã˜Â£ Ã™â€¦Ã™â€ : [Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â®]

Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜Â§Ã™â€žÃ˜ÂªÃ™Ë†Ã˜Â§Ã˜ÂµÃ™â€ž Ã™â€¦Ã˜Â¹Ã™â€ Ã˜Â§ Ã™ÂÃ™Å  Ã˜Â­Ã˜Â§Ã™â€ž Ã™Ë†Ã˜Â¬Ã™Ë†Ã˜Â¯ Ã˜Â£Ã™Å  Ã˜ÂªÃ˜Â¹Ã˜Â§Ã˜Â±Ã˜Â¶.

Best regards / Ã™â€¦Ã˜Â¹ Ã˜Â£Ã˜Â·Ã™Å Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Å Ã˜Â§Ã˜Âª`,
  },
  {
    id: 'holiday_notice',
    icon: 'Ã°Å¸Ââ€“Ã¯Â¸Â',
    label: 'Holiday / Break Notice',
    labelAr: 'Ã˜Â¥Ã˜Â´Ã˜Â¹Ã˜Â§Ã˜Â± Ã˜Â¥Ã˜Â¬Ã˜Â§Ã˜Â²Ã˜Â©',
    category: 'general' as CategoryType,
    priority: 'normal' as AnnouncementPriority,
    title: 'Holiday Break Notice - [Holiday Name]',
    content: `Dear Students,

Please note that classes will be suspended during the upcoming holiday period:

Ã°Å¸â€”â€œ Holiday: [Holiday Name]
Ã°Å¸â€œâ€¦ Break Period: [Start Date] Ã¢â‚¬â€ [End Date]
Ã°Å¸â€œâ€¦ Classes Resume: [Resume Date]

During this period:
Ã¢â‚¬Â¢ No sessions will be held
Ã¢â‚¬Â¢ Homework/assignments are still due as scheduled
Ã¢â‚¬Â¢ For emergencies, contact [Phone/Email]

Wishing you a wonderful break! Ã°Å¸Å½â€°

Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¹Ã˜Â²Ã˜Â§Ã˜Â¡Ã˜Å’
Ã™â€ Ã™Ë†Ã˜Â¯ Ã˜Â¥Ã˜Â¹Ã™â€žÃ˜Â§Ã™â€¦Ã™Æ’Ã™â€¦ Ã˜Â¨Ã˜ÂªÃ˜Â¹Ã™â€žÃ™Å Ã™â€š Ã˜Â§Ã™â€žÃ˜Â¯Ã˜Â±Ã™Ë†Ã˜Â³ Ã˜Â®Ã™â€žÃ˜Â§Ã™â€ž Ã™ÂÃ˜ÂªÃ˜Â±Ã˜Â© Ã˜Â¥Ã˜Â¬Ã˜Â§Ã˜Â²Ã˜Â© [Ã˜Â§Ã˜Â³Ã™â€¦ Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â¬Ã˜Â§Ã˜Â²Ã˜Â©]:
Ã™â€¦Ã™â€  [Ã˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â® Ã˜Â§Ã™â€žÃ˜Â¨Ã˜Â¯Ã˜Â§Ã™Å Ã˜Â©] Ã˜Â¥Ã™â€žÃ™â€° [Ã˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â® Ã˜Â§Ã™â€žÃ™â€ Ã™â€¡Ã˜Â§Ã™Å Ã˜Â©]
Ã˜ÂªÃ˜Â³Ã˜ÂªÃ˜Â£Ã™â€ Ã™Â Ã˜Â§Ã™â€žÃ˜Â¯Ã˜Â±Ã™Ë†Ã˜Â³ Ã™ÂÃ™Å : [Ã˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â® Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â³Ã˜ÂªÃ˜Â¦Ã™â€ Ã˜Â§Ã™Â]

Ã™â€ Ã˜ÂªÃ™â€¦Ã™â€ Ã™â€° Ã™â€žÃ™Æ’Ã™â€¦ Ã˜Â¥Ã˜Â¬Ã˜Â§Ã˜Â²Ã˜Â© Ã˜Â³Ã˜Â¹Ã™Å Ã˜Â¯Ã˜Â©! Ã°Å¸Å½â€°

Best regards / Ã™â€¦Ã˜Â¹ Ã˜Â£Ã˜Â·Ã™Å Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Å Ã˜Â§Ã˜Âª`,
  },
  {
    id: 'exam_notice',
    icon: 'Ã°Å¸â€œÂ',
    label: 'Exam / Test Notice',
    labelAr: 'Ã˜Â¥Ã˜Â´Ã˜Â¹Ã˜Â§Ã˜Â± Ã˜Â§Ã˜Â®Ã˜ÂªÃ˜Â¨Ã˜Â§Ã˜Â±',
    category: 'exam' as CategoryType,
    priority: 'high' as AnnouncementPriority,
    title: 'Upcoming Exam - [Subject] - [Date]',
    content: `Dear Students,

An exam has been scheduled:

Ã°Å¸â€œÂ Subject: [Subject / Topic]
Ã°Å¸â€œâ€¦ Date: [Date]
Ã°Å¸â€¢Â Time: [Time]
Ã°Å¸â€œÂ Location: [Location]
Ã¢ÂÂ± Duration: [Duration] minutes

Ã°Å¸â€œÅ¡ Topics Covered:
Ã¢â‚¬Â¢ [Topic 1]
Ã¢â‚¬Â¢ [Topic 2]
Ã¢â‚¬Â¢ [Topic 3]

Ã°Å¸â€œâ€¹ Preparation Tips:
Ã¢â‚¬Â¢ Review chapters [X-Y] thoroughly
Ã¢â‚¬Â¢ Practice exercises from [Resource]
Ã¢â‚¬Â¢ Bring required materials: [Materials List]

Ã¢Å¡Â Ã¯Â¸Â Important: Students who are absent without a valid excuse will receive a zero.

Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¹Ã˜Â²Ã˜Â§Ã˜Â¡Ã˜Å’
Ã˜ÂªÃ™â€¦ Ã˜ÂªÃ˜Â­Ã˜Â¯Ã™Å Ã˜Â¯ Ã™â€¦Ã™Ë†Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã˜Â®Ã˜ÂªÃ˜Â¨Ã˜Â§Ã˜Â±:
Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â§Ã˜Â¯Ã˜Â©: [Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â§Ã˜Â¯Ã˜Â©]
Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â®: [Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â®]
Ã˜Â§Ã™â€žÃ™Ë†Ã™â€šÃ˜Âª: [Ã˜Â§Ã™â€žÃ™Ë†Ã™â€šÃ˜Âª]

Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â§Ã˜Â¬Ã˜Â¹Ã˜Â© Ã™Ë†Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã˜Â¶Ã™Å Ã˜Â± Ã˜Â¬Ã™Å Ã˜Â¯Ã˜Â§Ã™â€¹.

Good luck! / Ã˜Â¨Ã˜Â§Ã™â€žÃ˜ÂªÃ™Ë†Ã™ÂÃ™Å Ã™â€š! Ã°Å¸Ââ‚¬`,
  },
  {
    id: 'homework',
    icon: 'Ã°Å¸â€œÅ¡',
    label: 'Homework Assignment',
    labelAr: 'Ã™Ë†Ã˜Â§Ã˜Â¬Ã˜Â¨ Ã™â€¦Ã™â€ Ã˜Â²Ã™â€žÃ™Å ',
    category: 'homework' as CategoryType,
    priority: 'normal' as AnnouncementPriority,
    title: 'Homework: [Topic] - Due [Date]',
    content: `Dear Students,

A new homework assignment has been posted:

Ã°Å¸â€œÅ¡ Subject: [Subject]
Ã°Å¸â€œâ€“ Topic: [Topic / Chapter]
Ã°Å¸â€œâ€¦ Due Date: [Date]
Ã°Å¸â€œÂ Requirements: [Brief Description]

Instructions:
1. [Step 1]
2. [Step 2]
3. [Step 3]

Ã¢Å¡Â Ã¯Â¸Â Late submissions: [Policy]
Ã°Å¸â€œÂ§ Questions? Contact: [Teacher Email / Phone]

Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¹Ã˜Â²Ã˜Â§Ã˜Â¡Ã˜Å’
Ã˜ÂªÃ™â€¦ Ã™â€ Ã˜Â´Ã˜Â± Ã™Ë†Ã˜Â§Ã˜Â¬Ã˜Â¨ Ã™â€¦Ã™â€ Ã˜Â²Ã™â€žÃ™Å  Ã˜Â¬Ã˜Â¯Ã™Å Ã˜Â¯:
Ã˜Â§Ã™â€žÃ™â€¦Ã™Ë†Ã˜Â¶Ã™Ë†Ã˜Â¹: [Ã˜Â§Ã™â€žÃ™â€¦Ã™Ë†Ã˜Â¶Ã™Ë†Ã˜Â¹]
Ã™â€¦Ã™Ë†Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â³Ã™â€žÃ™Å Ã™â€¦: [Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â§Ã˜Â±Ã™Å Ã˜Â®]

Ã™Å Ã˜Â±Ã˜Â¬Ã™â€° Ã˜Â§Ã™â€žÃ˜Â§Ã™â€žÃ˜ÂªÃ˜Â²Ã˜Â§Ã™â€¦ Ã˜Â¨Ã˜Â§Ã™â€žÃ™â€¦Ã™Ë†Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã™â€žÃ™â€ Ã™â€¡Ã˜Â§Ã˜Â¦Ã™Å .

Best regards / Ã™â€¦Ã˜Â¹ Ã˜Â£Ã˜Â·Ã™Å Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Å Ã˜Â§Ã˜Âª`,
  },
  {
    id: 'welcome',
    icon: 'Ã°Å¸â€˜â€¹',
    label: 'Welcome New Students',
    labelAr: 'Ã˜ÂªÃ˜Â±Ã˜Â­Ã™Å Ã˜Â¨ Ã˜Â¨Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â¯Ã˜Â¯',
    category: 'celebration' as CategoryType,
    priority: 'normal' as AnnouncementPriority,
    title: 'Welcome to [Course Name]! Ã°Å¸Å½â€°',
    content: `Welcome to all new students! Ã°Å¸Å½â€°

We're thrilled to have you join us. Here's everything you need to know:

Ã°Å¸â€œâ€¦ Schedule: [Day(s)] at [Time]
Ã°Å¸â€œÂ Location: [Location]
Ã°Å¸â€˜Â¨Ã¢â‚¬ÂÃ°Å¸ÂÂ« Instructor: [Instructor Name]

Ã°Å¸â€œâ€¹ What to Bring:
Ã¢â‚¬Â¢ [Item 1]
Ã¢â‚¬Â¢ [Item 2]
Ã¢â‚¬Â¢ Notebook and pen

Ã°Å¸â€œÂ± Stay Connected:
Ã¢â‚¬Â¢ Download [App/Platform] for updates
Ã¢â‚¬Â¢ Check announcements regularly
Ã¢â‚¬Â¢ Contact: [Email / Phone]

We look forward to an amazing learning journey together!

Ã˜Â£Ã™â€¡Ã™â€žÃ˜Â§Ã™â€¹ Ã™Ë†Ã˜Â³Ã™â€¡Ã™â€žÃ˜Â§Ã™â€¹ Ã˜Â¨Ã˜Â¬Ã™â€¦Ã™Å Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â¯Ã˜Â¯! Ã°Å¸Å½â€°
Ã™â€ Ã˜Â­Ã™â€  Ã˜Â³Ã˜Â¹Ã˜Â¯Ã˜Â§Ã˜Â¡ Ã˜Â¨Ã˜Â§Ã™â€ Ã˜Â¶Ã™â€¦Ã˜Â§Ã™â€¦Ã™Æ’Ã™â€¦ Ã˜Â¥Ã™â€žÃ™Å Ã™â€ Ã˜Â§.
Ã™â€ Ã˜ÂªÃ˜Â·Ã™â€žÃ˜Â¹ Ã˜Â¥Ã™â€žÃ™â€° Ã˜Â±Ã˜Â­Ã™â€žÃ˜Â© Ã˜ÂªÃ˜Â¹Ã™â€žÃ™â€˜Ã™â€¦ Ã˜Â±Ã˜Â§Ã˜Â¦Ã˜Â¹Ã˜Â© Ã™â€¦Ã˜Â¹Ã˜Â§Ã™â€¹!

Best regards / Ã™â€¦Ã˜Â¹ Ã˜Â£Ã˜Â·Ã™Å Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Å Ã˜Â§Ã˜Âª`,
  },
  {
    id: 'achievement',
    icon: 'Ã°Å¸Ââ€ ',
    label: 'Student Achievement',
    labelAr: 'Ã˜Â¥Ã™â€ Ã˜Â¬Ã˜Â§Ã˜Â² Ã˜Â·Ã™â€žÃ˜Â§Ã˜Â¨Ã™Å ',
    category: 'celebration' as CategoryType,
    priority: 'normal' as AnnouncementPriority,
    title: 'Ã°Å¸Ââ€  Congratulations to Our Outstanding Students!',
    content: `Ã°Å¸Å½Å  Student Achievement Recognition Ã°Å¸Å½Å 

We are proud to recognize the following students for their outstanding performance:

Ã°Å¸Â¥â€¡ [Student Name] Ã¢â‚¬â€ [Achievement]
Ã°Å¸Â¥Ë† [Student Name] Ã¢â‚¬â€ [Achievement]
Ã°Å¸Â¥â€° [Student Name] Ã¢â‚¬â€ [Achievement]

Ã°Å¸â€œÅ  This Period's Highlights:
Ã¢â‚¬Â¢ Average Class Attendance: [X]%
Ã¢â‚¬Â¢ Top Performer Score: [X]
Ã¢â‚¬Â¢ Most Improved: [Student Name]

Keep up the excellent work! Your dedication inspires everyone.

Ã™â€ Ã™ÂÃ˜Â®Ã˜Â± Ã˜Â¨Ã˜ÂªÃ™Æ’Ã˜Â±Ã™Å Ã™â€¦ Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ™â€¦Ã˜ÂªÃ™â€¦Ã™Å Ã˜Â²Ã™Å Ã™â€  Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å Ã˜Â© Ã˜Â£Ã˜Â³Ã™â€¦Ã˜Â§Ã˜Â¤Ã™â€¡Ã™â€¦:
[Ã˜Â£Ã˜Â³Ã™â€¦Ã˜Â§Ã˜Â¡ Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨]

Ã˜Â§Ã˜Â³Ã˜ÂªÃ™â€¦Ã˜Â±Ã™Ë†Ã˜Â§ Ã™ÂÃ™Å  Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€¦Ã™Å Ã˜Â²! Ã°Å¸Å’Å¸

Best regards / Ã™â€¦Ã˜Â¹ Ã˜Â£Ã˜Â·Ã™Å Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Å Ã˜Â§Ã˜Âª`,
  },
  {
    id: 'event',
    icon: 'Ã°Å¸Å½Å ',
    label: 'Special Event',
    labelAr: 'Ã™ÂÃ˜Â¹Ã˜Â§Ã™â€žÃ™Å Ã˜Â© Ã˜Â®Ã˜Â§Ã˜ÂµÃ˜Â©',
    category: 'event' as CategoryType,
    priority: 'normal' as AnnouncementPriority,
    title: 'Ã°Å¸Å½Å  [Event Name] - [Date]',
    content: `Dear Students,

You're invited to an upcoming special event!

Ã°Å¸Å½Å  Event: [Event Name]
Ã°Å¸â€œâ€¦ Date: [Date]
Ã°Å¸â€¢Â Time: [Start Time] - [End Time]
Ã°Å¸â€œÂ Location: [Location]

Ã°Å¸â€œâ€¹ Event Details:
[Brief description of the event]

Ã°Å¸Å½Â¯ Agenda:
Ã¢â‚¬Â¢ [Activity 1]
Ã¢â‚¬Â¢ [Activity 2]
Ã¢â‚¬Â¢ [Activity 3]

Ã¢Å¡Â Ã¯Â¸Â Registration: [Required / Optional]
Ã°Å¸â€œÂ§ RSVP by: [Date]

Don't miss it! / Ã™â€žÃ˜Â§ Ã˜ÂªÃ™ÂÃ™Ë†Ã˜ÂªÃ™Ë†Ã™â€¡Ã˜Â§! Ã°Å¸Å½â€°

Best regards / Ã™â€¦Ã˜Â¹ Ã˜Â£Ã˜Â·Ã™Å Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Å Ã˜Â§Ã˜Âª`,
  },
] as const;


// Extended Announcement type with reactions and comments
export interface ExtendedAnnouncement extends Announcement {
  reactions?: { emoji: string; count: number; hasReacted: boolean; reactors?: { id: string; name: string }[] }[];
  commentCount?: number;
}
