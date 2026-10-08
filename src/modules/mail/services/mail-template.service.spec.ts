import {
  formatMailDateTime,
  maskMailPhone,
  MailTemplateService,
} from './mail-template.service';

describe('MailTemplateService', () => {
  const service = new MailTemplateService();

  it('主题加品牌前缀，验证码、信息表格与提示框同时出现在 HTML 与纯文本里', () => {
    const rendered = service.render({
      subject: '邮箱验证码',
      preheader: '您的验证码是 123456',
      title: '验证您的邮箱',
      paragraphs: ['您正在注册 AI 营销官账号：'],
      code: '123456',
      codeHint: '10 分钟内有效',
      details: [{ label: '登录账号', value: '138****0000' }],
      notice: '请勿告诉他人',
    });
    expect(rendered.subject).toBe('【AI 营销官】邮箱验证码');
    for (const piece of ['123456', '10 分钟内有效', '138****0000', '请勿告诉他人']) {
      expect(rendered.html).toContain(piece);
      expect(rendered.text).toContain(piece);
    }
    expect(rendered.text.startsWith('【AI 营销官】验证您的邮箱')).toBe(true);
    expect(rendered.text).toContain('验证码：123456');
    expect(rendered.html).toContain('您好：');
  });

  it('用户输入的文案会被转义，不能注入标签', () => {
    const rendered = service.render({
      subject: '测试',
      preheader: '预览',
      title: '<b>标题</b>',
      greeting: '<script>alert(1)</script>，您好：',
      paragraphs: ['团队「A & B」'],
      details: [{ label: '原因说明', value: '"><img src=x onerror=alert(1)>' }],
    });
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain('&lt;b&gt;标题&lt;/b&gt;');
    expect(rendered.html).toContain('A &amp; B');
  });

  it('时间按北京时间格式化，手机号中间四位脱敏', () => {
    expect(formatMailDateTime(new Date('2026-09-30T06:08:00Z'))).toBe(
      '2026-09-30 14:08',
    );
    expect(formatMailDateTime(new Date('2026-09-30T16:05:00Z'))).toBe(
      '2026-10-01 00:05',
    );
    expect(maskMailPhone('15912342810')).toBe('159****2810');
    expect(maskMailPhone('abc')).toBe('abc');
  });
});
