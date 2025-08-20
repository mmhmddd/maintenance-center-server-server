import nodemailer from 'nodemailer';

const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: false, 
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `"Qatrah Ghaith" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: text || html?.replace(/<[^>]+>/g, ''),
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully to:', to, 'Response:', info.response);
    return info;
  } catch (error) {
    console.error('❌ Error sending email to:', to, 'Error:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

export default sendEmail;
