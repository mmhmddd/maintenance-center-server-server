import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import JoinRequest from '../models/JoinRequest.js';
import Notification from '../models/Notification.js';
import LowLectureReport from '../models/LowLectureReport.js'; // New model
import validator from 'validator';
import mongoose from 'mongoose';
import cron from 'node-cron';

const router = express.Router();

// Middleware to verify JWT token
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    console.error('لم يتم توفير رمز التوثيق');
    return res.status(401).json({ message: 'الوصول مرفوض، يرجى تسجيل الدخول' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    console.log('تم التحقق من التوكن:', { userId: req.userId, role: req.userRole });
    next();
  } catch (error) {
    console.error('خطأ في التحقق من الرمز:', error.message);
    res.status(401).json({ message: 'رمز غير صالح' });
  }
};

// Admin middleware
const adminMiddleware = (req, res, next) => {
  if (req.userRole !== 'admin') {
    console.error('محاولة وصول غير مصرح بها:', req.userId);
    return res.status(403).json({ message: 'يجب أن تكون مسؤولاً للوصول إلى هذا الطريق' });
  }
  next();
};

// Add a lecture
router.post('/', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { link, name, subject, studentEmail } = req.body;

    // Validate input
    if (!link || !name || !subject || !studentEmail) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'رابط المحاضرة، الاسم، المادة، وبريد الطالب مطلوبة' });
    }
    if (!validator.isURL(link)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'رابط المحاضرة غير صالح' });
    }
    if (!validator.isLength(name, { min: 1, max: 100 })) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'اسم المحاضرة يجب أن يكون بين 1 و100 حرف' });
    }
    if (!validator.isLength(subject, { min: 1, max: 100 })) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'اسم المادة يجب أن يكون بين 1 و100 حرف' });
    }
    if (!validator.isEmail(studentEmail)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'بريد الطالب غير صالح' });
    }

    const normalizedStudentEmail = studentEmail.toLowerCase().trim();
    const user = await User.findById(req.userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      console.error('المستخدم غير موجود:', req.userId);
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    // Log student validation
    console.log('التحقق من وجود الطالب:', {
      userId: req.userId,
      studentEmail: normalizedStudentEmail,
      students: user.students.map(s => s.email)
    });

    // Check if student exists (case-insensitive)
    if (!Array.isArray(user.students) || !user.students.some(s => s.email.toLowerCase() === normalizedStudentEmail)) {
      await session.abortTransaction();
      session.endSession();
      console.error('الطالب غير موجود في قائمة الطلاب:', normalizedStudentEmail);
      return res.status(400).json({ message: 'الطالب غير موجود' });
    }

    const joinRequest = await JoinRequest.findOne({ email: user.email.toLowerCase().trim() }).session(session);
    if (!joinRequest) {
      await session.abortTransaction();
      session.endSession();
      console.error('طلب الانضمام غير موجود للمستخدم:', user.email);
      return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    }

    // Initialize lectures array if undefined
    if (!Array.isArray(user.lectures)) user.lectures = [];

    // Create lecture
    const lecture = { 
      link, 
      name, 
      subject, 
      studentEmail: normalizedStudentEmail, 
      createdAt: new Date() 
    };
    user.lectures.push(lecture);
    user.lectureCount = (user.lectureCount || 0) + 1;
    joinRequest.volunteerHours = (joinRequest.volunteerHours || 0) + 2;

    // Delete related low lecture count notifications
    await Notification.deleteMany(
      {
        userId: req.userId,
        type: 'low_lecture_count_per_subject',
        'lectureDetails.subject': subject,
        'lectureDetails.studentEmail': normalizedStudentEmail
      },
      { session }
    );

    // Create notification
    const notification = new Notification({
      userId: req.userId,
      message: `تمت إضافة محاضرة جديدة بواسطة ${user.email}: ${name} (${subject}) - ${link}`,
      type: 'lecture_added',
      lectureDetails: { link, name, subject, studentEmail: normalizedStudentEmail }
    });
    await notification.save({ session });

    // Save changes
    await Promise.all([user.save({ session }), joinRequest.save({ session })]);

    await session.commitTransaction();
    session.endSession();

    console.log('تم إضافة المحاضرة بنجاح:', {
      userId: req.userId,
      link,
      name,
      subject,
      studentEmail: normalizedStudentEmail,
      lectureCount: user.lectureCount,
      volunteerHours: joinRequest.volunteerHours
    });

    res.json({
      success: true,
      message: 'تم إضافة المحاضرة بنجاح',
      lecture,
      lectureCount: user.lectureCount,
      volunteerHours: joinRequest.volunteerHours
    });
  } catch (error) {
    console.error('خطأ في إضافة المحاضرة:', error.message);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ success: false, message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete a lecture
router.delete('/:lectureId', authMiddleware, adminMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const lectureId = req.params.lectureId;
    if (!mongoose.Types.ObjectId.isValid(lectureId)) {
      await session.abortTransaction();
      session.endSession();
      console.error('معرف المحاضرة غير صالح:', lectureId);
      return res.status(400).json({ 
        success: false, 
        message: 'معرف المحاضرة غير صالح' 
      });
    }

    const user = await User.findOne({ 'lectures._id': lectureId }).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      console.error('المحاضرة غير موجودة:', lectureId);
      return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    }

    const lecture = user.lectures.id(lectureId);
    if (!lecture) {
      await session.abortTransaction();
      session.endSession();
      console.error('المحاضرة غير موجودة:', lectureId);
      return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    }

    const joinRequest = await JoinRequest.findOne({ email: user.email.toLowerCase().trim() }).session(session);
    if (!joinRequest) {
      await session.abortTransaction();
      session.endSession();
      console.error('طلب الانضمام غير موجود للمستخدم:', user.email);
      return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    }

    user.lectures.pull(lectureId);
    user.lectureCount = Math.max(0, (user.lectureCount || 1) - 1);
    joinRequest.volunteerHours = Math.max(0, (joinRequest.volunteerHours || 2) - 2);

    await Promise.all([user.save({ session }), joinRequest.save({ session })]);

    await session.commitTransaction();
    session.endSession();

    console.log('تم حذف المحاضرة بنجاح:', { lectureId, userId: user._id, lectureCount: user.lectureCount });
    res.json({ 
      success: true, 
      message: 'تم حذف المحاضرة بنجاح', 
      lectureCount: user.lectureCount,
      volunteerHours: joinRequest.volunteerHours
    });
  } catch (error) {
    console.error('خطأ في حذف المحاضرة:', error.message);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ success: false, message: 'خطأ في الخادم', error: error.message });
  }
});

