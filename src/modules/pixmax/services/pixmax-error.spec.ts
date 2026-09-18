import {
  describePixmaxError,
  extractPixmaxErrorCode,
  PixmaxFriendlyError,
  toPixmaxFriendlyError,
} from './pixmax-error';

const COPYRIGHT_RAW =
  'PIXMAX_ASSET_COMPLIANCE_FAILED:{"errorCode":"InputImageSensitiveContentDetected.PolicyViolation","errorMessage":"The request failed because the input image may be related to copyright restrictions. Request ID: 20260917190747D2115FCCE0B8B8DE449C_asset-20260917190747-g2j9z"}';

describe('pixmax error translation', () => {
  it('图片版权审核失败翻译成中文，并标出是哪几镜的画面', () => {
    const message = describePixmaxError(COPYRIGHT_RAW, '第 2、5 镜的画面');
    expect(message).toBe(
      '第 2、5 镜的画面可能涉及版权内容（如知名 IP、动漫或影视形象、品牌标识等），没有通过平台审核。请换成原创或没有版权风险的图片后重试。',
    );
    expect(extractPixmaxErrorCode(COPYRIGHT_RAW)).toBe(
      'InputImageSensitiveContentDetected.PolicyViolation',
    );
  });

  it('包装成友好异常时保留原始信息，重复包装不改写', () => {
    const friendly = toPixmaxFriendlyError(
      new Error(COPYRIGHT_RAW),
      '第 1 镜的画面',
    );
    expect(friendly).toBeInstanceOf(PixmaxFriendlyError);
    expect(friendly.message.startsWith('第 1 镜的画面可能涉及版权内容')).toBe(
      true,
    );
    expect(friendly.detail).toContain('Request ID');
    expect(toPixmaxFriendlyError(friendly, '参考图')).toBe(friendly);
  });

  it('常见错误都有中文说明', () => {
    expect(
      describePixmaxError(
        'PIXMAX_API_FAILED:InputTextSensitiveContentDetected:xx',
      ),
    ).toContain('脚本或分镜描述里有平台不允许的敏感内容');
    expect(describePixmaxError('PIXMAX_TASK_RESOURCE_INSUFFICIENT')).toBe(
      'PixMax 积分不足，请充值后重新生成。',
    );
    expect(
      describePixmaxError(
        'PIXMAX_API_FAILED:OpenApi.RateLimit.Exceeded:OpenAPI rate limit exceeded',
      ),
    ).toBe('请求 PixMax 太频繁，请稍等片刻再试。');
    expect(describePixmaxError('PIXMAX_NETWORK_ERROR:fetch failed')).toBe(
      '连接 PixMax 失败，请检查网络后重试。',
    );
    expect(describePixmaxError('PIXMAX_ASSET_COMPLIANCE_TIMEOUT')).toBe(
      '参考图的平台审核超过 90 秒仍未出结果，请稍后重试。',
    );
  });

  it('中文原文直接展示；未知英文错误给通用说明并附错误码', () => {
    expect(describePixmaxError('生成内容违反平台规范，请修改后重试')).toBe(
      '生成内容违反平台规范，请修改后重试',
    );
    expect(
      describePixmaxError(
        'PIXMAX_API_FAILED:{"code":"SomethingWeird","message":"boom"}',
      ),
    ).toBe('视频生成失败，请稍后重试（错误码：SomethingWeird）。');
  });
});
