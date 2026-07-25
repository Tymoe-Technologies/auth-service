interface TemplateArgs {
  brand: string;
  email: string;
  selector: string;
  token: string;
  minutes: number;
}

interface Template {
  subject: string;
  html: string;
}

interface FranchiseInvitationArgs {
  brand: string;
  email: string;
  link: string;
  days: number;
}

interface AccountCredentialResetArgs {
  brand: string;
  recipientName: string;
  value: string; // 新 PIN 码 / 新密码明文
}

// 统一的邮件外壳（卡片 + 标题 + 正文段落 + 可选高亮块 + 可选按钮 + 页脚），
// 所有邮件都走这一套视觉样式，不再各写各的（之前 signupCode/resetCode/changeEmail
// 是纯 Arial 朴素样式，跟 franchiseInvitation 的卡片风格完全不统一）
function emailShell(args: {
  heading: string;
  paragraphs: string[];
  highlight?: string; // 验证码/PIN/密码这类需要醒目展示的内容
  button?: { label: string; href: string };
  footNote: string;
}): string {
  const paragraphsHtml = args.paragraphs
    .map(p => `<p style="margin:0 0 16px 0; font-size:15px; line-height:1.6; color:#334155;">${p}</p>`)
    .join('');

  const highlightHtml = args.highlight
    ? `
                <tr>
                  <td style="padding:8px 40px 0 40px;">
                    <div style="background:#f1f5f9; border-radius:10px; padding:16px; text-align:center; font-size:22px; font-weight:700; letter-spacing:2px; color:#0f172a;">
                      ${args.highlight}
                    </div>
                  </td>
                </tr>`
    : '';

  const buttonHtml = args.button
    ? `
                <tr>
                  <td style="padding:8px 40px 0 40px;" align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="border-radius:10px; background:#0f172a;">
                          <a href="${args.button.href}" style="display:inline-block; padding:14px 32px; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:10px;">${args.button.label}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`
    : '';

  return `
      <div style="background:#f4f4f7; padding:40px 16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto;">
          <tr>
            <td style="background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 1px 3px rgba(15,23,42,0.08);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:32px 40px 0 40px;">
                    <div style="width:36px; height:36px; border-radius:10px; background:#0f172a; display:inline-block; text-align:center; line-height:36px; color:#ffffff; font-weight:700; font-size:16px;">T</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 40px 0 40px;">
                    <h1 style="margin:0; font-size:22px; line-height:1.35; color:#0f172a; font-weight:600;">${args.heading}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 40px 0 40px;">
                    ${paragraphsHtml}
                  </td>
                </tr>
                ${highlightHtml}
                ${buttonHtml}
                <tr>
                  <td style="padding:24px 40px 0 40px;">
                    <p style="margin:0; font-size:13px; line-height:1.6; color:#64748b;">${args.footNote}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px 40px 32px 40px;">
                    <div style="border-top:1px solid #e2e8f0; padding-top:20px;">
                      <p style="margin:0; font-size:12px; line-height:1.6; color:#94a3b8;">This email was sent automatically by Tymoe. Please do not reply directly to this message.</p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 8px 0 8px;" align="center">
              <p style="margin:0; font-size:12px; color:#94a3b8;">© ${new Date().getFullYear()} Tymoe. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </div>
    `;
}

export const Templates = {
  signupCode: (args: TemplateArgs): Template => ({
    subject: `${args.brand} | Email Verification`,
    html: emailShell({
      heading: 'Email Verification',
      paragraphs: [
        'Hello,',
        `Thank you for signing up for ${args.brand}! Please use the following verification code to complete your email verification:`,
      ],
      highlight: args.token,
      footNote: `This verification code will expire in ${args.minutes} minutes. If you did not sign up for a ${args.brand} account, please ignore this email.`,
    }),
  }),

  resetCode: (args: TemplateArgs): Template => ({
    subject: `${args.brand} | Password Reset`,
    html: emailShell({
      heading: 'Password Reset',
      paragraphs: [
        'Hello,',
        'We received your password reset request. Please use the following reset code to set a new password:',
      ],
      highlight: args.token,
      footNote: `This reset code will expire in ${args.minutes} minutes. If you did not request a password reset, please ignore this email or contact our customer service team.`,
    }),
  }),

  changeEmail: (args: TemplateArgs): Template => ({
    subject: `${args.brand} | Confirm Email Change`,
    html: emailShell({
      heading: 'Confirm Email Change',
      paragraphs: [
        'Hello,',
        'We received your email change request. Please use the following verification code to confirm your new email:',
      ],
      highlight: args.token,
      footNote: `This verification code will expire in ${args.minutes} minutes. If you did not request an email change, please contact our customer service team immediately.`,
    }),
  }),

  franchiseInvitation: (args: FranchiseInvitationArgs): Template => ({
    subject: `You're invited to join the ${args.brand} franchise on Tymoe`,
    html: emailShell({
      heading: `You're invited to join the ${args.brand} franchise`,
      paragraphs: [
        'Hello,',
        `<strong style="color:#0f172a;">${args.brand}</strong> has invited you to run your own franchise location on Tymoe. Click the button below to accept the invitation, set up your store details, and create your own login — you'll manage this location entirely on your own.`,
      ],
      button: { label: 'Join now', href: args.link },
      footNote: `This invitation will expire in ${args.days} days. If you weren't expecting this invitation, you can safely ignore this email.`,
    }),
  }),

  // 员工/老板重置 PIN 码后，把新 PIN 发到本人邮箱，不再直接显示在管理界面上
  accountPinReset: (args: AccountCredentialResetArgs): Template => ({
    subject: `${args.brand} | Your PIN Code Has Been Reset`,
    html: emailShell({
      heading: 'Your PIN Code Has Been Reset',
      paragraphs: [
        `Hello ${args.recipientName},`,
        'Your PIN code for POS login has just been reset. Your new PIN code is:',
      ],
      highlight: args.value,
      footNote: 'Please keep this PIN confidential. If you did not request this change, contact your manager immediately.',
    }),
  }),

  // 员工重置后台登录密码后，把新密码发到本人邮箱，不再直接显示在管理界面上
  accountPasswordReset: (args: AccountCredentialResetArgs): Template => ({
    subject: `${args.brand} | Your Login Password Has Been Reset`,
    html: emailShell({
      heading: 'Your Login Password Has Been Reset',
      paragraphs: [
        `Hello ${args.recipientName},`,
        'Your password for the Portal admin login has just been reset. Your new password is:',
      ],
      highlight: args.value,
      footNote: 'Please keep this password confidential and change it after logging in if possible. If you did not request this change, contact your manager immediately.',
    }),
  }),
};
