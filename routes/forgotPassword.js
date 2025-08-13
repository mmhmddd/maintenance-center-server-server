import express from 'express';
import crypto from 'crypto';
import { hash } from 'bcryptjs';
import User from '../models/User.js';
import sendEmail from '../utils/email.js';
import validator from 'validator';

const router = express.Router();

// طلب إعادة تعيين كلمة المرور
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
      return res.status(404).json({ message: 'لا يوجد مستخدم مسجل بهذا البريد الإلكتروني' });
    }

    // توليد رمز إعادة التعيين
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpire = Date.now() + 3600000; // الرمز صالح لمدة ساعة واحدة

    user.resetToken = resetToken;
    user.tokenExpire = tokenExpire;
    await user.save();

    // رابط إعادة التعيين
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    
    // إرسال بريد إلكتروني مع رابط إعادة التعيين
    try {
      await sendEmail({
        to: email,
        subject: 'إعادة تعيين كلمة المرور',
        text: `مرحبًا،\n\nلقد تلقينا طلبًا لإعادة تعيين كلمة المرور لحسابك.\nيرجى النقر على الرابط التالي لإعادة تعيين كلمة المرور:\n${resetUrl}\n\nإذا لم تطلب إعادة تعيين كلمة المرور، يرجى تجاهل هذا البريد الإلكتروني.\n\nالرابط صالح لمدة ساعة واحدة.\n\nتحياتنا,\nفريق الإدارة`
      });
      console.log('تم إرسال بريد إلكتروني لإعادة تعيين كلمة المرور إلى:', email);
      res.json({ message: 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني' });
    } catch (emailError) {
      console.error('فشل إرسال بريد إعادة التعيين:', emailError);
      user.resetToken = null;
      user.tokenExpire = null;
      await user.save();
      return res.status(500).json({ message: 'فشل في إرسال البريد الإلكتروني، حاول مرة أخرى لاحقًا' });
    }
  } catch (error) {
    console.error('خطأ في طلب إعادة تعيين كلمة المرور:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// إعادة تعيين كلمة المرور
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ message: 'كلمة المرور الجديدة مطلوبة' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    const user = await User.findOne({
      resetToken: token,
      tokenExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'رمز إعادة التعيين غير صالح أو منتهي الصلاحية' });
    }

    user.password = await hash(newPassword, 10);
    user.resetToken = null;
    user.tokenExpire = null;
    await user.save();

    console.log('تم إعادة تعيين كلمة المرور لـ:', user.email);
    res.json({ message: 'تم إعادة تعيين كلمة المرور بنجاح' });
  } catch (error) {
    console.error('خطأ في إعادة تعيين كلمة المرور:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

export default router;