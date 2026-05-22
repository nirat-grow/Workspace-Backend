const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

exports.sendInviteEmail = async (email, workspaceName, link, message) => {
  try {
    const mailOptions = {
      from: `"Hopefly" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `You've been invited to ${workspaceName} on Hopefly`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Hopefly Invitation</title>
          <style>
            body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #172B4D; margin: 0; padding: 0; background-color: #F4F5F7; }
            .container { max-width: 600px; margin: 40px auto; background: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 24px rgba(9, 30, 66, 0.05); border: 1px solid #DFE1E6; }
            .header { background: linear-gradient(135deg, #0052CC 0%, #00B8D9 100%); padding: 32px 40px; text-align: center; }
            .header h1 { color: #FFFFFF; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
            .content { padding: 40px; }
            .greeting { font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 16px; color: #172B4D; }
            .message-block { background: #FAFBFC; border-left: 4px solid #0052CC; padding: 16px 20px; margin: 24px 0; border-radius: 0 8px 8px 0; font-style: italic; color: #42526E; font-size: 15px; }
            .cta-wrapper { text-align: center; margin: 40px 0 24px; }
            .btn { display: inline-block; background: #0052CC; color: #FFFFFF; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; transition: background 0.2s; box-shadow: 0 4px 12px rgba(0, 82, 204, 0.2); }
            .footer { padding: 24px 40px; background: #FAFBFC; text-align: center; font-size: 13px; color: #7A869A; border-top: 1px solid #EBECF0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Hopefly</h1>
            </div>
            <div class="content">
              <h2 class="greeting">You're Invited!</h2>
              <p style="font-size: 16px; color: #42526E; margin-bottom: 8px;">
                You have been invited to join the <strong>${workspaceName}</strong> workspace on Hopefly.
              </p>
              ${message ? `
              <div class="message-block">
                "${message}"
              </div>
              ` : ''}
              <p style="font-size: 16px; color: #42526E; margin-bottom: 24px;">
                Join your team to start collaborating on projects, tracking tasks, and managing workflows seamlessly.
              </p>
              <div class="cta-wrapper" style="text-align: center; margin: 40px 0 24px;">
                <a href="${link}" class="btn" style="display: inline-block; background-color: #0052CC; color: #FFFFFF !important; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(0, 82, 204, 0.2);">
                  <span style="color: #FFFFFF !important;">Accept Invitation</span>
                </a>
              </div>
              <p style="font-size: 14px; color: #5E6C84; text-align: center; margin-top: 32px; margin-bottom: 0;">
                This link will expire in 7 days.
              </p>
            </div>
            <div class="footer">
              Sent by Hopefly • Modern Project Management
            </div>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Failed to send email');
  }
};

exports.sendOTPEmail = async (email, otp) => {
  try {
    const mailOptions = {
      from: `"Hopefly" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `Reset Your Hopefly Password`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Reset Your Password</title>
          <style>
            body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #172B4D; margin: 0; padding: 0; background-color: #F4F5F7; }
            .container { max-width: 500px; margin: 40px auto; background: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 24px rgba(9, 30, 66, 0.05); border: 1px solid #DFE1E6; }
            .header { background: linear-gradient(135deg, #0052CC 0%, #00B8D9 100%); padding: 32px 40px; text-align: center; }
            .header h1 { color: #FFFFFF; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
            .content { padding: 40px; text-align: center; }
            .greeting { font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 16px; color: #172B4D; }
            .otp-box { background: #F4F5F7; border-radius: 8px; padding: 16px; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0052CC; margin: 24px 0; display: inline-block; }
            .footer { padding: 24px 40px; background: #FAFBFC; text-align: center; font-size: 13px; color: #7A869A; border-top: 1px solid #EBECF0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Hopefly</h1>
            </div>
            <div class="content">
              <h2 class="greeting">Reset Your Password</h2>
              <p style="font-size: 16px; color: #42526E; margin-bottom: 24px;">
                Use the following One-Time Password (OTP) to reset your password. This OTP is valid for 10 minutes.
              </p>
              <div class="otp-box">
                ${otp}
              </div>
              <p style="font-size: 14px; color: #5E6C84; margin-top: 24px; margin-bottom: 0;">
                If you did not request a password reset, please ignore this email.
              </p>
            </div>
            <div class="footer">
              Sent by Hopefly • Modern Project Management
            </div>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Error sending OTP email:', error);
    return false;
  }
};