// Get notifications
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.userId })
      .populate('userId', 'email')
      .sort({ createdAt: -1 });

    console.log('تم جلب الإشعارات للمستخدم:', { userId: req.userId, count: notifications.length });

    res.json({
      success: true,
      message: 'تم جلب الإشعارات بنجاح',
      notifications: notifications.map(notification => ({
        _id: notification._id.toString(),
        userId: {
          _id: notification.userId._id.toString(),
          email: notification.userId.email
        },
        message: notification.message,
        type: notification.type,
        createdAt: notification.createdAt.toISOString(),
        read: notification.read,
        lectureDetails: notification.lectureDetails
      }))
    });
  } catch (error) {
    console.error('خطأ في جلب الإشعارات:', error.message);
    res.status(500).json({
      success: false,
      message: 'خطأ في جلب الإشعارات',
      error: error.message
    });
  }
});

// Mark notifications as read
router.post('/notifications/mark-read', authMiddleware, async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.userId, read: false },
      { $set: { read: true } }
    );

    const notifications = await Notification.find({ userId: req.userId })
      .populate('userId', 'email')
      .sort({ createdAt: -1 });

    console.log('تم تحديد الإشعارات كمقروءة:', { userId: req.userId, modifiedCount: result.modifiedCount });

    res.json({
      success: true,
      message: 'تم تحديد الإشعارات كمقروءة',
      notifications: notifications.map(notification => ({
        _id: notification._id.toString(),
        userId: {
          _id: notification.userId._id.toString(),
          email: notification.userId.email
        },
        message: notification.message,
        type: notification.type,
        createdAt: notification.createdAt.toISOString(),
        read: notification.read,
        lectureDetails: notification.lectureDetails
      }))
    });
  } catch (error) {
    console.error('خطأ في تحديد الإشعارات كمقروءة:', error.message);
    res.status(500).json({
      success: false,
      message: 'خطأ في تحديد الإشعارات كمقروءة',
      error: error.message
    });
  }
});

