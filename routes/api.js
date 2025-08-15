// api.js (Backend - Updated with enhanced logging and message management)
import express from 'express';
import { hash, compare } from 'bcryptjs';
import jwt from 'jsonwebtoken';
const { sign, verify } = jwt;
import JoinRequest from '../models/JoinRequest.js';
import User from '../models/User.js';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import sendEmail from '../utils/email.js';
import validator from 'validator';
import { v2 as cloudinary } from 'cloudinary';
import crypto from 'crypto';

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Multer configuration for file uploads (memory storage for Cloudinary)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    console.log('فحص نوع الملف:', file.mimetype, file.originalname);
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    
    if (extname && mimetype) {
      console.log('نوع الملف مقبول');
      return cb(null, true);
    } else {
      console.log('نوع الملف مرفوض');
      cb(new Error('يجب أن تكون الصورة بصيغة JPEG، PNG، GIF، أو WebP'));
    }
  },
  limits: { 
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  }
});

// Middleware to verify JWT token
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: 'الوصول مرفوض، يرجى تسجيل الدخول' });
  }
  try {
    const decoded = verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch (error) {
    console.error('خطأ في التحقق من الرمز:', error);
    res.status(401).json({ message: 'رمز غير صالح' });
  }
};

// Admin middleware
const adminMiddleware = (req, res, next) => {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ message: 'يجب أن تكون مسؤولاً للوصول إلى هذا الطريق' });
  }
  next();
};

// Submit a join request
router.post('/join-requests', async (req, res) => {
  try {
    const { name, email, number, academicSpecialization, address, subjects } = req.body;
    if (!name || !email || !number || !academicSpecialization || !address) {
      return res.status(400).json({ message: 'الاسم، البريد الإلكتروني، الرقم، التخصص الجامعي، والعنوان مطلوبة' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    const existingRequest = await JoinRequest.findOne({ email });
    if (existingRequest) {
      return res.status(400).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });
    }

    const joinRequest = new JoinRequest({ name, email, number, academicSpecialization, address, subjects });
    await joinRequest.save();
    console.log('تم إنشاء طلب الانضمام:', joinRequest);
    res.status(201).json({ message: 'تم تسجيل طلب الانضمام بنجاح', id: joinRequest._id });
  } catch (error) {
    console.error('خطأ في تقديم طلب الانضمام:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get all join requests
router.get('/join-requests', async (req, res) => {
  try {
    const joinRequests = await JoinRequest.find();
    console.log('تم جلب طلبات الانضمام:', joinRequests.length);
    res.json(joinRequests);
  } catch (error) {
    console.error('خطأ في جلب طلبات الانضمام:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Approve a join request
router.post('/join-requests/:id/approve', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: 'خطأ في إعدادات البريد الإلكتروني، تحقق من متغيرات البيئة' });
    }

    const joinRequest = await JoinRequest.findById(req.params.id).session(session);
    if (!joinRequest) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }
    if (joinRequest.status !== 'Pending') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'الطلب تم معالجته مسبقًا' });
    }

    joinRequest.status = 'Approved';
    joinRequest.volunteerHours = 0;
    await joinRequest.save({ session });
    console.log('تمت الموافقة على طلب الانضمام:', joinRequest);

    if (!validator.isEmail(joinRequest.email)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'البريد الإلكتروني للطلب غير صالح' });
    }

    const existingUser = await User.findOne({ email: joinRequest.email }).session(session);
    if (existingUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'حساب المستخدم موجود بالفعل' });
    }

    const randomPassword = crypto.randomBytes(8).toString('hex');
    console.log('كلمة المرور المولدة:', randomPassword);

    const hashedPassword = await hash(randomPassword, 10);
    console.log('تم إنشاء كلمة المرور المشفرة');

    const user = new User({
      email: joinRequest.email,
      password: hashedPassword,
      numberOfStudents: 0,
      subjects: joinRequest.subjects || [],
      students: [],
      meetings: [],
      lectures: [],
      lectureCount: 0,
      role: 'user',
      profileImage: null,
      profileImagePublicId: null
    });
    await user.save({ session });
    console.log('تم إنشاء المستخدم:', user.email);

    try {
      await sendEmail({
        to: joinRequest.email,
        subject: 'تم الموافقة على طلب الانضمام الخاص بك',
        text: `مرحبًا ${joinRequest.name},\n\nتم الموافقة على طلب انضمامك!\nبريدك الإلكتروني: ${joinRequest.email}\nكلمة المرور: ${randomPassword}\n\nيرجى تسجيل الدخول وتغيير كلمة المرور لاحقًا.\n\nتحياتنا,\nفريق الإدارة`,
      });
      console.log('تم إرسال البريد الإلكتروني إلى:', joinRequest.email);
    } catch (emailError) {
      console.error('فشل إرسال البريد الإلكتروني:', emailError);
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: 'فشل في إرسال البريد الإلكتروني', error: emailError.message });
    }

    await session.commitTransaction();
    session.endSession();

    res.json({
      message: 'تم الموافقة على الطلب وإنشاء الحساب وإرسال كلمة المرور عبر البريد الإلكتروني',
      email: user.email,
    });
  } catch (error) {
    console.error('خطأ في الموافقة على طلب الانضمام:', error);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'فشل في الموافقة على الطلب، تحقق من المعرف أو الاتصال بالخادم', error: error.message });
  }
});

