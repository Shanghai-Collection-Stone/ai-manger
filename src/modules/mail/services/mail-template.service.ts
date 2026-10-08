import { Injectable } from '@nestjs/common';
import {
  MAIL_BRAND_NAME,
  type MailRenderedContent,
  type MailTemplateContent,
} from '../entities/mail.entity.js';

/** @type {string} 正文字体栈，覆盖 Windows / macOS / 移动端常见中文字体。 */
const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',Helvetica,Arial,sans-serif";

/** @type {string} 验证码等宽字体栈。 */
const MONO_STACK = "Consolas,'SFMono-Regular',Menlo,'Courier New',monospace";

/**
 * @description 把时间格式化为北京时间 `YYYY-MM-DD HH:mm`，供邮件信息表格使用
 * @keyword-cn 邮件时间格式, 北京时间
 * @keyword-en mail-datetime-format, beijing-time
 * @param date 时间。
 * @returns {string} 格式化后的时间。
 */
export function formatMailDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

/**
 * @description 把大陆手机号中间四位替换为星号，邮件内展示登录账号时使用
 * @keyword-cn 邮件手机号脱敏, 手机号脱敏
 * @keyword-en mask-mail-phone, masked-phone
 * @param phone 手机号。
 * @returns {string} 脱敏手机号，非 11 位时原样返回。
 */
export function maskMailPhone(phone: string): string {
  return String(phone ?? '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

/**
 * @description 平台邮件模板服务：把文案结构渲染成统一品牌版式的 HTML（表格布局 + 内联样式，兼容 Outlook / QQ 邮箱 / Gmail）
 *   与纯文本两份，所有文案先转义再拼接。
 * @keyword-cn 邮件模板服务, 统一版式
 * @keyword-en mail-template-service, unified-layout
 */
@Injectable()
export class MailTemplateService {
  /**
   * @description 渲染模板邮件，主题统一加品牌前缀
   * @keyword-cn 渲染模板邮件, 主题前缀
   * @keyword-en render-mail-template, subject-prefix
   * @param content 邮件文案结构。
   * @returns {MailRenderedContent} 主题、纯文本与 HTML。
   */
  render(content: MailTemplateContent): MailRenderedContent {
    const subject = `【${MAIL_BRAND_NAME}】${content.subject}`;
    return {
      subject,
      text: this.renderText(content),
      html: this.renderHtml(subject, content),
    };
  }

  /**
   * @description 生成纯文本版本，供不显示 HTML 的客户端与模拟发信日志使用
   * @keyword-cn 纯文本邮件, 降级展示
   * @keyword-en plain-text-mail, text-fallback
   * @param content 邮件文案结构。
   * @returns {string} 纯文本正文。
   */
  private renderText(content: MailTemplateContent): string {
    const blocks: string[] = [
      `【${MAIL_BRAND_NAME}】${content.title}`,
      content.greeting || '您好：',
      ...content.paragraphs,
    ];
    if (content.code) {
      blocks.push(
        [`验证码：${content.code}`, content.codeHint ?? '']
          .filter(Boolean)
          .join('\n'),
      );
    }
    if (content.details?.length) {
      blocks.push(
        content.details.map((row) => `${row.label}：${row.value}`).join('\n'),
      );
    }
    blocks.push(...(content.afterParagraphs ?? []));
    if (content.notice) blocks.push(`提示：${content.notice}`);
    blocks.push(`${MAIL_BRAND_NAME}团队`);
    blocks.push(`——\n此邮件由系统自动发送，请勿直接回复。`);
    return blocks.join('\n\n');
  }

  /**
   * @description 生成品牌版式 HTML：深色页眉、正文、验证码框、信息表格、提示框与页脚
   * @keyword-cn 邮件HTML版式, 品牌页眉
   * @keyword-en mail-html-layout, brand-header
   * @param subject 带品牌前缀的主题。
   * @param content 邮件文案结构。
   * @returns {string} 完整 HTML 文档。
   */
  private renderHtml(subject: string, content: MailTemplateContent): string {
    const e = (value: string): string => this.escapeHtml(value);
    const paragraph = (value: string): string =>
      `<p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#334155;">${e(value)}</p>`;

    const code = content.code
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 12px;">
<tr><td style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 28px;font-family:${MONO_STACK};font-size:32px;font-weight:700;letter-spacing:8px;color:#1d4ed8;">${e(content.code)}</td></tr>
</table>${
          content.codeHint
            ? `<p style="margin:0 0 20px;font-size:13px;line-height:1.7;color:#64748b;">${e(content.codeHint)}</p>`
            : ''
        }`
      : '';

    const details = content.details?.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;border-spacing:0;">
${content.details
  .map(
    (row, index) =>
      `<tr><td style="width:96px;padding:12px 16px;background-color:#f8fafc;font-size:14px;line-height:1.6;color:#64748b;white-space:nowrap;${
        index === 0 ? '' : 'border-top:1px solid #e2e8f0;'
      }">${e(row.label)}</td><td style="padding:12px 16px;font-size:14px;line-height:1.6;color:#0f172a;word-break:break-all;${
        index === 0 ? '' : 'border-top:1px solid #e2e8f0;'
      }">${e(row.value)}</td></tr>`,
  )
  .join('\n')}
</table>`
      : '';

    const notice = content.notice
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;">
<tr><td style="background-color:#fffbeb;border-left:4px solid #f59e0b;border-radius:4px;padding:12px 16px;font-size:13px;line-height:1.7;color:#92400e;">${e(content.notice)}</td></tr>
</table>`
      : '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${e(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;font-family:${FONT_STACK};">
<tr><td style="background-color:#0f172a;padding:20px 32px;font-size:18px;font-weight:700;letter-spacing:1px;color:#ffffff;">${e(MAIL_BRAND_NAME)}</td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background-color:#2563eb;">&nbsp;</td></tr>
<tr><td style="padding:32px 32px 8px;">
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.4;font-weight:700;color:#0f172a;">${e(content.title)}</h1>
${paragraph(content.greeting || '您好：')}
${content.paragraphs.map(paragraph).join('\n')}
${code}
${details}
${(content.afterParagraphs ?? []).map(paragraph).join('\n')}
${notice}
<p style="margin:24px 0 0;font-size:15px;line-height:1.75;color:#334155;">${e(MAIL_BRAND_NAME)}团队</p>
</td></tr>
<tr><td style="padding:24px 32px 28px;">
<div style="border-top:1px solid #e2e8f0;padding-top:16px;font-size:12px;line-height:1.7;color:#94a3b8;">此邮件由系统自动发送，请勿直接回复。<br>&copy; ${new Date().getFullYear()} ${e(MAIL_BRAND_NAME)}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  }

  /**
   * @description 转义 HTML 特殊字符，防止文案里的用户输入（昵称、团队名、拒绝原因）注入标签
   * @keyword-cn HTML转义, 邮件安全
   * @keyword-en html-escape, email-safety
   * @param value 原始文本。
   * @returns {string} 转义后的文本。
   */
  private escapeHtml(value: string): string {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}