// Delete a specific notification
router.delete('/notifications/:id', authMiddleware, async (req, res) => {
  try {
    const notificationId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      console.error('معرف الإشعار غير صالح:', notificationId);
      return res.status(400).json({ success: false, message: 'معرف الإشعار غير صالح' });
    }

    const notification = await Notification.findOne({ _id: notificationId, userId: req.userId });
    if (!notification) {
      console.error('الإشعار غير موجود أو لا ينتمي إلى المستخدم:', { notificationId, userId: req.userId });
      return res.status(404).json({ success: false, message: 'الإشعار غير موجود أو لا ينتمي إلى المستخدم' });
    }

    await Notification.deleteOne({ _id: notificationId });

    console.log('تم حذف الإشعار بنجاح:', { notificationId, userId: req.userId });

    res.json({ success: true, message: 'تم حذف الإشعار بنجاح' });
  } catch (error) {
    console.error('خطأ في حذف الإشعار:', error.message);
    res.status(500).json({
      success: false,
      message: 'خطأ في الخادم',
      error: error.message
    });
  }
});

// Function to check low lecture members
async function checkLowLectureMembers(isCronJob = false) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const users = await User.find({ role: 'user' }).session(session);
    console.log('📊 Found users with role "user":', users.length);
    
    const lowLectureMembers = [];
    
    // Calculate the previous week: Saturday to Friday
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    let daysToPreviousSaturday = (dayOfWeek + 1) % 7;
    if (daysToPreviousSaturday === 0) daysToPreviousSaturday = 7;

    const previousSaturday = new Date(now);
    previousSaturday.setDate(now.getDate() - daysToPreviousSaturday);
    
    const weekStart = new Date(previousSaturday);
    weekStart.setDate(previousSaturday.getDate() - 7); // Previous Saturday
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(previousSaturday);
    weekEnd.setDate(previousSaturday.getDate() - 1); // Previous Friday
    weekEnd.setHours(23, 59, 59, 999);

    console.log('📅 Checking lectures from:', weekStart.toISOString(), 'to', weekEnd.toISOString());

    for (const user of users) {
      console.log('👤 Processing user:', { userId: user._id, email: user.email });

      // Check if user has approved join request
      const joinRequest = await JoinRequest.findOne({ email: user.email.toLowerCase().trim() }).session(session);
      if (!joinRequest || joinRequest.status !== 'Approved') {
        console.log('⏩ Skipping user - No approved join request:', { userId: user._id, email: user.email });
        continue;
      }

      // Ensure students array exists and is valid
      if (!Array.isArray(user.students) || user.students.length === 0) {
        console.log('⏩ Skipping user - No students:', { userId: user._id, email: user.email });
        // Reset counter if no students
        if (isCronJob && user.lowLectureWeekCount > 0) {
          user.lowLectureWeekCount = 0;
          user.lastLowLectureWeek = null;
          await user.save({ session });
        }
        continue;
      }

      console.log('👥 User has students:', user.students.length);
      const userUnderTargetStudents = [];

      // Process each student
      for (let studentIndex = 0; studentIndex < user.students.length; studentIndex++) {
        const student = user.students[studentIndex];
        console.log(`🎓 Processing student ${studentIndex + 1}/${user.students.length}:`, {
          studentEmail: student.email,
          studentName: student.name,
          hasSubjects: Array.isArray(student.subjects)
        });

        // Ensure subjects array exists
        if (!Array.isArray(student.subjects) || student.subjects.length === 0) {
          console.log('⚠️ Student has no subjects:', { studentEmail: student.email });
          continue;
        }

        const studentUnderTargetSubjects = [];

        // Process each subject for this student
        for (let subjectIndex = 0; subjectIndex < student.subjects.length; subjectIndex++) {
          const subject = student.subjects[subjectIndex];
          console.log(`📚 Processing subject ${subjectIndex + 1}/${student.subjects.length}:`, {
            subjectName: subject.name,
            minLectures: subject.minLectures,
            studentEmail: student.email
          });

          // Ensure lectures array exists
          if (!Array.isArray(user.lectures)) {
            user.lectures = [];
          }

          // Count lectures for this student and subject in the last week
          const lectureCount = user.lectures.filter(lecture => {
            const matchesTimeFrame = lecture.createdAt >= weekStart && lecture.createdAt <= weekEnd;
            const matchesStudent = lecture.studentEmail && 
              lecture.studentEmail.toLowerCase().trim() === student.email.toLowerCase().trim();
            const matchesSubject = lecture.subject === subject.name;
            
            const matches = matchesTimeFrame && matchesStudent && matchesSubject;
            
            if (matches) {
              console.log('✅ Matching lecture found:', {
                lectureId: lecture._id,
                lectureName: lecture.name,
                lectureSubject: lecture.subject,
                lectureStudentEmail: lecture.studentEmail,
                lectureDate: lecture.createdAt
              });
            }
            
            return matches;
          }).length;

          console.log(`📊 Lecture count for ${student.name} in ${subject.name}:`, {
            delivered: lectureCount,
            required: subject.minLectures,
            isUnderTarget: lectureCount < subject.minLectures
          });

          // If lectures are below minimum requirement
          if (lectureCount < subject.minLectures) {
            studentUnderTargetSubjects.push({
              name: subject.name,
              minLectures: subject.minLectures,
              deliveredLectures: lectureCount
            });

            // Create notification if it doesn't exist (only in cron job)
            if (isCronJob) {
              const notificationExists = await Notification.findOne({
                userId: user._id,
                type: 'low_lecture_count_per_subject',
                'lectureDetails.subject': subject.name,
                'lectureDetails.studentEmail': student.email.toLowerCase().trim()
              }).session(session);

              if (!notificationExists) {
                console.log('🔔 Creating notification for low lecture count:', {
                  userId: user._id,
                  studentEmail: student.email,
                  subject: subject.name,
                  delivered: lectureCount,
                  required: subject.minLectures
                });
                
                const notification = new Notification({
                  userId: user._id,
                  message: `عدد المحاضرات الأسبوعية للطالب ${student.name} في مادة ${subject.name} أقل من الحد الأدنى (${lectureCount}/${subject.minLectures})`,
                  type: 'low_lecture_count_per_subject',
                  lectureDetails: {
                    studentEmail: student.email.toLowerCase().trim(),
                    subject: subject.name,
                    minLectures: subject.minLectures,
                    currentLectures: lectureCount
                  }
                });
                await notification.save({ session });
              }
            }
          }
        }

        // If this student has subjects under target, add to user's under-target students
        if (studentUnderTargetSubjects.length > 0) {
          console.log(`Student ${student.name} has ${studentUnderTargetSubjects.length} subjects under target`);
          
          userUnderTargetStudents.push({
            studentName: student.name || 'اسم غير متوفر',
            studentEmail: student.email.toLowerCase().trim(),
            academicLevel: student.academicLevel || 'غير محدد',
            underTargetSubjects: studentUnderTargetSubjects
          });
        }
      }

      // If this user has students with under-target subjects
      if (userUnderTargetStudents.length > 0) {
        console.log(`Adding user ${user.email} to low lecture members with ${userUnderTargetStudents.length} students`);
        
        // Increment counter only in cron job and if not already counted for this week
        if (isCronJob && (!user.lastLowLectureWeek || user.lastLowLectureWeek < weekStart)) {
          user.lowLectureWeekCount = (user.lowLectureWeekCount || 0) + 1;
          user.lastLowLectureWeek = weekStart;
          await user.save({ session });
          console.log(`Incremented lowLectureWeekCount for ${user.email}: ${user.lowLectureWeekCount}`);
        }
        
        lowLectureMembers.push({
          _id: user._id.toString(),
          name: joinRequest.name || user.email,
          email: user.email,
          lowLectureWeekCount: user.lowLectureWeekCount,
          underTargetStudents: userUnderTargetStudents,
          lectures: user.lectures.map(lecture => ({
            _id: lecture._id.toString(),
            name: lecture.name,
            subject: lecture.subject,
            studentEmail: lecture.studentEmail,
            link: lecture.link,
            createdAt: lecture.createdAt.toISOString()
          }))
        });
      } else {
        console.log(`User ${user.email} meets all requirements`);
        // Reset counter if user meets requirements (only in cron job)
        if (isCronJob && user.lowLectureWeekCount > 0) {
          user.lowLectureWeekCount = 0;
          user.lastLowLectureWeek = null;
          await user.save({ session });
          console.log(`Reset lowLectureWeekCount for ${user.email} to 0`);
        }
      }
    }

    // Save report (only in cron job)
    let report = null;
    if (isCronJob) {
      report = new LowLectureReport({
        weekStart,
        weekEnd,
        members: lowLectureMembers,
        totalUsersProcessed: users.length,
        membersWithLowLectures: lowLectureMembers.length,
        createdAt: new Date()
      });
      await report.save({ session });
      console.log('Saved low lecture report:', { weekStart: weekStart.toISOString(), members: lowLectureMembers.length });
    }

    await session.commitTransaction();
    session.endSession();

    console.log(`Final results: ${lowLectureMembers.length} members with low lecture counts`);
    
    // Debug: Log summary of results
    if (lowLectureMembers.length > 0) {
      console.log('Summary of low lecture members:', 
        lowLectureMembers.map(member => ({
          name: member.name,
          email: member.email,
          lowLectureWeekCount: member.lowLectureWeekCount,
          studentsCount: member.underTargetStudents.length,
          totalSubjects: member.underTargetStudents.reduce((sum, student) => 
            sum + student.underTargetSubjects.length, 0)
        }))
      );
    }

    return {
      success: true,
      message: lowLectureMembers.length > 0 
        ? `تم العثور على ${lowLectureMembers.length} عضو لديهم محاضرات أقل من الحد الأدنى` 
        : 'جميع الأعضاء يحققون الحد الأدنى من المحاضرات الأسبوعية',
      members: lowLectureMembers,
      debug: {
        totalUsersProcessed: users.length,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        membersWithLowLectures: lowLectureMembers.length
      }
    };
  } catch (error) {
    console.error('Error in checkLowLectureMembers:', error.message, error.stack);
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
}