// Reject a join request
router.post('/join-requests/:id/reject', authMiddleware, async (req, res) => {
  try {
    const joinRequest = await JoinRequest.findById(req.params.id);
    if (!joinRequest) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }
    if (joinRequest.status !== 'Pending') {
      return res.status(400).json({ message: 'الطلب تم معالجته مسبقًا' });
    }

    joinRequest.status = 'Rejected';
    await joinRequest.save();
    console.log('تم رفض طلب الانضمام:', joinRequest);
    res.json({ message: 'تم رفض الطلب' });
  } catch (error) {
    console.error('خطأ في رفض طلب الانضمام:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete an approved member
router.delete('/members/:id', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const memberId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'معرف العضو غير صالح' });
    }

    const joinRequest = await JoinRequest.findById(memberId).session(session);
    if (!joinRequest) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'العضو غير موجود' });
    }

    if (joinRequest.status !== 'Approved') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'يجب أن يكون العضو قد تمت الموافقة عليه' });
    }

    const user = await User.findOne({ email: joinRequest.email }).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'حساب المستخدم غير موجود' });
    }

    // Delete profile image from Cloudinary if exists
    if (user.profileImagePublicId) {
      try {
        await cloudinary.uploader.destroy(user.profileImagePublicId);
        console.log('تم حذف الصورة من Cloudinary:', user.profileImagePublicId);
      } catch (cloudinaryError) {
        console.error('خطأ في حذف الصورة من Cloudinary:', cloudinaryError);
        // Continue with user deletion even if Cloudinary deletion fails
      }
    }

    await JoinRequest.deleteOne({ _id: memberId }).session(session);
    await User.deleteOne({ email: joinRequest.email }).session(session);

    await session.commitTransaction();
    session.endSession();

    console.log('تم حذف العضو:', { memberId, email: joinRequest.email });
    res.json({ message: 'تم حذف العضو بنجاح' });
  } catch (error) {
    console.error('خطأ في حذف العضو:', error);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get all approved members with details
router.get('/approved-members', async (req, res) => {
  try {
    const approvedMembers = await JoinRequest.find({ status: 'Approved' });
    const membersWithDetails = await Promise.all(approvedMembers.map(async (member) => {
      const user = await User.findOne({ email: member.email });
      return {
        id: member._id,
        name: member.name,
        email: member.email,
        phone: member.number,
        address: member.address,
        academicSpecialization: member.academicSpecialization,
        volunteerHours: member.volunteerHours || 0,
        numberOfStudents: user?.numberOfStudents || 0,
        subjects: user?.subjects || [],
        students: user?.students || [],
        meetings: user?.meetings || [],
        lectures: user?.lectures || [],
        lectureCount: user?.lectureCount || 0,
        profileImage: user?.profileImage || null
      };
    }));
    console.log('تم جلب الأعضاء المعتمدين:', membersWithDetails.length);
    res.json(membersWithDetails);
  } catch (error) {
    console.error('خطأ في جلب الأعضاء المعتمدين:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get member details by ID
router.get('/members/:id', async (req, res) => {
  try {
    const member = await JoinRequest.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'العضو غير موجود' });
    }
    const user = await User.findOne({ email: member.email });
    res.json({
      id: member._id,
      name: member.name,
      email: member.email,
      phone: member.number,
      address: member.address,
      academicSpecialization: member.academicSpecialization,
      volunteerHours: member.volunteerHours || 0,
      numberOfStudents: user?.numberOfStudents || 0,
      subjects: user?.subjects || [],
      students: user?.students || [],
      lectures: user?.lectures || [],
      lectureCount: user?.lectureCount || 0,
      status: member.status,
      createdAt: member.createdAt,
      profileImage: user?.profileImage || null,
    });
  } catch (error) {
    console.error('خطأ في جلب تفاصيل العضو:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update member details
router.put('/members/:id/update-details', async (req, res) => {
  try {
    const { volunteerHours, numberOfStudents, students, subjects } = req.body;

    if (
      volunteerHours === undefined ||
      numberOfStudents === undefined ||
      !Array.isArray(students) ||
      !Array.isArray(subjects)
    ) {
      return res.status(400).json({ message: 'ساعات التطوع، عدد الطلاب، بيانات الطلاب، والمواد مطلوبة' });
    }

    if (volunteerHours < 0 || numberOfStudents < 0) {
      return res.status(400).json({ message: 'ساعات التطوع وعدد الطلاب يجب أن يكونا صفر أو أكثر' });
    }

    if (students.some(student => !student.name || !student.email || !student.phone)) {
      return res.status(400).json({ message: 'بيانات الطلاب يجب أن تحتوي على الاسم، البريد الإلكتروني، والهاتف' });
    }

    if (students.some(student => student.grade && !validator.isLength(student.grade, { min: 1, max: 50 }))) {
      return res.status(400).json({ message: 'الصف يجب أن يكون بين 1 و50 حرفًا إذا تم توفيره' });
    }

    if (students.some(student => student.subjects && !Array.isArray(student.subjects))) {
      return res.status(400).json({ message: 'المواد يجب أن تكون مصفوفة' });
    }

    if (students.some(student => student.subjects && student.subjects.some(subject => !validator.isLength(subject, { min: 1, max: 100 })))) {
      return res.status(400).json({ message: 'كل مادة يجب أن تكون بين 1 و100 حرف إذا تم توفيرها' });
    }

    const member = await JoinRequest.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'العضو غير موجود' });
    }

    if (member.status !== 'Approved') {
      return res.status(400).json({ message: 'يجب أن يكون العضو قد تمت الموافقة عليه' });
    }

    const user = await User.findOne({ email: member.email });
    if (!user) {
      return res.status(404).json({ message: 'حساب المستخدم غير موجود' });
    }

    member.volunteerHours = volunteerHours;
    member.students = students;
    member.subjects = subjects;

    user.numberOfStudents = numberOfStudents;
    user.students = students;
    user.subjects = subjects;

    await Promise.all([member.save(), user.save()]);

    console.log('تم تحديث تفاصيل العضو:', { 
      memberId: member._id,
      volunteerHours, 
      numberOfStudents, 
      students, 
      subjects 
    });

    res.json({ 
      message: 'تم تحديث التفاصيل بنجاح',
      volunteerHours: member.volunteerHours,
      numberOfStudents: user.numberOfStudents,
      students: user.students,
      subjects: user.subjects
    });
    
  } catch (error) {
    console.error('خطأ في تحديث تفاصيل العضو:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Add a single student to a member
router.post('/members/:id/add-student', async (req, res) => {
  try {
    const { name, email, phone, grade, subjects } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ message: 'الاسم، البريد الإلكتروني، والهاتف مطلوبة للطالب' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني للطالب غير صالح' });
    }
    if (grade && !validator.isLength(grade, { min: 1, max: 50 })) {
      return res.status(400).json({ message: 'الصف يجب أن يكون بين 1 و50 حرفًا إذا تم توفيره' });
    }
    if (subjects && !Array.isArray(subjects)) {
      return res.status(400).json({ message: 'المواد يجب أن تكون مصفوفة' });
    }
    if (subjects && subjects.some(subject => !validator.isLength(subject, { min: 1, max: 100 }))) {
      return res.status(400).json({ message: 'كل مادة يجب أن تكون بين 1 و100 حرف إذا تم توفيرها' });
    }

    const member = await JoinRequest.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'العضو غير موجود' });
    }
    if (member.status !== 'Approved') {
      return res.status(400).json({ message: 'يجب أن يكون العضو قد تمت الموافقة عليه' });
    }

    const user = await User.findOne({ email: member.email });
    if (!user) {
      return res.status(404).json({ message: 'حساب المستخدم غير موجود' });
    }

    if (!Array.isArray(user.students)) {
      user.students = [];
    }
    if (!Array.isArray(member.students)) {
      member.students = [];
    }

    if (user.students.some(student => student.email === email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني للطالب مستخدم بالفعل' });
    }

    const newStudent = { name, email, phone, grade, subjects: subjects || [] };
    user.students.push(newStudent);
    member.students.push(newStudent);
    user.numberOfStudents = (user.numberOfStudents || 0) + 1;

    // Ensure subjects arrays are initialized before updating
    if (!Array.isArray(user.subjects)) {
      user.subjects = [];
    }
    if (!Array.isArray(member.subjects)) {
      member.subjects = [];
    }

    // Update user.subjects to include any new subjects from the student's subjects
    if (subjects && Array.isArray(subjects)) {
      user.subjects = [...new Set([...user.subjects, ...subjects])];
      member.subjects = [...new Set([...member.subjects, ...subjects])];
    }

    await Promise.all([member.save(), user.save()]);
    console.log('تم إضافة الطالب:', { 
      memberId: member._id, 
      student: newStudent, 
      numberOfStudents: user.numberOfStudents 
    });

    res.json({
      message: 'تم إضافة الطالب بنجاح',
      student: newStudent,
      numberOfStudents: user.numberOfStudents,
      students: user.students,
      subjects: user.subjects
    });
  } catch (error) {
    console.error('خطأ في إضافة الطالب:', error.stack);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'بيانات تسجيل الدخول غير صحيحة' });
    }

    const isMatch = await compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'بيانات تسجيل الدخول غير صحيحة' });
    }

    const token = sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    res.json({ token });
  } catch (error) {
    console.error('خطأ في تسجيل الدخول:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get user profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }
    const joinRequest = await JoinRequest.findOne({ email: user.email });

    // Filter out expired messages for display
    const currentDate = new Date();
    user.messages = user.messages.filter(message => message.displayUntil > currentDate);

    await user.save(); // Save to persist filtered messages

    console.log('تم جلب الملف الشخصي:', {
      userId: req.userId,
      numberOfStudents: user.numberOfStudents,
      students: user.students,
      subjects: user.subjects,
      meetings: user.meetings,
      lectures: user.lectures,
      lectureCount: user.lectureCount,
      profileImage: user.profileImage,
      messages: user.messages
    });

    res.json({
      success: true,
      message: 'تم جلب الملف الشخصي بنجاح',
      data: {
        user: {
          id: user._id,
          email: user.email,
          profileImage: user.profileImage || null,
          numberOfStudents: user.numberOfStudents || 0,
          subjects: user.subjects || [],
          students: user.students || [],
          meetings: user.meetings || [],
          lectures: user.lectures || [],
          lectureCount: user.lectureCount || 0,
          messages: user.messages || []
        },
        joinRequest: joinRequest ? {
          name: joinRequest.name,
          phone: joinRequest.number,
          academicSpecialization: joinRequest.academicSpecialization,
          address: joinRequest.address,
          volunteerHours: joinRequest.volunteerHours || 0,
          status: joinRequest.status,
          students: user.students || [],
          subjects: user.subjects || [],
          lectures: user.lectures || [],
          lectureCount: user.lectureCount || 0
        } : null
      }
    });
  } catch (error) {
    console.error('خطأ في جلب الملف الشخصي:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update password
router.put('/profile/password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'كلمة المرور الحالية والجديدة مطلوبة' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const isMatch = await compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة' });
    }

    user.password = await hash(newPassword, 10);
    await user.save();
    res.json({ success: true, message: 'تم تحديث كلمة المرور بنجاح' });
  } catch (error) {
    console.error('خطأ في تحديث كلمة المرور:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Upload profile image to Cloudinary
router.post('/profile/image', authMiddleware, (req, res) => {
  console.log('تلقي طلب رفع صورة شخصية...');
  
  upload.single('profileImage')(req, res, async (err) => {
    try {
      if (err) {
        console.error('خطأ في multer:', err.message);
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
              success: false,
              message: 'حجم الملف كبير جداً. الحد الأقصى هو 10MB' 
            });
          }
        }
        return res.status(400).json({ 
          success: false,
          message: err.message || 'خطأ في رفع الملف' 
        });
      }

      if (!req.file) {
        console.log('لم يتم تلقي أي ملف');
        return res.status(400).json({ 
          success: false,
          message: 'يرجى اختيار صورة للرفع' 
        });
      }

      console.log('تم تلقي الملف:', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      });

      const user = await User.findById(req.userId);
      if (!user) {
        return res.status(404).json({ 
          success: false,
          message: 'المستخدم غير موجود' 
        });
      }

      // Delete old image from Cloudinary if exists
      if (user.profileImagePublicId) {
        try {
          await cloudinary.uploader.destroy(user.profileImagePublicId);
          console.log('تم حذف الصورة القديمة من Cloudinary:', user.profileImagePublicId);
        } catch (deleteError) {
          console.error('خطأ في حذف الصورة القديمة من Cloudinary:', deleteError);
        }
      }

      // Upload new image to Cloudinary
      const uploadResult = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            folder: 'profile_images',
            resource_type: 'image',
            transformation: [
              { width: 500, height: 500, crop: 'limit' },
              { quality: 'auto' },
              { format: 'auto' }
            ]
          },
          (error, result) => {
            if (error) {
              console.error('خطأ في رفع الصورة إلى Cloudinary:', error);
              reject(error);
            } else {
              console.log('تم رفع الصورة إلى Cloudinary بنجاح:', result?.secure_url);
              resolve(result);
            }
          }
        ).end(req.file.buffer);
      });

      // Update user profile with new image URL and public_id
      user.profileImage = uploadResult.secure_url;
      user.profileImagePublicId = uploadResult.public_id;
      await user.save();

      console.log('تم تحديث بيانات المستخدم بالصورة الجديدة:', {
        profileImage: user.profileImage,
        profileImagePublicId: user.profileImagePublicId
      });

      res.json({
        success: true,
        message: 'تم رفع الصورة الشخصية بنجاح',
        data: { 
          profileImage: uploadResult.secure_url,
          fileName: req.file.originalname,
          fileSize: req.file.size
        }
      });

    } catch (error) {
      console.error('خطأ في رفع الصورة الشخصية:', error);
      res.status(500).json({ 
        success: false,
        message: 'خطأ في الخادم أثناء رفع الصورة', 
        error: error.message 
      });
    }
  });
});

