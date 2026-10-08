import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { MailTemplateContent } from '../../mail/entities/mail.entity.js';
import { MailService } from '../../mail/services/mail.service.js';
import {
  formatMailDateTime,
  maskMailPhone,
} from '../../mail/services/mail-template.service.js';
import type { JoinNotifyResult } from '../entities/tenant-join.entity.js';

/**
 * @description 入驻审批邮件通知服务：按平台统一版式发送审核结果，邮件失败只返回状态而不影响审批事务
 * @keyword-cn 入驻邮件通知, 审批解耦
 * @keyword-en join-email-notification, approval-decoupling
 */
@Injectable()
export class TenantJoinNotifyService {
  private readonly logger = new Logger(TenantJoinNotifyService.name);

  constructor(private readonly mail: MailService) {}

  /**
   * @description 发送入驻申请通过通知：团队名、脱敏登录账号、审核时间与登录指引
   * @keyword-cn 申请通过邮件, 手机号脱敏
   * @keyword-en approval-email, masked-phone
   */
  async sendApproved(input: {
    email?: string;
    displayName: string;
    tenantName: string;
    phone: string;
  }): Promise<JoinNotifyResult> {
    if (!input.email?.trim()) return { status: 'skipped' };
    const phone = maskMailPhone(input.phone);
    return this.sendSafely(input.email.trim(), {
      subject: `您加入「${input.tenantName}」的申请已通过`,
      preheader: `您已成为「${input.tenantName}」团队成员，登录客户端即可开始使用。`,
      title: '入驻申请已通过',
      greeting: this.greeting(input.displayName),
      paragraphs: [
        `您加入「${input.tenantName}」团队的申请已由管理员审核通过，您现在已是该团队成员。`,
      ],
      details: [
        { label: '团队名称', value: input.tenantName },
        { label: '登录账号', value: phone },
        { label: '审核结果', value: '已通过' },
        { label: '审核时间', value: formatMailDateTime(new Date()) },
      ],
      afterParagraphs: [
        `请打开 AI 营销官客户端，使用手机号 ${phone} 登录，在团队列表中选择「${input.tenantName}」即可开始使用。`,
      ],
      notice: '如对审核结果有疑问，请联系该团队管理员。',
    });
  }

  /**
   * @description 发送入驻申请拒绝通知：团队名、审核结果与拒绝原因
   * @keyword-cn 申请拒绝邮件, 拒绝原因
   * @keyword-en rejection-email, rejection-reason
   */
  async sendRejected(input: {
    email?: string;
    displayName: string;
    tenantName: string;
    reason?: string;
  }): Promise<JoinNotifyResult> {
    if (!input.email?.trim()) return { status: 'skipped' };
    return this.sendSafely(input.email.trim(), {
      subject: `您加入「${input.tenantName}」的申请未通过`,
      preheader: `您加入「${input.tenantName}」团队的申请暂未通过审核。`,
      title: '入驻申请未通过',
      greeting: this.greeting(input.displayName),
      paragraphs: [
        `很遗憾，您加入「${input.tenantName}」团队的申请暂未通过审核。`,
      ],
      details: [
        { label: '团队名称', value: input.tenantName },
        { label: '审核结果', value: '未通过' },
        { label: '原因说明', value: input.reason?.trim() || '管理员未填写' },
        { label: '审核时间', value: formatMailDateTime(new Date()) },
      ],
      afterParagraphs: ['如有疑问，请联系该团队管理员了解详情。'],
    });
  }

  /**
   * @description 生成称呼，昵称为空时退回通用称呼
   * @keyword-cn 邮件称呼, 昵称兜底
   * @keyword-en mail-greeting, display-name-fallback
   */
  private greeting(displayName: string): string | undefined {
    const name = displayName?.trim();
    return name ? `${name}，您好：` : undefined;
  }

  /**
   * @description 按统一版式发送模板邮件，并把异常收敛成通知状态
   * @keyword-cn 安全发送邮件, 通知失败记录
   * @keyword-en safe-mail-send, notification-failure-record
   */
  private async sendSafely(
    to: string,
    content: MailTemplateContent,
  ): Promise<JoinNotifyResult> {
    try {
      await this.mail.sendTemplate(to, content);
      return { status: 'sent' };
    } catch (error) {
      const response =
        error instanceof HttpException ? error.getResponse() : undefined;
      const message =
        response && typeof response === 'object' && 'message' in response
          ? String(response.message)
          : error instanceof Error
            ? error.message
            : String(error);
      this.logger.warn(`入驻审批邮件发送失败：${message}`);
      return { status: 'failed', error: message.slice(0, 1000) };
    }
  }
}
