import nodemailer from 'nodemailer';

const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to,
      subject,
      text: text || html?.replace(/<[^>]+>/g, ''), // Fallback to stripped HTML if text is not provided
      html, // Include HTML if provided
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully to:', to, 'Response:', info.response);
    return info;
  } catch (error) {
    console.error('Error sending email to:', to, 'Error:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

export default sendEmail;