// Delete profile image
router.delete('/profile/image', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'المستخدم غير موجود' 
      });
    }

    if (!user.profileImagePublicId) {
      return res.status(400).json({
        success: false,
        message: 'لا توجد صورة شخصية لحذفها'
      });
    }

    // Delete image from Cloudinary
    try {
      await cloudinary.uploader.destroy(user.profileImagePublicId);
      console.log('تم حذف الصورة من Cloudinary:', user.profileImagePublicId);
    } catch (cloudinaryError) {
      console.error('خطأ في حذف الصورة من Cloudinary:', cloudinaryError);
    }

    // Remove image references from user document
    user.profileImage = null;
    user.profileImagePublicId = null;
    await user.save();

    res.json({
      success: true,
      message: 'تم حذف الصورة الشخصية بنجاح'
    });

  } catch (error) {
    console.error('خطأ في حذف الصورة الشخصية:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في الخادم أثناء حذف الصورة',
      error: error.message
    });
  }
});

// Add a meeting to calendar
router.post('/profile/meetings', authMiddleware, async (req, res) => {
  try {
    const { title, date, startTime, endTime } = req.body;
    if (!title || !date || !startTime || !endTime) {
      return res.status(400).json({ message: 'العنوان، التاريخ، وقت البدء، ووقت الانتهاء مطلوبة' });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'صيغة التاريخ غير صالحة، يجب أن تكون YYYY-MM-DD' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    if (!Array.isArray(user.meetings)) {
      user.meetings = [];
      console.log('تم تهيئة مصفوفة المواعيد كمصفوفة فارغة');
    }

    user.meetings.push({ title, date: parsedDate, startTime, endTime, reminded: false });
    await user.save();
    console.log('تم إضافة الموعد:', user.meetings);

    const formattedMeetings = user.meetings.map(meeting => ({
      _id: meeting._id,
      title: meeting.title,
      date: meeting.date.toISOString().split('T')[0],
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      reminded: meeting.reminded
    }));

    res.json({ message: 'تم إضافة الموعد بنجاح', meetings: formattedMeetings });
  } catch (error) {
    console.error('خطأ في إضافة الموعد:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update a meeting
router.put('/profile/meetings/:meetingId', authMiddleware, async (req, res) => {
  try {
    const { title, date, startTime, endTime } = req.body;
    const meetingId = req.params.meetingId;

    if (!title || !date || !startTime || !endTime) {
      return res.status(400).json({ message: 'العنوان، التاريخ، وقت البدء، ووقت الانتهاء مطلوبة' });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'صيغة التاريخ غير صالحة، يجب أن تكون YYYY-MM-DD' });
    }

    if (!mongoose.Types.ObjectId.isValid(meetingId)) {
      return res.status(400).json({ message: 'معرف الموعد غير صالح' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const meeting = user.meetings.id(meetingId);
    if (!meeting) {
      return res.status(404).json({ message: 'الموعد غير موجود' });
    }

    meeting.title = title;
    meeting.date = parsedDate;
    meeting.startTime = startTime;
    meeting.endTime = endTime;
    meeting.reminded = false;

    await user.save();
    console.log('تم تحديث الموعد:', user.meetings);

    const formattedMeetings = user.meetings.map(meeting => ({
      _id: meeting._id,
      title: meeting.title,
      date: meeting.date.toISOString().split('T')[0],
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      reminded: meeting.reminded
    }));

    res.json({ message: 'تم تحديث الموعد بنجاح', meetings: formattedMeetings });
  } catch (error) {
    console.error('خطأ في تحديث الموعد:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete a meeting
router.delete('/profile/meetings/:meetingId', authMiddleware, async (req, res) => {
  try {
    const meetingId = req.params.meetingId;
    console.log('تلقي طلب حذف موعد مع المعرف:', meetingId);

    if (!mongoose.Types.ObjectId.isValid(meetingId)) {
      console.error('معرف الموعد غير صالح:', meetingId);
      return res.status(400).json({ message: 'معرف الموعد غير صالح' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      console.error('المستخدم غير موجود للمعرف:', req.userId);
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const meeting = user.meetings.id(meetingId);
    if (!meeting) {
      console.error('الموعد غير موجود للمعرف:', meetingId);
      return res.status(404).json({ message: 'الموعد غير موجود' });
    }

    user.meetings.pull(meetingId);
    await user.save();
    console.log('تم حذف الموعد، المواعيد المحدثة:', user.meetings);

    const formattedMeetings = user.meetings.map(meeting => ({
      _id: meeting._id,
      title: meeting.title,
      date: meeting.date.toISOString().split('T')[0],
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      reminded: meeting.reminded
    }));

    res.json({ message: 'تم حذف الموعد بنجاح', meetings: formattedMeetings });
  } catch (error) {
    console.error('خطأ في حذف الموعد:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'البريد الإلكتروني مطلوب' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpire = Date.now() + 3600000; // 1 hour expiration

    user.resetToken = resetToken;
    user.tokenExpire = tokenExpire;
    await user.save();

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:4200'}/reset-password/${resetToken}`;
    const message = `مرحبًا,\n\nلقد طلبت إعادة تعيين كلمة المرور. يرجى النقر على الرابط التالي لإعادة تعيين كلمة المرور الخاصة بك:\n${resetUrl}\n\nهذا الرابط صالح لمدة ساعة واحدة فقط.\n\nإذا لم تطلب إعادة تعيين كلمة المرور، يرجى تجاهل هذا البريد الإلكتروني.\n\nتحياتنا,\nفريق الإدارة`;

    try {
      await sendEmail({
        to: email,
        subject: 'إعادة تعيين كلمة المرور',
        text: message,
      });
      console.log('تم إرسال بريد إلكتروني لإعادة تعيين كلمة المرور إلى:', email, 'مع الرابط:', resetUrl);
      res.json({ message: 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني' });
    } catch (emailError) {
      console.error('فشل إرسال بريد إلكتروني لإعادة تعيين كلمة المرور:', emailError);
      user.resetToken = null;
      user.tokenExpire = null;
      await user.save();
      return res.status(500).json({ message: 'فشل في إرسال البريد الإلكتروني', error: emailError.message });
    }
  } catch (error) {
    console.error('خطأ في طلب إعادة تعيين كلمة المرور:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Manually send meeting reminder
router.post('/profile/meetings/:meetingId/remind', authMiddleware, async (req, res) => {
  try {
    const meetingId = req.params.meetingId;
    if (!mongoose.Types.ObjectId.isValid(meetingId)) {
      return res.status(400).json({ message: 'معرف الموعد غير صالح' });
    }
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }
    const meeting = user.meetings.id(meetingId);
    if (!meeting) {
      return res.status(404).json({ message: 'الموعد غير موجود' });
    }
    await sendEmail({
      to: user.email,
      subject: 'تذكير يدوي بموعد اجتماع',
      text: `مرحبًا،\n\nهذا تذكير يدوي بموعدك "${meeting.title}" في ${meeting.date.toISOString().split('T')[0]} الساعة ${meeting.startTime}.\n\nتحياتنا,\nفريق قطرة غيث`,
    });
    console.log(`تم إرسال تذكير يدوي إلى ${user.email} للموعد ${meeting._id}`);
    meeting.reminded = true;
    await user.save();
    const formattedMeetings = user.meetings.map(meeting => ({
      _id: meeting._id,
      title: meeting.title,
      date: meeting.date.toISOString().split('T')[0],
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      reminded: meeting.reminded
    }));
    res.json({ message: 'تم إرسال التذكير اليدوي بنجاح', meetings: formattedMeetings });
  } catch (error) {
    console.error('خطأ في إرسال التذكير اليدوي:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Send message from admin to user
router.post('/admin/send-message', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, content, displayDays } = req.body;
    if (!userId || !content || !displayDays) {
      return res.status(400).json({ message: 'معرف المستخدم، الرسالة، وعدد الأيام للعرض مطلوبة' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'معرف المستخدم غير صالح' });
    }
    if (!validator.isLength(content, { min: 1, max: 1000 })) {
      return res.status(400).json({ message: 'الرسالة يجب أن تكون بين 1 و1000 حرف' });
    }
    if (!Number.isInteger(displayDays) || displayDays < 1 || displayDays > 30) {
      return res.status(400).json({ message: 'عدد الأيام يجب أن يكون عددًا صحيحًا بين 1 و30' });
    }

    // Find JoinRequest by userId
    const joinRequest = await JoinRequest.findById(userId);
    if (!joinRequest) {
      return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    }

    // Find user by email from JoinRequest
    const targetUser = await User.findOne({ email: joinRequest.email });
    if (!targetUser) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    if (!Array.isArray(targetUser.messages)) {
      targetUser.messages = [];
    }

    // Check for active (non-expired) messages
    const currentDate = new Date();
    const activeMessages = targetUser.messages.filter(message => message.displayUntil > currentDate);
    if (activeMessages.length > 0) {
      return res.status(400).json({ 
        message: 'يوجد رسالة نشطة بالفعل، يرجى تعديلها أو حذفها أولاً',
        activeMessage: {
          _id: activeMessages[0]._id,
          content: activeMessages[0].content,
          displayUntil: activeMessages[0].displayUntil
        }
      });
    }

    // Calculate displayUntil date
    const displayUntil = new Date();
    displayUntil.setDate(displayUntil.getDate() + displayDays);

    targetUser.messages.push({ content, displayUntil });
    await targetUser.save();

    console.log('تم إرسال الرسالة إلى المستخدم:', { userId, email: joinRequest.email, content, displayUntil });

    res.json({ message: 'تم إرسال الرسالة بنجاح', displayUntil });
  } catch (error) {
    console.error('خطأ في إرسال الرسالة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Edit an existing message
router.put('/admin/edit-message', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, messageId, content, displayDays } = req.body;
    if (!userId || !messageId || !content || !displayDays) {
      return res.status(400).json({ message: 'معرف المستخدم، معرف الرسالة، الرسالة، وعدد الأيام للعرض مطلوبة' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: 'معرف المستخدم أو معرف الرسالة غير صالح' });
    }
    if (!validator.isLength(content, { min: 1, max: 1000 })) {
      return res.status(400).json({ message: 'الرسالة يجب أن تكون بين 1 و1000 حرف' });
    }
    if (!Number.isInteger(displayDays) || displayDays < 1 || displayDays > 30) {
      return res.status(400).json({ message: 'عدد الأيام يجب أن يكون عددًا صحيحًا بين 1 و30' });
    }

    // Find JoinRequest by userId
    const joinRequest = await JoinRequest.findById(userId);
    if (!joinRequest) {
      return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    }

    // Find user by email from JoinRequest
    const targetUser = await User.findOne({ email: joinRequest.email });
    if (!targetUser) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    // Find the message
    const message = targetUser.messages.id(messageId);
    if (!message) {
      return res.status(404).json({ message: 'الرسالة غير موجودة' });
    }

    // Update message content and displayUntil
    const displayUntil = new Date();
    displayUntil.setDate(displayUntil.getDate() + displayDays);
    message.content = content;
    message.displayUntil = displayUntil;

    await targetUser.save();

    console.log('تم تعديل الرسالة:', { userId, messageId, email: joinRequest.email, content, displayUntil });

    res.json({ message: 'تم تعديل الرسالة بنجاح', displayUntil });
  } catch (error) {
    console.error('خطأ في تعديل الرسالة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete a message
router.delete('/admin/delete-message', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, messageId } = req.body;
    if (!userId || !messageId) {
      return res.status(400).json({ message: 'معرف المستخدم ومعرف الرسالة مطلوبان' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: 'معرف المستخدم أو معرف الرسالة غير صالح' });
    }

    // Find JoinRequest by userId
    const joinRequest = await JoinRequest.findById(userId);
    if (!joinRequest) {
      return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    }

    // Find user by email from JoinRequest
    const targetUser = await User.findOne({ email: joinRequest.email });
    if (!targetUser) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    // Find and remove the message
    const message = targetUser.messages.id(messageId);
    if (!message) {
      return res.status(404).json({ message: 'الرسالة غير موجودة' });
    }

    targetUser.messages.pull(messageId);
    await targetUser.save();

    console.log('تم حذف الرسالة:', { userId, messageId, email: joinRequest.email });

    res.json({ message: 'تم حذف الرسالة بنجاح' });
  } catch (error) {
    console.error('خطأ في حذف الرسالة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

export default router;