// GET /low-lecture-members endpoint
router.get('/low-lecture-members', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    // Calculate the previous week
    const now = new Date();
    const dayOfWeek = now.getDay();
    let daysToPreviousSaturday = (dayOfWeek + 1) % 7;
    if (daysToPreviousSaturday === 0) daysToPreviousSaturday = 7;

    const previousSaturday = new Date(now);
    previousSaturday.setDate(now.getDate() - daysToPreviousSaturday);
    
    const weekStart = new Date(previousSaturday);
    weekStart.setDate(previousSaturday.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    // Find the latest report for the previous week
    const report = await LowLectureReport.findOne({ weekStart })
      .sort({ createdAt: -1 });

    if (report) {
      console.log('Returning cached low lecture report:', { weekStart: weekStart.toISOString() });
      res.json({
        success: true,
        message: report.members.length > 0 
          ? `تم العثور على ${report.members.length} عضو لديهم محاضرات أقل من الحد الأدنى` 
          : 'جميع الأعضاء يحققون الحد الأدنى من المحاضرات الأسبوعية',
        members: report.members,
        debug: {
          totalUsersProcessed: report.totalUsersProcessed,
          weekStart: report.weekStart.toISOString(),
          weekEnd: report.weekEnd.toISOString(),
          membersWithLowLectures: report.membersWithLowLectures
        }
      });
    } else {
      // If no report exists, run the analysis without incrementing counters
      const result = await checkLowLectureMembers(false);
      res.json(result);
    }
  } catch (error) {
    console.error('Error in low-lecture-members:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'خطأ في الخادم',
      error: error.message
    });
  }
});

// Schedule the weekly check
cron.schedule('0 0 * * 6', async () => {
  console.log(' Starting weekly low lecture check...');
  try {
    await checkLowLectureMembers(true);
    console.log('Weekly check completed successfully.');
  } catch (error) {
    console.error(' Error in weekly cron job:', error);
  }
}, {
  timezone: 'Asia/Riyadh'
});

export default router;