import JoinRequest from '../models/JoinRequest.js';
import User from '../models/User.js';
import Leaderboard from '../models/Leaderboard.js';
import Gallery from '../models/Gallery.js'; // إضافة استيراد Gallery
import validator from 'validator';
import { calculateRankScore } from '../utils/leaderboardUtils.js';
import cloudinary from 'cloudinary';

export const addUserToLeaderboard = async (req, res) => {
  try {
    const { email, type, name, rank } = req.body;
    const file = req.file;

    // Validate input
    if (!email || !type) {
      return res.status(400).json({ message: 'البريد الإلكتروني والنوع مطلوبان' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }
    if (!['متطوع', 'قاده'].includes(type)) {
      return res.status(400).json({ message: 'النوع يجب أن يكون متطوع أو قاده' });
    }

    // Check if the user is already in the leaderboard
    const existingEntry = await Leaderboard.findOne({ email });
    if (existingEntry) {
      return res.status(400).json({ message: 'المستخدم موجود بالفعل في لوحة الصدارة' });
    }

    let leaderboardEntry;
    let user;
    let joinRequest;
    let imageUrl = null;
    let imagePublicId = null;

    if (type === 'متطوع') {
      // For volunteers, fetch existing user details
      joinRequest = await JoinRequest.findOne({ email, status: 'Approved' });
      if (!joinRequest) {
        return res.status(404).json({ message: 'المتطوع غير موجود أو لم يتم الموافقة عليه' });
      }
      user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({ message: 'حساب المتطوع غير موجود' });
      }

      leaderboardEntry = new Leaderboard({
        email,
        type,
        name: joinRequest.name,
        image: user.profileImage || null,
        imagePublicId: user.profileImagePublicId || null
      });
    } else {
      // For leaders, require name, rank, and image
      if (!name || !rank || !file) {
        return res.status(400).json({ message: 'الاسم، الرتبة، والصورة مطلوبة للقادة' });
      }

      // Upload image to Cloudinary
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.v2.uploader.upload_stream(
          {
            folder: 'leaderboard',
            transformation: [
              { width: 500, height: 500, crop: 'limit' },
              { quality: 'auto', fetch_format: 'auto' }
            ]
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(file.buffer);
      });
      imageUrl = result.secure_url;
      imagePublicId = result.public_id;

      leaderboardEntry = new Leaderboard({
        email,
        type,
        rank,
        name,
        image: imageUrl,
        imagePublicId
      });

      // Create or update user
      user = await User.findOne({ email });
      if (!user) {
        console.log(`إنشاء مستخدم جديد للبريد ${email}`);
        user = new User({
          email,
          name,
          role: 'leader'
        });
        await user.save();
      } else {
        user.name = name;
        user.role = 'leader';
        await user.save();
      }
    }

    await leaderboardEntry.save();

    // Calculate rank score
    const score = joinRequest ? calculateRankScore(joinRequest.volunteerHours, user.numberOfStudents) : 0;

    // Prepare response
    const response = {
      id: leaderboardEntry._id,
      name: leaderboardEntry.name,
      email: leaderboardEntry.email,
      type: leaderboardEntry.type,
      rank: leaderboardEntry.rank || null,
      image: leaderboardEntry.image || null,
      volunteerHours: joinRequest ? joinRequest.volunteerHours || 0 : 0,
      numberOfStudents: user ? user.numberOfStudents || 0 : 0,
      subjects: user ? user.subjects || [] : [],
      score,
    };

    res.status(201).json({
      message: 'تم إضافة المستخدم إلى لوحة الصدارة بنجاح',
      data: response,
    });
  } catch (error) {
    console.error('خطأ في إضافة المستخدم إلى لوحة الصدارة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

export const getLeaderboard = async (req, res) => {
  try {
    const leaderboardUsers = await Leaderboard.find();
    if (!leaderboardUsers.length) {
      return res.status(404).json({ message: 'لا يوجد مستخدمين في لوحة الصدارة' });
    }

    const leaderboard = await Promise.all(
      leaderboardUsers.map(async (entry) => {
        const joinRequest = await JoinRequest.findOne({ email: entry.email, status: 'Approved' });
        const user = await User.findOne({ email: entry.email });
        const score = joinRequest && user ? calculateRankScore(joinRequest.volunteerHours || 0, user.numberOfStudents || 0) : 0;

        let imageUrl = entry.image;
        if (entry.type === 'متطوع' && user) {
          imageUrl = user.profileImage || null;
        }

        // تخطي السجلات إذا لم يكن المستخدم موجودًا
        if (!user && entry.type === 'متطوع') {
          console.log(`تحذير: المستخدم غير موجود للبريد ${entry.email}`);
          return null;
        }

        return {
          id: entry._id,
          name: entry.name,
          email: entry.email,
          type: entry.type,
          rank: entry.rank || null,
          image: imageUrl,
          volunteerHours: joinRequest ? joinRequest.volunteerHours || 0 : 0,
          numberOfStudents: user ? user.numberOfStudents || 0 : 0,
          subjects: user ? user.subjects || [] : [],
          score,
        };
      })
    );

    const validLeaderboard = leaderboard.filter(entry => entry !== null);

    if (!validLeaderboard.length) {
      return res.status(404).json({ message: 'لا يوجد مستخدمين صالحين في لوحة الصدارة' });
    }

    validLeaderboard.sort((a, b) => b.score - a.score);

    const rankedLeaderboard = validLeaderboard.map((entry, index) => ({
      rank: index + 1,
      ...entry,
    }));

    res.json({
      message: 'تم جلب لوحة الصدارة بنجاح',
      data: rankedLeaderboard,
    });
  } catch (error) {
    console.error('خطأ في جلب لوحة الصدارة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

export const editUserInLeaderboard = async (req, res) => {
  try {
    const { email, name, rank, volunteerHours, numberOfStudents, subjects } = req.body;
    const file = req.file;

    if (!email) {
      return res.status(400).json({ message: 'البريد الإلكتروني مطلوب' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    let leaderboardEntry = await Leaderboard.findOne({ email });
    if (!leaderboardEntry) {
      return res.status(404).json({ message: 'المستخدم غير موجود في لوحة الصدارة' });
    }

    let imageUrl = leaderboardEntry.image;
    let imagePublicId = leaderboardEntry.imagePublicId;

    if (leaderboardEntry.type === 'قاده' && file) {
      // Delete old image from Cloudinary if it exists
      if (imagePublicId) {
        await cloudinary.v2.uploader.destroy(imagePublicId).catch(() => {});
      }
      // Upload new image to Cloudinary
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.v2.uploader.upload_stream(
          {
            folder: 'leaderboard',
            transformation: [
              { width: 500, height: 500, crop: 'limit' },
              { quality: 'auto', fetch_format: 'auto' }
            ]
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(file.buffer);
      });
      imageUrl = result.secure_url;
      imagePublicId = result.public_id;
    }

    if (name) leaderboardEntry.name = name;
    if (leaderboardEntry.type === 'قاده' && rank) leaderboardEntry.rank = rank;
    if (leaderboardEntry.type === 'قاده') {
      leaderboardEntry.image = imageUrl;
      leaderboardEntry.imagePublicId = imagePublicId;
    }

    let joinRequest = await JoinRequest.findOne({ email, status: 'Approved' });
    let user = await User.findOne({ email });

    if (volunteerHours !== undefined && joinRequest) {
      joinRequest.volunteerHours = parseInt(volunteerHours);
    }
    if (subjects) {
      if (!Array.isArray(subjects) || subjects.some(subject => typeof subject !== 'string' || subject.trim() === '')) {
        return res.status(400).json({ message: 'المواد يجب أن تكون قائمة من النصوص غير الفارغة' });
      }
      if (joinRequest) joinRequest.subjects = subjects;
      if (user) user.subjects = subjects;
    }
    if (numberOfStudents !== undefined && user) {
      user.numberOfStudents = parseInt(numberOfStudents);
    }

    await Promise.all([
      leaderboardEntry.save(),
      joinRequest ? joinRequest.save() : Promise.resolve(),
      user ? user.save() : Promise.resolve(),
    ]);

    const score = joinRequest && user ? calculateRankScore(joinRequest.volunteerHours, user.numberOfStudents) : 0;

    const response = {
      id: leaderboardEntry._id,
      name: leaderboardEntry.name,
      email: leaderboardEntry.email,
      type: leaderboardEntry.type,
      rank: leaderboardEntry.rank || null,
      image: leaderboardEntry.image || null,
      volunteerHours: joinRequest ? joinRequest.volunteerHours || 0 : 0,
      numberOfStudents: user ? user.numberOfStudents || 0 : 0,
      subjects: user ? user.subjects || [] : [],
      score,
    };

    res.json({
      message: 'تم تحديث بيانات المستخدم في لوحة الصدارة بنجاح',
      data: response,
    });
  } catch (error) {
    console.error('خطأ في تحديث المستخدم في لوحة الصدارة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

export const deleteUserFromLeaderboard = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'البريد الإلكتروني مطلوب' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    const leaderboardEntry = await Leaderboard.findOne({ email });
    if (!leaderboardEntry) {
      return res.status(404).json({ message: 'المستخدم غير موجود في لوحة الصدارة' });
    }

    // Delete image from Cloudinary if it exists
    if (leaderboardEntry.imagePublicId) {
      await cloudinary.v2.uploader.destroy(leaderboardEntry.imagePublicId).catch(() => {});
    }

    // Find the user to get their _id
    const user = await User.findOne({ email });
    if (user) {
      // Delete related gallery images
      const galleryImages = await Gallery.find({ uploadedBy: user._id });
      for (const image of galleryImages) {
        if (image.imagePublicId) {
          await cloudinary.v2.uploader.destroy(image.imagePublicId).catch(() => {});
        }
      }
      await Gallery.deleteMany({ uploadedBy: user._id });
    }

    // Delete the leaderboard entry
    await Leaderboard.deleteOne({ email });

    // Optionally, delete the user from the User collection
    // if (user) {
    //   await User.deleteOne({ _id: user._id });
    // }

    res.json({
      message: 'تم حذف المستخدم من لوحة الصدارة بنجاح',
      data: { email }
    });
  } catch (error) {
    console.error('خطأ في حذف المستخدم من لوحة الصدارة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};