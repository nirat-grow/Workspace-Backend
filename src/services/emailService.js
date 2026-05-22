const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendInviteEmail(toEmail, inviteLink, role) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log("SMTP not configured, skipping email. Link:", inviteLink);
    return false;
  }

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #0f1117; border-radius: 16px; overflow: hidden; border: 1px solid #2a2d3e;">
      <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px 24px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">⚡ Lite Jira SaaS</h1>
        <p style="color: rgba(255,255,255,.8); margin: 8px 0 0; font-size: 14px;">You've been invited to join!</p>
      </div>
      <div style="padding: 32px 24px; color: #e8eaed;">
        <p style="font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
          You have been invited as <strong style="color: #818cf8;">${role}</strong> to collaborate on projects.
        </p>
        <p style="font-size: 14px; color: #9ca3af; margin: 0 0 24px;">
          Click the button below to create your account and get started:
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${inviteLink}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
            Accept Invite & Register
          </a>
        </div>
        <p style="font-size: 12px; color: #6b7280; margin: 24px 0 0; text-align: center;">
          This invite expires in 7 days. If you didn't expect this, ignore this email.
        </p>
        <p style="font-size: 11px; color: #4b5563; margin: 16px 0 0; text-align: center; word-break: break-all;">
          ${inviteLink}
        </p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Lite Jira SaaS" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: `You're invited to Lite Jira SaaS as ${role}`,
      html
    });
    console.log("Invite email sent to:", toEmail);
    return true;
  } catch (err) {
    console.log("Email send error:", err.message);
    return false;
  }
}

module.exports = { sendInviteEmail };
